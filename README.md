# Timed Scenes for Home Assistant

Temporarily apply states to a list of entities during a time window, then restore them.

Typical use: *"tomorrow from 14:00, put the heater in eco mode for 3 hours, then go back to its schedule"* —
or *"switch everything to frost protection during my week of holidays"*.

> **Status: pre-release.** The backend is currently a YAML *package* installed by hand.
> It will be turned into a custom integration installable from the Home Assistant Marketplace.

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
- **Robust**: scenes survive Home Assistant restarts; a scene whose window passed while Home Assistant was
  stopped is dropped with a notification.
- **English and French** user interface.

Supported entity domains: `switch`, `input_boolean`, `select`, `input_select`.

## How it works

| Part | File | Role |
|---|---|---|
| Registry | `packages/timed_scene.yaml` | `sensor.timed_scenes` stores every scene in its `scenes` attribute. |
| Scripts | `packages/timed_scene.yaml` | `script.timed_scene_set` and `script.timed_scene_delete` (public), plus internal scripts. |
| Engine | `packages/timed_scene.yaml` | Automation checking every minute (and at startup) which scenes start or end. |
| Card | `www/timed-scene/timed-scene-card.js` | `custom:timed-scene-card`: display, planning dialog and visual editor. |

## Installation (manual)

Developed and tested with Home Assistant 2026.11.

### 1. Backend

1. Copy `packages/timed_scene.yaml` to `<config>/packages/timed_scene.yaml`.
2. Enable packages in `configuration.yaml` if not done yet:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
3. *Developer tools → YAML → Check configuration*, then restart Home Assistant.
4. Check that `sensor.timed_scenes` exists.

### 2. Card

1. Copy `www/timed-scene/timed-scene-card.js` to `<config>/www/timed-scene/timed-scene-card.js`.
2. *Settings → Dashboards → ⋮ → Resources → Add resource*:
   - URL: `/local/timed-scene/timed-scene-card.js?v=0.3.2`
   - Type: *JavaScript module*
3. Reload the browser page (Ctrl+F5).

When updating the card, change the `?v=` number of the resource so browsers load the new file.

## Card configuration

The card has a visual editor. Equivalent YAML:

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

## Using the scripts from automations

```yaml
action: script.timed_scene_set
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
```

The script returns `{ok: true}` or `{ok: false, errors: [...]}`. Saving a scene with an existing `id`
replaces it. `script.timed_scene_delete` (`id`) removes a scene, restoring the entities immediately if it is running.

## Development

Tests are in `tests/`:

- **Backend** — starts a real Home Assistant with the package and runs scenarios, including a restart:
  ```bash
  pip install homeassistant home-assistant-frontend numpy
  python tests/backend/run_tests.py
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
