"""Config flow: lets the user add Timed Scenes from Settings > Devices & services.

There is nothing to configure: one confirmation step creates the (single) entry.
"single_config_entry" in manifest.json prevents adding it twice.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class TimedScenesConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the creation of the Timed Scenes entry."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirmation step shown when the user adds the integration."""
        if user_input is not None:
            return self.async_create_entry(title="Timed Scenes", data={})
        return self.async_show_form(step_id="user")
