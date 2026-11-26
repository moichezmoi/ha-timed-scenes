"""Starts a real Home Assistant with the timed_scenes integration and runs scenarios.

Usage (from the repository root):
    pip install homeassistant home-assistant-frontend numpy
    python tests/integration/run_tests.py

A temporary configuration directory is created with tests/integration/configuration.yaml
and custom_components/timed_scenes. A second Home Assistant start checks that the
scenes survive a restart.
"""
import asyncio, sys, logging, os, shutil, subprocess, tempfile
from datetime import timedelta
from homeassistant import bootstrap
from homeassistant.runner import RuntimeConfig
import homeassistant.util.dt as dt_util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SERVICES = {"timed_scene_set": "set", "timed_scene_delete": "delete", "rename": "rename"}
RAD = "select.heater_mode"
S1 = "input_boolean.schedule_weekdays"
S2 = "input_boolean.schedule_weekend"
results = []


def check(label, cond, extra=""):
    results.append((label, bool(cond)))
    print(("  ✔ " if cond else "  ✖ ") + label + (f"   [{extra}]" if extra and not cond else ""))


async def start_hass(cfg):
    rc = RuntimeConfig(config_dir=cfg, safe_mode=False, recovery_mode=False, debug=False,
                       verbose=False, log_rotate_days=None, log_file=None, log_no_color=True,
                       skip_pip=True, skip_pip_packages=[])
    hass = await bootstrap.async_setup_hass(rc)
    await hass.async_start()
    await hass.async_block_till_done()
    logging.getLogger().setLevel(logging.WARNING)
    if not hass.config_entries.async_entries("timed_scenes"):
        # Same as "Add integration" in the user interface.
        flow = await hass.config_entries.flow.async_init("timed_scenes", context={"source": "user"})
        await hass.config_entries.flow.async_configure(flow["flow_id"], {})
        await hass.async_block_till_done()
    return hass


