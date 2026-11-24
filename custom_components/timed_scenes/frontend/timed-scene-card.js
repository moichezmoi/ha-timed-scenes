/**
 * Timed Scene Card for Home Assistant
 * ------------------------------------
 * Shows the timed scene attached to this card and lets the user plan,
 * edit, clear or stop it through a dialog. Includes a visual editor.
 *
 * Backend: the timed_scenes integration (sensor.timed_scenes and the
 * timed_scenes.set / timed_scenes.delete actions), which also serves this file.
 *
 * Example configuration:
 *
 *   type: custom:timed-scene-card
 *   scene_id: living_room_heater
 *   title: Heater override
 *   default_duration: "03:00:00"        # HH:MM:SS, hours may exceed 24 ("168:00:00" = 7 days)
 *   entities:
 *     - entity: select.living_room_heater_mode
 *       name: Mode
 *       start: { mode: ask, default: eco }          # fixed | ask
 *       end:   { mode: fixed, value: comfort }      # fixed | ask | previous | none
 *     - entity: switch.living_room_schedule
 *       start: { mode: fixed, value: "off" }
 *       end:   { mode: previous }
 *
 * No build step, no dependency: plain Web Components.
 */

const TS_VERSION = "0.4.0";
const TS_REGISTRY = "sensor.timed_scenes";
const TS_DOMAIN = "timed_scenes";
const TS_SERVICE_SET = "set";
const TS_SERVICE_DELETE = "delete";

/* ------------------------------------------------------------------ */
/*  Translations                                                       */
/* ------------------------------------------------------------------ */
const TS_I18N = {
  en: {
    default_title: "Timed scene",
    planned: "Planned",
    running: "Running",
    until: "until",
    plan: "Plan",
    edit: "Edit",
    clear: "Clear",
    stop: "Stop",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    plan_scene: "Plan a timed scene",
    edit_scene: "Edit the planned scene",
    clear_title: "Clear the planned scene?",
    clear_text: "The planned scene will be removed.",
    stop_title: "Stop the running scene?",
    stop_text: "The entities will be restored now.",
    when: "When",
    start: "Start",
    duration: "Duration",
    end: "End",
    days: "d",
    hours: "h",
    minutes: "min",
    at_start: "At start",
    at_end: "At end",
    errors: "The scene could not be saved:",
    error_generic: "Unexpected error:",
    no_backend: "The Timed Scenes integration was not found: is it installed and added?",
    no_form: "Home Assistant form components could not be loaded. Reload the page and try again.",
    // --- Visual editor ---
    ed_general: "General",
    ed_title: "Title",
    ed_scene_id: "Scene ID",
    ed_scene_id_help: "Cards sharing the same scene ID control the same scene.",
    ed_default_duration: "Default duration",
    ed_entities: "Entities (applied in this order)",
    ed_entity: "Entity",
    ed_name: "Name (optional)",
    ed_show: "Show in card",
    ed_show_auto: "Auto",
    ed_show_always: "Yes",
    ed_show_never: "No",
    ed_start_value: "Start value",
    ed_end_value: "End value",
    ed_mode_fixed: "Fixed",
    ed_mode_ask: "Ask",
    ed_mode_previous: "Restore",
    ed_mode_none: "Unchanged",
    ed_value: "Value",
    ed_default: "Default value",
    ed_add: "Add entity",
    ed_new_entity: "New entity",
    ed_up: "Move up",
    ed_down: "Move down",
    ed_remove: "Remove",
    ed_suggest: "{n} schedule(s) control this entity.",
    ed_suggest_add: "Add them",
  },
  fr: {
    default_title: "Scène temporisée",
    planned: "Prévue",
    running: "En cours",
    until: "jusqu'à",
    plan: "Planifier",
    edit: "Modifier",
    clear: "Effacer",
    stop: "Arrêter",
    cancel: "Annuler",
    save: "Enregistrer",
    saving: "Enregistrement…",
    plan_scene: "Planifier une scène temporisée",
    edit_scene: "Modifier la scène planifiée",
    clear_title: "Effacer la scène planifiée ?",
    clear_text: "La scène planifiée sera supprimée.",
    stop_title: "Arrêter la scène en cours ?",
    stop_text: "Les entités seront restaurées immédiatement.",
    when: "Quand",
    start: "Début",
    duration: "Durée",
    end: "Fin",
    days: "j",
    hours: "h",
    minutes: "min",
    at_start: "Au début",
    at_end: "À la fin",
    errors: "La scène n'a pas pu être enregistrée :",
    error_generic: "Erreur inattendue :",
    no_backend: "L'intégration Timed Scenes est introuvable : est-elle installée et ajoutée ?",
    no_form: "Les composants de formulaire de Home Assistant n'ont pas pu être chargés. Rechargez la page et réessayez.",
    // --- Éditeur visuel ---
    ed_general: "Général",
    ed_title: "Titre",
    ed_scene_id: "Identifiant de scène",
    ed_scene_id_help: "Des cartes ayant le même identifiant pilotent la même scène.",
    ed_default_duration: "Durée par défaut",
    ed_entities: "Entités (appliquées dans cet ordre)",
    ed_entity: "Entité",
    ed_name: "Nom (facultatif)",
    ed_show: "Afficher dans la carte",
    ed_show_auto: "Auto",
    ed_show_always: "Oui",
    ed_show_never: "Non",
    ed_start_value: "Valeur au début",
    ed_end_value: "Valeur à la fin",
    ed_mode_fixed: "Fixe",
    ed_mode_ask: "Demander",
    ed_mode_previous: "Restaurer",
    ed_mode_none: "Inchangé",
    ed_value: "Valeur",
    ed_default: "Valeur par défaut",
    ed_add: "Ajouter une entité",
    ed_new_entity: "Nouvelle entité",
    ed_up: "Monter",
    ed_down: "Descendre",
    ed_remove: "Retirer",
    ed_suggest: "{n} planning(s) pilotent cette entité.",
    ed_suggest_add: "Les ajouter",
  },
};

function tsLang(hass) {
  const lang = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  return TS_I18N[lang.split("-")[0]] ? lang.split("-")[0] : "en";
}

function tsT(hass, key) {
  const dict = TS_I18N[tsLang(hass)];
  return dict[key] !== undefined ? dict[key] : TS_I18N.en[key];
}

