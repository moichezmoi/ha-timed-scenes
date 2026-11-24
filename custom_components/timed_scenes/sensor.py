"""sensor.timed_scenes: read-only view of the scenes, used by the card and by automations.

State: number of scenes. Attribute "scenes": the scenes as stored by the manager.
The attribute is not recorded in the history database (it changes often and is
only useful live).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .manager import TimedScenesManager


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Creates the sensor."""
    async_add_entities([TimedScenesSensor(entry.runtime_data)])


class TimedScenesSensor(SensorEntity):
    """Mirror of the manager's scenes."""

    _attr_has_entity_name = False
    _attr_name = "Timed scenes"
    _attr_unique_id = f"{DOMAIN}_registry"
    _attr_icon = "mdi:calendar-clock"
    _attr_should_poll = False
    _unrecorded_attributes = frozenset({"scenes"})

    def __init__(self, manager: TimedScenesManager) -> None:
        self._manager = manager

    async def async_added_to_hass(self) -> None:
        """Updates the sensor after every change of the manager."""
        self.async_on_remove(self._manager.async_add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        return len(self._manager.scenes)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"scenes": deepcopy(self._manager.scenes)}
