import hi from "./locales/en-hi.json" with { type: "json" };
import messageTemplates from "./locales/message-templates.json" with { type: "json" };

let activeLanguage = "en";
export const getUiLanguage = () => activeLanguage;
export const setUiLanguage = (language) => { activeLanguage = language === "hi" ? "hi" : "en"; };
export const translationCatalog = hi;

const patterns = [
  [/^Token #(\d+)$/i, "टोकन #$1"],
  [/^(\d+) (waiting|completed|pending|patients|doctors|visits|appointments)$/i,
    (m, n, status) => `${n} ${hi[status] || status}`],
  [/^No (.+) found\.$/i, (m, subject) => `कोई ${hi[subject] || subject} नहीं मिला।`],
  [/^Good (?:day|morning|afternoon|evening),\s*(.+)$/i, (m, name) => `नमस्कार, ${name}`],
  [/^Welcome,\s*(.+)$/i, (m, name) => `स्वागत है, ${name}`],
];

const renderParams = (text, params) => String(text).replace(/\{([a-zA-Z][\w]*)\}/g,
  (match, key) => Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiledTemplates = Object.entries(messageTemplates).map(([english, hindi]) => {
  const names = [];
  const parts = english.split(/(\{[a-zA-Z][\w]*\})/g);
  const source = parts.map((part) => {
    const match = part.match(/^\{([a-zA-Z][\w]*)\}$/);
    if (match) { names.push(match[1]); return "([\\s\\S]*?)"; }
    return escapeRegex(part);
  }).join("");
  return { pattern: new RegExp("^" + source + "$", "i"), names, hindi };
});

export function translateUiText(value, language = activeLanguage, params = {}) {
  if (typeof value !== "string" || !value.trim()) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const clean = value.trim();
  if (language !== "hi") return renderParams(value, params);
  let result = Object.prototype.hasOwnProperty.call(hi, clean) ? hi[clean] : undefined;
  if (result === undefined && clean.length <= 4096) {
    for (const template of compiledTemplates) {
      const match = clean.match(template.pattern);
      if (!match) continue;
      const values = { ...params };
      template.names.forEach((name, index) => { values[name] = match[index + 1]; });
      result = renderParams(template.hindi, values);
      break;
    }
  }
  if (result === undefined) {
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(clean)) { result = clean.replace(pattern, replacement); break; }
    }
  }
  if (result === undefined) return renderParams(value, params);
  return `${leading}${renderParams(result, params)}${trailing}`;
}

export function localizeUi(value, params) {
  return translateUiText(value, activeLanguage, params);
}

export function translateUiEnum(value, language = activeLanguage) {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/_/g, " ");
  return translateUiText(normalized, language);
}
