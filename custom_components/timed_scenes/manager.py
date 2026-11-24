"""Core of Timed Scenes: stores the scenes, starts and stops them at the right time.

A scene is stored as:

    {
        "start": "2026-11-24T14:00:00+01:00",   # ISO, Home Assistant time zone
        "end":   "2026-11-24T17:00:00+01:00",
        "status": "planned" | "ongoing",
        "entities": [                            # applied in this order
            {"entity": "select.x", "start_value": "eco",
             "end_mode": "value" | "previous" | "none", "end_value": "comfort"},
        ],
        "previous": {"select.x": "comfort"},     # values before the scene (filled at start)
        "started_at": 1795530234.4 | None,       # used to find the most recent scene (stack)
        "reapply": false,                        # scene edited while running
    }

Rules (same as the former YAML package):
- one scene per id: saving an existing id replaces it;
- at the end, each entity gets its end value, its previous value, or is left unchanged;
- entities shared by running scenes behave like a stack: the most recently
  started scene wins, and the original value is restored by the last one;
- deleting a running scene restores its entities immediately;
- a scene whose window passed while Home Assistant was stopped is dropped,
  with a notification.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timedelta
import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import persistent_notification
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
import homeassistant.util.dt as dt_util

from .const import DOMAIN
from .entity_types import SUPPORTED_DOMAINS, async_apply, current_value, normalize_value

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = DOMAIN
ID_PATTERN = re.compile(r"^[a-z0-9_]+$")
ENTITY_PATTERN = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
END_MODES = ("value", "previous", "none")


def _parse_datetime(value: Any) -> datetime | None:
    """Accepts a datetime or a string ("2026-11-24 14:00:00", ISO...). Naive = HA time zone."""
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str) and value.strip():
        result = dt_util.parse_datetime(value.strip())
    else:
        return None
    if result is None:
        return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=dt_util.get_default_time_zone())
    return dt_util.as_local(result)


def _parse_duration(value: Any) -> timedelta | None:
    """Accepts {days, hours, minutes, seconds}, "HH:MM:SS" or a number of seconds."""
    if value in (None, "", {}):
        return None
    try:
        duration = cv.time_period(value)
    except vol.Invalid:
        return None
    return duration if duration.total_seconds() > 0 else None


class TimedScenesManager:
    """Keeps the scenes, persists them and drives the timers."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.scenes: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()  # one operation at a time (timers, services)
        self._timers: list[CALLBACK_TYPE] = []
        self._listeners: list[Callable[[], None]] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        """Loads the stored scenes (called at setup)."""
        data = await self._store.async_load() or {}
        self.scenes = data.get("scenes", {})

    async def async_start(self) -> None:
        """Catches up with what happened while Home Assistant was stopped, then schedules timers.

        Called once Home Assistant has started, so that the controlled entities exist.
        """
        await self.async_reconcile()

    @callback
    def async_shutdown(self) -> None:
        """Cancels the timers (unload)."""
        self._cancel_timers()

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Registers a callback called after every change (used by the sensor)."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    # ------------------------------------------------------------------
    # Public operations (services)
    # ------------------------------------------------------------------

    async def async_set(self, data: dict[str, Any]) -> dict[str, Any]:
        """Validates then creates or replaces a scene. Returns {ok, errors} or {ok, id, start, end}."""
        scene_id, start, end, items, errors = self._validate(data)
        if errors:
            return {"ok": False, "errors": errors}

        async with self._lock:
            old = self.scenes.get(scene_id)
            running = old is not None and old["status"] == "ongoing"
            if running:
                # Entities removed from a running scene are released now.
                kept = {item["entity"] for item in items}
                removed = [item for item in old["entities"] if item["entity"] not in kept]
                if removed:
                    await self._release(scene_id, removed, old["previous"])
            self.scenes[scene_id] = {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "status": "ongoing" if running else "planned",
                "entities": items,
                "previous": old["previous"] if running else {},
                "started_at": old["started_at"] if running else None,
                "reapply": running,
            }
            await self._save()
        await self.async_reconcile()
        return {"ok": True, "id": scene_id, "start": start.isoformat(), "end": end.isoformat()}

    async def async_delete(self, scene_id: str) -> dict[str, Any]:
        """Deletes a scene, restoring its entities if it is running."""
        async with self._lock:
            scene = self.scenes.get(scene_id)
            if scene is None:
                return {"ok": False, "id": scene_id}
            if scene["status"] == "ongoing":
                await self._stop(scene_id, remove=True)
            else:
                self.scenes.pop(scene_id)
            await self._save()
        await self.async_reconcile()
        return {"ok": True, "id": scene_id}

    # ------------------------------------------------------------------
    # Engine
    # ------------------------------------------------------------------

    async def async_reconcile(self) -> None:
        """Compares the scenes with the current time, starts / stops them, reschedules timers.

        Two passes: starts first, then stops. When a scene ends exactly when another one
        starts on the same entities, the new one takes over without any bounce.
        """
        async with self._lock:
            now = dt_util.now()
            changed = False
            # Pass 1: starts and re-applies
            for scene_id in list(self.scenes):
                scene = self.scenes[scene_id]
                start, end = self._window(scene)
                if start <= now < end and (scene["status"] == "planned" or scene.get("reapply")):
                    await self._start(scene_id)
                    changed = True
            # Pass 2: stops and expired scenes
            for scene_id in list(self.scenes):
                scene = self.scenes.get(scene_id)
                if scene is None:
                    continue
                start, end = self._window(scene)
                if scene["status"] == "ongoing" and now >= end:
                    await self._stop(scene_id, remove=True)
                    changed = True
                elif scene["status"] == "ongoing" and now < start:
                    await self._stop(scene_id, remove=False)
                    changed = True
                elif scene["status"] == "planned" and now >= end:
                    self.scenes.pop(scene_id)
                    persistent_notification.async_create(
                        self.hass,
                        f"Scene '{scene_id}' ({scene['start']} → {scene['end']}) expired without being "
                        "applied (Home Assistant was probably stopped).",
                        title="Timed Scenes",
                    )
                    changed = True
            if changed:
                await self._save()
            self._schedule()
        self._notify_listeners()

    def _schedule(self) -> None:
        """One timer per upcoming start or end."""
        self._cancel_timers()
        now = dt_util.now()
        moments = set()
        for scene in self.scenes.values():
            start, end = self._window(scene)
            moment = start if scene["status"] == "planned" else end
            moments.add(max(moment, now + timedelta(seconds=1)))
        for moment in moments:
            self._timers.append(async_track_point_in_time(self.hass, self._on_timer, moment))

    @callback
    def _on_timer(self, _now: datetime) -> None:
        self.hass.async_create_task(self.async_reconcile())

    def _cancel_timers(self) -> None:
        for cancel in self._timers:
            cancel()
        self._timers = []

    # ------------------------------------------------------------------
    # Start / stop / release (called with the lock held)
    # ------------------------------------------------------------------

    async def _start(self, scene_id: str) -> None:
        """Stores the original values, then applies the start values in list order."""
        scene = self.scenes[scene_id]
        own = scene.get("previous") or {}
        previous: dict[str, str] = {}
        for item in scene["entities"]:
            entity_id = item["entity"]
            if entity_id in own:  # 1. already stored by this scene (re-apply)
                previous[entity_id] = own[entity_id]
                continue
            # 2. stored by another running scene holding the entity: the current value
            #    is the one forced by that scene, not the original one.
            inherited = next(
                (
                    other["previous"][entity_id]
                    for other_id, other in self.scenes.items()
                    if other_id != scene_id and other["status"] == "ongoing" and entity_id in other["previous"]
                ),
                None,
            )
            value = inherited if inherited is not None else current_value(self.hass, entity_id)  # 3. current
            if value is not None:
                previous[entity_id] = value
        scene["previous"] = previous
        scene["status"] = "ongoing"
        scene["reapply"] = False
        if scene.get("started_at") is None:
            scene["started_at"] = dt_util.utcnow().timestamp()
        for item in scene["entities"]:
            await async_apply(self.hass, item["entity"], item["start_value"])

    async def _stop(self, scene_id: str, remove: bool) -> None:
        """Restores the entities, then removes the scene or sets it back to planned."""
        scene = self.scenes[scene_id]
        await self._release(scene_id, scene["entities"], scene.get("previous") or {})
        if remove:
            self.scenes.pop(scene_id)
        else:
            scene.update(status="planned", previous={}, started_at=None, reapply=False)

    async def _release(self, scene_id: str, items: list[dict[str, Any]], previous: dict[str, str]) -> None:
        """Releases entities of a scene, in order (stack behaviour for shared entities)."""
        for item in items:
            entity_id = item["entity"]
            holder = self._most_recent_holder(scene_id, entity_id)
            if holder is not None:
                await async_apply(self.hass, entity_id, holder)
            elif item["end_mode"] == "value":
                await async_apply(self.hass, entity_id, item["end_value"])
            elif item["end_mode"] == "previous" and entity_id in previous:
                await async_apply(self.hass, entity_id, previous[entity_id])
            # end_mode "none": entity left unchanged

    def _most_recent_holder(self, scene_id: str, entity_id: str) -> str | None:
        """Start value of the most recently started OTHER running scene holding the entity."""
        best: tuple[float, str] | None = None
        for other_id, other in self.scenes.items():
            if other_id == scene_id or other["status"] != "ongoing":
                continue
            for item in other["entities"]:
                if item["entity"] == entity_id:
                    started = other.get("started_at") or 0
                    if best is None or started > best[0]:
                        best = (started, item["start_value"])
        return best[1] if best else None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _window(scene: dict[str, Any]) -> tuple[datetime, datetime]:
        return dt_util.parse_datetime(scene["start"]), dt_util.parse_datetime(scene["end"])

    def _validate(self, data: dict[str, Any]):
        """Normalizes the service data and lists the errors (same messages as the YAML version)."""
        errors: list[str] = []
        scene_id = str(data.get("id", ""))
        if not ID_PATTERN.match(scene_id):
            errors.append("invalid id (lowercase letters, digits and _ only)")
        start = _parse_datetime(data.get("start"))
        if start is None:
            errors.append("invalid start")
        duration = _parse_duration(data.get("duration"))
        end = None
        if start is not None:
            end = start + duration if duration else _parse_datetime(data.get("end"))
            if end is None:
                errors.append("missing end or duration")
            elif end <= start:
                errors.append("end must be after start")
            elif end <= dt_util.now():
                errors.append("end is already in the past")

        raw = data.get("entities")
        raw = raw if isinstance(raw, list) else []
        items = []
        for entry in raw:
            entry = entry if isinstance(entry, dict) else {}
            item = {
                "entity": str(entry.get("entity", "")),
                "start_value": normalize_value(entry.get("start_value")),
                "end_mode": str(entry.get("end_mode", "previous")),
                "end_value": normalize_value(entry.get("end_value")),
            }
            items.append(item)
        if not items:
            errors.append("no entity")
        for item in items:
            entity_id = item["entity"]
            if not ENTITY_PATTERN.match(entity_id) or self.hass.states.get(entity_id) is None:
                errors.append(f"unknown entity: {entity_id}")
            elif entity_id.split(".")[0] not in SUPPORTED_DOMAINS:
                errors.append(f"unsupported entity type: {entity_id}")
            if item["start_value"] == "":
                errors.append(f"missing start_value: {entity_id}")
            if item["end_mode"] not in END_MODES:
                errors.append(f"invalid end_mode: {entity_id}")
            elif item["end_mode"] == "value" and item["end_value"] == "":
                errors.append(f"missing end_value: {entity_id}")
        return scene_id, start, end, items, errors

    async def _save(self) -> None:
        await self._store.async_save({"scenes": self.scenes})

    @callback
    def _notify_listeners(self) -> None:
        for listener in list(self._listeners):
            listener()
