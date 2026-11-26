"""Timed Scenes: temporarily apply states to entities during a time window, then restore them."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.start import async_at_started
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .manager import TimedScenesManager

PLATFORMS = [Platform.SENSOR]

# The card is served by the integration: no dashboard resource to declare.
CARD_URL_BASE = f"/{DOMAIN}_static"
CARD_FILE = "timed-scene-card.js"
DATA_CARD = f"{DOMAIN}_card"

type TimedScenesConfigEntry = ConfigEntry[TimedScenesManager]

# Loose schemas: detailed validation is done by the manager, which returns
# readable errors ({ok: false, errors: [...]}) instead of raising.
SET_SCHEMA = vol.Schema(
    {
        vol.Required("id"): cv.string,
        vol.Required("start"): vol.Any(cv.string, cv.datetime),
        vol.Optional("end"): vol.Any(None, cv.string, cv.datetime),
        vol.Optional("duration"): vol.Any(None, dict, cv.string, vol.Coerce(float)),
        vol.Required("entities"): list,
    }
)
DELETE_SCHEMA = vol.Schema({vol.Required("id"): cv.string})
RENAME_SCHEMA = vol.Schema({vol.Required("id"): cv.string, vol.Required("new_id"): cv.string})

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup_entry(hass: HomeAssistant, entry: TimedScenesConfigEntry) -> bool:
    """Set up Timed Scenes from its config entry (created with "Add integration")."""
    manager = TimedScenesManager(hass)
    await manager.async_load()
    entry.runtime_data = manager

    async def handle_set(call: ServiceCall) -> ServiceResponse:
        return await manager.async_set(dict(call.data))

    async def handle_delete(call: ServiceCall) -> ServiceResponse:
        return await manager.async_delete(call.data["id"])

    async def handle_rename(call: ServiceCall) -> ServiceResponse:
        return await manager.async_rename(call.data["id"], call.data["new_id"])

    hass.services.async_register(DOMAIN, "set", handle_set, SET_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete", handle_delete, DELETE_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "rename", handle_rename, RENAME_SCHEMA, supports_response=SupportsResponse.OPTIONAL)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _async_register_card(hass)

    # Scenes are started / stopped once Home Assistant runs: the controlled
    # entities (Zigbee devices, schedules...) must exist first.
    async def _started(_hass: HomeAssistant) -> None:
        await manager.async_start()

    entry.async_on_unload(async_at_started(hass, _started))
    entry.async_on_unload(manager.async_shutdown)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TimedScenesConfigEntry) -> bool:
    """Unload the integration (removal or reload)."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.services.async_remove(DOMAIN, "set")
        hass.services.async_remove(DOMAIN, "delete")
        hass.services.async_remove(DOMAIN, "rename")
        card = hass.data.get(DATA_CARD)
        if card and card["url"]:
            remove_extra_js_url(hass, card["url"])
            card["url"] = None
    return unloaded


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serves frontend/timed-scene-card.js and loads it on every page of the frontend.

    The version of the integration is added to the URL (?v=0.4.0): after an
    update, browsers load the new file instead of the one in their cache.
    """
    card = hass.data.setdefault(DATA_CARD, {"path_registered": False, "url": None})
    if not card["path_registered"]:
        # A static path cannot be unregistered: register it once per Home Assistant run.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL_BASE, str(Path(__file__).parent / "frontend"), cache_headers=False)]
        )
        card["path_registered"] = True
    if card["url"] is None:
        integration = await async_get_integration(hass, DOMAIN)
        card["url"] = f"{CARD_URL_BASE}/{CARD_FILE}?v={integration.version}"
        add_extra_js_url(hass, card["url"])
