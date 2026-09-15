export const CONSENT_CATEGORIES = Object.freeze(["general_treatment", "procedure", "record_sharing", "teleconsultation", "other"]);

function cleanText(value, { label, min = 0, max }) {
  const result = String(value || "").trim();
  if (result.length < min || result.length > max) throw Object.assign(new Error(`${label} must be between ${min} and ${max} characters.`), { status: 400 });
  return result;
}

export function cleanConsentRequest(body = {}, now = new Date()) {
  const category = String(body.category || "");
  if (!CONSENT_CATEGORIES.includes(category)) throw Object.assign(new Error("Choose a valid consent category."), { status: 400 });
  const language = String(body.language || "en");
  if (!["en", "hi"].includes(language)) throw Object.assign(new Error("Consent language must be English or Hindi."), { status: 400 });
  const validUntil = new Date(body.validUntil || "");
  const minTime = now.getTime() + 15 * 60 * 1000;
  const maxTime = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  if (Number.isNaN(validUntil.getTime()) || validUntil.getTime() < minTime || validUntil.getTime() > maxTime) {
    throw Object.assign(new Error("Consent validity must be between 15 minutes and 30 days from now."), { status: 400 });
  }
  const materialRisks = cleanText(body.materialRisks, { label: "Material risks", min: category === "procedure" ? 10 : 0, max: 2000 });
  return {
    category, language, validUntil,
    title: cleanText(body.title, { label: "Consent title", min: 4, max: 120 }),
    explanation: cleanText(body.explanation, { label: "Explanation", min: 20, max: 2000 }),
    expectedBenefits: cleanText(body.expectedBenefits, { label: "Expected benefits", max: 1600 }),
    materialRisks,
    alternatives: cleanText(body.alternatives, { label: "Alternatives", max: 1600 }),
    refusalConsequences: cleanText(body.refusalConsequences, { label: "Consequences of refusal", max: 1600 }),
  };
}

export function effectiveConsentStatus(consent, now = new Date()) {
  if (["pending", "patient_acknowledged", "active"].includes(consent?.status) && consent?.validUntil && new Date(consent.validUntil) <= now) return "expired";
  return consent?.status || "pending";
}

export function appendConsentEvent(consent, event) {
  const history = consent.events || [];
  if (history.length >= 50) throw Object.assign(new Error("Consent audit history is full. Contact support before adding another event."), { status: 409 });
  history.push({ ...event, at: event.at || new Date() });
  consent.events = history;
}

export function normalizePersonName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
}
