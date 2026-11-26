// Tests of the visual editor (timed-scene-card-editor) in jsdom with a fake Home Assistant.
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
const tick = () => new Promise((r) => setTimeout(r, 20));
const fire = (form, value) => form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: { [form.schema[0].name]: value } } }));

function makeHass(withScheduler) {
  const states = {
    "select.heater_mode": { entity_id: "select.heater_mode", state: "frost", attributes: { friendly_name: "Heater mode", options: ["comfort", "eco", "frost"] } },
    "switch.plug": { entity_id: "switch.plug", state: "on", attributes: { friendly_name: "Plug" } },
  };
  if (withScheduler) {
    states["switch.schedule_weekdays"] = { entity_id: "switch.schedule_weekdays", state: "on", attributes: { friendly_name: "Weekdays", entities: ["select.heater_mode"] } };
    states["switch.schedule_weekend"] = { entity_id: "switch.schedule_weekend", state: "off", attributes: { friendly_name: "Weekend", entities: "select.heater_mode" } };
  }
  return { language: "en", locale: { language: "en" }, config: { time_zone: "Europe/Paris" }, states, connection };
}
const calls = [];
let nextResponse = { ok: true };
const connection = { sendMessagePromise: async (msg) => { calls.push(msg); return { response: nextResponse }; } };
function withScenes(hass, scenes) {
  return { ...hass, states: { ...hass.states, "sensor.timed_scenes": { entity_id: "sensor.timed_scenes", state: "1", attributes: { scenes } } } };
}

