# Timed Scenes for Home Assistant

Temporarily apply states to a list of entities during a time window, then restore them.

Typical use: *"tomorrow from 14:00, put the heater in eco mode for 3 hours, then go back to its schedule"* —
or *"switch everything to frost protection during my week of holidays"*.

## Features

- **A dashboard card** to plan, edit, clear or stop the timed scene of a device, with a visual editor.
- **Ordered entities**: values are applied in the order of the list, at the start and at the end.
- **Per-entity start value**: fixed in the card configuration, or asked when planning the scene.
- **Per-entity end value**: fixed, asked when planning, *restore* the value it had before the scene, or leave it *unchanged*.
- **Schedules friendly**: schedule switches (e.g. the [Scheduler](https://github.com/nielsfaber/scheduler-component)
  integration) can be switched off during the scene and restored afterwards. The card editor suggests the
  schedules that control an entity.
- **Overlapping scenes** on the same entities are handled like a stack: the most recently started scene wins,
  and the original value is restored when the last one ends.
- **Exact timing**: scenes start and end at the planned second.
- **Robust**: scenes survive Home Assistant restarts; a scene whose window passed while Home Assistant was
  stopped is dropped with a notification.
- **English and French** user interface.

Supported entity domains: `switch`, `input_boolean`, `select`, `input_select`.

## Installation

Developed and tested with Home Assistant 2026.11. Minimum version: 2026.2.

### From the Marketplace

1. *Settings → Marketplace → Add from link*, and enter `https://github.com/moichezmoi/ha-timed-scenes`.
2. Install **Timed Scenes**, then restart Home Assistant if asked.
3. *Settings → Devices & services → Add integration → Timed Scenes*.

### Manual

1. Copy `custom_components/timed_scenes` to `<config>/custom_components/timed_scenes`.
2. Restart Home Assistant.
3. *Settings → Devices & services → Add integration → Timed Scenes*.

The card is provided by the integration: there is no dashboard resource to declare. After an update,
reload the browser page to get the new version of the card.

## The card

Add a **Timed Scene** card to a dashboard and configure it with the visual editor. Equivalent YAML:

```yaml
type: custom:timed-scene-card
scene_id: living_room_heater      # cards sharing the same scene_id control the same scene
title: Heater override
default_duration: "03:00:00"      # HH:MM:SS, hours may exceed 24 ("168:00:00" = 7 days)
entities:
  - entity: select.living_room_heater_mode
    name: Mode                    # optional display name
    start:
      mode: ask                   # fixed | ask
      default: eco
    end:
      mode: fixed                 # fixed | ask | previous | none
      value: comfort
  - entity: switch.living_room_heater_schedule
    start:
      mode: fixed
      value: "off"
    end:
      mode: previous              # restore the value it had before the scene
```

| Option | Description |
|---|---|
| `scene_id` | Required. Lowercase letters, digits and `_`. |
| `title` | Card title. |
| `default_duration` | Duration proposed when planning a new scene. |
| `entities[].entity` | Entity to control. |
| `entities[].name` | Name displayed in the card and the dialog. |
| `entities[].start.mode` | `fixed` (use `value`) or `ask` (asked when planning, prefilled with `default`). |
| `entities[].end.mode` | `fixed` (`value`), `ask` (`default`), `previous` (restore) or `none` (leave unchanged). |
| `entities[].show` | `true` / `false` to force showing / hiding the value in the card. By default, asked values are shown. |

## Actions

The card uses two actions, which can also be called from automations and scripts.

### `timed_scenes.set`

Creates a scene, or replaces the scene with the same `id`.

```yaml
action: timed_scenes.set
data:
  id: living_room_heater
  start: "2026-12-24 14:00:00"
  duration: { hours: 3 }          # or end: "2026-12-24 17:00:00", or "03:00:00", or seconds
  entities:
    - entity: select.living_room_heater_mode
      start_value: eco
      end_mode: value             # value | previous | none
      end_value: comfort
    - entity: switch.living_room_heater_schedule
      start_value: "off"
      end_mode: previous
response_variable: result         # {ok: true, id, start, end} or {ok: false, errors: [...]}
```

### `timed_scenes.delete`

Deletes the scene `id`. If it is running, its entities are restored immediately.

```yaml
action: timed_scenes.delete
data:
  id: living_room_heater
```

## The `sensor.timed_scenes` entity

Its state is the number of scenes, and its `scenes` attribute contains every scene with its `status`
(`planned` or `ongoing`). It can be used in automations, for example:

```yaml
condition: template
value_template: >
  {{ (state_attr('sensor.timed_scenes', 'scenes') or {}).get('living_room_heater', {}).get('status') == 'ongoing' }}
```

## Development

Tests are in `tests/` and run automatically on GitHub for every push:

- **Integration** — starts a real Home Assistant with the integration and runs scenarios, including a restart:
  ```bash
  pip install homeassistant==2026.2.3 home-assistant-frontend==20260128.6 numpy
  python tests/integration/run_tests.py
  ```
- **Card** — runs the card, the dialog and the editor in a simulated browser (jsdom) with a fake Home Assistant:
  ```bash
  cd tests/card && npm install && npm test
  ```

## AI disclosure

Generative AI (Claude, by Anthropic) was used during the development of this project to:

- help understand how Home Assistant works internally;
- give advice while designing the features;
- generate code and tests, which were reviewed, tested and validated before being integrated.

## License

[MIT](LICENSE)