async def main(cfg):
    hass = await start_hass(cfg)

    st = lambda e: hass.states.get(e).state
    scenes = lambda: (hass.states.get("sensor.timed_scenes").attributes.get("scenes") or {}) if hass.states.get("sensor.timed_scenes") else {}

    async def call(script, **data):
        r = await hass.services.async_call("timed_scenes", SERVICES[script], data, blocking=True, return_response=True)
        await hass.async_block_till_done()
        return r

    async def tick():
        # No engine to wake up any more: timers fire at the exact time. Just let things settle.
        await asyncio.sleep(0.5)
        await hass.async_block_till_done()
        await asyncio.sleep(0.5)
        await hass.async_block_till_done()

    async def setv(e, v):
        if e.startswith("select."):
            await hass.services.async_call("select", "select_option", {"entity_id": e, "option": v}, blocking=True)
        else:
            await hass.services.async_call("input_boolean", "turn_" + v, {"entity_id": e}, blocking=True)
        await hass.async_block_till_done()

    now = lambda: dt_util.now()
    iso = lambda d: d.isoformat()

    print("\n=== Initial state ===")
    print("  sensor.timed_scenes :", hass.states.get("sensor.timed_scenes"))
    await setv(RAD, "frost_protection"); await setv(S1, "on"); await setv(S2, "off")

    print("\n=== 1. Validation ===")
    r = await call("timed_scene_set", id="Bad Id", start=iso(now() + timedelta(hours=1)),
                   end=iso(now()), entities=[{"entity": "switch.does_not_exist", "start_value": "off"}])
    print("  response:", r)
    check("rejected with errors", r and r.get("ok") is False and len(r.get("errors", [])) >= 3)

    print("\n=== 2. Simple scene (duration takes precedence) ===")
    ents = [
        {"entity": RAD, "start_value": "eco", "end_mode": "previous"},
        {"entity": S1, "start_value": "off", "end_mode": "previous"},
        {"entity": S2, "start_value": "off", "end_mode": "previous"},
    ]
    r = await call("timed_scene_set", id="heater", start=iso(now() - timedelta(seconds=1)),
                   end=iso(now() + timedelta(hours=5)), duration={"hours": 0, "minutes": 0, "seconds": 4}, entities=ents)
    print("  response:", r)
    await tick()
    sc = scenes().get("heater", {})
    check("duration takes precedence over end", r.get("ok") and (dt_util.parse_datetime(sc.get("end")) - dt_util.parse_datetime(sc.get("start"))).total_seconds() < 10, sc)
    check("immediate start: status ongoing", sc.get("status") == "ongoing", sc.get("status"))
    check("heater in eco", st(RAD) == "eco", st(RAD))
    check("weekdays schedule switched off", st(S1) == "off", st(S1))
    check("previous values stored", sc.get("previous") == {RAD: "frost_protection", S1: "on", S2: "off"}, sc.get("previous"))
    await asyncio.sleep(4)
    await tick()
    check("end: scene removed", "heater" not in scenes(), scenes())
    check("end: heater restored", st(RAD) == "frost_protection", st(RAD))
    check("end: weekdays schedule switched back on", st(S1) == "on", st(S1))
    check("end: weekend schedule left off", st(S2) == "off", st(S2))

    print("\n=== 3. end_mode value / none ===")
    ents = [
        {"entity": RAD, "start_value": "comfort", "end_mode": "value", "end_value": "eco"},
        {"entity": S1, "start_value": False, "end_mode": "none"},  # YAML boolean "off"
    ]
    r = await call("timed_scene_set", id="t3", start=iso(now()), duration="00:00:03", entities=ents)
    await tick()
    check("start: comfort + schedule off (boolean normalized)", st(RAD) == "comfort" and st(S1) == "off", (st(RAD), st(S1), r))
    await asyncio.sleep(3); await tick()
    check("end: fixed value eco", st(RAD) == "eco", st(RAD))
    check("end: none → schedule left off", st(S1) == "off", st(S1))
    await setv(RAD, "frost_protection"); await setv(S1, "on")

    print("\n=== 4. Stack: Y (long) then X (short) on the same entities ===")
    y = [{"entity": RAD, "start_value": "eco", "end_mode": "previous"},
         {"entity": S1, "start_value": "off", "end_mode": "previous"}]
    x = [{"entity": RAD, "start_value": "comfort", "end_mode": "previous"},
         {"entity": S1, "start_value": "off", "end_mode": "previous"}]
    await call("timed_scene_set", id="y", start=iso(now()), duration={"seconds": 9}, entities=y)
    await tick()
    await asyncio.sleep(1.1)
    await call("timed_scene_set", id="x", start=iso(now()), duration={"seconds": 3}, entities=x)
    await tick()
    check("X starts: comfort (most recent wins)", st(RAD) == "comfort", st(RAD))
    check("X copied Y's original values", scenes()["x"]["previous"] == {RAD: "frost_protection", S1: "on"}, scenes()["x"]["previous"])
    await asyncio.sleep(3.2); await tick()
    check("X ends: back to eco (Y's value)", st(RAD) == "eco", st(RAD))
    check("X ends: schedule still off (held by Y)", st(S1) == "off", st(S1))
    check("Y untouched", scenes().get("y", {}).get("previous") == {RAD: "frost_protection", S1: "on"}, scenes().get("y"))
    await asyncio.sleep(5); await tick()
    check("Y ends: heater frost_protection", st(RAD) == "frost_protection", st(RAD))
    check("Y ends: schedule switched back on", st(S1) == "on", st(S1))
    check("registry empty", scenes() == {}, scenes())

    print("\n=== 5. Delete while running ===")
    await call("timed_scene_set", id="d", start=iso(now()), duration={"hours": 1},
               entities=[{"entity": RAD, "start_value": "eco", "end_mode": "previous"},
                         {"entity": S1, "start_value": "off", "end_mode": "previous"}])
    await tick()
    check("running", st(RAD) == "eco" and st(S1) == "off")
    r = await call("timed_scene_delete", id="d")
    await tick()
    check("deleted and restored", "d" not in scenes() and st(RAD) == "frost_protection" and st(S1) == "on", (r, st(RAD), st(S1)))

    print("\n=== 6. Editing a running scene ===")
    base = [{"entity": RAD, "start_value": "eco", "end_mode": "previous"},
            {"entity": S1, "start_value": "off", "end_mode": "previous"}]
    await call("timed_scene_set", id="m", start=iso(now()), duration={"hours": 1}, entities=base)
    await tick()
    # 6a: new mode, still in the window, without the schedule
    await call("timed_scene_set", id="m", start=iso(now() - timedelta(minutes=1)), duration={"hours": 1},
               entities=[{"entity": RAD, "start_value": "comfort", "end_mode": "previous"}])
    await tick()
    sc = scenes()["m"]
    check("re-apply: comfort", st(RAD) == "comfort", st(RAD))
    check("removed entity released: schedule switched back on", st(S1) == "on", st(S1))
    check("previous kept (frost_protection)", sc["previous"].get(RAD) == "frost_protection", sc["previous"])
    # 6b: moved to the future
    await call("timed_scene_set", id="m", start=iso(now() + timedelta(hours=2)), duration={"hours": 1},
               entities=[{"entity": RAD, "start_value": "comfort", "end_mode": "previous"}])
    await tick()
    sc = scenes()["m"]
    check("moved: status planned", sc["status"] == "planned", sc)
    check("moved: heater restored", st(RAD) == "frost_protection", st(RAD))
    await call("timed_scene_delete", id="m"); await tick()

    print("\n=== 7. Scene expired while Home Assistant was stopped ===")
    await call("timed_scene_set", id="exp", start=iso(now() + timedelta(seconds=1)), duration={"seconds": 2},
               entities=[{"entity": RAD, "start_value": "eco", "end_mode": "previous"}])
    entry = hass.config_entries.async_entries("timed_scenes")[0]
    await hass.config_entries.async_unload(entry.entry_id)  # integration stopped
    await asyncio.sleep(3.5)
    await hass.config_entries.async_setup(entry.entry_id)    # back after the window
    await tick()
    check("removed without touching the heater", "exp" not in scenes() and st(RAD) == "frost_protection", (scenes(), st(RAD)))

    print("\n=== 7b. Exact start time (timer, no polling) ===")
    await call("timed_scene_set", id="timer", start=iso(now() + timedelta(seconds=2)), duration={"seconds": 2},
               entities=[{"entity": RAD, "start_value": "comfort", "end_mode": "previous"}])
    check("planned, not started yet", scenes()["timer"]["status"] == "planned" and st(RAD) == "frost_protection")
    await asyncio.sleep(2.6); await hass.async_block_till_done()
    check("started by its timer", st(RAD) == "comfort" and scenes()["timer"]["status"] == "ongoing", (st(RAD), scenes().get("timer")))
    await asyncio.sleep(2.2); await hass.async_block_till_done()
    check("stopped by its timer", st(RAD) == "frost_protection" and "timer" not in scenes(), (st(RAD), scenes()))

    print("\n=== 8. Payload in the card format (local time string, duration with days) ===")
    start = now().strftime("%Y-%m-%d %H:%M:00")
    r = await call("timed_scene_set", id="card", start=start,
                   duration={"days": 1, "hours": 2, "minutes": 30, "seconds": 0},
                   entities=[{"entity": RAD, "start_value": "comfort", "end_mode": "value", "end_value": "frost_protection"},
                             {"entity": S1, "start_value": "off", "end_mode": "previous"}])
    await tick()
    sc = scenes().get("card", {})
    span = (dt_util.parse_datetime(sc["end"]) - dt_util.parse_datetime(sc["start"])).total_seconds() if sc else 0
    check("accepted, end = start + 1 d 2 h 30", r.get("ok") and span == 26.5 * 3600, r)
    check("running: heater comfort, schedule off", st(RAD) == "comfort" and st(S1) == "off", (st(RAD), st(S1)))
    await call("timed_scene_delete", id="card"); await tick()
    check("deleted: heater frost_protection, schedule on", st(RAD) == "frost_protection" and st(S1) == "on", (st(RAD), st(S1)))

    print("\n=== 8b. Card served by the integration ===")
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get("http://127.0.0.1:8123/timed_scenes_static/timed-scene-card.js") as resp:
            body = await resp.text()
            check("card file served (HTTP 200, card v0.5.0)", resp.status == 200 and 'TS_VERSION = "0.5.0"' in body, resp.status)
    # The frontend injects these URLs in every page (and pushes them live to open browsers).
    extra = hass.data["frontend_extra_module_url"].urls
    check("frontend loads the card (with version)", "/timed_scenes_static/timed-scene-card.js?v=0.5.0" in extra, sorted(extra))
    entry = hass.config_entries.async_entries("timed_scenes")[0]
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    extra = hass.data["frontend_extra_module_url"].urls
    check("reload: card registered once, no error", sorted(extra).count("/timed_scenes_static/timed-scene-card.js?v=0.5.0") == 1, sorted(extra))

    print("\n=== 8c. Rename (scene ID of a card changed) ===")
    r = await call("rename", id="nothing_here", new_id="x")
    check("unknown scene refused", r.get("ok") is False and any("unknown scene" in e for e in r["errors"]), r)
    await call("timed_scene_set", id="old_id", start=iso(now() + timedelta(seconds=2)), duration={"seconds": 2},
               entities=[{"entity": RAD, "start_value": "comfort", "end_mode": "previous"}])
    await call("timed_scene_set", id="taken", start=iso(now() + timedelta(hours=5)), duration={"hours": 1},
               entities=[{"entity": RAD, "start_value": "eco", "end_mode": "previous"}])
    r = await call("rename", id="old_id", new_id="Bad Id")
    check("invalid new id refused", r.get("ok") is False and any("invalid new id" in e for e in r["errors"]), r)
    r = await call("rename", id="old_id", new_id="taken")
    check("existing new id refused (no overwrite)", r.get("ok") is False and any("already exists" in e for e in r["errors"]) and "old_id" in scenes(), r)
    r = await call("rename", id="old_id", new_id="new_id")
    check("planned scene renamed", r.get("ok") and "new_id" in scenes() and "old_id" not in scenes() and scenes()["new_id"]["status"] == "planned", (r, list(scenes())))
    await asyncio.sleep(2.6); await hass.async_block_till_done()
    check("renamed scene started by its timer", st(RAD) == "comfort" and scenes()["new_id"]["status"] == "ongoing", (st(RAD), scenes().get("new_id")))
    r = await call("rename", id="new_id", new_id="running_id")
    check("running scene renamed, stored values kept", r.get("ok") and scenes()["running_id"]["status"] == "ongoing" and scenes()["running_id"]["previous"].get(RAD) == "frost_protection", scenes().get("running_id"))
    await asyncio.sleep(2.2); await hass.async_block_till_done()
    check("renamed running scene ended and restored", st(RAD) == "frost_protection" and "running_id" not in scenes(), (st(RAD), list(scenes())))
    await call("timed_scene_delete", id="taken"); await tick()

    print("\n=== 9. Planned scene kept for the restart test ===")
    r = await call("timed_scene_set", id="persist", start=iso(now() + timedelta(days=1)), duration={"hours": 3},
                   entities=[{"entity": RAD, "start_value": "eco", "end_mode": "previous"}])
    check("saved", "persist" in scenes(), r)

    await hass.async_stop()
    ok = sum(1 for _, c in results if c)
    print(f"\nScenarios: {ok}/{len(results)} checks OK")
    return ok == len(results)


