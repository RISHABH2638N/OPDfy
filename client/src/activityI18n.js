import { translateUiText, translateUiEnum } from "./i18n.js";

const modules = {
  auth: "प्रमाणीकरण", authentication: "प्रमाणीकरण", queue: "कतार",
  consultation: "परामर्श", consultations: "परामर्श", referral: "रेफरल",
  referrals: "रेफरल", reception: "रिसेप्शन", appointments: "अपॉइंटमेंट",
  appointment: "अपॉइंटमेंट", staff: "स्टाफ", billing: "बिलिंग",
  "clinic settings": "क्लिनिक सेटिंग्स", "tv display": "TV डिस्प्ले",
  prescription: "पर्चा", operations: "संचालन", patient: "रोगी",
  patients: "रोगी", feedback: "प्रतिक्रिया", admin: "एडमिन",
  platform: "प्लेटफ़ॉर्म", "check-in": "चेक-इन",
};
const actions = {
  CREATE_STAFF: "स्टाफ खाता बनाया गया",
  UPDATE_STAFF: "स्टाफ खाता अपडेट किया गया",
  DELETE_STAFF: "स्टाफ खाता हटाया गया",
  UPDATE_DOCTOR_SCHEDULE: "डॉक्टर का शेड्यूल या कक्ष अपडेट किया गया",
  UPDATE_CLINIC_BRANDING: "क्लिनिक की ब्रांडिंग अपडेट की गई",
  UPDATE_BILLING_SETTINGS: "बिलिंग और शुल्क नियम अपडेट किए गए",
  UPDATE_DOCTOR_FEES: "डॉक्टर का शुल्क अपडेट किया गया",
  REFUND_PAYMENT: "भुगतान रिफंड दर्ज किया गया",
  CREATE_TV_DISPLAY: "सुरक्षित TV डिस्प्ले बनाया गया",
  ROTATE_TV_DISPLAY_KEY: "TV डिस्प्ले की सुरक्षा कुंजी बदली गई",
  DELETE_TV_DISPLAY: "TV डिस्प्ले हटाया गया",
  UPDATE_TV_DISPLAY: "TV डिस्प्ले की सेटिंग्स अपडेट की गईं",
  REGISTER_PATIENT: "वॉक-इन रोगी पंजीकृत किया गया",
  ISSUE_WALKIN_TOKEN: "वॉक-इन कतार टोकन जारी किया गया",
  CHECK_IN_RESERVATION: "ऑनलाइन रिज़र्वेशन का चेक-इन किया गया",
  BOOK_APPOINTMENT: "अपॉइंटमेंट बुक किया गया",
  CHECK_IN_APPOINTMENT: "अपॉइंटमेंट का चेक-इन किया गया",
  ASSIGN_DOCTOR: "टोकन के लिए डॉक्टर असाइन किया गया",
  UPDATE_ARRIVAL: "रोगी के आगमन की स्थिति अपडेट की गई",
  QUEUE_INTERVENTION: "कतार में नियंत्रित बदलाव किया गया",
  PRINT_PRESCRIPTION: "पूर्ण पर्चा प्रिंट किया गया",
  UPDATE_TOKEN_STATUS: "लाइव टोकन की स्थिति अपडेट की गई",
  RESET_DAILY_QUEUE: "दैनिक कतार रीसेट करके आर्काइव की गई",
  COMPLETE_CONSULTATION: "परामर्श पूर्ण किया गया",
  DOCTOR_REFERRAL_CREATED: "डॉक्टर ने विभाग रेफरल बनाया",
  DOCTOR_REFERRAL_CANCELLED: "डॉक्टर ने लंबित रेफरल रद्द किया",
  RECEPTION_REFERRAL_ACCEPTED: "रिसेप्शन ने रेफरल स्वीकार किया",
  RECEPTION_HOLD: "रिसेप्शन ने टोकन होल्ड किया",
  RECEPTION_RESUME: "रिसेप्शन ने टोकन फिर शुरू किया",
  RECEPTION_REASSIGN: "रिसेप्शन ने दूसरा डॉक्टर असाइन किया",
  RECEPTION_TRANSFER: "रिसेप्शन ने विभाग बदला",
  RECEPTION_RECOVER_NO_SHOW: "रिसेप्शन ने अनुपस्थित रोगी को कतार में वापस लाया",
  RECEPTION_PRIORITY: "रिसेप्शन ने कतार की प्राथमिकता बदली",
};
const methodLabels = { GET: "पढ़ने", POST: "बनाने/भेजने", PATCH: "आंशिक अपडेट", PUT: "अपडेट", DELETE: "हटाने" };

export function formatActivityModule(module, language = "en") {
  if (language !== "hi" || typeof module !== "string") return module || "";
  return modules[module.toLowerCase()] || translateUiText(module, language);
}
export function formatActivityAction(action, language = "en") {
  if (language !== "hi" || typeof action !== "string") return action || "";
  if (actions[action]) return actions[action];
  const match = action.match(/^(GET|POST|PATCH|PUT|DELETE)_OPERATION$/);
  if (match) return `${methodLabels[match[1]]} का अनुरोध पूरा हुआ`;
  return translateUiEnum(action, language);
}

// All parsing is presentation-only. Names, identifiers and clinical information
// remain untouched, and the stored English audit records are never rewritten.
const legacy = [
  [/^Completed (GET|POST|PATCH|PUT|DELETE) operation in (.+)$/i,
    (m, method, module, language) => `${formatActivityModule(module, language)} में ${method.toUpperCase()} अनुरोध पूरा हुआ`],
  [/^Referral ([a-f0-9]{24}) accepted; target token #(\d+) in (.+)\.$/i,
    (m, ref, token, department, language) => `रेफरल ${ref} स्वीकार किया गया; ${translateUiText(department, language)} विभाग में नया टोकन #${token} जारी हुआ।`],
  [/^Referral ([a-f0-9]{24}) created for (.+) to (.+)\.$/i,
    (m, ref, from, to, language) => `रेफरल ${ref} बनाया गया; ${translateUiText(from, language)} से ${translateUiText(to, language)} भेजा गया।`],
  [/^Referral ([a-f0-9]{24}) cancelled\.$/i,
    (m, ref) => `रेफरल ${ref} रद्द किया गया।`],
  [/^Reception (hold|resume|reassign|transfer|recover no show|priority) for (.+) token #(\d+): (.*)$/i,
    (m, action, department, token, reason, language) => `रिसेप्शन ने ${translateUiText(department, language)} के टोकन #${token} पर ${translateUiText(action, language)} किया: ${reason}`],
];
export function formatActivitySummary(log, language = "en") {
  const summary = log?.summary;
  if (typeof summary !== "string" || language !== "hi") return summary || "";
  for (const [pattern, format] of legacy) {
    const match = summary.match(pattern);
    if (match) return format(...match, language);
  }
  const exact = translateUiText(summary, language);
  if (exact !== summary) return exact;
  // Known action codes provide a safe translation for historic audit messages.
  // Keep unrecognized summaries verbatim rather than inventing an action.
  return actions[log?.action] ? `${actions[log.action]} — ${summary}` : summary;
}
