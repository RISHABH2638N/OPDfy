import mongoose from "mongoose";
import PrivacyConsentEvent from "../models/PrivacyConsentEvent.js";
import GlobalPatient from "../models/GlobalPatient.js";

export const CONSENT_NOTICE_VERSION = "external-ai-2026-09-09-v1";
export const CONSENT_PURPOSE = "external_ai";
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export const consentNotice = Object.freeze({
  purpose: CONSENT_PURPOSE,
  version: CONSENT_NOTICE_VERSION,
  en: "Optional external AI routing: your symptom description and coarse age band/gender may be sent to Google's Gemini service to suggest an OPD department. Do not include unnecessary identifiers. AI does not diagnose or prescribe. You can decline or withdraw without losing ordinary booking, queue or clinical services. Withdrawal prevents future external AI requests; it cannot recall information already sent. Review the provider's current processing and retention terms before granting consent; contact privacy support for details.",
  hi: "वैकल्पिक बाहरी AI रूटिंग: आपके लक्षणों का विवरण और अनुमानित आयु-वर्ग/लिंग OPD विभाग सुझाने के लिए Google की Gemini सेवा को भेजे जा सकते हैं। अनावश्यक पहचान संबंधी जानकारी न लिखें। AI निदान या दवा नहीं देता। आप सामान्य बुकिंग, कतार या चिकित्सा सेवा खोए बिना मना कर सकते हैं या सहमति वापस ले सकते हैं। सहमति वापस लेने से भविष्य के बाहरी AI अनुरोध रुकते हैं; पहले भेजी गई जानकारी वापस नहीं ली जा सकती। अनुमति देने से पहले प्रदाता की वर्तमान डेटा प्रोसेसिंग और रिटेंशन शर्तें देखें; विवरण के लिए गोपनीयता सहायता से संपर्क करें।",
});

export async function currentConsent(patientId, purpose = CONSENT_PURPOSE, session = null) {
  if (purpose !== CONSENT_PURPOSE) throw error("Unknown consent purpose.");
  let query = PrivacyConsentEvent.findOne({ patient: patientId, purpose }).sort({ version: -1 }).lean();
  if (session) query = query.session(session);
  return await query;
}

export function isAdultForExternalAi(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return false;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime()) || birth > now) return false;
  const year = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  return year - (birthdayPassed ? 0 : 1) >= 18;
}

export async function hasExternalAiConsent(patientId) {
  const account = await GlobalPatient.findOne({ _id: patientId, status: "active" })
    .select("dateOfBirth").lean();
  if (!account || !isAdultForExternalAi(account.dateOfBirth)) return false;
  const current = await currentConsent(patientId);
  return current?.decision === "granted" && current.noticeVersion === CONSENT_NOTICE_VERSION;
}

export async function recordConsent(patientId, input, { actor = "patient", source = "privacy-center" } = {}) {
  if (input?.purpose !== CONSENT_PURPOSE || !["granted", "withdrawn"].includes(input?.decision) ||
      !["en", "hi"].includes(input?.language) || input.noticeVersion !== CONSENT_NOTICE_VERSION ||
      input.acknowledged !== true) throw error("Review and acknowledge the current consent notice.");
  if (input.decision === "granted") {
    const account = await GlobalPatient.findOne({ _id: patientId, status: "active" })
      .select("dateOfBirth").lean();
    if (!account || !isAdultForExternalAi(account.dateOfBirth)) {
      throw error("Optional external AI requires a verified adult profile. Guardian consent support is not yet available.", 403);
    }
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      const account = await GlobalPatient.updateOne({ _id: patientId, status: "active" },
        { $inc: { privacyRevision: 1 } }, { session });
      if (account.matchedCount !== 1) throw error("Account is unavailable.", 401);
      const previous = await currentConsent(patientId, CONSENT_PURPOSE, session);
      const [event] = await PrivacyConsentEvent.create([{
        patient: patientId, purpose: CONSENT_PURPOSE, version: (previous?.version || 0) + 1,
        decision: input.decision, noticeVersion: CONSENT_NOTICE_VERSION,
        language: input.language, actor, source,
      }], { session });
      return event;
    });
  } catch (err) {
    if (err.code === 11000 || err.name === "VersionError") throw error("Consent changed in another request. Refresh and try again.", 409);
    throw err;
  }
}