async def restart_check(cfg):
    """Second start on the same configuration: the planned scene must still be there."""
    hass = await start_hass(cfg)
    await asyncio.sleep(1)
    s = hass.states.get("sensor.timed_scenes")
    scenes = (s.attributes.get("scenes") or {}) if s else {}
    check("registry restored after restart", "persist" in scenes and scenes["persist"]["status"] == "planned", list(scenes))
    await hass.async_stop()
    return "persist" in scenes


if __name__ == "__main__":
    # Each Home Assistant run happens in its own process; this one only orchestrates.
    if len(sys.argv) == 3 and sys.argv[1] == "--scenarios":
        sys.exit(0 if asyncio.run(main(sys.argv[2])) else 1)
    if len(sys.argv) == 3 and sys.argv[1] == "--restart-check":
        sys.exit(0 if asyncio.run(restart_check(sys.argv[2])) else 1)
    cfg = tempfile.mkdtemp(prefix="timed_scenes_test_")
    try:
        os.makedirs(os.path.join(cfg, "custom_components"))
        shutil.copy(os.path.join(HERE, "configuration.yaml"), cfg)
        shutil.copytree(os.path.join(ROOT, "custom_components", "timed_scenes"),
                        os.path.join(cfg, "custom_components", "timed_scenes"))
        ok = subprocess.run([sys.executable, __file__, "--scenarios", cfg]).returncode == 0
        print("\n=== Restart ===")
        restarted = subprocess.run([sys.executable, __file__, "--restart-check", cfg]).returncode == 0
    finally:
        shutil.rmtree(cfg, ignore_errors=True)
    print("\nALL TESTS PASSED" if ok and restarted else "\nSOME TESTS FAILED")
    sys.exit(0 if ok and restarted else 1)
