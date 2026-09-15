import { translateUiText } from "./i18n.js";

export function isFollowUpNotification(item) {
  return ["follow_up_reminder", "follow_up_pending"].includes(item?.type);
}

function formatDate(value, language) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN",
    { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatClock(value, language) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return "";
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN",
    { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(`2000-01-01T${value}:00Z`));
}

export function followUpNotificationText(item, language = "en") {
  if (!isFollowUpNotification(item)) return { title: item?.title || "", message: item?.message || "" };
  const meta = item.metadata || {};
  const stage = Number(meta.stage);
  const due = meta.followUpDate;
  // Preserve legacy notifications when structured metadata is unavailable.
  if (!Number.isInteger(stage) || !Number.isFinite(stage) || stage < -3 || stage > 3 || !due) {
    return { title: translateUiText(item.title || "", language), message: item.message || "" };
  }
  const hi = language === "hi";
  const days = Math.abs(stage);
  const title = stage === 0
    ? (hi ? "आज फॉलो-अप चेकअप है" : "Follow-up due today")
    : stage < 0
      ? (hi ? `${days} दिन बाद फॉलो-अप चेकअप` : `Follow-up in ${days} day${days === 1 ? "" : "s"}`)
      : (hi ? `फॉलो-अप लंबित: ${days} दिन बीत गए` : `Follow-up pending: ${days} day${days === 1 ? "" : "s"} overdue`);
  const date = formatDate(due, language);
  const intro = stage > 0
    ? (hi ? `${date} के लिए सुझाया गया फॉलो-अप अभी पूर्ण नहीं हुआ है।` : `Your recommended follow-up on ${date} has not yet been completed.`)
    : stage === 0
      ? (hi ? `आपका सुझाया गया फॉलो-अप आज (${date}) है।` : `Your recommended follow-up is due today (${date}).`)
      : (hi ? `आपका सुझाया गया फॉलो-अप ${date} को है।` : `Your recommended follow-up is on ${date}.`);
  const doctorName = meta.doctorName || "";
  const doctor = doctorName ? `${hi ? "डॉ." : "Dr."} ${doctorName}` : (hi ? "आपके डॉक्टर" : "Your doctor");
  const department = translateUiText(meta.department || "", language);
  const details = [
    doctor, department, meta.clinicName,
    meta.roomNumber ? `${hi ? "कक्ष" : "Room"} ${meta.roomNumber}` : "",
  ].filter(Boolean).join(" · ");
  const booked = meta.appointmentId && meta.appointmentDate && meta.startTime;
  const appointmentText = booked
    ? (hi ? `आपका अपॉइंटमेंट ${formatDate(meta.appointmentDate, language)} को ${formatClock(meta.startTime, language)} बजे बुक है।`
      : `Your appointment is booked for ${formatDate(meta.appointmentDate, language)} at ${formatClock(meta.startTime, language)}.`)
    : (hi ? "इस फॉलो-अप के लिए अभी कोई सक्रिय अपॉइंटमेंट लिंक नहीं है। अपॉइंटमेंट बुक करें या रिसेप्शन से संपर्क करें।"
      : "No active follow-up appointment is linked. Book a suitable slot or contact reception.");
  return { title, message: [intro, details, appointmentText].filter(Boolean).join("\n") };
}
