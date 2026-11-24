"""Timed Scenes: temporarily apply states to entities during a time window, then restore them."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.start import async_at_started

from .const import DOMAIN
from .manager import TimedScenesManager

PLATFORMS = [Platform.SENSOR]

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

    hass.services.async_register(DOMAIN, "set", handle_set, SET_SCHEMA, supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "delete", handle_delete, DELETE_SCHEMA, supports_response=SupportsResponse.OPTIONAL)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

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
    return unloaded