/* ------------------------------------------------------------------ */
/*  Type table                                                         */
/*  How each entity domain is edited (dialog and visual editor) and    */
/*  converted to the text value expected by the backend.               */
/*  To support a new domain: add an entry here AND in the backend      */
/*  (custom_components/timed_scenes/entity_types.py).                  */
/* ------------------------------------------------------------------ */
const TS_BOOLEAN_TYPE = {
  // Field of the planning dialog.
  selector: () => ({ boolean: {} }),
  // Field used by the visual editor to pick a value (stored as "on" / "off").
  editorSelector: () => ({ select: { mode: "dropdown", options: ["on", "off"] } }),
  toForm: (v) => ["on", "true"].includes(String(v).toLowerCase()),
  toServer: (v) => (v === true || ["on", "true"].includes(String(v).toLowerCase()) ? "on" : "off"),
};
const TS_OPTIONS_TYPE = {
  selector: (stateObj) => ({
    select: { mode: "dropdown", options: (stateObj && stateObj.attributes.options) || [] },
  }),
  editorSelector: (stateObj) => TS_OPTIONS_TYPE.selector(stateObj),
  toForm: (v) => (v === undefined || v === null ? "" : String(v)),
  toServer: (v) => String(v),
};
const TS_TYPES = {
  switch: TS_BOOLEAN_TYPE,
  input_boolean: TS_BOOLEAN_TYPE,
  select: TS_OPTIONS_TYPE,
  input_select: TS_OPTIONS_TYPE,
};
const TS_SUPPORTED_DOMAINS = Object.keys(TS_TYPES);

const tsDomain = (entityId) => String(entityId).split(".")[0];
const tsType = (entityId) => TS_TYPES[tsDomain(entityId)];

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const tsEsc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Normalizes a configured value: YAML booleans (off / on) become "off" / "on". */
const tsNorm = (v) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v));

/** Current time in the Home Assistant time zone, as "YYYY-MM-DD HH:MM:00". */
function tsNowLocal(hass) {
  const tz = (hass && hass.config && hass.config.time_zone) || undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:00`;
}

/** Adds minutes to a "YYYY-MM-DD HH:MM:SS" wall-clock time. */
function tsAddMinutes(local, minutes) {
  const [d, t] = local.split(" ");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, da, h, mi + minutes));
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
}

/**
 * The backend stores times as ISO strings in the HA time zone
 * ("2026-11-12T14:00:00+01:00"). Reading the digits directly gives the
 * HA local time, whatever the browser time zone is.
 */
const tsIsoToLocal = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

function tsFormatWhen(hass, iso, withDay = true) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const time = iso.slice(11, 16);
  if (!withDay) return time;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat(tsLang(hass), { weekday: "short", timeZone: "UTC" }).format(date);
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} ${time}`;
}

const tsSameDay = (isoA, isoB) => isoA.slice(0, 10) === isoB.slice(0, 10);

/* ----- Durations: {days, hours, minutes} ----- */