(async () => {
  const Card = w.customElements.get("timed-scene-card");

  console.log("\n=== Stub config & editor element ===");
  const stub = Card.getStubConfig(makeHass(true));
  check("stub uses an existing select with ask mode", stub.entities[0].entity === "select.heater_mode" && stub.entities[0].start.mode === "ask");
  let err = ""; try { new Card().setConfig(stub); } catch (e) { err = e.message; }
  check("stub config is valid for the card", err === "", err);

  console.log("\n=== General section ===");
  const ed = Card.getConfigElement();
  w.document.body.appendChild(ed);
  let emitted = null;
  ed.addEventListener("config-changed", (e) => (emitted = e.detail.config));
  ed.hass = makeHass(true);
  ed.setConfig({ ...stub, title: "Heater", scene_id: "heater", default_duration: "168:00:00" });
  await tick();
  const general = () => ed.shadowRoot.querySelector(".general");
  const gForms = () => [...general().querySelectorAll("ha-form")];
  check("general: one ha-form per field (title, scene_id) + own duration field", gForms().map((f) => f.schema[0].name).join(",") === "title,scene_id" && general().querySelector(".duration"));
  check("general fields spaced by our CSS (.fields)", general().classList.contains("fields") && /\.fields > \* \+ \* \{ margin-top: 8px; \}/.test(ed.shadowRoot.querySelector("style").textContent));
  check("scene ID help under its field", gForms()[1].computeHelper().startsWith("Cards sharing"));
  const durInputs = () => [...general().querySelectorAll(".duration input")];
  check("default duration 168 h shown as 7 d 00 h 00 min", durInputs().map((i) => i.value).join(":") === "7:00:00", durInputs().map((i) => i.value));
  durInputs()[0].value = "1"; durInputs()[0].dispatchEvent(new w.Event("change"));
  durInputs()[1].value = "2"; durInputs()[1].dispatchEvent(new w.Event("change"));
  check("default duration stored as HH:MM:SS (26 h)", emitted.default_duration === "26:00:00", emitted.default_duration);

  fire(gForms()[0], "Crème brûlée");
  check("auto scene_id from title", emitted.scene_id === "creme_brulee" && gForms()[1].data.scene_id === "creme_brulee", emitted.scene_id);
  fire(gForms()[1], "my_");
  check("typing: trailing _ kept", emitted.scene_id === "my_", emitted.scene_id);
  fire(gForms()[1], "My ID");
  check("manual scene_id sanitized", emitted.scene_id === "my_id", emitted.scene_id);
  fire(gForms()[0], "Other");
  check("manual scene_id no longer follows title", emitted.scene_id === "my_id");

  console.log("\n=== Entity block layout ===");
  ed.setConfig({ title: "Heater", scene_id: "heater", entities: [
    { entity: "select.heater_mode", start: { mode: "ask", default: "eco" }, end: { mode: "previous" } },
  ] });
  await tick();
  const block = () => ed.shadowRoot.querySelectorAll("details")[0];
  block().open = true;
  const body = () => block().querySelector(".body");
  const order = () => [...body().children].map((el) =>
    el.tagName === "HA-FORM" ? el.schema[0].name : el.classList.contains("radios") ? "radios:" + el.querySelector(".radios-label").textContent : el.className);
  check("order: entity, name, show, start radios, start value, end radios (no end value for Restore), suggestion",
    JSON.stringify(order()) === JSON.stringify(["entity", "name", "radios:Show in card", "radios:Start value", "start_value", "radios:End value", "suggest"]), order());
  const radiosOf = (label) => [...body().querySelectorAll(".radios")].find((r) => r.querySelector(".radios-label").textContent === label);
  const opts = (label) => [...radiosOf(label).querySelectorAll("label.radio")].map((l) => l.textContent + (l.querySelector("input").checked ? "*" : ""));
  check("show radios Auto*/Yes/No", JSON.stringify(opts("Show in card")) === '["Auto*","Yes","No"]', opts("Show in card"));
  check("start radios Fixed/Ask*", JSON.stringify(opts("Start value")) === '["Fixed","Ask*"]', opts("Start value"));
  check("end radios Fixed/Ask/Restore*/Unchanged", JSON.stringify(opts("End value")) === '["Fixed","Ask","Restore*","Unchanged"]', opts("End value"));
  const formOf = (name) => [...body().querySelectorAll("ha-form")].find((f) => f.schema[0].name === name);
  check("start value: 'Default value' label, entity options, indented", formOf("start_value").computeLabel() === "Default value" && JSON.stringify(formOf("start_value").schema[0].selector.select.options) === '["comfort","eco","frost"]' && formOf("start_value").classList.contains("indent"));

  console.log("\n=== Spacing & default values ===");
  check("entity picker marked for extra spacing", formOf("entity").classList.contains("picker") && /\.fields > \.picker \+ \* \{ margin-top: 16px; \}/.test(ed.shadowRoot.querySelector("style").textContent));
  check("fields displayed as blocks", /\.fields > \* \{ display: block; \}/.test(ed.shadowRoot.querySelector("style").textContent));

  console.log("\n=== Editing ===");
  const pick = (label, idx) => { const i = radiosOf(label).querySelectorAll("input")[idx]; i.checked = true; i.dispatchEvent(new w.Event("change")); };
  pick("End value", 0); // Fixed
  check("end Fixed: value field appears", !!formOf("end_value") && formOf("end_value").computeLabel() === "Value");
  check("end Fixed: prefilled with current state (frost), config valid", formOf("end_value").data.end_value === "frost" && emitted.entities[0].end.value === "frost", [formOf("end_value").data, emitted.entities[0]]);
  err = ""; try { new Card().setConfig(emitted); } catch (e) { err = e.message; }
  check("no 'end.value is required' error", err === "", err);
  fire(formOf("end_value"), undefined); // cleared with the X button
  check("cleared value refilled and displayed", formOf("end_value").data.end_value === "frost" && emitted.entities[0].end.value === "frost");
  fire(formOf("end_value"), "frost");
  pick("Start value", 0); // Fixed (keeps value eco)
  fire(formOf("name"), "Mode");
  pick("Show in card", 1); // Yes
  check("config item", JSON.stringify(emitted.entities[0]) === JSON.stringify({ entity: "select.heater_mode", name: "Mode", show: true, start: { mode: "fixed", value: "eco" }, end: { mode: "fixed", value: "frost" } }), emitted.entities[0]);
  check("block title updated", block().querySelector(".rowtitle").textContent === "Mode");
  pick("End value", 3); // Unchanged
  check("end Unchanged: value field removed, config end {mode:none}", !formOf("end_value") && JSON.stringify(emitted.entities[0].end) === '{"mode":"none"}');
  fire(formOf("entity"), "switch.plug");
  check("entity change: values reset to the new entity state (on), on/off choices", emitted.entities[0].start.value === "on" && formOf("start_value").data.start_value === "on" && JSON.stringify(formOf("start_value").schema[0].selector.select.options) === '["on","off"]', emitted.entities[0]);
  err = ""; try { new Card().setConfig(emitted); } catch (e) { err = e.message; }
  check("edited config valid for the card", err === "", err);

  console.log("\n=== Scheduler suggestion ===");
  fire(formOf("entity"), "select.heater_mode");
  const sug = body().querySelector(".suggest");
  check("suggestion shown (2 schedules)", sug && sug.textContent.includes("2 schedule(s)"));
  sug.querySelector("button").click();
  await tick();
  check("schedules inserted after, off / previous", JSON.stringify(emitted.entities.slice(1).map((e) => [e.entity, e.start.value, e.end.mode])) === '[["switch.schedule_weekdays","off","previous"],["switch.schedule_weekend","off","previous"]]', emitted.entities);
  const ed2 = Card.getConfigElement();
  w.document.body.appendChild(ed2);
  ed2.hass = makeHass(false);
  ed2.setConfig(stub);
  await tick();
  check("without Scheduler: no suggestion, no error", !ed2.shadowRoot.querySelector(".suggest") && ed2.shadowRoot.querySelectorAll("details").length === 1);

  console.log("\n=== Order, removal, add ===");
  const ids = () => emitted.entities.map((e) => e.entity);
  ed.shadowRoot.querySelectorAll("details")[2].querySelector('[data-op="up"]').click();
  await tick();
  check("move up", JSON.stringify(ids()) === '["select.heater_mode","switch.schedule_weekend","switch.schedule_weekdays"]', ids());
  ed.shadowRoot.querySelectorAll("details")[0].querySelector('[data-op="remove"]').click();
  await tick();
  check("remove", JSON.stringify(ids()) === '["switch.schedule_weekend","switch.schedule_weekdays"]', ids());
  ed.shadowRoot.querySelector("button.add").click();
  await tick();
  check("add: new empty block, opened", emitted.entities.length === 3 && ed.shadowRoot.querySelectorAll("details")[2].open);

  console.log("\n=== Scroll position kept on rebuild ===");
  // Fake scrolling container (like HA's dialog) that jumps to 0 when the content changes.
  const scroller = w.document.createElement("div");
  scroller.style.overflowY = "auto";
  let pos = 0;
  Object.defineProperty(scroller, "scrollTop", { get: () => pos, set: (v) => (pos = v) });
  Object.defineProperty(scroller, "scrollHeight", { get: () => 2000 });
  Object.defineProperty(scroller, "clientHeight", { get: () => 600 });
  w.document.body.appendChild(scroller);
  const ed3 = Card.getConfigElement();
  scroller.appendChild(ed3);
  let em3 = null;
  ed3.addEventListener("config-changed", (e) => (em3 = e.detail.config));
  ed3.hass = makeHass(true);
  ed3.setConfig({ title: "T", scene_id: "t", entities: [
    { entity: "switch.plug", start: { mode: "fixed", value: "on" }, end: { mode: "previous" } },
    { entity: "select.heater_mode", start: { mode: "ask", default: "eco" }, end: { mode: "previous" } },
  ] });
  await tick();
  new w.MutationObserver(() => (pos = 0)).observe(ed3.shadowRoot, { childList: true, subtree: true });
  const b3 = ed3.shadowRoot.querySelectorAll("details")[1];
  b3.open = true;
  pos = 500;
  const r3 = [...b3.querySelectorAll(".radios")].find((r) => r.querySelector(".radios-label").textContent === "End value");
  const fixed = r3.querySelectorAll("input")[0];
  fixed.checked = true; fixed.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 120));
  check("radio change (block rebuilt): scroll position restored", pos === 500 && em3.entities[1].end.mode === "fixed", pos);
  check("temporary min-height released", b3.querySelector(".body").style.minHeight === "");
  pos = 700;
  ed3.shadowRoot.querySelectorAll("details")[1].querySelector('[data-op="up"]').click();
  await new Promise((r) => setTimeout(r, 120));
  check("move (full re-render): scroll position restored", pos === 700 && em3.entities[0].entity === "select.heater_mode", pos);
  check("temporary min-height released on host", ed3.style.minHeight === "");

  console.log("\n=== Transfer notice (scene ID changed while a scene exists) ===");
  const edT = Card.getConfigElement();
  w.document.body.appendChild(edT);
  const planned = { heater_override: { status: "planned", start: "2026-11-27T14:00:00+01:00", end: "2026-11-27T17:00:00+01:00", entities: [] } };
  edT.hass = withScenes(makeHass(false), planned);
  edT.setConfig({ title: "Heater override", scene_id: "heater_override", entities: [] });
  await tick();
  const tBox = () => edT.shadowRoot.querySelector(".transfer");
  const idForm = () => [...edT.shadowRoot.querySelectorAll(".general ha-form")].find((f) => f.schema[0].name === "scene_id");
  check("no notice while the ID is unchanged", tBox().hidden);
  fire(idForm(), "heater_override_2");
  check("notice shown after the ID change", !tBox().hidden && tBox().textContent.includes("An occurrence of heater_override is planned. Transfer it to heater_override_2?"), tBox().textContent);
  check("notice placed right under the Scene ID field", tBox().previousElementSibling === idForm());
  const plainEd = new JSDOM(`<!DOCTYPE html><body>${edT.shadowRoot.innerHTML}</body>`).window;
  check("notice displayed as a row (flex)", plainEd.getComputedStyle(plainEd.document.querySelector(".transfer")).display === "flex", plainEd.getComputedStyle(plainEd.document.querySelector(".transfer")).display);
  fire(idForm(), "heater_override");
  check("notice hidden when back to the original ID", tBox().hidden);
  // running + conflict
  edT.hass = withScenes(makeHass(false), { ...planned, heater_override: { ...planned.heater_override, status: "ongoing" }, other: { status: "planned", entities: [] } });
  fire(idForm(), "other");
  check("running scene + conflict: no button, conflict message", tBox().textContent.includes("is running") && tBox().textContent.includes("other already has a scene: transfer is not possible.") && !tBox().querySelector("button"), tBox().textContent);
  // transfer
  edT.hass = withScenes(makeHass(false), planned);
  fire(idForm(), "bedroom_heater");
  nextResponse = { ok: true };
  tBox().querySelector("button").click();
  await tick();
  check("Transfer calls timed_scenes.rename {id, new_id}", calls.at(-1).domain === "timed_scenes" && calls.at(-1).service === "rename" && JSON.stringify(calls.at(-1).service_data) === '{"id":"heater_override","new_id":"bedroom_heater"}', calls.at(-1));
  check("success message", tBox().textContent.includes("Scene transferred to bedroom_heater.") && tBox().classList.contains("done"), tBox().textContent);
  edT.hass = withScenes(makeHass(false), { bedroom_heater: planned.heater_override }); // registry updated by the backend
  fire(idForm(), "bedroom_heater_x");
  check("after transfer, the new ID is the reference", tBox().textContent.includes("An occurrence of bedroom_heater is planned"), tBox().textContent);
  fire(idForm(), "bedroom_heater");
  check("back to the transferred ID: no notice", tBox().hidden);
  // error from the backend
  fire(idForm(), "elsewhere");
  nextResponse = { ok: false, errors: ["a scene already exists for elsewhere"] };
  tBox().querySelector("button").click();
  await tick();
  check("backend error displayed", tBox().textContent.includes("Transfer failed: a scene already exists for elsewhere"), tBox().textContent);
  nextResponse = { ok: true };

  console.log("\n=== Suggestion box layout ===");
  const edS = Card.getConfigElement();
  w.document.body.appendChild(edS);
  edS.hass = makeHass(true);
  edS.setConfig({ title: "T", scene_id: "t", entities: [{ entity: "select.heater_mode", start: { mode: "ask", default: "eco" }, end: { mode: "previous" } }] });
  await tick();
  const plainSug = new JSDOM(`<!DOCTYPE html><body>${edS.shadowRoot.innerHTML}</body>`).window;
  const sugEl = plainSug.document.querySelector(".suggest");
  check("suggestion box displayed as a row (flex)", sugEl && plainSug.getComputedStyle(sugEl).display === "flex", sugEl && plainSug.getComputedStyle(sugEl).display);

  console.log("\n=== No re-render on echoed config ===");
  const before = gForms()[0];
  ed.setConfig(emitted);
  await tick();
  check("same field element kept (focus preserved)", gForms()[0] === before);

  console.log(`\nResult: ${ok}/${ok + ko} checks OK`);
  process.exitCode = ko ? 1 : 0;
})();
