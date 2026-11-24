"""Type table: how a value is applied to an entity, per domain.

To support a new domain, add an entry to ENTITY_TYPES (and to the TS_TYPES
table of the card, which builds the matching form fields).
"""

from __future__ import annotations

from dataclasses import dataclass
import logging

from homeassistant.components import persistent_notification
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class EntityType:
    """Behaviour of one entity domain."""

    kind: str  # "toggle" (on / off) or "options" (one of the "options" attribute)

    def valid_values(self, hass: HomeAssistant, entity_id: str) -> list[str] | None:
        """Values accepted by the entity (None: unknown)."""
        if self.kind == "toggle":
            return ["on", "off"]
        state = hass.states.get(entity_id)
        return list(state.attributes.get("options", [])) if state else None


ENTITY_TYPES: dict[str, EntityType] = {
    "switch": EntityType("toggle"),
    "input_boolean": EntityType("toggle"),
    "select": EntityType("options"),
    "input_select": EntityType("options"),
}

SUPPORTED_DOMAINS = tuple(ENTITY_TYPES)


def normalize_value(value) -> str:
    """YAML booleans (on / off written without quotes) become "on" / "off"."""
    if isinstance(value, bool):
        return "on" if value else "off"
    return "" if value is None else str(value)


def current_value(hass: HomeAssistant, entity_id: str) -> str | None:
    """Current value of an entity, or None when it is unavailable."""
    state = hass.states.get(entity_id)
    if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
        return None
    return state.state


async def async_apply(hass: HomeAssistant, entity_id: str, value: str) -> None:
    """Applies a value to an entity (nothing is done if it already has it)."""
    domain = entity_id.split(".")[0]
    entity_type = ENTITY_TYPES.get(domain)
    if entity_type is None:
        _notify(hass, f"Unsupported entity type: {entity_id}")
        return
    if current_value(hass, entity_id) == value:
        return
    if entity_type.kind == "toggle":
        service = "turn_on" if value.lower() in ("on", "true") else "turn_off"
        data = {"entity_id": entity_id}
    else:
        if value not in (entity_type.valid_values(hass, entity_id) or []):
            _notify(hass, f"Unknown option '{value}' for {entity_id}.")
            return
        service = "select_option"
        data = {"entity_id": entity_id, "option": value}
    try:
        await hass.services.async_call(domain, service, data, blocking=True)
    except Exception as err:  # noqa: BLE001 - one failing entity must not stop the others
        _LOGGER.warning("Could not set %s to %s: %s", entity_id, value, err)
        _notify(hass, f"Could not set {entity_id} to '{value}': {err}")


def _notify(hass: HomeAssistant, message: str) -> None:
    persistent_notification.async_create(hass, message, title="Timed Scenes")