/** Total minutes → {days, hours, minutes}. */
function tsSplitMinutes(total) {
  total = Math.max(0, Math.round(total));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

const tsDurationMinutes = (d) => (+d.days || 0) * 1440 + (+d.hours || 0) * 60 + (+d.minutes || 0);

/** "HH:MM[:SS]" (hours may exceed 24) or an object → {days, hours, minutes}. */
function tsParseDuration(value) {
  if (value && typeof value === "object") {
    return tsSplitMinutes(tsDurationMinutes(value) + Math.round((+value.seconds || 0) / 60));
  }
  const [h = 0, m = 0] = String(value || "01:00:00").split(":").map((x) => +x || 0);
  return tsSplitMinutes(h * 60 + m);
}

/** {days, hours, minutes} → "HH:MM:00" (hours may exceed 24). */
function tsDurationToString(d) {
  const total = tsDurationMinutes(d);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

const tsDurationBetween = (isoStart, isoEnd) => tsSplitMinutes((Date.parse(isoEnd) - Date.parse(isoStart)) / 60000);

/**
 * ha-form is lazily loaded by Home Assistant. Creating the editor of a
 * built-in card forces it to load (common technique of custom cards).
 */
let tsFormLoading;
function tsLoadHaForm() {
  if (customElements.get("ha-form")) return Promise.resolve(true);
  if (!tsFormLoading) {
    tsFormLoading = (async () => {
      try {
        const helpers = await window.loadCardHelpers();
        const card = await helpers.createCardElement({ type: "tile", entity: "sun.sun" });
        if (card && card.constructor.getConfigElement) await card.constructor.getConfigElement();
      } catch (e) {
        /* ignored: we check below whether ha-form is available */
      }
      await Promise.race([
        customElements.whenDefined("ha-form"),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      return !!customElements.get("ha-form");
    })();
  }
  return tsFormLoading;
}

/** Calls an action of the integration and returns its response ({ok, errors} ...). */
async function tsCallService(hass, service, data) {
  const result = await hass.connection.sendMessagePromise({
    type: "call_service",
    domain: TS_DOMAIN,
    service,
    service_data: data,
    return_response: true,
  });
  return result && result.response;
}

/* ------------------------------------------------------------------ */
/*  Shared form building blocks (dialog + visual editor)               */
/*  Each field is its own element, so spacing is controlled here       */
/*  (ha-form imposes 24px between the fields it contains).             */
/* ------------------------------------------------------------------ */

/** One ha-form holding ONE field. onChange(value) receives the new value. */
function tsField(hass, { name, selector, label, helper, value, disabled = false }, onChange) {
  const form = document.createElement("ha-form");
  form.hass = hass;
  form.schema = [{ name, selector }];
  form.data = value === undefined ? {} : { [name]: value };
  form.disabled = disabled;
  form.computeLabel = () => label;
  form.computeHelper = () => helper;
  form.addEventListener("value-changed", (ev) => {
    const v = (ev.detail.value || {})[name];
    form.data = v === undefined ? {} : { [name]: v };
    onChange(v);
  });
  return form;
}

/** Browser-native date-time field, value "YYYY-MM-DD HH:MM:SS". */
function tsDateField(hass, { label, value, disabled = false }, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "box";
  const caption = document.createElement("span");
  caption.className = "caption";
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.value = (value || "").replace(" ", "T").slice(0, 16);
  input.disabled = disabled;
  // Dark themes: the browser draws its calendar icon and picker in dark colours.
  input.style.colorScheme = hass && hass.themes && hass.themes.darkMode ? "dark" : "light";
  input.addEventListener("change", () => onChange(input.value ? `${input.value.replace("T", " ")}:00` : ""));
  wrapper.append(caption, input);
  return wrapper;
}

/** Duration field "dd : hh : mm", value {days, hours, minutes}. */
function tsDurationField(hass, { label, value, disabled = false }, onChange) {
  const t = (k) => tsT(hass, k);
  const wrapper = document.createElement("div");
  wrapper.className = "box duration";
  wrapper.innerHTML = `<span class="caption">${tsEsc(label)}</span><div class="parts"></div>`;
  const parts = wrapper.querySelector(".parts");
  const current = { ...tsSplitMinutes(tsDurationMinutes(value || {})) };
  const inputs = {};
  for (const [key, max] of [["days", 365], ["hours", 23], ["minutes", 59]]) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(max);
    input.inputMode = "numeric";
    input.value = key === "days" ? String(current[key]) : String(current[key]).padStart(2, "0");
    input.disabled = disabled;
    input.dataset.part = key;
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => {
      current[key] = Math.max(0, Math.floor(+input.value || 0));
      // Normalize (e.g. 90 min → 1 h 30 min) and display the result.
      Object.assign(current, tsSplitMinutes(tsDurationMinutes(current)));
      for (const k of Object.keys(inputs)) inputs[k].value = k === "days" ? String(current[k]) : String(current[k]).padStart(2, "0");
      onChange({ ...current });
    });
    inputs[key] = input;
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = t(key);
    parts.append(input, unit);
  }
  return wrapper;
}

/** Inline radio buttons. options: [{value, label}]. */
function tsRadioRow({ label, name, options, selected }, onChange) {
  const row = document.createElement("div");
  row.className = "radios";
  row.innerHTML = label ? `<span class="radios-label">${tsEsc(label)}</span>` : "";
  const group = document.createElement("div");
  group.className = "radios-group";
  const groupName = `${name}_${Math.random().toString(36).slice(2, 8)}`;
  for (const opt of options) {
    const item = document.createElement("label");
    item.className = "radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = groupName;
    input.value = opt.value;
    input.checked = opt.value === selected;
    input.addEventListener("change", () => input.checked && onChange(opt.value));
    item.append(input, document.createTextNode(opt.label));
    group.appendChild(item);
  }
  row.appendChild(group);
  return row;
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */
const TS_BUTTON_CSS = `
  button {
    font: inherit; font-weight: 500; cursor: pointer;
    border-radius: 18px; padding: 6px 12px; border: 1px solid transparent;
    background: none; color: var(--primary-color);
  }
  button:hover:not(:disabled) { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1); }
  button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); padding: 6px 16px; }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); background: var(--primary-color); }
  button.danger { color: var(--error-color, #db4437); }
  button.danger:hover:not(:disabled) { background: rgba(219, 68, 55, 0.1); }
  button.danger.primary { background: var(--error-color, #db4437); color: #fff; }
  button:disabled { opacity: 0.4; cursor: default; }
`;

const TS_FIELD_CSS = `
  .fields > * { display: block; }
  .fields > * + * { margin-top: 8px; }
  /* The entity picker draws its label above the field: give it more room. */
  .fields > .picker + * { margin-top: 16px; }
  .box {
    display: flex; flex-direction: column; box-sizing: border-box; width: 100%;
    background: var(--mdc-text-field-fill-color, var(--input-fill-color, rgba(127, 127, 127, 0.08)));
    border-radius: 4px 4px 0 0; padding: 8px 16px 6px;
    border-bottom: 1px solid var(--secondary-text-color);
  }
  .box:focus-within { border-bottom: 2px solid var(--primary-color); padding-bottom: 5px; }
  .box .caption { font-size: 12px; color: var(--secondary-text-color); }
  .box input {
    background: none; border: none; outline: none; padding: 4px 0 0;
    color: var(--primary-text-color); font: inherit; font-size: 16px;
  }
  .duration .parts { display: flex; align-items: baseline; gap: 4px; }
  .duration input { width: 3.2em; text-align: right; -moz-appearance: textfield; }
  .duration input::-webkit-inner-spin-button, .duration input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .duration .unit { color: var(--secondary-text-color); margin-right: 12px; }
  .radios { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  .radios-label { min-width: 7.5em; color: var(--primary-text-color); }
  .radios-group { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .radio { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
  .radio input { accent-color: var(--primary-color); margin: 0; }
  .indent { margin-left: 24px; }
`;

/* ================================================================== */
/*  The card                                                           */
/* ================================================================== */
class TimedSceneCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
    this._preview = false;
  }

  /** Called by Home Assistant with the YAML configuration. Throwing shows an error card. */
  setConfig(config) {
    if (!config || !/^[a-z0-9_]+$/.test(config.scene_id || "")) {
      throw new Error("scene_id is required (lowercase letters, digits and _ only)");
    }
    if (!Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("entities must be a non-empty list");
    }
    const entities = config.entities.map((item, i) => {
      const where = `entities[${i}]`;
      if (!item || !item.entity) throw new Error(`${where}: entity is required`);
      if (!tsType(item.entity)) throw new Error(`${where}: unsupported entity type (${item.entity})`);
      const start = item.start || {};
      const end = item.end || { mode: "previous" };
      if (!["fixed", "ask"].includes(start.mode)) throw new Error(`${where}: start.mode must be fixed or ask`);
      if (!["fixed", "ask", "previous", "none"].includes(end.mode)) {
        throw new Error(`${where}: end.mode must be fixed, ask, previous or none`);
      }
      if (start.mode === "fixed" && start.value === undefined) throw new Error(`${where}: start.value is required`);
      if (end.mode === "fixed" && end.value === undefined) throw new Error(`${where}: end.value is required`);
      return { entity: item.entity, name: item.name, show: item.show, start, end };
    });
    this._config = { ...config, entities };
    this._signature = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._dialog) this._dialog.hass = hass;
    // Only re-render when something displayed has changed.
    const scene = this._scene();
    const signature = JSON.stringify([
      scene,
      tsLang(hass),
      this._config && this._config.entities.map((e) => hass.states[e.entity] && hass.states[e.entity].attributes.friendly_name),
    ]);
    if (signature !== this._signature) {
      this._signature = signature;
      this._render();
    }
  }

  /**
   * Set to true by Home Assistant when the card is shown in the card editor
   * preview or while the dashboard is in edit mode: buttons are disabled.
   */
  set preview(value) {
    if (this._preview === !!value) return;
    this._preview = !!value;
    this._render();
  }

  get preview() {
    return this._preview;
  }

  getCardSize() {
    return this._scene() ? 3 : 1;
  }

  /** Visual editor shown by Home Assistant in the card configuration dialog. */
  static getConfigElement() {
    return document.createElement("timed-scene-card-editor");
  }

  /** Starting configuration when the card is added from the card picker. */
  static getStubConfig(hass) {
    const ids = Object.keys((hass && hass.states) || {});
    const select = ids.find((id) => ["select", "input_select"].includes(tsDomain(id)));
    const toggle = ids.find((id) => ["switch", "input_boolean"].includes(tsDomain(id)));
    let entity;
    if (select) {
      const options = hass.states[select].attributes.options || [];
      entity = { entity: select, start: { mode: "ask", default: options[0] }, end: { mode: "previous" } };
    } else {
      entity = { entity: toggle || "input_boolean.example", start: { mode: "fixed", value: "on" }, end: { mode: "previous" } };
    }
    return { title: "Timed scene", scene_id: "timed_scene", entities: [entity] };
  }

  _scene() {
    const reg = this._hass && this._hass.states[TS_REGISTRY];
    const scenes = (reg && reg.attributes.scenes) || {};
    return this._config ? scenes[this._config.scene_id] : undefined;
  }

  _label(item) {
    const st = this._hass && this._hass.states[item.entity];
    return item.name || (st && st.attributes.friendly_name) || item.entity;
  }

  /** Lines describing the values of the scene ("Mode: comfort → eco"). */
  _valueLines(scene) {
    const lines = [];
    for (const item of this._config.entities) {
      const shown = item.show !== undefined ? item.show : item.start.mode === "ask" || item.end.mode === "ask";
      if (!shown) continue;
      const stored = (scene.entities || []).find((e) => e.entity === item.entity);
      if (!stored) continue;
      let text = stored.start_value;
      if (item.end.mode === "ask" && stored.end_mode === "value") text += ` → ${stored.end_value}`;
      lines.push(`<div class="value"><span class="label">${tsEsc(this._label(item))}</span>: ${tsEsc(text)}</div>`);
    }
    return lines.join("");
  }

  _render() {
    if (!this._config) return;
    const hass = this._hass;
    const t = (k) => tsT(hass, k);
    const scene = this._scene();
    const title = this._config.title || t("default_title");
    const disabled = this._preview ? "disabled" : "";

    let icon = "mdi:calendar-blank-outline";
    let body = "";
    let actions = "";
    if (scene && scene.status === "ongoing") {
      icon = "mdi:play-circle-outline";
      const endText = tsFormatWhen(hass, scene.end, !tsSameDay(scene.end, tsNowLocal(hass).replace(" ", "T")));
      body = `<div class="status running">${t("running")} · ${t("until")} ${endText}</div>`;
      actions = `<button class="danger" data-action="stop" ${disabled}>${t("stop")}</button>
                 <button data-action="edit" ${disabled}>${t("edit")}</button>`;
    } else if (scene) {
      icon = "mdi:calendar-clock";
      const endText = tsFormatWhen(hass, scene.end, !tsSameDay(scene.start, scene.end));
      body = `<div class="status">${t("planned")} · ${tsFormatWhen(hass, scene.start)} → ${endText}</div>`;
      actions = `<button class="danger" data-action="clear" ${disabled}>${t("clear")}</button>
                 <button data-action="edit" ${disabled}>${t("edit")}</button>`;
    }
    // Nothing planned: a single line, with the Plan button next to the title.
    const headerButton = scene ? "" : `<button data-action="plan" ${disabled}>${t("plan")}</button>`;

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px; }
        .header { display: flex; align-items: center; gap: 12px; min-height: 36px; }
        .header ha-icon { color: var(--state-icon-color, var(--primary-color)); }
        .title { flex: 1; font-size: 1.1em; font-weight: 500; }
        .body { margin: 4px 0 0 36px; }
        .status { color: var(--primary-text-color); }
        .status.running { color: var(--primary-color); font-weight: 500; }
        .value { color: var(--secondary-text-color); margin: 2px 0 0 16px; }
        .label { color: var(--primary-text-color); }
        .actions { display: flex; justify-content: flex-end; gap: 4px; margin-top: 8px; }
        ${TS_BUTTON_CSS}
      </style>
      <ha-card>
        <div class="header">
          <ha-icon icon="${icon}"></ha-icon>
          <span class="title">${tsEsc(title)}</span>
          ${headerButton}
        </div>
        ${scene ? `<div class="body">${body}${this._valueLines(scene)}</div><div class="actions">${actions}</div>` : ""}
      </ha-card>`;

    this.shadowRoot.querySelectorAll("button[data-action]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (!this._preview) this._openDialog(btn.dataset.action);
      })
    );
  }

  _openDialog(action) {
    if (!this._dialog) {
      // The dialog lives in <body> so that it is never clipped by the dashboard layout.
      this._dialog = document.createElement("timed-scene-dialog");
      document.body.appendChild(this._dialog);
    }
    this._dialog.hass = this._hass;
    this._dialog.open({ action, config: this._config, scene: this._scene() });
  }

  disconnectedCallback() {
    if (this._dialog) {
      this._dialog.remove();
      this._dialog = undefined;
    }
  }
}

/* ================================================================== */
/*  The dialog (plan / edit / clear / stop)                            */
/* ================================================================== */
class TimedSceneDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot.querySelectorAll("ha-form").forEach((f) => (f.hass = hass));
  }

  /** action: plan | edit | clear | stop */
  async open({ action, config, scene }) {
    this._action = action;
    this._config = config;
    this._scene = scene;
    this._errors = [];
    this._busy = false;
    if (this._isForm()) {
      this._data = this._initialData();
      this._endChoice = "duration";
      this._formReady = await tsLoadHaForm();
    }
    this._render();
  }

  _isForm() {
    return this._action === "plan" || this._action === "edit";
  }

  close() {
    this.shadowRoot.innerHTML = "";
  }

  /** Initial values: defaults for a new scene, stored values when editing. */
  _initialData() {
    const scene = this._action === "edit" ? this._scene : undefined;
    const data = {};
    if (scene) {
      data.start = tsIsoToLocal(scene.start);
      data.end = tsIsoToLocal(scene.end);
      data.duration = tsDurationBetween(scene.start, scene.end);
    } else {
      data.start = tsNowLocal(this._hass);
      data.duration = tsParseDuration(this._config.default_duration);
      data.end = tsAddMinutes(data.start, tsDurationMinutes(data.duration));
    }
    this._config.entities.forEach((item, i) => {
      const type = tsType(item.entity);
      const stored = scene && (scene.entities || []).find((e) => e.entity === item.entity);
      if (item.start.mode === "ask") {
        const v = stored ? stored.start_value : item.start.default;
        data[`start_${i}`] = type.toForm(v !== undefined ? v : "");
      }
      if (item.end.mode === "ask") {
        const v = stored && stored.end_mode === "value" ? stored.end_value : item.end.default;
        data[`end_${i}`] = type.toForm(v !== undefined ? v : "");
      }
    });
    return data;
  }

  _label(item) {
    const st = this._hass.states[item.entity];
    return item.name || (st && st.attributes.friendly_name) || item.entity;
  }

  _render() {
    const t = (k) => tsT(this._hass, k);
    const titles = { plan: "plan_scene", edit: "edit_scene", clear: "clear_title", stop: "stop_title" };
    const confirm = { plan: "save", edit: "save", clear: "clear", stop: "stop" }[this._action];
    const danger = !this._isForm();

    this.shadowRoot.innerHTML = `
      <style>
        .backdrop {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0, 0, 0, 0.5);
          display: flex; align-items: center; justify-content: center;
        }
        .dialog {
          background: var(--card-background-color, var(--primary-background-color, #fff));
          color: var(--primary-text-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
          width: min(480px, calc(100vw - 32px));
          max-height: calc(100vh - 32px); overflow-y: auto;
          padding: 24px; box-sizing: border-box;
          font-family: var(--paper-font-body1_-_font-family, inherit);
        }
        h2 { margin: 0 0 16px; font-size: 1.3em; font-weight: 400; }
        h3 { margin: 20px 0 8px; font-size: 0.9em; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.05em; }
        .choice { display: flex; align-items: center; gap: 8px; }
        .choice > input[type=radio] { accent-color: var(--primary-color); margin: 0; }
        .choice .field { flex: 1; }
        .choice .field.off { opacity: 0.45; }
        .errors { background: rgba(219, 68, 55, 0.1); color: var(--error-color, #db4437); border-radius: 8px; padding: 8px 12px; margin-top: 16px; }
        .errors ul { margin: 4px 0 0; padding-left: 20px; }
        .text { color: var(--secondary-text-color); }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
        ${TS_BUTTON_CSS}
        ${TS_FIELD_CSS}
      </style>
      <div class="backdrop">
        <div class="dialog" role="dialog" aria-modal="true">
          <h2>${tsEsc(t(titles[this._action]))}</h2>
          <div class="content"></div>
          <div class="errors" hidden></div>
          <div class="actions">
            <button data-action="cancel">${t("cancel")}</button>
            <button class="primary ${danger ? "danger" : ""}" data-action="confirm">${t(confirm)}</button>
          </div>
        </div>
      </div>`;

    const content = this.shadowRoot.querySelector(".content");
    if (this._action === "clear" || this._action === "stop") {
      content.innerHTML = `<div class="text">${t(this._action === "stop" ? "stop_text" : "clear_text")}</div>`;
    } else if (!this._formReady) {
      content.innerHTML = `<div class="text">${t("no_form")}</div>`;
      this.shadowRoot.querySelector('[data-action="confirm"]').disabled = true;
    } else {
      this._renderForm(content);
    }

    this._showErrors();
    // Close when clicking outside the dialog or pressing Escape.
    this.shadowRoot.querySelector(".backdrop").addEventListener("click", (ev) => {
      if (ev.target.classList.contains("backdrop") && !this._busy) this.close();
    });
    this.shadowRoot.querySelector(".dialog").addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this._busy) this.close();
    });
    this.shadowRoot.querySelector('[data-action="cancel"]').addEventListener("click", () => this.close());
    this.shadowRoot.querySelector('[data-action="confirm"]').addEventListener("click", () =>
      this._isForm() ? this._save() : this._delete()
    );
  }

  _renderForm(content) {
    const t = (k) => tsT(this._hass, k);
    const set = (name) => (value) => (this._data = { ...this._data, [name]: value });

    // --- When: start, then duration OR end (radio buttons) ---
    // Start / End use the browser's native date-time input: Home Assistant's own
    // date picker relies on events that only work inside the <home-assistant>
    // element, and this dialog lives in <body>.
    content.insertAdjacentHTML("beforeend", `<h3>${t("when")}</h3><div class="fields when"></div>`);
    const when = content.querySelector(".when");
    when.appendChild(tsDateField(this._hass, { label: t("start"), value: this._data.start }, set("start")));

    const choices = [
      ["duration", (off) => tsDurationField(this._hass, { label: t("duration"), value: this._data.duration, disabled: off }, set("duration"))],
      ["end", (off) => tsDateField(this._hass, { label: t("end"), value: this._data.end, disabled: off }, set("end"))],
    ];
    for (const [name, build] of choices) {
      const row = document.createElement("div");
      row.className = "choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "end_choice";
      radio.checked = this._endChoice === name;
      const field = document.createElement("div");
      field.className = "field";
      field.appendChild(build(!radio.checked));
      radio.addEventListener("change", () => {
        this._endChoice = name;
        this._updateChoices();
      });
      row.append(radio, field);
      when.appendChild(row);
    }
    this._updateChoices();

    // --- Values to choose, grouped by moment ---
    for (const [moment, heading] of [["start", t("at_start")], ["end", t("at_end")]]) {
      const fields = [];
      this._config.entities.forEach((item, i) => {
        if (item[moment].mode !== "ask") return;
        const name = `${moment}_${i}`;
        fields.push(
          tsField(this._hass, {
            name,
            selector: tsType(item.entity).selector(this._hass.states[item.entity]),
            label: this._label(item),
            value: this._data[name],
          }, set(name))
        );
      });
      if (fields.length === 0) continue;
      content.insertAdjacentHTML("beforeend", `<h3>${tsEsc(heading)}</h3>`);
      const box = document.createElement("div");
      box.className = "fields";
      box.append(...fields);
      content.appendChild(box);
    }
  }

  /** Greys out and disables the field whose radio button is not selected. */
  _updateChoices() {
    this.shadowRoot.querySelectorAll(".choice").forEach((row) => {
      const selected = row.querySelector(':scope > input[type="radio"]').checked;
      row.querySelector(".field").classList.toggle("off", !selected);
      row.querySelectorAll(".field input").forEach((input) => (input.disabled = !selected));
    });
  }

  _showErrors() {
    const box = this.shadowRoot.querySelector(".errors");
    if (!box) return;
    if (!this._errors.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `${tsEsc(this._errorTitle || tsT(this._hass, "errors"))}<ul>${this._errors
      .map((e) => `<li>${tsEsc(e)}</li>`)
      .join("")}</ul>`;
  }

  _setBusy(busy) {
    this._busy = busy;
    const btn = this.shadowRoot.querySelector('[data-action="confirm"]');
    if (btn) {
      btn.disabled = busy;
      if (this._isForm()) btn.textContent = tsT(this._hass, busy ? "saving" : "save");
    }
  }

  /** Builds the data expected by the timed_scenes.set action. */
  _payload() {
    const d = this._data;
    const entities = this._config.entities.map((item, i) => {
      const type = tsType(item.entity);
      const out = { entity: item.entity };
      out.start_value = item.start.mode === "fixed" ? tsNorm(item.start.value) : type.toServer(d[`start_${i}`]);
      if (item.end.mode === "fixed") {
        out.end_mode = "value";
        out.end_value = tsNorm(item.end.value);
      } else if (item.end.mode === "ask") {
        out.end_mode = "value";
        out.end_value = type.toServer(d[`end_${i}`]);
      } else {
        out.end_mode = item.end.mode; // previous | none
      }
      return out;
    });
    const payload = { id: this._config.scene_id, start: d.start, entities };
    if (this._endChoice === "duration") {
      payload.duration = { days: d.duration.days || 0, hours: d.duration.hours || 0, minutes: d.duration.minutes || 0, seconds: 0 };
    } else {
      payload.end = d.end;
    }
    return payload;
  }

  async _save() {
    this._errors = [];
    this._errorTitle = undefined;
    this._setBusy(true);
    try {
      const response = await tsCallService(this._hass, TS_SERVICE_SET, this._payload());
      if (response && response.ok) {
        this.close();
        return;
      }
      this._errors = (response && response.errors) || ["?"];
    } catch (err) {
      this._handleCallError(err);
    }
    this._setBusy(false);
    this._showErrors();
  }

  async _delete() {
    this._errors = [];
    this._setBusy(true);
    try {
      await tsCallService(this._hass, TS_SERVICE_DELETE, { id: this._config.scene_id });
      this.close();
      return;
    } catch (err) {
      this._handleCallError(err);
    }
    this._setBusy(false);
    this._showErrors();
  }

  _handleCallError(err) {
    const message = (err && (err.message || err.code)) || String(err);
    const notFound = err && (err.code === "service_not_found" || /not found/i.test(message));
    this._errorTitle = tsT(this._hass, notFound ? "no_backend" : "error_generic");
    this._errors = [message];
  }
}

/* ================================================================== */
/*  The visual editor                                                  */
/*  Shown by Home Assistant in the card configuration dialog. It never */
/*  throws: partial configurations are allowed while editing.          */
/* ================================================================== */

/** "Living room heater" → "living_room_heater" */
const tsSlug = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Sanitizes an ID typed by hand, keeping underscores (typing "my_id" must work). */
const tsSanitizeId = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");

/**
 * Switches that declare they control an entity through an "entities"
 * attribute (e.g. schedules of the Scheduler integration). Generic: on an
 * installation without such switches, the list is simply empty.
 */
function tsControllingSwitches(hass, entityId) {
  if (!hass || !entityId) return [];
  return Object.values(hass.states)
    .filter((st) => tsDomain(st.entity_id) === "switch" && st.entity_id !== entityId)
    .filter((st) => {
      const list = st.attributes.entities;
      return Array.isArray(list) ? list.includes(entityId) : list === entityId;
    })
    .map((st) => st.entity_id);
}

/**
 * First scrolling ancestor of an element, crossing shadow DOM boundaries
 * (the editor scrolls inside Home Assistant's dialog, outside our card).
 */
function tsScrollParent(el) {
  let node = el;
  while (node) {
    node = node.parentNode || node.host; // a shadow root has no parentNode, but a host
    if (!node || node === document) break;
    if (node instanceof Element) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
  }
  return document.scrollingElement;
}

/** Sensible value for an entity: its current state if valid, else its first possible value. */
function tsDefaultValue(hass, entityId) {
  const st = hass && hass.states[entityId];
  if (["switch", "input_boolean"].includes(tsDomain(entityId))) return st && st.state === "on" ? "on" : "off";
  const options = (st && st.attributes.options) || [];
  if (st && options.includes(st.state)) return st.state;
  return options.length ? options[0] : undefined;
}

class TimedSceneCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = new Set(); // indexes of expanded entity blocks
    this._lastEmitted = "";
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this.shadowRoot.querySelectorAll("ha-form").forEach((f) => (f.hass = hass));
    if (first) this._render();
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    // Home Assistant sends back the config we just emitted: re-rendering would
    // make the user lose the focus of the field being edited.
    if (incoming === this._lastEmitted && this._config) return;
    this._config = JSON.parse(incoming || "{}");
    if (!Array.isArray(this._config.entities)) this._config.entities = [];
    this._render();
  }

  _t(key) {
    return tsT(this._hass, key);
  }

  _emit() {
    const config = { ...this._config };
    if (!config.title) delete config.title;
    if (!config.default_duration) delete config.default_duration;
    this._lastEmitted = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  /* ---------- conversion config item ⇄ flat row data ---------- */

  _toRow(item) {
    const start = item.start || { mode: "fixed" };
    const end = item.end || { mode: "previous" };
    return {
      entity: item.entity || "",
      name: item.name || "",
      start_mode: start.mode || "fixed",
      start_value: start.mode === "ask" ? start.default : start.value,
      end_mode: end.mode || "previous",
      end_value: end.mode === "ask" ? end.default : end.value,
      show: item.show === true ? "always" : item.show === false ? "never" : "auto",
    };
  }

  _fromRow(row) {
    const val = (v) => (v === undefined || v === null || v === "" ? undefined : tsNorm(v));
    const item = { entity: row.entity || "" };
    if (row.name) item.name = row.name;
    if (row.show === "always") item.show = true;
    if (row.show === "never") item.show = false;
    const sv = val(row.start_value);
    item.start = row.start_mode === "ask" ? { mode: "ask" } : { mode: "fixed" };
    if (sv !== undefined) item.start[row.start_mode === "ask" ? "default" : "value"] = sv;
    const ev = val(row.end_value);
    item.end = { mode: row.end_mode || "previous" };
    if (["fixed", "ask"].includes(item.end.mode) && ev !== undefined) {
      item.end[item.end.mode === "ask" ? "default" : "value"] = ev;
    }
    return item;
  }

  /**
   * A value field must never stay empty (the card would reject the config):
   * fill it with the current state of the entity, or its first option.
   */
  _withDefaults(row) {
    if (!row.entity || !tsType(row.entity)) return row;
    const fallback = tsDefaultValue(this._hass, row.entity);
    const empty = (v) => v === undefined || v === null || v === "";
    const out = { ...row };
    if (empty(out.start_value)) out.start_value = fallback;
    if (["fixed", "ask"].includes(out.end_mode) && empty(out.end_value)) out.end_value = fallback;
    return out;
  }

  _rowTitle(item) {
    const st = this._hass && item.entity && this._hass.states[item.entity];
    return item.name || (st && st.attributes.friendly_name) || item.entity || this._t("ed_new_entity");
  }

  /* ---------- rendering ---------- */

  /**
   * Rebuilds part of the editor without making the dialog jump back to the
   * top: while fields are rebuilt, the content is briefly shorter (new Home
   * Assistant fields are drawn asynchronously) and the browser clamps the
   * scroll position. We freeze the height, rebuild, wait for the new fields
   * to be drawn, then restore the height and the scroll position.
   */
  async _keepPosition(container, rebuild) {
    const scroller = tsScrollParent(this);
    const top = scroller ? scroller.scrollTop : 0;
    container.style.minHeight = `${container.offsetHeight}px`;
    await rebuild();
    const forms = [...container.querySelectorAll("ha-form")];
    await Promise.all(forms.map((f) => f.updateComplete).filter(Boolean));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    container.style.minHeight = "";
    if (scroller) scroller.scrollTop = top;
  }

  /** Full re-render (add / move / remove entities) keeping the scroll position. */
  _rerender() {
    return this._keepPosition(this.shadowRoot.host, () => this._render());
  }

  async _render() {
    if (!this._hass || !this._config) return;
    await tsLoadHaForm();
    const t = (k) => this._t(k);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        h3 { margin: 16px 0 8px; font-size: 1em; font-weight: 500; }
        details {
          border: 1px solid var(--divider-color); border-radius: 8px; margin-bottom: 8px;
          background: var(--card-background-color);
        }
        summary {
          display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px;
          cursor: pointer; list-style: none; user-select: none;
        }
        summary::-webkit-details-marker { display: none; }
        summary .chevron { transition: transform 0.2s; color: var(--secondary-text-color); }
        details[open] summary .chevron { transform: rotate(90deg); }
        summary .rowtitle { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        summary .index { color: var(--secondary-text-color); min-width: 1.5em; }
        .body { padding: 0 12px 12px; }
        .icon-btn {
          background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%;
          color: var(--secondary-text-color); line-height: 0;
        }
        .icon-btn:hover:not(:disabled) { background: rgba(127, 127, 127, 0.15); color: var(--primary-text-color); }
        .icon-btn:disabled { opacity: 0.3; cursor: default; }
        .suggest {
          display: flex; align-items: center; gap: 8px; padding: 8px 12px;
          border-radius: 8px; background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
        }
        .suggest span { flex: 1; }
        ${TS_BUTTON_CSS}
        ${TS_FIELD_CSS}
        button.add { margin-top: 4px; }
      </style>
      <h3>${tsEsc(t("ed_general"))}</h3>
      <div class="fields general"></div>
      <h3>${tsEsc(t("ed_entities"))}</h3>
      <div class="entities"></div>
      <button class="add">+ ${tsEsc(t("ed_add"))}</button>`;

    this._renderGeneral(this.shadowRoot.querySelector(".general"));
    const list = this.shadowRoot.querySelector(".entities");
    this._config.entities.forEach((item, i) => list.appendChild(this._renderRow(item, i)));
    this.shadowRoot.querySelector("button.add").addEventListener("click", () => {
      this._config.entities = [...this._config.entities, { entity: "", start: { mode: "fixed" }, end: { mode: "previous" } }];
      this._open.add(this._config.entities.length - 1);
      this._emit();
      this._rerender();
    });
  }

  _renderGeneral(container) {
    const t = (k) => this._t(k);
    const titleField = tsField(this._hass, { name: "title", selector: { text: {} }, label: t("ed_title"), value: this._config.title || "" }, (v) => {
      const oldTitle = this._config.title || "";
      // Scene ID follows the title as long as it has not been edited by hand.
      const autoId = !this._config.scene_id || this._config.scene_id === tsSlug(oldTitle);
      this._config.title = v || "";
      if (autoId) {
        this._config.scene_id = tsSlug(v);
        idField.data = { scene_id: this._config.scene_id };
      }
      this._emit();
    });
    const idField = tsField(this._hass, {
      name: "scene_id", selector: { text: {} }, label: t("ed_scene_id"), helper: t("ed_scene_id_help"),
      value: this._config.scene_id || "",
    }, (v) => {
      this._config.scene_id = tsSanitizeId(v);
      idField.data = { scene_id: this._config.scene_id };
      this._emit();
    });
    const durationField = tsDurationField(this._hass, {
      label: t("ed_default_duration"), value: tsParseDuration(this._config.default_duration),
    }, (d) => {
      this._config.default_duration = tsDurationToString(d);
      this._emit();
    });
    container.append(titleField, idField, durationField);
  }

  _renderRow(item, index) {
    const t = (k) => this._t(k);
    const count = this._config.entities.length;
    const details = document.createElement("details");
    details.open = this._open.has(index);
    details.addEventListener("toggle", () => {
      if (details.open) this._open.add(index);
      else this._open.delete(index);
    });

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      <span class="index">${index + 1}.</span>
      <span class="rowtitle">${tsEsc(this._rowTitle(item))}</span>
      <button class="icon-btn" data-op="up" title="${tsEsc(t("ed_up"))}" ${index === 0 ? "disabled" : ""}><ha-icon icon="mdi:arrow-up"></ha-icon></button>
      <button class="icon-btn" data-op="down" title="${tsEsc(t("ed_down"))}" ${index === count - 1 ? "disabled" : ""}><ha-icon icon="mdi:arrow-down"></ha-icon></button>
      <button class="icon-btn" data-op="remove" title="${tsEsc(t("ed_remove"))}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>`;
    summary.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        ev.preventDefault(); // do not toggle the block
        ev.stopPropagation();
        this._rowOperation(btn.dataset.op, index);
      })
    );

    const body = document.createElement("div");
    body.className = "body fields";
    details.append(summary, body);
    this._fillRowBody(body, summary, index);
    return details;
  }

  /** (Re)builds the fields of one entity block. */
  _fillRowBody(body, summary, index) {
    const t = (k) => this._t(k);
    body.innerHTML = "";
    const row = this._toRow(this._config.entities[index]);
    const type = tsType(row.entity);
    const st = this._hass.states[row.entity];
    const valueSelector = type ? type.editorSelector(st) : { text: {} };

    const update = (changes, rebuild) => {
      const merged = { ...row, ...changes };
      const next = this._withDefaults(merged);
      this._config.entities = this._config.entities.map((e, i) => (i === index ? this._fromRow(next) : e));
      summary.querySelector(".rowtitle").textContent = this._rowTitle(this._config.entities[index]);
      this._emit();
      // Rebuild when fields must appear / disappear or a value was filled in
      // by default (keeps the focus otherwise).
      const filled = next.start_value !== merged.start_value || next.end_value !== merged.end_value;
      if (rebuild || filled) this._keepPosition(body, () => this._fillRowBody(body, summary, index));
      else Object.assign(row, next);
    };
    const modes = (list) => list.map((m) => ({ value: m, label: t(`ed_mode_${m}`) }));

    const picker = tsField(this._hass, {
      name: "entity", label: t("ed_entity"), value: row.entity,
      selector: { entity: { filter: [{ domain: TS_SUPPORTED_DOMAINS }] } },
    }, (v) => update({ entity: v || "", start_value: undefined, end_value: undefined }, true)); // new entity: values reset, then defaulted
    picker.classList.add("picker");
    body.append(
      picker,
      tsField(this._hass, { name: "name", label: t("ed_name"), value: row.name, selector: { text: {} } }, (v) => update({ name: v || "" })),
      tsRadioRow({
        label: t("ed_show"), name: "show", selected: row.show,
        options: ["auto", "always", "never"].map((v) => ({ value: v, label: t(`ed_show_${v}`) })),
      }, (v) => update({ show: v })),
      tsRadioRow({ label: t("ed_start_value"), name: "start_mode", selected: row.start_mode, options: modes(["fixed", "ask"]) },
        (v) => update({ start_mode: v }, true)),
    );
    const startValue = tsField(this._hass, {
      name: "start_value", selector: valueSelector, value: row.start_value,
      label: row.start_mode === "ask" ? t("ed_default") : t("ed_value"),
    }, (v) => update({ start_value: v }));
    startValue.classList.add("indent");
    body.append(
      startValue,
      tsRadioRow({ label: t("ed_end_value"), name: "end_mode", selected: row.end_mode, options: modes(["fixed", "ask", "previous", "none"]) },
        (v) => update({ end_mode: v }, true)),
    );
    if (["fixed", "ask"].includes(row.end_mode)) {
      const endValue = tsField(this._hass, {
        name: "end_value", selector: valueSelector, value: row.end_value,
        label: row.end_mode === "ask" ? t("ed_default") : t("ed_value"),
      }, (v) => update({ end_value: v }));
      endValue.classList.add("indent");
      body.append(endValue);
    }
    this._renderSuggestion(body, index);
  }

  /** "N schedules control this entity — Add them" */
  _renderSuggestion(body, index) {
    const item = this._config.entities[index];
    const present = new Set(this._config.entities.map((e) => e.entity));
    const missing = tsControllingSwitches(this._hass, item.entity).filter((id) => !present.has(id));
    if (!missing.length) return;
    const box = document.createElement("div");
    box.className = "suggest";
    box.innerHTML = `<ha-icon icon="mdi:lightbulb-outline"></ha-icon>
      <span>${tsEsc(this._t("ed_suggest").replace("{n}", missing.length))}</span>
      <button>${tsEsc(this._t("ed_suggest_add"))}</button>`;
    box.querySelector("button").addEventListener("click", () => {
      const added = missing.map((id) => ({ entity: id, start: { mode: "fixed", value: "off" }, end: { mode: "previous" } }));
      const list = [...this._config.entities];
      list.splice(index + 1, 0, ...added);
      this._config.entities = list;
      this._open = new Set([...this._open].map((i) => (i > index ? i + added.length : i)));
      this._emit();
      this._rerender();
    });
    body.appendChild(box);
  }

  _rowOperation(op, index) {
    const list = [...this._config.entities];
    const move = (from, to) => {
      [list[from], list[to]] = [list[to], list[from]];
      const wasOpen = this._open.has(from), otherOpen = this._open.has(to);
      this._open.delete(from); this._open.delete(to);
      if (wasOpen) this._open.add(to);
      if (otherOpen) this._open.add(from);
    };
    if (op === "up" && index > 0) move(index, index - 1);
    else if (op === "down" && index < list.length - 1) move(index, index + 1);
    else if (op === "remove") {
      list.splice(index, 1);
      this._open = new Set([...this._open].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    }
    this._config.entities = list;
    this._emit();
    this._rerender();
  }
}

// Guard against the resource being loaded twice.
if (!customElements.get("timed-scene-card")) customElements.define("timed-scene-card", TimedSceneCard);
if (!customElements.get("timed-scene-dialog")) customElements.define("timed-scene-dialog", TimedSceneDialog);
if (!customElements.get("timed-scene-card-editor")) customElements.define("timed-scene-card-editor", TimedSceneCardEditor);

// Makes the card appear in the "Add card" picker.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "timed-scene-card",
  name: "Timed Scene",
  description: "Temporarily apply states to entities during a time window, then restore them.",
  preview: true,
});

console.info(`%c TIMED-SCENE-CARD %c v${TS_VERSION} `, "color: white; background: #03a9f4; font-weight: 700;", "");
