// Tests of the card and its dialog (timed-scene-card.js) in jsdom with a fake Home Assistant.
const { JSDOM } = require("jsdom");
const fs = require("fs");

const path = require("path");
// Card file: first argument, or the one of this repository.
const cardFile = process.argv[2] || path.join(__dirname, "..", "..", "custom_components", "timed_scenes", "frontend", "timed-scene-card.js");
const src = fs.readFileSync(cardFile, "utf8");
const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(`
  customElements.define("ha-form", class extends HTMLElement {});
  customElements.define("ha-card", class extends HTMLElement {});
  customElements.define("ha-icon", class extends HTMLElement {});
`);
w.eval(src);

let ok = 0, ko = 0;
const check = (label, cond, extra) => {
  if (cond) { ok++; console.log("  ✔ " + label); }
  else { ko++; console.log("  ✖ " + label + (extra !== undefined ? "   [" + JSON.stringify(extra) + "]" : "")); }
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const text = (el) => (el.shadowRoot.querySelector("ha-card") || el.shadowRoot).textContent.replace(/\s+/g, " ").trim();

const calls = [];
let nextResponse = { ok: true };
function makeHass(scenes, language = "en") {
  return {
    language, locale: { language },
    config: { time_zone: "Europe/Paris" }, themes: { darkMode: true },
    states: {
      "sensor.timed_scenes": { state: String(Object.keys(scenes).length), attributes: { scenes } },
      "select.heater_mode": { state: "frost", attributes: { friendly_name: "Heater mode", options: ["comfort", "eco", "frost", "off"] } },
      "switch.heater_schedule": { state: "on", attributes: { friendly_name: "Heater schedule" } },
      "input_boolean.boost": { state: "off", attributes: { friendly_name: "Boost" } },
    },
    connection: { sendMessagePromise: async (msg) => { calls.push(msg); return { response: nextResponse }; } },
  };
}

const config = {
  scene_id: "heater",
  title: "Heater override",
  default_duration: "51:30:00", // 2 days 3 h 30 min
  entities: [
    { entity: "select.heater_mode", name: "Mode", start: { mode: "ask", default: "eco" }, end: { mode: "fixed", value: "frost" } },
    { entity: "switch.heater_schedule", start: { mode: "fixed", value: false }, end: { mode: "previous" } },
    { entity: "input_boolean.boost", start: { mode: "ask", default: "off" }, end: { mode: "ask", default: "on" } },
  ],
};
const planned = {
  heater: {
    start: "2026-11-12T14:00:00+01:00", end: "2026-11-12T17:00:00+01:00", status: "planned",
    entities: [
      { entity: "select.heater_mode", start_value: "comfort", end_mode: "value", end_value: "frost" },
      { entity: "switch.heater_schedule", start_value: "off", end_mode: "previous", end_value: "" },
      { entity: "input_boolean.boost", start_value: "on", end_mode: "value", end_value: "off" },
    ],
  },
};

(async () => {
  const C = w.customElements.get("timed-scene-card");

  console.log("\n=== setConfig validation ===");
  for (const [cfg, expected] of [
    [{ entities: [] }, "scene_id"],
    [{ scene_id: "x", entities: [] }, "non-empty"],
    [{ scene_id: "x", entities: [{ entity: "light.a", start: { mode: "fixed", value: "on" } }] }, "unsupported"],
    [{ scene_id: "x", entities: [{ entity: "switch.a", start: { mode: "bad" } }] }, "start.mode"],
    [{ scene_id: "x", entities: [{ entity: "switch.a", start: { mode: "fixed" } }] }, "start.value"],
  ]) {
    let msg = "";
    try { new C().setConfig(cfg); } catch (e) { msg = e.message; }
    check(`rejects config (${expected})`, msg.includes(expected), msg);
  }

  console.log("\n=== Card display ===");
  const card = new C();
  w.document.body.appendChild(card);
  card.setConfig(config);
  card.hass = makeHass({});
  const btn = (a) => card.shadowRoot.querySelector(`[data-action="${a}"]`);
  check("nothing planned: one line, no status text, Plan in header", text(card) === "Heater override Plan" && btn("plan") && btn("plan").closest(".header"), text(card));
  check("Plan button is a text button (no 'primary' class)", !btn("plan").classList.contains("primary"));

  card.hass = makeHass(planned);
  let tx = text(card);
  check("planned: dates", tx.includes("Planned · Thu 12/11 14:00 → 17:00"), tx);
  check("planned: values indented under status", card.shadowRoot.querySelector(".body .value") && /margin: 2px 0 0 16px/.test(card.shadowRoot.querySelector("style").textContent));
  check("planned: Mode: comfort / Boost: on → off", tx.includes("Mode: comfort") && tx.includes("Boost: on → off"), tx);
  check("planned: fixed value hidden", !tx.includes("Heater schedule"), tx);
  check("planned: Clear (red) + Edit", btn("clear") && btn("clear").classList.contains("danger") && btn("edit") && !btn("stop"));

  card.hass = makeHass({ heater: { ...planned.heater, status: "ongoing" } }, "fr");
  tx = text(card);
  check("running (FR): 'En cours · jusqu'à' + Arrêter / Modifier", tx.includes("En cours · jusqu'à") && btn("stop") && tx.includes("Arrêter") && tx.includes("Modifier") && !btn("clear"), tx);

  console.log("\n=== Preview mode (card editor / dashboard edit mode) ===");
  card.hass = makeHass({});
  card.preview = true;
  check("preview: buttons disabled", btn("plan").disabled === true);
  btn("plan").click();
  await tick();
  const dlgEl = w.document.querySelector("timed-scene-dialog");
  check("preview: no dialog opened", !dlgEl || dlgEl.shadowRoot.innerHTML === "");
  card.preview = false;
  check("preview off: buttons enabled", btn("plan").disabled === false);

  console.log("\n=== Dialog: plan ===");
  btn("plan").click();
  await tick();
  const dlg = w.document.querySelector("timed-scene-dialog");
  const sr = dlg.shadowRoot;
  check("title 'Plan a timed scene'", sr.querySelector("h2").textContent === "Plan a timed scene");
  const dates = [...sr.querySelectorAll('input[type="datetime-local"]')];
  const dur = [...sr.querySelectorAll(".duration input")];
  check("start + end native fields, end disabled", dates.length === 2 && dates[1].disabled && !dates[0].disabled);
  check("duration dd:hh:mm (no seconds) = 2 d 03 h 30 min", dur.length === 3 && dur.map((i) => i.value).join(":") === "2:03:30", dur.map((i) => i.value));
  check("end prefilled = start + default duration", (() => {
    const s = Date.parse(dates[0].value + ":00Z"), e = Date.parse(dates[1].value + ":00Z");
    return (e - s) / 60000 === 2 * 1440 + 210;
  })(), dates.map((d) => d.value));
  const forms = [...sr.querySelectorAll("ha-form")];
  check("one ha-form per value field (start_0, start_2, end_2)", forms.map((f) => f.schema[0].name).join(",") === "start_0,start_2,end_2", forms.map((f) => f.schema[0].name));
  check("ask defaults prefilled", forms[0].data.start_0 === "eco" && forms[1].data.start_2 === false && forms[2].data.end_2 === true);
  check("field label = entity name", forms[0].computeLabel() === "Mode" && forms[1].computeLabel() === "Boost");

  // user edits: start date, duration 7 days, mode comfort, boost on
  dates[0].value = "2026-11-20T08:00"; dates[0].dispatchEvent(new w.Event("change"));
  dur[0].value = "7"; dur[0].dispatchEvent(new w.Event("change"));
  dur[1].value = "0"; dur[1].dispatchEvent(new w.Event("change"));
  dur[2].value = "90"; dur[2].dispatchEvent(new w.Event("change"));
  check("duration normalized (90 min → 1 h 30)", dur.map((i) => i.value).join(":") === "7:01:30", dur.map((i) => i.value));
  forms[0].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { start_0: "comfort" } } }));
  forms[1].dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { start_2: true } } }));
  sr.querySelector('[data-action="confirm"]').click();
  await tick();
  check("save calls timed_scenes.set with return_response", calls.at(-1).domain === "timed_scenes" && calls.at(-1).service === "set" && calls.at(-1).return_response === true, calls.at(-1));
  let sd = calls.at(-1).service_data;
  check("payload: start, duration with days, no end", sd.start === "2026-11-20 08:00:00" && JSON.stringify(sd.duration) === '{"days":7,"hours":1,"minutes":30,"seconds":0}' && sd.end === undefined, sd);
  check("payload entities", JSON.stringify(sd.entities) === JSON.stringify([
    { entity: "select.heater_mode", start_value: "comfort", end_mode: "value", end_value: "frost" },
    { entity: "switch.heater_schedule", start_value: "off", end_mode: "previous" },
    { entity: "input_boolean.boost", start_value: "on", end_mode: "value", end_value: "on" },
  ]), sd.entities);
  check("dialog closed after success", sr.innerHTML === "");

  console.log("\n=== Dialog: End radio + errors ===");
  btn("plan").click();
  await tick();
  const radios = sr.querySelectorAll('.choice > input[type="radio"]');
  radios[1].checked = true; radios[1].dispatchEvent(new w.Event("change"));
  check("End selected: duration inputs disabled, end enabled", [...sr.querySelectorAll(".duration input")].every((i) => i.disabled) && !sr.querySelectorAll('input[type="datetime-local"]')[1].disabled);
  nextResponse = { ok: false, errors: ["end must be after start"] };
  sr.querySelector('[data-action="confirm"]').click();
  await tick();
  sd = calls.at(-1).service_data;
  check("payload: end sent, no duration", sd.end && sd.duration === undefined, sd);
  check("errors displayed, dialog kept open", !sr.querySelector(".errors").hidden && sr.textContent.includes("end must be after start"));
  sr.querySelector('[data-action="cancel"]').click();
  nextResponse = { ok: true };

  console.log("\n=== Dialog: edit ===");
  card.hass = makeHass(planned);
  btn("edit").click();
  await tick();
  check("title 'Edit the planned scene'", sr.querySelector("h2").textContent === "Edit the planned scene");
  const d3 = [...sr.querySelectorAll('input[type="datetime-local"]')].map((d) => d.value);
  check("stored start / end", d3[0] === "2026-11-12T14:00" && d3[1] === "2026-11-12T17:00", d3);
  check("duration = end - start (0:03:00)", [...sr.querySelectorAll(".duration input")].map((i) => i.value).join(":") === "0:03:00");
  const f3 = [...sr.querySelectorAll("ha-form")];
  check("stored ask values", f3[0].data.start_0 === "comfort" && f3[1].data.start_2 === true && f3[2].data.end_2 === false);
  sr.querySelector('[data-action="cancel"]').click();

  console.log("\n=== Dialog: clear / stop ===");
  btn("clear").click();
  await tick();
  check("clear: title + text + button", sr.querySelector("h2").textContent === "Clear the planned scene?" && sr.textContent.includes("The planned scene will be removed.") && sr.querySelector('[data-action="confirm"]').textContent === "Clear");
  sr.querySelector('[data-action="confirm"]').click();
  await tick();
  check("clear calls timed_scenes.delete", calls.at(-1).domain === "timed_scenes" && calls.at(-1).service === "delete" && calls.at(-1).service_data.id === "heater");
  card.hass = makeHass({ heater: { ...planned.heater, status: "ongoing" } });
  btn("stop").click();
  await tick();
  check("stop: title + text + button", sr.querySelector("h2").textContent === "Stop the running scene?" && sr.textContent.includes("restored now") && sr.querySelector('[data-action="confirm"]').textContent === "Stop");
  sr.querySelector('[data-action="confirm"]').click();
  await tick();
  check("stop calls timed_scenes.delete", calls.at(-1).domain === "timed_scenes" && calls.at(-1).service === "delete");

  console.log(`\nResult: ${ok}/${ok + ko} checks OK`);
  process.exitCode = ko ? 1 : 0;
})();
