import PrivacyPhase4Operations from "./PrivacyPhase4Operations";
import ClinicPrivacyReview from "./ClinicPrivacyReview";
import ClinicIdentityReviews from "./ClinicIdentityReviews";
import PlatformPrivacyRequests from "./PlatformPrivacyRequests";
import PrivacyPhase3Clinic from "./PrivacyPhase3Clinic";
import PrivacyPhase3Governance from "./PrivacyPhase3Governance";
import PatientPrivacyCenter from "./PatientPrivacyCenter";
import PatientClinicalSummary from './PatientClinicalSummary';
import ClinicalConsentCenter from "./ClinicalConsentCenter";
import PlatformBrandingPage from "./PlatformBrandingPage";
import "./followup-notifications.css";
import { useLanguage, Trans } from "./LanguageContext";
import { localizeUi } from "./i18n.js";
import { isFollowUpNotification, followUpNotificationText } from "./followUpNotificationText.js";
import { formatActivitySummary, formatActivityModule, formatActivityAction } from "./activityI18n.js";
import React, { useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";

import {
  Activity,
  AlertTriangle,
  Bell,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock3,
  FileText,
  FileCheck2,
  Download,
  Printer,
  Plus,
  Trash2,
  HeartPulse,
  LogIn,
  LogOut,
  Menu,
  X,
  Mail,
  Monitor,
  Phone,
  Pill,
  RefreshCw,
  QrCode,
  Send,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Stethoscope,
  Ticket,
  User,
  UserCheck,
  UserRound,
  Users,
  Volume2,
  VolumeX,
  Languages,
  Palette,
  Building2,
  Save,
  Globe2,
  MapPin,
  Image as ImageIcon,
  IndianRupee,
  CreditCard,
  Banknote,
} from "lucide-react";

import {
  api,
  getStoredUser,
  logout,
  saveAuth,
  savePatientAuth,
  getStoredPatient,
  getPatientToken,
  logoutPatient,
  updateStoredPatient,
  platformApi,
  savePlatformAuth,
  getStoredPlatformUser,
  logoutPlatform,
  onboardingApi,
  patientPlatformApi,
  setActiveClinicSlug,
  clearActiveClinicSlug,
  getSelectedClinicSlug,
  getActiveClinicSlug,
  saveOnboardingToken,
  getOnboardingToken,
  clearOnboardingToken,
} from "./api";

import { socket } from "./socket";
import { QRCodeSVG } from "qrcode.react";
import DoctorRating, { doctorOptionText } from "./DoctorRating";
import StaffPasswordRecovery from "./StaffPasswordRecovery";
import { DashboardTranslator, LanguageSwitcher } from "./LanguageContext";
import { ThemeToggle } from "./ThemeContext";
import PublicInfoPage, { PublicFooter, PatientPolicyNotice, ClinicPolicyAcceptance } from "./PublicPages.jsx";
import { POLICY_VERSION } from "./publicContent.js";
import { DoctorReferrals, ReceptionReferrals, PatientReferrals } from "./DepartmentReferrals";

/* =========================================================
   UTILITY & FORMATTING HELPERS
========================================================= */

const CLINICAL_DEPARTMENTS = [
  { value: "General OPD", label: "General OPD & Internal Medicine" },
  { value: "Cardiology", label: "Cardiology & Heart Care" },
  { value: "Orthopedics", label: "Orthopedics & Joint Clinic" },
  { value: "Neurology", label: "Neurology & Brain Care" },
  { value: "ENT", label: "ENT (Ear, Nose, Throat)" },
  { value: "Pediatrics", label: "Pediatrics & Child Wellness" },
  { value: "Dermatology", label: "Dermatology & Skin Care" },
];

const EMPTY_CLINIC_VERIFICATION = {
  legalName: "", establishmentType: "clinic", registrationNumber: "",
  registrationAuthority: "", registrationState: "", certificateExpiresAt: "",
  evidenceReference: "", status: "not_submitted", reviewNote: "",
};

const EMPTY_DOCTOR_VERIFICATION = {
  councilName: "", registrationState: "", registrationExpiresAt: "",
  evidenceReference: "", status: "not_submitted", reviewNote: "",
};

function verificationStatusLabel(status, subject = "clinic") {
  if (status === "platform_reviewed") return "Platform reviewed";
  if (status === "clinic_reviewed") return "Clinic-reviewed registration";
  if (status === "submitted") return "Submitted for review";
  if (status === "rejected") return "Review rejected";
  if (status === "expired") return subject === "doctor" ? "Registration review expired" : "Review expired";
  return subject === "doctor" ? "Registration not clinic-reviewed" : "Active clinic · verification not submitted";
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function normalizeDoctorSchedule(schedule = {}) {
  const selectedDays = Array.isArray(schedule.workingDays)
    ? schedule.workingDays.filter((day) => WEEK_DAYS.includes(day))
    : [];

  return {
    workingDays:
      selectedDays.length > 0
        ? selectedDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    startTime: schedule.startTime || "09:00",
    endTime: schedule.endTime || "17:00",
    isOnBreak: Boolean(schedule.isOnBreak),
    roomNumber: schedule.roomNumber || "",
    unavailableDates: Array.isArray(schedule.unavailableDates)
      ? [...schedule.unavailableDates].sort()
      : [],
    newUnavailableDate: "",
  };
}

function normalizeDoctorBillingProfile(profile = {}) {
  const value = (field) => profile?.[field] === null || profile?.[field] === undefined ? "" : String(profile[field]);
  return {
    enabled: profile.enabled !== false,
    consultationFee: value("consultationFee"),
    followUpFee: value("followUpFee"),
    freeFollowUpDays: String(profile.freeFollowUpDays ?? 0),
    walkInFee: value("walkInFee"),
    reservationFee: value("reservationFee"),
    appointmentFee: value("appointmentFee"),
    emergencyFee: value("emergencyFee"),
  };
}

function getLoggedInStaff() {
  return getStoredUser();
}
async function getExternalAiConsent() {
  try {
    const { data } = await patientPlatformApi.get("/privacy/consents");
    return data.active === true;
  } catch {
    return false;
  }
}

function formatInr(value) {
  const amount = Number(value || 0);
  return `₹${Number.isFinite(amount) ? amount.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0"}`;
}

function emptyPaymentDraft(amount = 0) {
  return { method: "cash", paidAmount: String(Number(amount || 0)), transactionReference: "", overrideReason: "" };
}

function ReceptionPaymentBox({ amount = 0, feeType = "consultation", draft, onChange, compact = false }) {
  const { t } = useLanguage();
  const due = Number(amount || 0);
  if (due <= 0) {
    return <div className="payment-free-visit"><CheckCircle size={17}/><div><b><Trans text={"No payment due"} /></b><small>{t(feeType === "free_follow_up" ? "Eligible free follow-up" : "Clinic/doctor fee is set to zero")}</small></div></div>;
  }
  return (
    <div className={`reception-payment-box ${compact ? "compact" : ""}`}>
      <div className="payment-amount-banner"><span><IndianRupee size={17}/> <Trans text={"Consultation fee"} /></span><strong>{formatInr(due)}</strong></div>
      <div className="payment-method-grid">
        {[['cash','Cash',Banknote],['upi','UPI',QrCode],['card','Card',CreditCard],['other','Other',WalletIconFallback]].map(([value,label,Icon]) => (
          <button key={value} type="button" className={draft.method===value?'active':''} onClick={()=>onChange({...draft,method:value})}><Icon size={15}/>{t(label)}</button>
        ))}
      </div>
      <div className="payment-input-grid">
        <label><Trans text={"Amount received"} /><input type="number" min="0" max={due} step="0.01" value={draft.paidAmount} onChange={(e)=>onChange({...draft,paidAmount:e.target.value})}/></label>
        <label><Trans text={"Reference / UTR"} /><input value={draft.transactionReference} onChange={(e)=>onChange({...draft,transactionReference:e.target.value})} placeholder={t("Optional for cash")}/></label>
      </div>
      {Number(draft.paidAmount || 0) < due && <label className="payment-override-reason"><Trans text={"Discount / override reason"} /><input value={draft.overrideReason} onChange={(e)=>onChange({...draft,overrideReason:e.target.value})} placeholder={t("Required when amount is reduced")}/></label>}
      <small className="payment-policy-note"><Trans text={"Payment is recorded only when reception confirms check-in. Emergency priority remains independent of payment."} /></small>
    </div>
  );
}

function WalletIconFallback(props) {
  const { t } = useLanguage(); return <FileText {...props}/>; }


function formatQueueStatus(status) {
  const statusLabels = {
    waiting: "Waiting in Queue",
    called: "Now Serving",
    completed: "Consultation Completed",
    skipped: "Token Skipped",
  };
  return statusLabels[status] || status;
}

function hasOperationalDomain(update, domain) {
  const domains = Array.isArray(update?.domains) ? update.domains : [];
  return domains.includes(domain);
}

/**
 * Normalizes array or comma-separated string data into a clean array of strings.
 * Solves rendering issues for medical history, allergies, and medications.
 */
function normalizeToArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.flatMap((item) =>
      typeof item === "string"
        ? item.split(",").map((str) => str.trim()).filter(Boolean)
        : item
    );
  }
  if (typeof data === "string") {
    return data
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function calculatePatientAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let calculatedAge = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    calculatedAge--;
  }
  return Math.max(calculatedAge, 0);
}


function getPrescriptionTemplate(clinicContext = {}) {
  const template = clinicContext?.settings?.prescriptionTemplate || clinicContext?.prescriptionTemplate || {};
  return {
    title: template.title || "Prescription",
    headerNote: template.headerNote || "",
    footerNote: template.footerNote || "Please follow the treating physician's instructions.",
    watermarkText: template.watermarkText || "",
    showLogo: template.showLogo !== false,
    showClinicContact: template.showClinicContact !== false,
    showPatientId: template.showPatientId !== false,
    showPatientAgeGender: template.showPatientAgeGender !== false,
    showToken: template.showToken !== false,
    showSymptoms: template.showSymptoms !== false,
    showDiagnosis: template.showDiagnosis !== false,
    showTests: template.showTests !== false,
    showAdvice: template.showAdvice !== false,
    showFollowUp: template.showFollowUp !== false,
    showDoctorRegistration: template.showDoctorRegistration !== false,
    showSignatureLine: template.showSignatureLine !== false,
    watermarkEnabled: template.watermarkEnabled !== false,
  };
}

function getClinicPrescriptionBrand(clinicContext = {}) {
  const branding = clinicContext?.settings?.branding || clinicContext?.branding || {};
  return {
    name: clinicContext?.settings?.displayName || clinicContext?.displayName || clinicContext?.name || "Clinic / Hospital",
    shortName: branding.shortName || "",
    logoUrl: branding.logoUrl || "",
    address: branding.address || "",
    website: branding.website || "",
    contactEmail: clinicContext?.contactEmail || "",
    contactPhone: clinicContext?.contactPhone || "",
    primaryColor: branding.primaryColor || "#0f766e",
    accentColor: branding.accentColor || "#14b8a6",
  };
}

function prescriptionLines(consultation, tokenItem, patient, clinicContext = {}) {
  const doctorName = consultation?.doctor?.name || "Medical Officer";
  const profile = consultation?.doctor?.prescriptionProfile || {};
  const template = getPrescriptionTemplate(clinicContext);
  const clinic = getClinicPrescriptionBrand(clinicContext);
  const age = calculatePatientAge(patient?.dateOfBirth);
  const lines = [
    clinic.name.toUpperCase(),
    template.title.toUpperCase(),
  ];
  if (template.showClinicContact) {
    if (clinic.address) lines.push(clinic.address);
    const contact = [clinic.contactPhone, clinic.contactEmail, clinic.website].filter(Boolean).join(" | ");
    if (contact) lines.push(contact);
  }
  if (template.headerNote) lines.push(template.headerNote);
  lines.push("", `Patient: ${patient?.name || "Patient"}`);
  if (template.showPatientId && patient?.patientId) lines.push(`Patient ID: ${patient.patientId}`);
  if (template.showPatientAgeGender) lines.push(`Age / Gender: ${age ?? "-"} / ${patient?.gender || "-"}`);
  lines.push(`Department: ${tokenItem?.department || consultation?.department || "OPD"}`);
  if (template.showToken) lines.push(`Token: #${tokenItem?.tokenNumber || consultation?.token?.tokenNumber || "-"}`);
  lines.push(`Date & Time: ${new Date(consultation?.createdAt || Date.now()).toLocaleString("en-IN")}`);
  lines.push("", `Doctor: Dr. ${doctorName}`);
  if (profile.qualification) lines.push(`Qualification: ${profile.qualification}`);
  if (profile.specialization || consultation?.doctor?.department) lines.push(`Specialization: ${profile.specialization || consultation?.doctor?.department}`);
  if (profile.designation) lines.push(`Designation: ${profile.designation}`);
  if (template.showDoctorRegistration && profile.registrationNumber) lines.push(`Registration No.: ${profile.registrationNumber}`);
  if (template.showDiagnosis) lines.push("", `Diagnosis: ${consultation?.diagnosis || "Not recorded"}`);
  if (template.showSymptoms && consultation?.symptoms) lines.push(`Symptoms: ${consultation.symptoms}`);
  lines.push("", "Rx");
  if (Array.isArray(consultation?.medicines) && consultation.medicines.length) {
    consultation.medicines.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.name}${m.dosage ? ` - ${m.dosage}` : ""}${m.frequency ? ` - ${m.frequency}` : ""}${m.duration ? ` - ${m.duration}` : ""}`);
      if (m.instructions) lines.push(`   ${m.instructions}`);
    });
  } else if (consultation?.prescription) {
    String(consultation.prescription).split("\n").forEach((line) => lines.push(line));
  } else {
    lines.push("No medicines prescribed.");
  }
  if (template.showTests && consultation?.testsRecommended?.length) {
    lines.push("", "Tests / Investigations:");
    consultation.testsRecommended.forEach((test) => lines.push(`- ${test}`));
  }
  if (template.showAdvice && consultation?.advice) lines.push("", `Advice: ${consultation.advice}`);
  if (template.showFollowUp && consultation?.followUpDate) lines.push("", `Follow-up: ${new Date(consultation.followUpDate).toLocaleDateString("en-IN")}`);
  if (template.showSignatureLine) lines.push("", "Doctor's Signature: ______________________________");
  if (template.footerNote) lines.push("", template.footerNote);
  lines.push("Generated securely by OPDfy.");
  return lines;
}

function escapePdfText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPrescriptionText(lines, maxChars = 88) {
  const wrapped = [];
  lines.forEach((line) => {
    const text = String(line || "");
    if (!text) { wrapped.push(""); return; }
    let remaining = text;
    while (remaining.length > maxChars) {
      let cut = remaining.lastIndexOf(" ", maxChars);
      if (cut < 20) cut = maxChars;
      wrapped.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    wrapped.push(remaining);
  });
  return wrapped;
}

function downloadPrescriptionPdf(consultation, tokenItem, patient, clinicContext = {}) {
  const lines = wrapPrescriptionText(prescriptionLines(consultation, tokenItem, patient, clinicContext));
  const pageSize = 48;
  const pages = [];
  for (let i = 0; i < lines.length; i += pageSize) pages.push(lines.slice(i, i + pageSize));
  const objects = [];
  const addObject = (body) => { objects.push(body); return objects.length; };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  pages.forEach((pageLines) => {
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "13 TL"];
    pageLines.forEach((line, index) => { if (index > 0) commands.push("T*"); commands.push(`(${escapePdfText(line)}) Tj`); });
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Prescription-Token-${tokenItem?.tokenNumber || "OPD"}.pdf`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printPrescription(consultation, tokenItem, patient, clinicContext = {}) {
  const popup = window.open("", "_blank", "width=900,height=1000");
  if (!popup) { alert(localizeUi("Please allow pop-ups to print the prescription.")); return; }
  const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const medicines = Array.isArray(consultation?.medicines) ? consultation.medicines : [];
  const profile = consultation?.doctor?.prescriptionProfile || {};
  const template = getPrescriptionTemplate(clinicContext);
  const clinic = getClinicPrescriptionBrand(clinicContext);
  const age = calculatePatientAge(patient?.dateOfBirth);
  const primary = /^#[0-9a-f]{6}$/i.test(clinic.primaryColor) ? clinic.primaryColor : "#0f766e";
  const watermark = template.watermarkEnabled ? (template.watermarkText || clinic.shortName || clinic.name) : "";
  const clinicContact = [clinic.address, clinic.contactPhone, clinic.contactEmail, clinic.website].filter(Boolean);
  const doctorSubtitle = [profile.qualification, profile.specialization || consultation?.doctor?.department, profile.designation].filter(Boolean).join(" · ");
  popup.document.write(`<!doctype html><html><head><title>${safe(template.title)} - ${safe(clinic.name)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17212b;margin:0;background:#eef3f4}.sheet{position:relative;width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:15mm 16mm 17mm;overflow:hidden;box-shadow:0 8px 30px #0002}.watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0}.watermark span{font-size:58px;font-weight:800;color:${primary};opacity:.055;transform:rotate(-28deg);white-space:nowrap}.content{position:relative;z-index:1}.clinic-head{display:grid;grid-template-columns:auto 1fr auto;gap:13px;align-items:center;padding-bottom:12px;border-bottom:3px solid ${primary}}.logo{width:68px;height:68px;display:grid;place-items:center;border-radius:14px;border:1px solid #dbe6e8;overflow:hidden}.logo img{width:100%;height:100%;object-fit:contain}.logo-fallback{font-size:28px;color:${primary};font-weight:900}.clinic-name{margin:0;color:${primary};font-size:25px;line-height:1.1}.clinic-contact{margin-top:5px;font-size:10px;color:#5b6974;line-height:1.45}.rx-title{text-align:right}.rx-title b{display:block;font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:${primary}}.rx-title span{font-size:9px;color:#667681}.header-note{margin:10px 0 0;text-align:center;color:#64727d;font-size:10px}.info-box{display:grid;grid-template-columns:1fr 1fr;gap:7px 24px;margin:14px 0;padding:10px 12px;border:1px solid #d8e3e5;border-radius:8px;font-size:11px}.info-box b{color:#263b48}.doctor-box{display:flex;justify-content:space-between;gap:18px;margin-bottom:13px;padding:9px 12px;background:#f7faf9;border-left:4px solid ${primary};font-size:11px}.doctor-box strong{font-size:13px;color:#183845}.doctor-meta{color:#65747e;margin-top:3px}.section{margin-top:14px}.section h2{margin:0 0 7px;padding-bottom:5px;border-bottom:1px solid #dce4e7;color:${primary};font-size:11px;text-transform:uppercase;letter-spacing:.08em}.section p{margin:0;font-size:11px;line-height:1.55;white-space:pre-line}.rx-mark{font-family:Georgia,serif;font-size:26px;font-weight:700;color:${primary};margin-bottom:3px}.med-table{width:100%;border-collapse:collapse;font-size:10px}.med-table th,.med-table td{border:1px solid #d9e2e5;padding:7px;text-align:left;vertical-align:top}.med-table th{background:#f4f8f7;color:#314b59}.signature{display:flex;justify-content:flex-end;margin-top:42px}.signature-inner{width:230px;text-align:center;font-size:10px}.signature-image{display:block;max-width:180px;max-height:64px;object-fit:contain;margin:0 auto 5px}.signature-line{border-top:1px solid #374151;padding-top:5px}.footer{position:absolute;left:16mm;right:16mm;bottom:10mm;border-top:1px solid #dce4e7;padding-top:6px;text-align:center;color:#75838c;font-size:8.5px}.no-print{display:flex;justify-content:center;gap:8px;margin:10px auto 20px}.no-print button{border:0;border-radius:8px;padding:9px 14px;cursor:pointer}.no-print .print{background:${primary};color:#fff}@page{size:A4;margin:0}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;width:210mm;min-height:297mm}.no-print{display:none}}
  </style></head><body><div class="sheet">${watermark ? `<div class="watermark"><span>${safe(watermark)}</span></div>` : ""}<div class="content">
    <header class="clinic-head">${template.showLogo ? `<div class="logo">${clinic.logoUrl ? `<img src="${safe(clinic.logoUrl)}" alt="Clinic logo">` : `<span class="logo-fallback">+</span>`}</div>` : `<div></div>`}<div><h1 class="clinic-name">${safe(clinic.name)}</h1>${template.showClinicContact && clinicContact.length ? `<div class="clinic-contact">${clinicContact.map(safe).join(" · ")}</div>` : ""}</div><div class="rx-title"><b>${safe(template.title)}</b><span>${safe(new Date(consultation?.createdAt || Date.now()).toLocaleString("en-IN"))}</span></div></header>
    ${template.headerNote ? `<p class="header-note">${safe(template.headerNote)}</p>` : ""}
    <div class="info-box"><div><b>Patient:</b> ${safe(patient?.name || "Patient")}</div><div><b>Department:</b> ${safe(tokenItem?.department || consultation?.department || "OPD")}</div>${template.showPatientId ? `<div><b>Patient ID:</b> ${safe(patient?.patientId || "-")}</div>` : ""}${template.showToken ? `<div><b>Token:</b> #${safe(tokenItem?.tokenNumber || consultation?.token?.tokenNumber || "-")}</div>` : ""}${template.showPatientAgeGender ? `<div><b>Age / Gender:</b> ${safe(age ?? "-")} / ${safe(patient?.gender || "-")}</div>` : ""}<div><b>Date & Time:</b> ${safe(new Date(consultation?.createdAt || Date.now()).toLocaleString("en-IN"))}</div></div>
    <div class="doctor-box"><div><strong>Dr. ${safe(consultation?.doctor?.name || "Medical Officer")}</strong>${doctorSubtitle ? `<div class="doctor-meta">${safe(doctorSubtitle)}</div>` : ""}</div>${template.showDoctorRegistration && profile.registrationNumber ? `<div><b>Reg. No.</b><br>${safe(profile.registrationNumber)}</div>` : ""}</div>
    ${template.showDiagnosis ? `<section class="section"><h2>Diagnosis</h2><p>${safe(consultation?.diagnosis || "Not recorded")}</p></section>` : ""}
    ${template.showSymptoms && consultation?.symptoms ? `<section class="section"><h2>Symptoms / Complaints</h2><p>${safe(consultation.symptoms)}</p></section>` : ""}
    <section class="section"><div class="rx-mark">Rx</div>${medicines.length ? `<table class="med-table"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medicines.map((m)=>`<tr><td>${safe(m.name)}</td><td>${safe(m.dosage)}</td><td>${safe(m.frequency)}</td><td>${safe(m.duration)}</td><td>${safe(m.instructions)}</td></tr>`).join("")}</tbody></table>` : `<p>${safe(consultation?.prescription || "No medicines prescribed.")}</p>`}</section>
    ${template.showTests && consultation?.testsRecommended?.length ? `<section class="section"><h2>Tests / Investigations</h2><p>${consultation.testsRecommended.map((t,i)=>`${i+1}. ${safe(t)}`).join("<br>")}</p></section>` : ""}
    ${template.showAdvice && consultation?.advice ? `<section class="section"><h2>Advice</h2><p>${safe(consultation.advice)}</p></section>` : ""}
    ${template.showFollowUp && consultation?.followUpDate ? `<section class="section"><h2>Follow-up</h2><p>${safe(new Date(consultation.followUpDate).toLocaleDateString("en-IN"))}</p></section>` : ""}
    ${template.showSignatureLine ? `<div class="signature"><div class="signature-inner">${profile.signatureDataUrl ? `<img class="signature-image" src="${safe(profile.signatureDataUrl)}" alt="Doctor signature">` : ""}<div class="signature-line">Dr. ${safe(consultation?.doctor?.name || "Medical Officer")}<br>Doctor's Signature</div></div></div>` : ""}
  </div><footer class="footer">${safe(template.footerNote || "")} ${template.footerNote ? " · " : ""}Generated securely by OPDfy.</footer></div><div class="no-print"><button class="print" onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div></body></html>`);
  popup.document.close();
}

function labReferralLines(consultation, tokenItem, patient) {
  const referral = consultation?.labReferral || {};
  const tests = Array.isArray(consultation?.testsRecommended) ? consultation.testsRecommended : [];
  const doctorName = consultation?.doctor?.name || "Medical Officer";

  const lines = [
    "OPDfy - LAB REFERRAL",
    "",
    `Patient: ${patient?.name || "Patient"}`,
    `Doctor: Dr. ${doctorName}`,
    `Department: ${tokenItem?.department || consultation?.department || "OPD"}`,
    `Token: #${tokenItem?.tokenNumber || consultation?.token?.tokenNumber || "-"}`,
    `Referral Date: ${new Date(referral.referralDate || consultation?.createdAt || Date.now()).toLocaleDateString()}`,
    `Priority: ${String(referral.priority || "routine").toUpperCase()}`,
    `Status: ${String(referral.status || "pending").toUpperCase()}`,
    "",
    "Tests / Investigations:",
  ];

  tests.forEach((test, index) => lines.push(`${index + 1}. ${test}`));
  if (!tests.length) lines.push("No tests listed.");
  if (consultation?.diagnosis) lines.push("", `Clinical Diagnosis: ${consultation.diagnosis}`);
  lines.push("", "Digitally generated from OPDfy.");
  return lines;
}

function downloadLabReferralPdf(consultation, tokenItem, patient) {
  const lines = wrapPrescriptionText(labReferralLines(consultation, tokenItem, patient));
  const pages = [];
  for (let i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48));

  const objects = [];
  const addObject = (body) => { objects.push(body); return objects.length; };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  pages.forEach((pageLines) => {
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "13 TL"];
    pageLines.forEach((line, index) => {
      if (index > 0) commands.push("T*");
      commands.push(`(${escapePdfText(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Lab-Referral-Token-${tokenItem?.tokenNumber || "OPD"}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printLabReferral(consultation, tokenItem, patient) {
  const popup = window.open("", "_blank", "width=850,height=900");
  if (!popup) {
    alert(localizeUi("Please allow pop-ups to print the lab referral."));
    return;
  }

  const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));

  const referral = consultation?.labReferral || {};
  const tests = Array.isArray(consultation?.testsRecommended) ? consultation.testsRecommended : [];

  popup.document.write(`<!doctype html><html><head><title>Lab Referral</title><style>
    body{font-family:Arial,sans-serif;color:#111827;margin:38px;line-height:1.45}
    header{border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px}
    h1{margin:0;font-size:24px}.muted{color:#6b7280}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}
    section{margin-top:22px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #ddd;padding-bottom:6px}
    li{margin:7px 0}footer{margin-top:36px;padding-top:12px;border-top:1px solid #ddd;font-size:12px;color:#6b7280}
    @media print{body{margin:20mm}}
  </style></head><body>
    <header><h1>OPDfy</h1><div class="muted">Laboratory Referral</div></header>
    <div class="grid">
      <div><b>Patient:</b> ${safe(patient?.name || "Patient")}</div>
      <div><b>Doctor:</b> Dr. ${safe(consultation?.doctor?.name || "Medical Officer")}</div>
      <div><b>Department:</b> ${safe(tokenItem?.department || consultation?.department || "OPD")}</div>
      <div><b>Token:</b> #${safe(tokenItem?.tokenNumber || consultation?.token?.tokenNumber || "-")}</div>
      <div><b>Referral Date:</b> ${safe(new Date(referral.referralDate || consultation?.createdAt || Date.now()).toLocaleDateString())}</div>
      <div><b>Priority:</b> ${safe(String(referral.priority || "routine").toUpperCase())}</div>
    </div>
    <section><h2>Tests / Investigations</h2>
      ${tests.length ? `<ol>${tests.map((test) => `<li>${safe(test)}</li>`).join("")}</ol>` : "<p>No tests listed.</p>"}
    </section>
    ${consultation?.diagnosis ? `<section><h2>Clinical Diagnosis</h2><p>${safe(consultation.diagnosis)}</p></section>` : ""}
    <footer>Digitally generated from OPDfy.</footer>
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  popup.document.close();
}

function playQueueNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const soundOscillator = audioCtx.createOscillator();
    const volumeGain = audioCtx.createGain();

    soundOscillator.type = "sine";
    soundOscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // Note D5
    soundOscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // Note A5

    volumeGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    volumeGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);

    soundOscillator.connect(volumeGain);
    volumeGain.connect(audioCtx.destination);

    soundOscillator.start();
    soundOscillator.stop(audioCtx.currentTime + 0.45);
  } catch {
    // Audio alerts are optional depending on browser policy
  }
}

/* =========================================================
   APPLICATION NAVIGATION & LAYOUT SHELL
========================================================= */

function AppLayout({ children }) {
  const { t } = useLanguage();
  const currentStaff = getLoggedInStaff();
  const currentPatient = getStoredPatient();
  const currentPlatformUser = getStoredPlatformUser();
  const navigate = useNavigate();
  const location = useLocation();
  const topbarRef = useRef(null);
  const publicMenuToggleRef = useRef(null);
  const publicMenuCloseRef = useRef(null);
  const publicMenuPanelRef = useRef(null);
  useEffect(() => {
    const expired = (event) => navigate(event.detail?.kind === "patient" ? "/patient-login?session=expired" : event.detail?.kind === "platform" ? "/platform/login?session=expired" : "/login?session=expired", { replace: true });
    window.addEventListener("opd:session-expired", expired);
    return () => window.removeEventListener("opd:session-expired", expired);
  }, [navigate]);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(socket.connected);
  const [isPortalNavOpen, setIsPortalNavOpen] = useState(false);
  const [isPublicMenuOpen, setIsPublicMenuOpen] = useState(false);
  const [patientLoungeAllowed, setPatientLoungeAllowed] = useState(false);
  const [clinicBranding, setClinicBranding] = useState(null);
  const [platformBranding, setPlatformBranding] = useState({ productName: "OPDfy", logoUrl: "" });
  const [platformLogoShape, setPlatformLogoShape] = useState("wide");
  const [selectedClinicSlug, setSelectedClinicSlugState] = useState(getSelectedClinicSlug());

  useEffect(() => {
    let active = true;
    const loadPlatformBranding = () => platformApi.get("/platform/branding/public")
      .then(({ data }) => {
        if (active) setPlatformBranding(data?.branding || { productName: "OPDfy", logoUrl: "" });
      })
      .catch(() => {
        if (active) setPlatformBranding({ productName: "OPDfy", logoUrl: "" });
      });
    const handleBrandingUpdate = (event) => {
      if (event?.detail?.branding) setPlatformBranding(event.detail.branding);
      else loadPlatformBranding();
    };
    loadPlatformBranding();
    window.addEventListener("opdfy:branding-updated", handleBrandingUpdate);
    return () => {
      active = false;
      window.removeEventListener("opdfy:branding-updated", handleBrandingUpdate);
    };
  }, []);

  useEffect(() => {
    const logoUrl = String(platformBranding.logoUrl || "");
    if (!logoUrl) {
      setPlatformLogoShape("wide");
      return undefined;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
      setPlatformLogoShape(ratio <= 1.3 ? "square" : "wide");
    };
    image.onerror = () => { if (active) setPlatformLogoShape("wide"); };
    image.src = logoUrl;
    return () => { active = false; };
  }, [platformBranding.logoUrl]);

  useEffect(() => {
    const syncClinicContext = (event) => setSelectedClinicSlugState(event?.detail?.slug ?? getSelectedClinicSlug());
    window.addEventListener("opd:clinic-context", syncClinicContext);
    return () => window.removeEventListener("opd:clinic-context", syncClinicContext);
  }, []);

  useEffect(() => {
    if (["/faqs", "/privacy", "/terms", "/support"].includes(location.pathname) || location.pathname.startsWith("/display/") || location.pathname.startsWith("/platform")) {
      setClinicBranding(null);
      return;
    }
    const patientGlobalSpace = Boolean(getPatientToken()) && ["/patient/clinics", "/patient/profile"].includes(location.pathname);
    const patientWithoutClinic = Boolean(getPatientToken()) && !selectedClinicSlug;
    if ((!currentStaff && !getPatientToken()) || patientGlobalSpace || patientWithoutClinic) {
      setClinicBranding(null);
      return;
    }
    let active = true;
    api.get("/tenant/current")
      .then(({ data }) => { if (active) setClinicBranding(data?.tenant || null); })
      .catch(() => { if (active) setClinicBranding(null); });
    return () => { active = false; };
  }, [location.pathname, currentStaff?.id, selectedClinicSlug]);

  useEffect(() => {
    if (!getPatientToken() || !selectedClinicSlug || ["/patient/clinics", "/patient/profile", "/faqs", "/privacy", "/terms", "/support"].includes(location.pathname)) {
      setPatientLoungeAllowed(false);
      return undefined;
    }

    let active = true;
    const refreshLoungeAccess = async () => {
      try {
        const { data } = await api.get("/patients/me/lounge-access");
        if (active) setPatientLoungeAllowed(Boolean(data?.allowed));
      } catch {
        if (active) setPatientLoungeAllowed(false);
      }
    };

    refreshLoungeAccess();
    const handleOperationalUpdate = () => refreshLoungeAccess();
    socket.on("operations:updated", handleOperationalUpdate);
    socket.on("connect", refreshLoungeAccess);

    return () => {
      active = false;
      socket.off("operations:updated", handleOperationalUpdate);
      socket.off("connect", refreshLoungeAccess);
    };
  }, [location.pathname, selectedClinicSlug]);

  useEffect(() => {
    const handleConnect = () => setIsRealtimeConnected(true);
    const handleDisconnect = () => setIsRealtimeConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    setIsRealtimeConnected(socket.connected);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  useEffect(() => {
    setIsPortalNavOpen(false);
    setIsPublicMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!isPortalNavOpen) return;
    const close = (event) => { if (event.key === "Escape") setIsPortalNavOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [isPortalNavOpen]);

  useEffect(() => {
    document.body.classList.toggle("portal-nav-open", isPortalNavOpen);
    return () => document.body.classList.remove("portal-nav-open");
  }, [isPortalNavOpen]);

  useEffect(() => {
    document.body.classList.toggle("public-nav-open", isPublicMenuOpen);
    if (!isPublicMenuOpen) return () => document.body.classList.remove("public-nav-open");

    const focusTimer = window.setTimeout(() => publicMenuCloseRef.current?.focus(), 0);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsPublicMenuOpen(false);
        window.setTimeout(() => publicMenuToggleRef.current?.focus(), 0);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(publicMenuPanelRef.current?.querySelectorAll("a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const closeAtDesktopWidth = () => {
      if (window.innerWidth > 1120) setIsPublicMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeAtDesktopWidth);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeAtDesktopWidth);
      document.body.classList.remove("public-nav-open");
    };
  }, [isPublicMenuOpen]);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return undefined;
    const shell = topbar.closest(".app-shell");
    if (!shell) return undefined;

    const syncTopbarHeight = () => {
      const height = Math.ceil(topbar.getBoundingClientRect().height);
      if (height > 0) shell.style.setProperty("--active-topbar-height", `${height}px`);
    };

    syncTopbarHeight();
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(syncTopbarHeight)
      : null;
    observer?.observe(topbar);
    window.addEventListener("resize", syncTopbarHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncTopbarHeight);
      shell.style.removeProperty("--active-topbar-height");
    };
  }, [location.pathname]);

  if (location.pathname.startsWith("/display/")) {
    return <>{children}</>;
  }

  const handleStaffLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const handlePatientLogout = () => {
    logoutPatient();
    navigate("/patient-login", { replace: true });
  };

  const handlePlatformLogout = () => {
    logoutPlatform();
    navigate("/platform/login", { replace: true });
  };

  const isCurrentPage = (path) => location.pathname === path;
  const isPathWithin = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const patientPortalPaths = ["/patient", "/qr-checkin"];
  const staffPortalPaths = ["/doctor", "/admin", "/reception"];
  const isPatientPortal = Boolean(
    getPatientToken() && patientPortalPaths.some((path) => isPathWithin(path))
  );
  const isStaffPortal = Boolean(
    currentStaff && staffPortalPaths.some((path) => isPathWithin(path))
  );
  const isPlatformPortal = Boolean(
    currentPlatformUser && isPathWithin("/platform") && location.pathname !== "/platform/login"
  );

  let portalConfig = null;

  if (isPatientPortal) {
    portalConfig = {
      type: "patient",
      eyebrow: "Patient Care Portal",
      title: currentPatient?.name || "My Health Dashboard",
      role: "Patient",
      logout: handlePatientLogout,
      nav: selectedClinicSlug
        ? [
            { to: "/patient", label: "My Dashboard", icon: <Activity size={17} /> },
            { to: "/patient/clinics", label: "Switch Clinic", icon: <HeartPulse size={17} /> },
            { to: "/patient/profile", label: "Health Profile", icon: <User size={17} /> },
            { to: "/patient/ehr", label: "Clinical EHR Summary", icon: <FileText size={17} /> },
            { to: "/patient/consents", label: "Treatment Consent", icon: <FileCheck2 size={17} /> },
            { to: "/patient/privacy", label: "Privacy & Account Safety", icon: <ShieldCheck size={17} /> },
            { to: "/qr-checkin", label: "QR Check-in", icon: <QrCode size={17} /> },
            ...(patientLoungeAllowed ? [{ to: "/patient/lounge", label: "Waiting Lounge", icon: <Monitor size={17} /> }] : []),
          ]
        : [
            { to: "/patient/clinics", label: "Find a Clinic", icon: <HeartPulse size={17} /> },
            { to: "/patient/profile", label: "Health Profile", icon: <User size={17} /> },
            { to: "/patient/ehr", label: "Clinical EHR Summary", icon: <FileText size={17} /> },
            { to: "/patient/privacy", label: "Privacy & Account Safety", icon: <ShieldCheck size={17} /> },
          ],
    };
  } else if (isPlatformPortal) {
    portalConfig = {
      type: "platform",
      eyebrow: "SaaS Control Plane",
      title: currentPlatformUser?.name || "Platform Administration",
      role: "Super Admin",
      logout: handlePlatformLogout,
      nav: [
        { to: "/platform", label: "Platform Overview", icon: <ShieldAlert size={17} /> },
        { to: "/platform/privacy", label: "Privacy Requests", icon: <FileText size={17} /> },
        { to: "/platform/privacy/governance", label: "Privacy Governance", icon: <ShieldCheck size={17} /> },
        { to: "/platform/privacy/operations", label: "Operational Readiness", icon: <Activity size={17} /> },
        { to: "/platform/branding", label: "Brand & Logo", icon: <ImageIcon size={17} /> },
      ],
    };
  } else if (isStaffPortal) {
    const isAdmin = currentStaff?.role === "admin";
    const isReception = currentStaff?.role === "receptionist";

    portalConfig = {
      type: isAdmin ? "admin" : isReception ? "reception" : "doctor",
      eyebrow: isAdmin
        ? "Hospital Operations"
        : isReception
          ? "Front Desk Workspace"
          : "Clinical Workspace",
      title: isAdmin
        ? "Admin Control Center"
        : isReception
          ? currentStaff?.name || "Reception Desk"
          : `Dr. ${currentStaff?.name || "Practitioner"}`,
      role: isAdmin
        ? "Hospital Administrator"
        : isReception
          ? "Receptionist"
          : currentStaff?.department || "Doctor",
      logout: handleStaffLogout,
      nav: isAdmin
        ? [
            { to: "/admin", label: "Admin Dashboard", icon: <BarChart3 size={17} /> },
            { to: "/admin/displays", label: "TV Displays", icon: <Monitor size={17} /> },
            { to: "/admin/settings", label: "Clinic Settings", icon: <Palette size={17} /> },
            { to: "/admin/consents", label: "Treatment Consent", icon: <FileCheck2 size={17} /> },
          ]
        : isReception
          ? [
              { to: "/reception", label: "Reception Desk", icon: <UserCheck size={17} /> },
              { to: "/reception/scan", label: "QR Scanner", icon: <QrCode size={17} /> },
              { to: "/reception/consents", label: "Treatment Consent", icon: <FileCheck2 size={17} /> },
            ]
          : [
              { to: "/doctor", label: "Doctor Workstation", icon: <Stethoscope size={17} /> },
              { to: "/doctor/consents", label: "Treatment Consent", icon: <FileCheck2 size={17} /> },
            ],
    };
  }

  if (portalConfig) {
    const clinicLogoUrl = clinicBranding?.settings?.branding?.logoUrl || "";
    const activeLogoUrl = clinicLogoUrl || platformBranding.logoUrl || "";
    return (
      <div
        className={`app-shell portal-mode portal-${portalConfig.type}`}
        style={{
          "--clinic-primary": clinicBranding?.settings?.branding?.primaryColor || "#0f766e",
          "--clinic-accent": clinicBranding?.settings?.branding?.accentColor || "#14b8a6",
        }}
      >
        <DashboardTranslator />
        <a href="#main-content" className="skip-link"><Trans text={"Skip to content"} /></a>
        <header ref={topbarRef} className="premium-header portal-topbar">
          <div className="header-inner portal-header-inner">
            <button
              type="button"
              className="portal-menu-toggle"
              onClick={() => setIsPortalNavOpen((open) => !open)}
              aria-label={t("Toggle portal navigation")}
              aria-expanded={isPortalNavOpen}
              aria-controls="portal-navigation"
            >
              {isPortalNavOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <Link to={portalConfig.type === "patient" ? (selectedClinicSlug ? "/patient" : "/patient/clinics") : portalConfig.type === "admin" ? "/admin" : portalConfig.type === "reception" ? "/reception" : portalConfig.type === "doctor" ? "/doctor" : "/platform"} className={`premium-brand portal-brand ${!clinicLogoUrl && platformBranding.logoUrl ? `uses-platform-logo platform-logo-${platformLogoShape}` : ""}`} aria-label={t("Portal home")}>
              <span className={`brand-mark ${activeLogoUrl ? "has-clinic-logo" : ""}`}>
                {activeLogoUrl
                  ? <img src={activeLogoUrl} alt="" />
                  : <HeartPulse size={20} strokeWidth={2.5} />}
              </span>
              <span>
                <strong>{clinicBranding?.settings?.branding?.shortName || clinicBranding?.settings?.displayName || platformBranding.productName || "OPDfy"}</strong>
                <small>{clinicBranding ? t("Powered by OPDfy") : t("Healthcare SaaS")}</small>
              </span>
            </Link>

            <div className="portal-topbar-context">
              <span>{t(portalConfig.eyebrow)}</span>
              <b>{portalConfig.title}</b>
            </div>

            <div className="header-actions portal-header-actions">
              <ThemeToggle />
              <span className={`system-status ${isRealtimeConnected ? "" : "offline"}`} aria-live="polite">
                <i /> {isRealtimeConnected ? t("Live Sync") : t("Reconnecting")}
              </span>
              <span className="role-chip portal-role-chip">
                <UserRound size={13} /> {t(portalConfig.role)}
              </span>
            </div>
          </div>
        </header>
        <div className="premium-header-spacer" aria-hidden="true" />

        <div className="portal-workspace">
          <aside id="portal-navigation" className={`portal-sidebar ${isPortalNavOpen ? "open" : ""}`}>
            <div className="portal-sidebar-profile">
              <span className="portal-avatar">
                {portalConfig.type === "doctor" ? <Stethoscope size={20} /> :
                  portalConfig.type === "patient" ? <User size={20} /> :
                    portalConfig.type === "platform" ? <ShieldAlert size={20} /> :
                      <ShieldCheck size={20} />}
              </span>
              <div>
                <b>{portalConfig.title}</b>
                <span>{t(portalConfig.role)}</span>
              </div>
            </div>

            <nav className="portal-sidebar-nav" aria-label={t(`${portalConfig.role} navigation`)}>
              <span className="portal-nav-label"><Trans text={"Workspace"} /></span>
              {portalConfig.nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={isCurrentPage(item.to) ? "active" : ""}
                  aria-current={isCurrentPage(item.to) ? "page" : undefined}
                >
                  {item.icon}
                  <span>{t(item.label)}</span>
                  <ChevronRight size={15} className="portal-nav-arrow" />
                </Link>
              ))}
            </nav>

            <section className="portal-sidebar-preferences platform-sidebar-preferences" aria-label={t("Interface preferences")}>
              <span className="portal-nav-label">{t("Interface preferences")}</span>
              <div className="portal-sidebar-language platform-sidebar-language">
                <div className="platform-preference-title">
                  <Languages size={16} />
                  <span>{t("Interface language")}</span>
                </div>
                <LanguageSwitcher />
              </div>
            </section>

            <div className="portal-sidebar-foot">
              <div className="portal-security-note">
                <ShieldCheck size={16} />
                <div>
                  <b>{t(portalConfig.type === "platform" ? "Protected control plane" : "Secure workspace")}</b>
                  <span>{t(portalConfig.type === "platform" ? "Administrative access only" : "Your clinic workspace")}</span>
                </div>
              </div>
              <button type="button" className="portal-logout" onClick={portalConfig.logout}>
                <LogOut size={16} /> <Trans text={"Sign out"} /></button>
            </div>
          </aside>

          {isPortalNavOpen && (
            <button
              type="button"
              className="portal-sidebar-backdrop"
              onClick={() => setIsPortalNavOpen(false)}
              aria-label={t("Close navigation")}
            />
          )}

          <div id="main-content" tabIndex={-1} className="app-content portal-content">{children}<PublicFooter /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell public-mode">
      <DashboardTranslator />
      <header ref={topbarRef} className="premium-header">
        <div className="header-inner">
          <Link to="/" className={`premium-brand ${platformBranding.logoUrl ? `uses-platform-logo platform-logo-${platformLogoShape}` : ""}`} aria-label={t("OPDfy home")}>
            <span className={`brand-mark ${platformBranding.logoUrl ? "has-clinic-logo" : ""}`}>
              {platformBranding.logoUrl ? <img src={platformBranding.logoUrl} alt="" /> : <HeartPulse size={20} strokeWidth={2.5} />}
            </span>
            <span>
              <strong>{platformBranding.productName || "OPDfy"}</strong>
              <small><Trans text={"Precision Queue & EHR"} /></small>
            </span>
          </Link>

          <nav className="premium-nav public-patient-nav" aria-label={t("Primary navigation")}>
            <Link className="patient-portal-link" to={getPatientToken() ? "/patient/clinics" : "/patient-login"} aria-current={isCurrentPage("/patient-login") || isCurrentPage("/patient/clinics") ? "page" : undefined}>
              <User size={15} /> <Trans text={"Patient Portal"} /></Link>
          </nav>

          <div className="header-actions public-desktop-actions">
            <LanguageSwitcher />
            <ThemeToggle />
            <Link to="/clinic/register" className="clinic-register-link">
              <Plus size={15} /> <Trans text={"Register Clinic"} /></Link>
            <Link to="/platform/login" className="platform-admin-link">
              <ShieldAlert size={15} /> <Trans text={"Platform Admin"} /></Link>
            <Link to="/login" className="staff-login-link">
              <LogIn size={15} /> <Trans text={"Staff Sign In"} /></Link>
          </div>

          <button
            ref={publicMenuToggleRef}
            type="button"
            className="public-menu-toggle"
            onClick={() => setIsPublicMenuOpen(true)}
            aria-label={t("Open navigation menu")}
            aria-expanded={isPublicMenuOpen}
            aria-controls="public-mobile-navigation"
          >
            <Menu size={21} />
          </button>
        </div>
      </header>
      <div className="premium-header-spacer" aria-hidden="true" />

      {isPublicMenuOpen && (
        <>
          <button
            type="button"
            className="public-menu-backdrop"
            onClick={() => setIsPublicMenuOpen(false)}
            aria-label={t("Close navigation menu")}
          />
          <aside ref={publicMenuPanelRef} id="public-mobile-navigation" className="public-menu-panel" role="dialog" aria-modal="true" aria-labelledby="public-menu-title">
            <div className="public-menu-head">
              <div>
                <span><Trans text="OPDfy access" /></span>
                <strong id="public-menu-title"><Trans text="Menu & preferences" /></strong>
              </div>
              <button ref={publicMenuCloseRef} type="button" className="public-menu-close" onClick={() => setIsPublicMenuOpen(false)} aria-label={t("Close navigation menu")}>
                <X size={21} />
              </button>
            </div>

            <section className="public-menu-preferences" aria-label={t("Interface preferences")}>
              <span className="public-menu-section-label"><Trans text="Interface preferences" /></span>
              <LanguageSwitcher />
              <ThemeToggle />
            </section>

            <nav className="public-menu-links" aria-label={t("Account and clinic access")}>
              <span className="public-menu-section-label"><Trans text="Account and clinic access" /></span>
              <Link to="/clinic/register" className="public-menu-link register" onClick={() => setIsPublicMenuOpen(false)}>
                <Plus size={18} /><span><strong><Trans text="Register Clinic" /></strong><small><Trans text="Create a new clinic workspace" /></small></span><ChevronRight size={17} />
              </Link>
              <Link to="/platform/login" className="public-menu-link" onClick={() => setIsPublicMenuOpen(false)}>
                <ShieldAlert size={18} /><span><strong><Trans text="Platform Admin" /></strong><small><Trans text="Open platform administration" /></small></span><ChevronRight size={17} />
              </Link>
              <Link to="/login" className="public-menu-link staff" onClick={() => setIsPublicMenuOpen(false)}>
                <LogIn size={18} /><span><strong><Trans text="Staff Sign In" /></strong><small><Trans text="Access your clinic workstation" /></small></span><ChevronRight size={17} />
              </Link>
            </nav>

            <div className="public-menu-foot">
              <ShieldCheck size={17} />
              <span><strong><Trans text="Secure access" /></strong><small><Trans text="Protected clinic and patient workspaces" /></small></span>
            </div>
          </aside>
        </>
      )}

      <div id="main-content" tabIndex={-1} className="app-content">{children}</div>
      <PublicFooter />
    </div>
  );
}

/* =========================================================
   STAFF PROTECTED ROUTE
========================================================= */

function StaffProtectedRoute({ children, allowedRoles }) {
  const { t } = useLanguage();
  const currentStaff = getLoggedInStaff();

  if (!currentStaff) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(currentStaff.role)) {
    const roleHome =
      currentStaff.role === "admin"
        ? "/admin"
        : currentStaff.role === "receptionist"
          ? "/reception"
          : "/doctor";

    return <Navigate to={roleHome} replace />;
  }

  return children;
}

/* =========================================================
   LIVE QUEUE SOCKET HOOK
========================================================= */

function useLiveQueue(accessMode = "public") {
  const [queueTokens, setQueueTokens] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const fetchQueue = async () => {
      try {
        if (accessMode === "staff") {
          const response = await api.get("/tokens/private");
          if (isMounted) setQueueTokens(response.data || []);
          return;
        }

        if (accessMode === "patient") {
          const response = await api.get("/patients/me/tokens");
          const activeTokens = (response.data?.tokens || []).filter(
            (item) => item.isArchived !== true
          );
          if (isMounted) setQueueTokens(activeTokens);
          return;
        }

        const response = await api.get("/tokens");
        if (isMounted) setQueueTokens(response.data || []);
      } catch {
        if (isMounted) setQueueTokens([]);
      }
    };

    fetchQueue();

    const handleQueueUpdate = (publicQueueData) => {
      if (accessMode === "public") {
        setQueueTokens(publicQueueData || []);
      } else {
        // Public socket events contain no PII. Authenticated dashboards
        // refresh their own protected queue view whenever the queue changes.
        fetchQueue();
      }
    };

    const handlePatientTokenUpdate = (updatedToken) => {
      if (accessMode !== "patient" || !updatedToken) return;

      const updatedId = String(updatedToken._id || updatedToken.id || "");
      if (!updatedId) return;

      setQueueTokens((current) => {
        if (updatedToken.isArchived === true) {
          return current.filter(
            (item) => String(item?._id || item?.id || "") !== updatedId
          );
        }

        const index = current.findIndex(
          (item) => String(item?._id || item?.id || "") === updatedId
        );

        if (index === -1) {
          return [...current, { ...updatedToken, _id: updatedId }];
        }

        const next = [...current];
        next[index] = { ...current[index], ...updatedToken, _id: updatedId };
        return next;
      });
    };

    const handleReconnect = () => {
      fetchQueue();
    };

    socket.on("queue:updated", handleQueueUpdate);
    socket.on("patient:token-updated", handlePatientTokenUpdate);
    socket.on("connect", handleReconnect);

    return () => {
      isMounted = false;
      socket.off("queue:updated", handleQueueUpdate);
      socket.off("patient:token-updated", handlePatientTokenUpdate);
      socket.off("connect", handleReconnect);
    };
  }, [accessMode]);

  return queueTokens;
}

/* =========================================================
   PATIENT OTP LOGIN
========================================================= */

function SignInContext({ staff = false }) {
  const { t } = useLanguage();
  return (
    <section className="signin-context" aria-label={t(staff ? "Clinic workspace" : "Your patient portal")}>
      <span className="signin-symbol"><HeartPulse size={32} /></span>
      <p className="eyebrow">{t(staff ? "OPDfy / CLINIC WORKSPACE" : "OPDfy / PATIENT PORTAL")}</p>
      <h2>{staff ? <><Trans text={"More time for"} /><br /><Trans text={"patient care."} /></> : <><Trans text={"Your visit,"} /><br /><Trans text={"in one place."} /></>}</h2>
      <p>{staff ? t("Manage arrivals, consultations and daily operations from your clinic workspace.") : t("Choose your clinic, book a visit and follow your place in the queue.")}</p>
      <ol className="signin-steps">
        {(staff ? ["Your clinic and your role", "A shared view of today's queue", "Visit records when you need them"] : ["Sign in with your email", "Choose a clinic and doctor", "Follow your token and visit updates"]).map((label, index) => <li key={label}><span>{String(index + 1).padStart(2, "0")}</span>{t(label)}</li>)}
      </ol>
      <div className="signin-foot"><Stethoscope size={18} /><span><Trans text={"Connected care. From arrival to follow-up."} /></span></div>
    </section>
  );
}

function PatientLoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const requestedReturnTo = (() => {
    const value = new URLSearchParams(location.search).get("returnTo") || "";
    return /^\/(?:patient(?:\/[^?#]*)?|qr-checkin)(?:[?#].*)?$/.test(value) && !/[\\\r\n]/.test(value) ? value : "";
  })();

  const [authStep, setAuthStep] = useState("email");
  const [patientEmail, setPatientEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const handleSendVerificationCode = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    const formattedEmail = patientEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formattedEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);

    try {
      const { data } = await patientPlatformApi.post("/patient-auth/send-otp", {
        email: formattedEmail,
      });

      setPatientEmail(formattedEmail);
      setStatusMessage(data.message || "A 6-digit verification code has been dispatched to your email.");
      setAuthStep("otp");
    } catch (error) {
      console.error("Send verification code error:", error);
      setErrorMessage(error.response?.data?.message || "Unable to send verification code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    const formattedCode = verificationCode.trim();

    if (!/^\d{6}$/.test(formattedCode)) {
      setErrorMessage("Please enter the complete 6-digit verification code.");
      return;
    }

    setIsLoading(true);

    try {
      const { data } = await patientPlatformApi.post("/patient-auth/verify-otp", {
        email: patientEmail.trim().toLowerCase(),
        otp: formattedCode,
      });

      savePatientAuth(data);

      if (requestedReturnTo) {
        sessionStorage.setItem("opd_patient_return_to", requestedReturnTo);
        navigate(requestedReturnTo, { replace: true });
        return;
      }

      // SaaS Day 7: the reusable health profile belongs to the global patient.
      // New/incomplete accounts complete it once before choosing any clinic.
      navigate(data.patient?.profileCompleted ? "/patient/clinics" : "/patient/profile", { replace: true });
    } catch (error) {
      console.error("Verification code error:", error);
      setErrorMessage(error.response?.data?.message || "Invalid or expired verification code.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchToEmailStep = () => {
    setAuthStep("email");
    setVerificationCode("");
    setErrorMessage("");
    setStatusMessage("");
  };

  const handleResendCode = async () => {
    setErrorMessage("");
    setStatusMessage("");
    setVerificationCode("");
    setIsLoading(true);

    try {
      const { data } = await patientPlatformApi.post("/patient-auth/send-otp", {
        email: patientEmail.trim().toLowerCase(),
      });

      setStatusMessage(data.message || "A new verification code has been sent to your email.");
    } catch (error) {
      console.error("Resend code error:", error);
      setErrorMessage(error.response?.data?.message || "Unable to resend verification code.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <SignInContext />
      <section className="login-card">
        <div className="login-logo">
          <UserCheck size={28} />
        </div>

        <p className="eyebrow"><Trans text={"OPDfy · Global Patient Account"} /></p>
        <h1>{t(authStep === "email" ? "Patient Sign In" : "Verify Email Code")}</h1>

        {authStep === "email" ? (
          <>
            <p className="login-sub">
              <Trans text={"One verified account for every clinic on OPDfy. Sign in once, choose a clinic, then book your doctor, token or appointment."} /></p>

            <form onSubmit={handleSendVerificationCode}>
              <label>
                <Trans text={"Patient Email Address"} /><input
                  type="email"
                  value={patientEmail}
                  onChange={(e) => setPatientEmail(e.target.value)}
                  placeholder={t("patient@example.com")}
                  autoComplete="email"
                  disabled={isLoading}
                  required
                />
              </label>

              {errorMessage && <div className="login-error" role="alert">{t(errorMessage)}</div>}

              <button type="submit" className="primary login-button" disabled={isLoading}>
                {t(isLoading ? "Sending One-Time Code..." : "Continue with Email")}
              </button>
              <PatientPolicyNotice />
            </form>
          </>
        ) : (
          <>
            <p className="login-sub">
              <Trans text={"Enter the 6-digit verification code sent to "} /><strong>{patientEmail}</strong>
            </p>

            <form onSubmit={handleVerifyCode}>
              <label>
                <Trans text={"6-Digit Verification Code"} /><input
                  type="text"
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  disabled={isLoading}
                  required
                  autoFocus
                />
              </label>

              {statusMessage && <p className="success">{t(statusMessage)}</p>}
              {errorMessage && <div className="login-error" role="alert">{t(errorMessage)}</div>}

              <button
                type="submit"
                className="primary login-button"
                disabled={isLoading || verificationCode.length !== 6}
              >
                {t(isLoading ? "Verifying..." : "Verify & Access Portal")}
              </button>

              <button
                type="button"
                className="ghost"
                onClick={handleResendCode}
                disabled={isLoading}
              >
                <Trans text={"Resend Code"} /></button>

              <button
                type="button"
                className="ghost"
                onClick={handleSwitchToEmailStep}
                disabled={isLoading}
              >
                <Trans text={"Use Different Email Address"} /></button>
            </form>
          </>
        )}

        <div className="demo-credentials">
          <b><Trans text={"Hospital Clinical Staff?"} /></b>
          <span><Trans text={"Attending doctors and operations administrators should access the"} /></span>
          <Link to="/login"><Trans text={"Staff Login Portal"} /></Link>
        </div>
      </section>
    </main>
  );
}


/* =========================================================
   SAAS DAY 5 - GLOBAL PATIENT CLINIC MARKETPLACE
========================================================= */

function PatientClinicMarketplacePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [globalPatient, setGlobalPatient] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectingSlug, setSelectingSlug] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadClinics = async () => {
    if (!getPatientToken()) {
      navigate("/patient-login", { replace: true });
      return;
    }
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [meResponse, clinicResponse] = await Promise.all([
        patientPlatformApi.get("/patient-auth/me"),
        patientPlatformApi.get("/patient-platform/clinics"),
      ]);
      const patientAccount = meResponse.data?.patient || null;
      if (patientAccount && !patientAccount.profileCompleted) {
        updateStoredPatient(patientAccount);
        navigate("/patient/profile", { replace: true });
        return;
      }
      setGlobalPatient(patientAccount);
      setClinics(clinicResponse.data?.clinics || []);
    } catch (error) {
      if (error.response?.status === 401) {
        logoutPatient();
        navigate("/patient-login", { replace: true });
        return;
      }
      setErrorMessage(error.response?.data?.message || "Unable to load clinics.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Marketplace is the global patient space: no tenant branding or stale tenant context.
    clearActiveClinicSlug();
    loadClinics();
  }, []);

  const chooseClinic = async (clinic) => {
    const previousSlug = getSelectedClinicSlug();
    setSelectingSlug(clinic.slug);
    setErrorMessage("");
    try {
      setActiveClinicSlug(clinic.slug);

      // This protected request creates/links the tenant-local membership.
      // The global JWT itself never changes and never contains clinicId.
      const { data } = await api.get("/patients/me");
      const localPatient = data.patient;
      updateStoredPatient(localPatient);

      // Membership is automatically hydrated from the reusable global health
      // profile, so selecting a new clinic never asks the patient to re-enter it.
      navigate("/patient", { replace: true });
    } catch (error) {
      if (previousSlug) setActiveClinicSlug(previousSlug); else clearActiveClinicSlug();
      setErrorMessage(error.response?.data?.message || "Unable to open this clinic.");
    } finally {
      setSelectingSlug("");
    }
  };

  const query = searchText.trim().toLowerCase();
  const filteredClinics = clinics.filter((clinic) => {
    if (!query) return true;
    return [
      clinic.name,
      clinic.slug,
      ...(clinic.departments || []),
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });

  return (
    <main className="patient-market-shell">
      <section className="patient-market-hero">
        <div>
          <span className="patient-market-kicker"><ShieldCheck size={14} /> <Trans text={"One secure patient account"} /></span>
          <h1><Trans text={"Choose your clinic"} /></h1>
          <p>
            <Trans text={"Welcome"} />{globalPatient?.name ? `, ${globalPatient.name}` : ""}<Trans text={". Your login works across OPDfy clinics. Medical records remain isolated inside the clinic where care was delivered."} /></p>
        </div>
        <div className="patient-market-account">
          <div className="patient-market-account-icon"><UserCheck size={20} /></div>
          <div><span><Trans text={"Signed in as"} /></span><strong>{globalPatient?.email || "Verified patient"}</strong></div>
          <button type="button" onClick={() => { logoutPatient(); navigate("/patient-login", { replace: true }); }}>
            <LogOut size={14} /> <Trans text={"Sign out"} /></button>
        </div>
      </section>

      <section className="patient-market-toolbar">
        <div className="patient-market-search">
          <Stethoscope size={18} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t("Search clinic, specialty or department...")}
          />
        </div>
        <span>{filteredClinics.length} <Trans text={"active clinic"} />{filteredClinics.length === 1 ? "" : "s"}</span>
      </section>

      {errorMessage && <div className="clinic-onboarding-error patient-market-error">{t(errorMessage)}</div>}

      {isLoading ? (
        <section className="patient-market-loading">
          <RefreshCw className="animate-spin" size={24} />
          <strong><Trans text={"Finding verified clinics..."} /></strong>
          <span><Trans text={"Only Platform Admin-approved clinics appear here."} /></span>
        </section>
      ) : (
        <section className="patient-clinic-grid">
          {filteredClinics.map((clinic) => (
            <article className="patient-clinic-card" key={clinic.id}>
              <div className="patient-clinic-card-top">
                <div className={`patient-clinic-mark ${clinic.branding?.logoUrl ? "has-logo" : ""}`}>
                  {clinic.branding?.logoUrl ? <img src={clinic.branding.logoUrl} alt={`${clinic.displayName || clinic.name} logo`} /> : <HeartPulse size={22} />}
                </div>
                <span className={`patient-clinic-verified verification-${clinic.legalVerification?.status || "not_submitted"}`}>
                  {clinic.legalVerification?.status === "platform_reviewed" ? <ShieldCheck size={13} /> : <CheckCircle size={13} />}
                  <Trans text={verificationStatusLabel(clinic.legalVerification?.status)} />
                </span>
              </div>
              <h2>{clinic.displayName || clinic.name}</h2>
              <p className="patient-clinic-slug">{clinic.slug}</p>

              <div className="patient-clinic-specialties">
                {(clinic.departments || []).slice(0, 4).map((department) => (
                  <span key={department}>{department}</span>
                ))}
                {(clinic.departments || []).length > 4 && (
                  <span>+{clinic.departments.length - 4} <Trans text={"more"} /></span>
                )}
                {!clinic.departments?.length && <span><Trans text={"General OPD"} /></span>}
              </div>

              <div className="patient-clinic-facts">
                <div><Stethoscope size={16} /><span><b>{clinic.doctorCount || 0}</b> <Trans text={"doctors"} /></span></div>
                {clinic.contactPhone && <div><Phone size={16} /><span>{clinic.contactPhone}</span></div>}
                {clinic.contactEmail && <div><Mail size={16} /><span>{clinic.contactEmail}</span></div>}
                {clinic.branding?.address && <div><MapPin size={16} /><span>{clinic.branding.address}</span></div>}
              </div>

              <button
                type="button"
                className="patient-clinic-open"
                disabled={Boolean(selectingSlug)}
                onClick={() => chooseClinic(clinic)}
              >
                {selectingSlug === clinic.slug
                  ? <><RefreshCw size={15} className="animate-spin" /> <Trans text={"Opening clinic..."} /></>
                  : <><Trans text={"Choose Clinic "} /><ChevronRight size={15} /></>}
              </button>
            </article>
          ))}

          {!filteredClinics.length && (
            <div className="patient-market-empty">
              <Stethoscope size={30} />
              <h2><Trans text={"No matching clinics"} /></h2>
              <p><Trans text={"Try a clinic name or specialty such as Cardiology, ENT or Pediatrics."} /></p>
            </div>
          )}
        </section>
      )}

      <section className="patient-market-privacy">
        <ShieldCheck size={19} />
        <div>
          <strong><Trans text={"Clinic-isolated healthcare records"} /></strong>
          <p><Trans text={"Your global account identifies you. Each clinic can access only the records created inside its own tenant."} /></p>
        </div>
      </section>
    </main>
  );
}

/* =========================================================
   PATIENT PROFILE & EHR REGISTRATION
========================================================= */

function PatientProfilePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    bloodGroup: "",
    allergies: "",
    medicalHistory: "",
    currentMedications: "",
    pastSurgeries: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  });

  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccessMessage, setFormSuccessMessage] = useState("");

  useEffect(() => {
    const fetchGlobalProfile = async () => {
      if (!getPatientToken()) {
        navigate("/patient-login", { replace: true });
        return;
      }

      try {
        const { data } = await patientPlatformApi.get("/patient-auth/profile");
        const patientData = data.patient || {};
        updateStoredPatient(patientData);

        setProfileForm({
          name: patientData.name || "",
          email: patientData.email || "",
          phone: patientData.phone || "",
          dateOfBirth: patientData.dateOfBirth ? String(patientData.dateOfBirth).slice(0, 10) : "",
          gender: patientData.gender || "",
          bloodGroup: patientData.bloodGroup || "",
          allergies: Array.isArray(patientData.allergies) ? patientData.allergies.join(", ") : patientData.allergies || "",
          medicalHistory: Array.isArray(patientData.medicalHistory) ? patientData.medicalHistory.join(", ") : patientData.medicalHistory || "",
          currentMedications: Array.isArray(patientData.currentMedications) ? patientData.currentMedications.join(", ") : patientData.currentMedications || "",
          pastSurgeries: Array.isArray(patientData.pastSurgeries) ? patientData.pastSurgeries.join(", ") : patientData.pastSurgeries || "",
          emergencyContactName: patientData.emergencyContact?.name || "",
          emergencyContactPhone: patientData.emergencyContact?.phone || "",
        });
      } catch (error) {
        console.error("Fetch global profile error:", error);
        if (error.response?.status === 401) {
          logoutPatient();
          navigate("/patient-login", { replace: true });
          return;
        }
        setFormError(error.response?.data?.message || "Unable to load your health profile.");
      } finally {
        setIsProfileLoading(false);
      }
    };

    fetchGlobalProfile();
  }, [navigate]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((prevForm) => ({ ...prevForm, [name]: value }));
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccessMessage("");

    if (!profileForm.name.trim()) {
      setFormError("Please enter your full legal name.");
      return;
    }
    if (profileForm.phone && !/^[6-9]\d{9}$/.test(profileForm.phone)) {
      setFormError("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (profileForm.emergencyContactPhone && !/^[6-9]\d{9}$/.test(profileForm.emergencyContactPhone)) {
      setFormError("Emergency contact mobile must be a valid 10-digit number.");
      return;
    }

    setIsSavingProfile(true);

    try {
      const formattedPayload = {
        name: profileForm.name.trim(),
        phone: profileForm.phone.trim(),
        dateOfBirth: profileForm.dateOfBirth || null,
        gender: profileForm.gender,
        bloodGroup: profileForm.bloodGroup,
        allergies: profileForm.allergies,
        medicalHistory: profileForm.medicalHistory,
        currentMedications: profileForm.currentMedications,
        pastSurgeries: profileForm.pastSurgeries,
        emergencyContact: {
          name: profileForm.emergencyContactName.trim(),
          phone: profileForm.emergencyContactPhone.trim(),
        },
      };

      const { data } = await patientPlatformApi.put("/patient-auth/profile", formattedPayload);
      updateStoredPatient(data.patient);
      setFormSuccessMessage(data.message || "Global health profile saved successfully.");

      const destination = sessionStorage.getItem("opd_patient_return_to") || "/patient/clinics";
      sessionStorage.removeItem("opd_patient_return_to");

      // If editing from an already-selected clinic, the next tenant request will
      // automatically sync the updated global profile into that clinic membership.
      navigate(destination, { replace: true });
    } catch (error) {
      if (error.response?.status === 401) {
        logoutPatient();
        navigate("/patient-login", { replace: true });
        return;
      }
      setFormError(error.response?.data?.message || "Unable to save your health profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (!getPatientToken()) return <Navigate to="/patient-login" replace />;

  if (isProfileLoading) {
    return (
      <main className="page premium-page">
        <section className="card center">
          <RefreshCw className="animate-spin" size={24} style={{ margin: "auto auto 12px" }} />
          <h2><Trans text={"Loading Your Health Profile..."} /></h2>
          <p className="muted"><Trans text={"Retrieving your reusable patient-owned medical summary."} /></p>
        </section>
      </main>
    );
  }

  return (
    <main className="page premium-page">
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Global Patient Health Profile"} /></p>
          <h1><Trans text={"Enter Your Medical Details Once"} /></h1>
          <p className="page-subtitle">
            <Trans text={"This reusable profile follows your OPDfy account, so you do not need to re-enter the same health details when choosing another clinic."} /></p>
        </div>
        <button type="button" className="ghost" onClick={() => navigate("/patient/clinics")}>
          <HeartPulse size={15} /> <Trans text={"Clinic Marketplace"} /></button>
      </div>

      <section className="card" style={{ marginBottom: "18px" }}>
        <div className="card-title"><ShieldCheck /><h2><Trans text={"Privacy Boundary"} /></h2></div>
        <p className="muted">
          <Trans text={"Only your reusable health summary is shared when you choose a clinic. Diagnoses, consultation notes, prescriptions and treatment records created by one clinic remain isolated inside that clinic."} /></p>
      </section>

      <section className="card" style={{ marginBottom: "18px" }}>
        <div className="card-title"><ShieldCheck /><h2><Trans text={"Privacy & Data Requests"} /></h2></div>
        <p className="muted"><Trans text={"Request access, correction, account closure or help with your personal data."} /></p>
        <button type="button" className="ghost" onClick={() => navigate("/patient/privacy")}><ShieldCheck size={16} /> <Trans text={"Open Privacy Center"} /></button>
      </section>

      <form className="card patient-profile-form" onSubmit={handleSaveProfile}>
        <div className="card-title"><UserRound /><h2><Trans text={"Personal Details"} /></h2></div>
        <div className="patient-profile-grid">
          <label>
            <Trans text={"Full Name"} /><input name="name" value={profileForm.name} onChange={handleInputChange} placeholder={t("Your full name")} required />
          </label>
          <label>
            <Trans text={"Verified Email"} /><input value={profileForm.email} disabled readOnly />
          </label>
          <label>
            <Trans text={"Mobile Number"} /><input
              name="phone"
              type="tel"
              value={profileForm.phone}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              placeholder={t("10-digit mobile number")}
              maxLength={10}
            />
          </label>
          <label>
            <Trans text={"Date of Birth"} /><input name="dateOfBirth" type="date" value={profileForm.dateOfBirth} onChange={handleInputChange} />
          </label>
          <label>
            <Trans text={"Gender"} /><select name="gender" value={profileForm.gender} onChange={handleInputChange}>
              <option value="">{t("Prefer not to say")}</option>
              <option value="Male">{t("Male")}</option>
              <option value="Female">{t("Female")}</option>
              <option value="Other">{t("Other")}</option>
            </select>
          </label>
          <label>
            <Trans text={"Blood Group"} /><select name="bloodGroup" value={profileForm.bloodGroup} onChange={handleInputChange}>
              <option value="">{t("Unknown / Not entered")}</option>
              {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>
        </div>

        <div className="medical-section">
          <h3><Pill size={16} /> <Trans text={"Reusable Health Summary"} /></h3>
          <div className="patient-profile-grid">
            <label>
              <Trans text={"Allergies"} /><textarea name="allergies" value={profileForm.allergies} onChange={handleInputChange} placeholder={t("e.g. Penicillin, Peanuts")} rows={3} />
            </label>
            <label>
              <Trans text={"Medical History & Chronic Conditions"} /><textarea name="medicalHistory" value={profileForm.medicalHistory} onChange={handleInputChange} placeholder={t("e.g. Diabetes, Hypertension, Asthma")} rows={3} />
            </label>
            <label>
              <Trans text={"Current Medicines & Dosages"} /><textarea name="currentMedications" value={profileForm.currentMedications} onChange={handleInputChange} placeholder={t("e.g. Metformin 500mg daily")} rows={3} />
            </label>
            <label>
              <Trans text={"Past Surgeries / Major Procedures"} /><textarea name="pastSurgeries" value={profileForm.pastSurgeries} onChange={handleInputChange} placeholder={t("e.g. Appendix surgery (2021)")} rows={3} />
            </label>
          </div>
        </div>

        <div className="medical-section">
          <h3><Phone size={16} /> <Trans text={"Emergency Contact"} /></h3>
          <div className="patient-profile-grid">
            <label>
              <Trans text={"Contact Name & Relation"} /><input name="emergencyContactName" value={profileForm.emergencyContactName} onChange={handleInputChange} placeholder={t("e.g. Priya Sharma (Spouse)")} />
            </label>
            <label>
              <Trans text={"Contact Mobile Number"} /><input
                name="emergencyContactPhone"
                type="tel"
                value={profileForm.emergencyContactPhone}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                placeholder={t("10-digit mobile number")}
                maxLength={10}
              />
            </label>
          </div>
        </div>

        {formError && <div className="login-error" role="alert">{t(formError)}</div>}
        {formSuccessMessage && <p className="success">{t(formSuccessMessage)}</p>}

        <div className="patient-action-card" style={{ marginTop: "24px" }}>
          <span className="muted"><Trans text={"You can update this profile anytime. Changes are synced to clinics you select, without merging clinic-specific treatment records."} /></span>
          <button type="submit" className="primary" disabled={isSavingProfile}>
            {t(isSavingProfile ? "Saving Health Profile..." : "Save & Continue to Clinics")}
          </button>
        </div>
      </form>
    </main>
  );
}

function PatientClinicRequiredRoute({ children }) {
  const { t } = useLanguage();
  if (!getPatientToken()) return <Navigate to="/patient-login" replace />;
  if (!getSelectedClinicSlug()) return <Navigate to="/patient/clinics" replace />;
  return children;
}

/* =========================================================
   CLINIC QR SELF CHECK-IN
========================================================= */

function PatientSelfCheckInPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const storedPatient = getStoredPatient();
  const qrClinicSlug = String(new URLSearchParams(window.location.search).get("clinic") || "").trim().toLowerCase();
  useEffect(() => {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(qrClinicSlug) && getSelectedClinicSlug() !== qrClinicSlug) setActiveClinicSlug(qrClinicSlug);
  }, [qrClinicSlug]);

  const [appointments, setAppointments] = useState([]);
  const [isLoading, setIsLoading] = useState(Boolean(storedPatient));
  const [isCheckingIn, setIsCheckingIn] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [createdToken, setCreatedToken] = useState(null);

  const loadTodayAppointments = async () => {
    setErrorMessage("");

    try {
      const { data } = await api.get("/patients/me/today-appointment");
      setAppointments(data.appointments || []);
    } catch (error) {
      if (error.response?.status === 401) {
        logoutPatient();
        return;
      }

      setErrorMessage(
        error.response?.data?.message || "Unable to load today's appointment."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (storedPatient) {
      loadTodayAppointments();
    }
  }, []);

  useEffect(() => {
    if (!storedPatient) return undefined;

    const refreshCheckInState = (update) => {
      if (!update || hasOperationalDomain(update, "appointments")) {
        loadTodayAppointments();
      }
    };

    socket.on("operations:updated", refreshCheckInState);
    socket.on("connect", loadTodayAppointments);

    return () => {
      socket.off("operations:updated", refreshCheckInState);
      socket.off("connect", loadTodayAppointments);
    };
  }, [Boolean(storedPatient)]);

  const handleSelfCheckIn = async (appointmentId) => {
    setIsCheckingIn(appointmentId);
    setMessage("");
    setErrorMessage("");

    try {
      const { data } = await api.post("/patients/me/check-in-today", {
        appointmentId,
      });

      setCreatedToken(data.token || null);
      setMessage(data.message || "Check-in successful.");
      await loadTodayAppointments();
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || "Unable to check in."
      );
    } finally {
      setIsCheckingIn("");
    }
  };

  if (!storedPatient) {
    return (
      <main className="page premium-page qr-self-page">
        <section className="card qr-self-card center">
          <div className="qr-page-icon">
            <QrCode size={32} />
          </div>
          <p className="eyebrow"><Trans text={"Clinic Arrival Check-in"} /></p>
          <h1><Trans text={"Welcome to OPD Check-in"} /></h1>
          <p className="lead">
            <Trans text={"Sign in with your verified patient email. We will securely identify today's appointment and create your live OPD queue token."} /></p>
          <button
            type="button"
            className="primary"
            onClick={() =>
              navigate(
                `/patient-login?returnTo=${encodeURIComponent(`/qr-checkin${window.location.search || ""}`)}`
              )
            }
          >
            <UserCheck size={17} /> <Trans text={"Patient Sign In & Check In"} /></button>
          <p className="muted qr-help-text">
            <Trans text={"No appointment today? Reception can still issue a normal walk-in token."} /></p>
        </section>
      </main>
    );
  }

  return (
    <main className="page premium-page qr-self-page">
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Clinic Arrival Check-in"} /></p>
          <h1><Trans text={"Check In for Today's Visit"} /></h1>
          <p className="page-subtitle">
            <Trans text={"Verified patient: "} /><strong>{storedPatient.name || storedPatient.email}</strong>
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => navigate("/patient")}>
          <Trans text={"Patient Dashboard"} /></button>
      </div>

      <section className="card qr-self-card">
        {isLoading ? (
          <div className="center">
            <RefreshCw className="animate-spin" />
            <p className="muted"><Trans text={"Finding today's appointment..."} /></p>
          </div>
        ) : (
          <>
            {message && <p className="success">{t(message)}</p>}
            {errorMessage && <div className="login-error" role="alert">{t(errorMessage)}</div>}

            {createdToken && (
              <div className="qr-checkin-success">
                <CheckCircle size={26} />
                <div>
                  <span><Trans text={"Live OPD Token Created"} /></span>
                  <strong>#{createdToken.tokenNumber}</strong>
                  <small>{t(createdToken.department)} <Trans text={"· You are now checked in."} /></small>
                </div>
              </div>
            )}

            <div className="appointment-list">
              {appointments.map((appointment) => (
                <div className="appointment-row qr-self-appointment" key={appointment._id}>
                  <div>
                    <strong>
                      {appointment.startTime} <Trans text={"· Dr. "} />{appointment.doctorName}
                    </strong>
                    <small>
                      {t(appointment.department)} · {appointment.patientName}
                    </small>
                  </div>

                  <span className={`appointment-status ${appointment.status}`}>
                    {appointment.status.replace("_", " ")}
                  </span>

                  {appointment.status === "booked" ? (
                    Number(appointment.billing?.quotedAmount || 0) > 0 && appointment.billing?.status === "pending" ? (
                      <div className="qr-payment-required"><IndianRupee size={16}/><span><b>{formatInr(appointment.billing?.quotedAmount || 0)} <Trans text={"due at reception"} /></b><small><Trans text={"Please pay at the front desk; reception will check you in and issue the live token."} /></small></span></div>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={isCheckingIn === appointment._id}
                        onClick={() => handleSelfCheckIn(appointment._id)}
                      >
                        <QrCode size={16} />
                        {t(isCheckingIn === appointment._id ? "Checking In..." : "I'm at the Clinic — Check In")}
                      </button>
                    )
                  ) : (
                    <span className="qr-already-checked">
                      <CheckCircle size={15} /> <Trans text={"Already checked in"} /></span>
                  )}
                </div>
              ))}

              {!appointments.length && (
                <div className="qr-empty-state center">
                  <Calendar size={30} />
                  <h3><Trans text={"No scheduled appointment found for today"} /></h3>
                  <p className="muted">
                    <Trans text={"If you are visiting as a walk-in, please contact reception for an OPD token."} /></p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function PatientDashboard() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const queueTokenList = useLiveQueue("patient");

  const [aiChatMessages, setAiChatMessages] = useState([]);
  const [chatMessageInput, setChatMessageInput] = useState("");
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState("");

  const [activePatient, setActivePatient] = useState(null);
  const [identityReviewRequired, setIdentityReviewRequired] = useState(false);
  const [tokenHistoryList, setTokenHistoryList] = useState([]);
  const [queueReservations, setQueueReservations] = useState([]);
  const [reservationQr, setReservationQr] = useState(null);
  const [reservationActionId, setReservationActionId] = useState("");
  const [consultationHistoryList, setConsultationHistoryList] = useState([]);
  const [isConsultationsLoading, setIsConsultationsLoading] = useState(true);
  const [labReferralUpdatingId, setLabReferralUpdatingId] = useState("");
  const [labReferralMessage, setLabReferralMessage] = useState("");
  const [patientFeedbackList, setPatientFeedbackList] = useState([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState({});
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [selectedHistoryToken, setSelectedHistoryToken] = useState(null);
  const [clinicDepartments, setClinicDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [patientDoctors, setPatientDoctors] = useState([]);
  const [selectedUrgency, setSelectedUrgency] = useState("normal");
  const [reservationConsultationKind, setReservationConsultationKind] = useState("normal");
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [tokenErrorMessage, setTokenErrorMessage] = useState("");
  const [tokenSuccessMessage, setTokenSuccessMessage] = useState("");
  const [appointmentDoctors, setAppointmentDoctors] = useState([]);
  const [appointmentForm, setAppointmentForm] = useState({ department: "", doctorId: "", appointmentDate: "", startTime: "", reason: "", followUpConsultationId: "" });
  const [appointmentConsultationKind, setAppointmentConsultationKind] = useState("normal");
  const [appointmentDates, setAppointmentDates] = useState([]);
  const [appointmentSlots, setAppointmentSlots] = useState([]);
  const [patientAppointments, setPatientAppointments] = useState([]);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [appointmentMessage, setAppointmentMessage] = useState("");
  const [appointmentError, setAppointmentError] = useState("");
  const [isBookingAppointment, setIsBookingAppointment] = useState(false);
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState("");
  const [patientEta, setPatientEta] = useState(null);
  const [appointmentQr, setAppointmentQr] = useState(null);
  const [appointmentQrError, setAppointmentQrError] = useState("");
  const [patientNotifications, setPatientNotifications] = useState([]);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [followUpBookingBusy, setFollowUpBookingBusy] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [liveNotificationToast, setLiveNotificationToast] = useState(null);
  const [patientClinicContext, setPatientClinicContext] = useState(null);
  const [patientWorkspaceTab, setPatientWorkspaceTab] = useState("overview");
  const [reservationFeeQuote, setReservationFeeQuote] = useState(null);
  const [appointmentFeeQuote, setAppointmentFeeQuote] = useState(null);
  const [reservationFeeState, setReservationFeeState] = useState("idle");
  const [appointmentFeeState, setAppointmentFeeState] = useState("idle");
  const feeQuoteRequestRef = useRef({ reservation: 0, appointment: 0 });

  const fetchClinicDepartments = async () => {
    const slug = getSelectedClinicSlug();
    if (!slug) return [];
    try {
      const { data } = await patientPlatformApi.get(`/patient-platform/clinics/${encodeURIComponent(slug)}`);
      const departments = [...new Set((data?.doctors || []).map((doctor) => doctor.department).filter(Boolean))];
      const fallback = data?.clinic?.defaultDepartment || "General OPD";
      const available = departments.length ? departments : [fallback];
      setClinicDepartments(available);
      const initial = available[0];
      setSelectedDepartment((current) => available.includes(current) ? current : initial);
      setAppointmentForm((current) => ({ ...current, department: available.includes(current.department) ? current.department : initial, doctorId: available.includes(current.department) ? current.doctorId : "", appointmentDate: available.includes(current.department) ? current.appointmentDate : "", startTime: available.includes(current.department) ? current.startTime : "" }));
      return available;
    } catch (error) {
      console.error("Unable to load clinic departments:", error);
      return [];
    }
  };

  const fetchPatientClinicContext = async () => {
    try {
      const { data } = await api.get("/tenant/current");
      setPatientClinicContext(data?.tenant || null);
    } catch (error) {
      console.error("Unable to load clinic prescription branding:", error);
      setPatientClinicContext(null);
    }
  };

  const fetchPatientNotifications = async () => {
    try {
      const [{ data }, history] = await Promise.all([
        api.get("/patients/me/notifications"),
        api.get("/patients/me/notifications", { params: { category: "followups" } })
          .catch(() => ({ data: { notifications: [] } })),
      ]);
      const merged = [...(data.notifications || []), ...(history.data.notifications || [])];
      const unique = [...new Map(merged.map((item) => [String(item._id), item])).values()];
      unique.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setPatientNotifications(unique);
      setNotificationUnreadCount(Number(data.unreadCount || 0));
    } catch (error) {
      console.error("Unable to load notifications:", error);
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await api.patch("/patients/me/notifications/read-all");
      setPatientNotifications((prev) =>
        prev.map((item) => ({
          ...item,
          readAt: item.readAt || new Date().toISOString(),
        }))
      );
      setNotificationUnreadCount(0);
    } catch (error) {
      console.error("Unable to mark notifications read:", error);
    }
  };

  const handleNotificationBell = async () => {
    const willOpen = !notificationPanelOpen;
    setNotificationPanelOpen(willOpen);

    if (willOpen) {
      await fetchPatientNotifications();
      await markAllNotificationsRead();
    }
  };

  const prepareFollowUpBooking = async (notification) => {
    const meta = notification?.metadata || {};
    if (!meta.consultationId || !meta.doctorId || !meta.department) return;
    setFollowUpBookingBusy(true);
    setAppointmentMessage("");
    setAppointmentError("");
    try {
      const { data } = await api.get("/patients/me/follow-ups");
      const plan = (data.followUps || []).find((item) => String(item.consultationId) === String(meta.consultationId));
      if (!plan || ["completed", "cancelled"].includes(plan.status)) {
        setAppointmentError("This follow-up is already completed or no longer available.");
      } else if (plan.status === "scheduled" && plan.appointment) {
        await fetchPatientAppointments();
        setAppointmentMessage("Your follow-up is already booked. Review your appointment below.");
      } else {
        setRescheduleTarget(null);
        setAppointmentConsultationKind("follow_up");
        setAppointmentForm({
          department: plan.department, doctorId: String(plan.doctorId),
          appointmentDate: "", startTime: "", reason: "Follow-up visit",
          followUpConsultationId: String(plan.consultationId),
        });
        setAppointmentFeeQuote(null);
        setAppointmentFeeState("idle");
        setAppointmentSlots([]);
        await fetchAppointmentDoctors(plan.department);
        await loadAppointmentDates(String(plan.doctorId));
        setAppointmentMessage("Follow-up details loaded. Choose an available date and time.");
      }
      setNotificationPanelOpen(false);
      openPatientWorkspace("appointments", "patient-appointments");
    } catch (error) {
      setAppointmentError(error.response?.data?.message || "Unable to load follow-up details.");
      setNotificationPanelOpen(false);
      openPatientWorkspace("appointments", "patient-appointments");
    } finally {
      setFollowUpBookingBusy(false);
    }
  };

  const loadPatientFeeQuote = async (doctorId, visitType, setter, urgency = "normal", consultationKind = "normal", serviceDate = "") => {
    const stateKey = visitType === "reservation" ? "reservation" : "appointment";
    const setState = stateKey === "reservation" ? setReservationFeeState : setAppointmentFeeState;
    const requestId = ++feeQuoteRequestRef.current[stateKey];
    if (!doctorId) { setter(null); setState("idle"); return; }
    setter(null);
    setState("loading");
    try {
      const { data } = await api.get("/patients/me/fee-quote", { params: { doctorId, visitType, urgency, consultationKind, serviceDate } });
      if (requestId !== feeQuoteRequestRef.current[stateKey]) return;
      if (!data?.quote || data.quote.amount === null || data.quote.amount === undefined) throw new Error("Fee quote missing from response");
      setter(data.quote);
      setState("ready");
    } catch (error) {
      if (requestId !== feeQuoteRequestRef.current[stateKey]) return;
      console.error("Unable to load patient consultation fee:", error);
      setter({ errorMessage: error.response?.data?.message || "Unable to load the configured doctor fee." });
      setState("error");
    }
  };

  const fetchAppointmentDoctors = async (department = appointmentForm.department) => {
    try {
      const { data } = await api.get("/patients/appointment-doctors", {
        params: { department },
      });
      setAppointmentDoctors(data.doctors || []);
    } catch (error) {
      console.error("Unable to load appointment doctors:", error);
      setAppointmentDoctors([]);
    }
  };

  const fetchPatientAppointments = async () => {
    try {
      const { data } = await api.get("/patients/me/appointments");
      setPatientAppointments(data.appointments || []);
    } catch (error) {
      console.error("Unable to load patient appointments:", error);
      setPatientAppointments([]);
    }
  };

  const loadAppointmentDates = async (doctorId) => {
    setAppointmentDates([]);
    setAppointmentSlots([]);
    setAppointmentError("");

    if (!doctorId) return;

    try {
      const { data } = await api.get(
        `/patients/appointment-doctors/${doctorId}/dates`
      );
      setAppointmentDates(data.dates || []);
    } catch (error) {
      setAppointmentError(
        error.response?.data?.message || "Unable to load available dates."
      );
    }
  };

  const loadAppointmentSlots = async (doctorId, date) => {
    setAppointmentSlots([]);
    setAppointmentError("");

    if (!doctorId || !date) return;

    try {
      const { data } = await api.get(
        `/patients/appointment-doctors/${doctorId}/slots`,
        { params: { date } }
      );
      setAppointmentSlots(data.slots || []);
    } catch (error) {
      setAppointmentError(
        error.response?.data?.message || "Unable to load time slots."
      );
    }
  };

  const handleBookAppointment = async (event) => {
    event.preventDefault();
    setAppointmentError("");
    setAppointmentMessage("");

    if (
      !appointmentForm.doctorId ||
      !appointmentForm.appointmentDate ||
      !appointmentForm.startTime
    ) {
      setAppointmentError(
        "Select department, doctor, available date and time slot."
      );
      return;
    }

    if (appointmentFeeState !== "ready") {
      setAppointmentError("Please wait for the consultation fee to load before confirming the appointment.");
      return;
    }

    setIsBookingAppointment(true);

    try {
      const { data } = rescheduleTarget
        ? await api.patch(`/patients/me/appointments/${rescheduleTarget._id}/reschedule`, appointmentForm)
        : await api.post("/patients/me/appointments", { ...appointmentForm, consultationKind: appointmentConsultationKind });

      setAppointmentMessage(
        rescheduleTarget
          ? (data.message || `Appointment rescheduled to ${data.appointment.appointmentDate} at ${data.appointment.startTime}.`)
          : `Appointment confirmed with Dr. ${data.appointment.doctorName} on ${data.appointment.appointmentDate} at ${data.appointment.startTime}.`
      );
      setRescheduleTarget(null);
      setAppointmentConsultationKind("normal");

      setAppointmentForm((prev) => ({
        ...prev,
        appointmentDate: "",
        startTime: "",
        reason: "",
        followUpConsultationId: "",
      }));

      setAppointmentSlots([]);
      await fetchPatientAppointments();
      await loadAppointmentDates(appointmentForm.doctorId);
    } catch (error) {
      setAppointmentError(
        error.response?.data?.message || "Unable to book appointment."
      );
    } finally {
      setIsBookingAppointment(false);
    }
  };

  const handleCancelAppointment = async (appointment) => {
    setAppointmentError("");
    setAppointmentMessage("");

    const cancellationReason = window.prompt(
      localizeUi(`Reason for cancelling your appointment with Dr. ${appointment.doctorName}?`),
      "Plans changed"
    );
    if (cancellationReason === null) return;

    setCancellingAppointmentId(appointment._id);

    try {
      const { data } = await api.patch(
        `/patients/me/appointments/${appointment._id}/cancel`,
        { reason: cancellationReason }
      );

      setAppointmentMessage(
        data.message || "Appointment cancelled successfully."
      );

      if (appointmentQr?.appointmentId === appointment._id) {
        setAppointmentQr(null);
      }

      await fetchPatientAppointments();

      if (appointmentForm.doctorId) {
        await loadAppointmentDates(appointmentForm.doctorId);

        if (appointmentForm.appointmentDate) {
          await loadAppointmentSlots(
            appointmentForm.doctorId,
            appointmentForm.appointmentDate
          );
        }
      }
    } catch (error) {
      setAppointmentError(
        error.response?.data?.message || "Unable to cancel appointment."
      );
    } finally {
      setCancellingAppointmentId("");
    }
  };

  const prepareAppointmentReschedule = async (appointment) => {
    setPatientWorkspaceTab("appointments");
    setRescheduleTarget(appointment); setAppointmentConsultationKind(appointment.billing?.feeType === "follow_up" ? "follow_up" : "normal"); setAppointmentMessage(""); setAppointmentError("");
    setAppointmentForm({ department: appointment.department, doctorId: String(appointment.doctor || ""), appointmentDate: "", startTime: "", reason: appointment.reason || "" });
    await fetchAppointmentDoctors(appointment.department);
    await loadAppointmentDates(String(appointment.doctor || ""));
    document.getElementById("patient-appointments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const prepareRepeatBooking = async (appointment) => {
    setPatientWorkspaceTab("appointments");
    setRescheduleTarget(null); setAppointmentConsultationKind("normal"); setAppointmentMessage("Previous visit details loaded. Choose a new available date and time."); setAppointmentError("");
    setAppointmentForm({ department: appointment.department, doctorId: String(appointment.doctor || ""), appointmentDate: "", startTime: "", reason: appointment.reason || "Follow-up visit", followUpConsultationId: "" });
    await fetchAppointmentDoctors(appointment.department); await loadAppointmentDates(String(appointment.doctor || ""));
    document.getElementById("patient-appointments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleAppointmentQr = async (appointment) => {
    setAppointmentQrError("");

    if (appointmentQr?.appointmentId === appointment._id) {
      setAppointmentQr(null);
      return;
    }

    try {
      const { data } = await api.get(
        `/patients/me/appointments/${appointment._id}/check-in-qr`
      );

      setAppointmentQr({
        appointmentId: appointment._id,
        token: data.checkInToken,
      });
    } catch (error) {
      setAppointmentQr(null);
      setAppointmentQrError(
        error.response?.data?.message || "Unable to generate check-in QR."
      );
    }
  };

  const fetchPatientEta = async () => {
    try {
      const { data } =
        await api.get(
          "/patients/me/eta"
        );

      setPatientEta(
        data.eta || null
      );

      return data.eta || null;
    } catch (error) {
      console.error(
        "Unable to load dynamic ETA:",
        error
      );

      return null;
    }
  };

  const fetchPatientDoctors = async () => {
    try {
      const { data } = await api.get("/patients/doctors");
      setPatientDoctors(data.doctors || []);
    } catch (error) {
      console.error("Unable to load doctor roster:", error);
      setPatientDoctors([]);
    }
  };

  const fetchPatientProfile = async () => {
    try {
      const { data } = await api.get("/patients/me");
      if (!data.patient?.profileCompleted) {
        navigate("/patient/profile", { replace: true });
        return null;
      }
      setActivePatient(data.patient);
      setIdentityReviewRequired(Boolean(data.identityReviewRequired));
      updateStoredPatient(data.patient);
      return data.patient;
    } catch (error) {
      if (error.response?.status === 401) {
        logoutPatient();
        navigate("/patient-login", { replace: true });
        return null;
      }
      setTokenErrorMessage(error.response?.data?.message || "Unable to load patient profile.");
      return null;
    }
  };

  const fetchTokenHistory = async () => {
    try {
      const { data } = await api.get("/patients/me/tokens");
      setTokenHistoryList(data.tokens || []);
      setQueueReservations(data.reservations || []);
    } catch (error) {
      console.error("Unable to load token history:", error);
    }
  };

  const fetchConsultationRecords = async () => {
    try {
      const { data } = await api.get("/patients/me/consultations");
      setConsultationHistoryList(data.consultations || []);
    } catch (error) {
      console.error("Unable to load consultation records:", error);
    } finally {
      setIsConsultationsLoading(false);
    }
  };

  const markLabReferralCompleted = async (consultation) => {
    const patientToken = getPatientToken();

    if (!patientToken) {
      setLabReferralMessage("Patient session expired. Please login again.");
      return;
    }

    if (!window.confirm(localizeUi("Confirm that the referred laboratory tests have been completed?"))) {
      return;
    }

    setLabReferralUpdatingId(consultation._id);
    setLabReferralMessage("");

    try {
      const { data } = await api.patch(
        `/patients/me/consultations/${consultation._id}/lab-referral/complete`,
        {},
        { headers: { Authorization: `Bearer ${patientToken}` } }
      );

      setLabReferralMessage(data.message || "Lab referral marked as completed.");
      await fetchConsultationRecords();
    } catch (error) {
      setLabReferralMessage(
        error.response?.data?.message || "Unable to update lab referral status."
      );
    } finally {
      setLabReferralUpdatingId("");
    }
  };

  const fetchPatientFeedback = async () => {
    try {
      const patientToken = getPatientToken();

      if (!patientToken) {
        setPatientFeedbackList([]);
        return;
      }

      const { data } = await api.get("/feedback/patient", {
        headers: {
          Authorization: `Bearer ${patientToken}`,
        },
      });

      setPatientFeedbackList(data.feedback || []);
    } catch (error) {
      console.error("Unable to load patient feedback:", error);
      setPatientFeedbackList([]);
    }
  };

  const submitPatientFeedback = async (consultation) => {
    const draft = feedbackDrafts[consultation._id] || {
      rating: 5,
      comment: "",
    };

    setFeedbackMessage("");

    if (!draft.rating) {
      setFeedbackMessage("Please select a star rating.");
      return;
    }

    const patientToken = getPatientToken();

    if (!patientToken) {
      setFeedbackMessage(
        "Your patient session has expired. Please login again."
      );
      return;
    }

    setFeedbackSubmittingId(consultation._id);

    try {
      const { data } = await api.post(
        "/feedback/patient",
        {
          consultationId: consultation._id,
          rating: Number(draft.rating),
          comment: draft.comment || "",
        },
        {
          headers: {
            Authorization: `Bearer ${patientToken}`,
          },
        }
      );

      setFeedbackMessage(
        data.message || "Thank you. Your feedback has been submitted."
      );

      await Promise.all([fetchPatientFeedback(), fetchPatientDoctors(), fetchAppointmentDoctors()]);
    } catch (error) {
      console.error("Feedback submission error:", error);

      if (error.response?.status === 401) {
        setFeedbackMessage(
          "Patient session expired. Please login again."
        );
        return;
      }

      setFeedbackMessage(
        error.response?.data?.message ||
          "Unable to submit feedback. Please try again."
      );
    } finally {
      setFeedbackSubmittingId("");
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeDashboard = async () => {
      setIsDashboardLoading(true);

      try {
        const patient = await fetchPatientProfile();

        if (!patient) {
          return;
        }

        const departments = await fetchClinicDepartments();
        const initialDepartment = departments[0] || "General OPD";
        await Promise.allSettled([
          fetchPatientDoctors(),
          fetchAppointmentDoctors(initialDepartment),
          fetchPatientAppointments(),
          fetchTokenHistory(),
          fetchPatientEta(),
          fetchConsultationRecords(),
          fetchPatientFeedback(),
          fetchPatientNotifications(),
          fetchPatientClinicContext(),
        ]);
      } catch (error) {
        console.error("Patient dashboard initialization error:", error);
        setTokenErrorMessage(
          error.response?.data?.message ||
            "Some dashboard information could not be loaded. Please refresh once."
        );
      } finally {
        if (isMounted) {
          setIsDashboardLoading(false);
        }
      }
    };

    initializeDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activePatient?._id) return undefined;

    const authenticatePatientSocket = () => {
      const patientToken = getPatientToken();
      if (patientToken) {
        socket.emit("patient:authenticate", patientToken);
      }
    };

    authenticatePatientSocket();

    const handlePatientNotification = (notification) => {
      if (!notification?._id) return;

      setPatientNotifications((prev) => {
        if (prev.some((item) => item._id === notification._id)) return prev;
        return [notification, ...prev].slice(0, 50);
      });

      setNotificationUnreadCount((count) => count + 1);
      setLiveNotificationToast(notification);

      window.setTimeout(() => {
        setLiveNotificationToast((current) =>
          current?._id === notification._id ? null : current
        );
      }, 5500);

      if (
        ["queue_next", "token_called", "queue_2_ahead"].includes(notification.type)
      ) {
        playQueueNotificationChime();

        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(notification.title || "OPDfy", {
            body: notification.message || "",
          });
        }
      }
    };

    socket.on("patient:notification", handlePatientNotification);
    socket.on("connect", authenticatePatientSocket);

    return () => {
      socket.off("patient:notification", handlePatientNotification);
      socket.off("connect", authenticatePatientSocket);
    };
  }, [activePatient?._id]);

  useEffect(() => {
    if (!activePatient?._id) return undefined;

    const refreshAppointmentState = async (update = null) => {
      const appointmentChanged = !update || hasOperationalDomain(update, "appointments");
      const staffChanged = !update || hasOperationalDomain(update, "staff");
      const feedbackChanged = update && hasOperationalDomain(update, "feedback");

      if (appointmentChanged) {
        fetchPatientAppointments();
        if (appointmentForm.doctorId && appointmentForm.appointmentDate) {
          loadAppointmentSlots(
            appointmentForm.doctorId,
            appointmentForm.appointmentDate
          );
        }
      }

      if (staffChanged) {
        fetchPatientDoctors();
        fetchAppointmentDoctors(appointmentForm.department);
        if (appointmentForm.doctorId) {
          loadAppointmentDates(appointmentForm.doctorId);
          if (appointmentForm.appointmentDate) {
            loadAppointmentSlots(
              appointmentForm.doctorId,
              appointmentForm.appointmentDate
            );
          }
        }
      }

      if (feedbackChanged) {
        fetchPatientFeedback();
        fetchPatientDoctors();
        fetchAppointmentDoctors();
      }
    };

    const handleOperationsUpdate = (update) => refreshAppointmentState(update);
    const handleReconnect = () => {
      refreshAppointmentState(null);
      fetchPatientNotifications();
    };

    socket.on("operations:updated", handleOperationsUpdate);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("operations:updated", handleOperationsUpdate);
      socket.off("connect", handleReconnect);
    };
  }, [
    activePatient?._id,
    appointmentForm.department,
    appointmentForm.doctorId,
    appointmentForm.appointmentDate,
  ]);

  useEffect(() => {
    const matchingDoctors = patientDoctors.filter(
      (doctor) => doctor.department === selectedDepartment
    );

    if (matchingDoctors.length === 1) {
      const doctorId = String(matchingDoctors[0]._id);
      setSelectedDoctorId(doctorId);
      loadPatientFeeQuote(doctorId, "reservation", setReservationFeeQuote, selectedUrgency, reservationConsultationKind);
    } else if (
      !matchingDoctors.some((doctor) => String(doctor._id) === String(selectedDoctorId))
    ) {
      setSelectedDoctorId("");
    }
  }, [selectedDepartment, patientDoctors, selectedUrgency, reservationConsultationKind]);

  useEffect(() => {
    if (!activePatient) return;
    fetchTokenHistory();
    fetchConsultationRecords();
  }, [queueTokenList]);

  const patientActiveToken = activePatient
    ? queueTokenList.find(
        (token) =>
          token.patientId === activePatient.patientId &&
          ["waiting", "called"].includes(token.status)
      )
    : null;

  const activeQueueReservation = queueReservations.find(
    (reservation) => reservation.status === "reserved"
  ) || null;

  const activeAssignedDoctorId = patientActiveToken?.assignedDoctor
    ? String(patientActiveToken.assignedDoctor?._id || patientActiveToken.assignedDoctor)
    : "";

  const currentlyServingToken = patientActiveToken
    ? queueTokenList.find(
        (token) =>
          token.status === "called" &&
          token.department === patientActiveToken.department &&
          (!activeAssignedDoctorId ||
            String(token.assignedDoctor?._id || token.assignedDoctor || "") === activeAssignedDoctorId)
      )
    : null;

  const waitingPatientsAhead =
    patientActiveToken?.status === "waiting"
      ? queueTokenList.filter(
          (token) =>
            token.status === "waiting" &&
            token.department === patientActiveToken.department &&
            (!activeAssignedDoctorId ||
              String(token.assignedDoctor?._id || token.assignedDoctor || "") === activeAssignedDoctorId) &&
            Number(token.tokenNumber) < Number(patientActiveToken.tokenNumber)
        ).length
      : 0;

  const activeAssignedDoctor = patientDoctors.find(
    (doctor) => String(doctor._id) === activeAssignedDoctorId
  );

  useEffect(() => {
    if (!patientActiveToken?._id) {
      setPatientEta(null);
      return undefined;
    }

    fetchPatientEta();

    const etaTimer =
      window.setInterval(
        fetchPatientEta,
        30000
      );

    return () =>
      window.clearInterval(
        etaTimer
      );
  }, [
    patientActiveToken?._id,
    patientActiveToken?.status,
    currentlyServingToken?._id,
    currentlyServingToken?.calledAt,
    waitingPatientsAhead,
  ]);

  const livePatientsAhead =
    patientEta?.patientsAhead ??
    waitingPatientsAhead;

  const estimatedWaitMinutes =
    patientEta?.estimatedMinutes ??
    livePatientsAhead * 7;

  const dynamicEtaLabel =
    patientActiveToken?.status === "called"
      ? "Proceed to Room"
      : patientEta
        ? patientEta.estimatedMinutes === 0
          ? "Next Patient in Line"
          : `${patientEta.lowerMinutes}-${patientEta.upperMinutes} min`
        : livePatientsAhead === 0
          ? "Next Patient in Line"
          : `~${estimatedWaitMinutes} min`;

  const handleGenerateNewToken = async () => {
    setTokenErrorMessage("");
    setTokenSuccessMessage("");
    setIsGeneratingToken(true);

    try {
      if (!selectedDoctorId) {
        setTokenErrorMessage(`Please select a ${selectedDepartment} specialist.`);
        return;
      }
      if (reservationFeeState !== "ready") {
        setTokenErrorMessage("Please wait for the consultation fee to load before reserving this visit.");
        return;
      }

      const { data } = await api.post("/patients/me/tokens", {
        department: selectedDepartment,
        doctorId: selectedDoctorId,
        urgency: selectedUrgency,
        consultationKind: reservationConsultationKind,
      });
      setTokenSuccessMessage(
        `Online reservation confirmed with Dr. ${data.doctor?.name || "selected specialist"}. Your FCFS token will be issued only after hospital check-in${selectedUrgency === "emergency" ? " (emergency priority preserved)" : ""}.`
      );
      await fetchTokenHistory();
    } catch (error) {
      if (error.response?.status === 409) {
        setTokenErrorMessage(
          error.response?.data?.message || "You already have an active queue token."
        );
        await fetchTokenHistory();
        return;
      }
      setTokenErrorMessage(error.response?.data?.message || "Unable to issue OPD token.");
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const showReservationQr = async (reservationId) => {
    setTokenErrorMessage("");
    try {
      if (reservationQr?.reservationId === reservationId) {
        setReservationQr(null);
        return;
      }
      const { data } = await api.get(`/patients/me/reservations/${reservationId}/check-in-qr`);
      setReservationQr({ reservationId, token: data.checkInToken });
    } catch (error) {
      setTokenErrorMessage(error.response?.data?.message || "Unable to generate check-in QR.");
    }
  };

  const cancelQueueReservation = async (reservationId) => {
    if (!window.confirm(localizeUi("Cancel this online queue reservation?"))) return;
    setReservationActionId(reservationId);
    setTokenErrorMessage("");
    try {
      const { data } = await api.patch(`/patients/me/reservations/${reservationId}/cancel`);
      setTokenSuccessMessage(data.message || "Reservation cancelled.");
      setReservationQr(null);
      await fetchTokenHistory();
    } catch (error) {
      setTokenErrorMessage(error.response?.data?.message || "Unable to cancel reservation.");
    } finally {
      setReservationActionId("");
    }
  };

  const handlePatientSignOut = () => {
    logoutPatient();
    navigate("/patient-login", { replace: true });
  };


  const handleSendChatMessage = async (event) => {
    event.preventDefault();
    const cleanMessage = chatMessageInput.trim();
    if (!cleanMessage) return;

    setChatErrorMessage("");
    setIsChatThinking(true);
    setAiChatMessages((prev) => [...prev, { role: "user", text: cleanMessage }]);
    setChatMessageInput("");

    try {
      const { data } = await api.post("/ai/chat", { message: cleanMessage, allowExternalAI: await getExternalAiConsent() });
      setAiChatMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: data.reply || "No response received from assistant.",
          token: data.token || null,
          doctors: data.doctors || [],
          department: data.department || null,
          externalAIContacted: data.externalAIContacted === true,
          source: data.source || "built-in",
        },
      ]);
      if (["token_booked", "reservation_created"].includes(data.action)) {
        await fetchTokenHistory();
      }
    } catch (error) {
      console.error("AI assistant error:", error);
      setChatErrorMessage(
        error.response?.data?.message || "AI triage assistant is temporarily unavailable."
      );
    } finally {
      setIsChatThinking(false);
    }
  };

  if (isDashboardLoading) {
    return (
      <main className="page premium-page">
        <section className="card center">
          <RefreshCw className="animate-spin" size={24} style={{ margin: "auto auto 12px" }} />
          <h2><Trans text={"Syncing Patient Dashboard..."} /></h2>
        </section>
      </main>
    );
  }

  if (!activePatient) {
    return <Navigate to="/patient-login" replace />;
  }

  const patientAge = calculatePatientAge(activePatient.dateOfBirth);
  const normalizedAllergies = normalizeToArray(activePatient.allergies);
  const normalizedHistory = normalizeToArray(activePatient.medicalHistory);
  const normalizedMedications = normalizeToArray(activePatient.currentMedications);

  const upcomingAppointment = patientAppointments
    .filter((appointment) => ["booked", "checked_in"].includes(appointment.status))
    .sort((a, b) => `${a.appointmentDate} ${a.startTime}`.localeCompare(`${b.appointmentDate} ${b.startTime}`))[0] || null;

  const latestConsultation = consultationHistoryList[0] || null;
  const pendingLabReferrals = consultationHistoryList.filter(
    (consultation) => consultation.labReferral?.enabled && consultation.labReferral?.status !== "completed"
  ).length;

  const formatPatientClock = (value) => {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) return value || "—";
    const [hours, minutes] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  const formatPatientDate = (value) => {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const openPatientWorkspace = (tab, sectionId) => {
    setPatientWorkspaceTab(tab);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <main className={`page premium-page patient-workspace patient-workspace-${patientWorkspaceTab}`}>
      {/* PATIENT HEADER */}
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Patient Medical Portal"} /></p>
          <h1><Trans text={"Welcome, "} />{activePatient.name}</h1>
          <p className="page-subtitle">
            <strong>{patientClinicContext?.settings?.displayName || patientClinicContext?.name || getActiveClinicSlug()}</strong> <Trans text={"· Patient ID "} /><strong>{activePatient.patientId}</strong>
          </p>
        </div>

        <div className="dashboard-actions">
          <div className="notification-bell-wrap">
            <button
              type="button"
              className="ghost notification-bell-button patient-head-action patient-head-notifications"
              onClick={handleNotificationBell}
              aria-label={t("Open notifications")}
            >
              <Bell size={16} />
              <Trans text={"Notifications"} />{notificationUnreadCount > 0 && (
                <span className="notification-badge">
                  {notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}
                </span>
              )}
            </button>
          </div>
          {(patientActiveToken || activeQueueReservation) && (
            <button
              type="button"
              className="ghost patient-head-action patient-head-lounge"
              onClick={() => navigate("/patient/lounge")}
            >
              <Monitor size={15} /> <Trans text={"Waiting Lounge"} /></button>
          )}
          <button
            type="button"
            className="ghost patient-head-action patient-head-switch"
            onClick={() => navigate("/patient/clinics")}
          >
            <HeartPulse size={15} /> <Trans text={"Switch Clinic"} /></button>
          <button
            type="button"
            className="ghost patient-head-action patient-head-profile"
            onClick={() => {
              sessionStorage.setItem("opd_patient_return_to", "/patient");
              navigate("/patient/profile");
            }}
          >
            <UserRound size={15} /> <Trans text={"Edit Health Profile"} /></button>
          <button type="button" className="ghost patient-head-action patient-head-signout" onClick={handlePatientSignOut}>
            <LogOut size={15} /> <Trans text={"Sign Out"} /></button>
        </div>
      </div>

      <PatientReferrals />

      <section className="patient-command-tabs" aria-label={t("Patient workspace sections")}>
        <button type="button" className={patientWorkspaceTab === "overview" ? "active" : ""} onClick={() => openPatientWorkspace("overview", "patient-overview")}>
          <Activity size={20} />
          <span><b><Trans text={"Overview"} /></b><small><Trans text={"Live visit & queue"} /></small></span>
        </button>
        <button type="button" className={patientWorkspaceTab === "appointments" ? "active" : ""} onClick={() => openPatientWorkspace("appointments", "patient-appointments")}>
          <Calendar size={20} />
          <span><b><Trans text={"Appointments"} /></b><small><Trans text={"Booking & check-in"} /></small></span>
        </button>
        <button type="button" className={patientWorkspaceTab === "records" ? "active" : ""} onClick={() => openPatientWorkspace("records", "patient-visit-history")}>
          <FileText size={20} />
          <span><b><Trans text={"Health Records"} /></b><small><Trans text={"OPD history & prescriptions"} /></small></span>
        </button>
        <button type="button" className={patientWorkspaceTab === "care" ? "active" : ""} onClick={() => openPatientWorkspace("care", "patient-care-assistant")}>
          <Sparkles size={20} />
          <span><b><Trans text={"Care Assistant"} /></b><small><Trans text={"AI guide, labs & feedback"} /></small></span>
        </button>
      </section>

      <section className="patient-premium-snapshot" id="patient-overview">
        <div className="patient-snapshot-copy">
          <p className="eyebrow"><Trans text={"My Care Command Center"} /></p>
          <h2>{t(patientActiveToken?.status === "called" ? "Your turn is ready" : patientActiveToken ? "Your live visit is on track" : activeQueueReservation ? "Reservation confirmed — check in on arrival" : "Ready for your next OPD visit")}</h2>
          <p>{t(patientActiveToken ? "Your live queue position and expected consultation timing." : "Your next OPD visit, appointments and clinical records in one place.")}</p>
          <div className="patient-snapshot-actions">
            {!patientActiveToken && !activeQueueReservation && (
              <button type="button" className="primary" onClick={() => openPatientWorkspace("overview", "patient-booking")}>
                <Ticket size={15} /> <Trans text={"Reserve OPD Visit"} /></button>
            )}
          </div>
        </div>

        <div className={`patient-snapshot-grid ${patientActiveToken ? "has-live-token" : ""}`}>
          {patientActiveToken ? (
            <article className="patient-live-summary-card">
              <div className="patient-live-summary-top">
                <span><Trans text={"Live Consultation"} /></span>
                <b className={`patient-live-state ${patientActiveToken.status === "called" ? "called" : "waiting"}`}>
                  {t(patientActiveToken.status === "called" ? "Your turn" : livePatientsAhead === 0 ? "You're next" : "Waiting")}
                </b>
              </div>
              <strong className="patient-live-token-number"><Trans text={"Token #"} />{patientActiveToken.tokenNumber}</strong>
              <p>{activeAssignedDoctor ? `${t("Dr. ")}${activeAssignedDoctor.name}` : t("Assigned doctor")} · {t(patientActiveToken.department)}</p>
              <div className="patient-live-metrics">
                <div><span><Trans text={"Patients ahead"} /></span><b>{patientActiveToken.status === "called" ? 0 : livePatientsAhead}</b></div>
                <div><span><Trans text={"Estimated wait"} /></span><b>{dynamicEtaLabel}</b></div>
                <div><span><Trans text={"Now serving"} /></span><b>{currentlyServingToken ? `#${currentlyServingToken.tokenNumber}` : "—"}</b></div>
              </div>
              <div className="patient-live-summary-actions">
                <button type="button" className="primary" onClick={() => navigate("/patient/lounge")}><Monitor size={15}/> <Trans text={"Waiting Lounge"} /></button>
              </div>
            </article>
          ) : (
            <article>
              <span><Trans text={"Queue Status"} /></span>
              <strong>{t(activeQueueReservation ? "Reserved" : "No Active Visit")}</strong>
              <small>{t(activeQueueReservation ? "Token at physical check-in" : "Reserve when you are ready")}</small>
            </article>
          )}
          <article>
            <span><Trans text={"Next Appointment"} /></span>
            <strong>{upcomingAppointment ? formatPatientDate(upcomingAppointment.appointmentDate) : t("None")}</strong>
            <small>{upcomingAppointment ? `${formatPatientClock(upcomingAppointment.startTime)} · ${t("Dr. ")}${upcomingAppointment.doctorName}` : t("No upcoming booking")}</small>
          </article>
          <article>
            <span><Trans text={"Clinical Records"} /></span>
            <strong>{consultationHistoryList.length}</strong>
            <small>{latestConsultation ? `${t("Latest:")} ${t(latestConsultation.department || latestConsultation.token?.department || "OPD")}` : t("No completed consultation yet")}</small>
          </article>
          <article>
            <span><Trans text={"Pending Lab Work"} /></span>
            <strong>{pendingLabReferrals}</strong>
            <small>{t(pendingLabReferrals ? "Doctor-referred investigations pending" : "No pending referral")}</small>
          </article>
        </div>
      </section>

      {liveNotificationToast && (
        <div className="patient-notification-toast" role="status">
          <Bell size={18} />
          <div>
            <strong>{liveNotificationToast.title}</strong>
            <p>{liveNotificationToast.message}</p>
          </div>
        </div>
      )}

      {notificationPanelOpen && (
        <section className="card patient-notification-center">
          <div className="notification-center-head">
            <div>
              <p className="eyebrow"><Trans text={"Live Patient Alerts"} /></p>
              <h2><Bell size={18} /> <Trans text={"Notifications"} /></h2>
            </div>
            <button
              type="button"
              className="small"
              onClick={markAllNotificationsRead}
            >
              <CheckCircle size={14} /> <Trans text={"Mark all read"} /></button>
          </div>

          <div className="followup-notification-filters" role="group" aria-label={t("Notification filter")}>
            <button type="button" className={notificationFilter === "all" ? "active" : ""}
              onClick={() => setNotificationFilter("all")}>{t("All notifications")}</button>
            <button type="button" className={notificationFilter === "followups" ? "active" : ""}
              onClick={() => setNotificationFilter("followups")}>{t("Follow-up reminders")}</button>
          </div>
          <div className="notification-list">
            {patientNotifications.filter((item) => notificationFilter === "all" || isFollowUpNotification(item)).length === 0 ? (
              <p className="muted">{t(notificationFilter === "followups" ? "No follow-up reminders yet." : "No notifications yet. Appointment and queue updates will appear here.")}</p>
            ) : (
              patientNotifications.filter((item) => notificationFilter === "all" || isFollowUpNotification(item)).map((item) => {
                const display = followUpNotificationText(item, language);
                return (
                  <div className={`notification-item ${item.readAt ? "" : "unread"}`}
                    key={item._id}>
                    <div className="notification-item-icon"><Bell size={15} /></div>
                    <div className="followup-notification-content">
                      <strong>{display.title}</strong>
                      <p className="followup-notification-message">{display.message}</p>
                      <small>{item.createdAt ? new Date(item.createdAt).toLocaleString(language === "hi" ? "hi-IN" : "en-IN") : t("Just now")}</small>
                      {isFollowUpNotification(item) && item.metadata?.consultationId && (
                        <div className="followup-notification-actions">
                          <button type="button" className="small ghost" disabled={followUpBookingBusy}
                            onClick={() => prepareFollowUpBooking(item)}>
                            <Calendar size={14} /> {t("Book / View follow-up")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      <div className={`patient-dashboard-main-grid patient-dashboard-tab-${patientWorkspaceTab}`}>
        <div className="patient-dashboard-primary-column">
      {/* ACTIVE TOKEN HERO OR TOKEN BOOKING CARD */}
      {patientActiveToken ? (
        <section id="patient-booking" className={`live patient-live-detail-card ${patientActiveToken.status === "called" ? "called" : ""}`}>
          <div className="livehead">
            <div>
              <p className="eyebrow"><Trans text={"Active Consultation Token"} /></p>
              <div className="token">#{patientActiveToken.tokenNumber}</div>
            </div>
            <div className="status">
              {t(patientActiveToken.status === "called" ? "🔔 Now Serving Your Turn" : "⏳ In Active Queue")}
            </div>
            {patientActiveToken.urgency === "emergency" && (
              <div className="doctor-emergency-badge" style={{ margin: "8px 0 0" }}><Trans text={"🚨 EMERGENCY"} /></div>
            )}
          </div>

          <div className="livegrid">
            <div>
              <span><Trans text={"Clinical Specialty"} /></span>
              <b>{t(patientActiveToken.department)}</b>
            </div>
            <div>
              <span><Trans text={"Assigned Specialist"} /></span>
              <b>{activeAssignedDoctor ? `Dr. ${activeAssignedDoctor.name}` : t("Assigned Doctor")}</b>
            </div>
            <div>
              <span><Trans text={"Current Token in Room"} /></span>
              <b>{currentlyServingToken ? `#${currentlyServingToken.tokenNumber}` : "—"}</b>
            </div>
            <div>
              <span><Trans text={"Patients Ahead"} /></span>
              <b>{patientActiveToken.status === "called" ? 0 : livePatientsAhead}</b>
            </div>
            <div>
              <span><Trans text={"Estimated Wait Time"} /></span>
              <b>
                {dynamicEtaLabel}
              </b>
            </div>
          </div>

          <p className="livefoot">
            <span />
            <Trans text={"Live WebSocket sync active · "} />{patientEta?.isDynamic
            ? t("{scope} recent {count} consultations average {minutes} min/patient", {
                scope: t(patientEta.source === "doctor_recent" ? "Doctor-specific" : "Department"),
                count: patientEta.sampleSize,
                minutes: patientEta.averageMinutes,
              })
              : `Learning doctor pace ${patientEta?.doctorSampleSize ?? 0}/${patientEta?.minimumDynamicSamples ?? 5} · temporary ${patientEta?.averageMinutes ?? 7} min baseline`}
          </p>
        </section>
      ) : activeQueueReservation ? (
        <section id="patient-booking" className="card token-booking-card queue-reservation-card">
          <div className="card-title">
            <ShieldCheck />
            <h2><Trans text={"Online Reservation Confirmed"} /></h2>
          </div>
          <p className="muted">
            <Trans text={"This is a reservation only — it does not hold a queue number. Your final FCFS token is created when hospital staff confirms your physical arrival."} /></p>
          <div className="patient-token-identity">
            <div><span><Trans text={"Department"} /></span><strong>{t(activeQueueReservation.department)}</strong></div>
            <div><span><Trans text={"Specialist"} /></span><strong><Trans text={"Dr. "} />{activeQueueReservation.doctorName}</strong></div>
            <div><span><Trans text={"Reservation Date"} /></span><strong>{activeQueueReservation.reservationDate}</strong></div>
            <div><span><Trans text={"Queue Position"} /></span><strong><Trans text={"Assigned at Check-in"} /></strong></div>
            <div><span><Trans text={"Priority"} /></span><strong>{t(activeQueueReservation.urgency === "emergency" ? "🚨 Emergency" : "Normal")}</strong></div>
          </div>
          <div className="queue-reservation-notice">
            <Clock3 size={18} />
            <div>
              <strong><Trans text={"First-come, first-served remains fair"} /></strong>
              <p><Trans text={"When you arrive, show the QR below or ask reception to check you in. Your token number is generated at that moment, alongside walk-in patients."} /></p>
            </div>
          </div>
          <div className="dashboard-actions" style={{ marginTop: "14px" }}>
            <button type="button" className="primary" onClick={() => showReservationQr(activeQueueReservation._id)}>
              <QrCode size={16} /> {t(reservationQr?.reservationId === activeQueueReservation._id ? "Hide Check-in QR" : "Show Check-in QR")}
            </button>
            <button type="button" className="ghost" disabled={reservationActionId === activeQueueReservation._id} onClick={() => cancelQueueReservation(activeQueueReservation._id)}>
              {t(reservationActionId === activeQueueReservation._id ? "Cancelling..." : "Cancel Reservation")}
            </button>
          </div>
          {reservationQr?.reservationId === activeQueueReservation._id && (
            <div className="appointment-qr-panel" style={{ marginTop: "16px" }}>
              <div className="appointment-qr-code">
                <QRCodeSVG value={reservationQr.token} size={190} level="M" includeMargin aria-label={t("Online queue reservation check-in QR")} />
              </div>
              <div>
                <p className="eyebrow"><Trans text={"Arrival Check-in"} /></p>
                <h3><Trans text={"Show this QR at Reception"} /></h3>
                <p className="muted"><Trans text={"Scanning it confirms that you have reached the hospital and then creates your live FCFS token."} /></p>
              </div>
            </div>
          )}
          {tokenErrorMessage && <div className="login-error" role="alert">{t(tokenErrorMessage)}</div>}
          {tokenSuccessMessage && <p className="success">{t(tokenSuccessMessage)}</p>}
        </section>
      ) : (
        <section id="patient-booking" className="card token-booking-card">
          <div className="card-title">
            <Ticket />
            <h2><Trans text={"Reserve Today's OPD Visit"} /></h2>
          </div>

          <p className="muted">
            <Trans text={"Reserve your doctor online without jumping ahead of walk-in patients. Your final queue token and position are assigned only when you physically check in at the hospital."} /></p>

          <div className="patient-token-identity">
            <div>
              <span><Trans text={"Patient Name"} /></span>
              <strong>{activePatient.name}</strong>
            </div>
            <div>
              <span><Trans text={"Mobile Contact"} /></span>
              <strong>{activePatient.phone || "Not recorded"}</strong>
            </div>
            <div>
              <span><Trans text={"Digital Health ID"} /></span>
              <strong>{activePatient.patientId}</strong>
            </div>
          </div>

          <label>
            <Trans text={"Select Clinical Department"} /><select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setSelectedDoctorId("");
                setReservationFeeQuote(null);
                setReservationFeeState("idle");
              }}
            >
              {clinicDepartments.map((department) => {
                const known = CLINICAL_DEPARTMENTS.find((item) => item.value === department);
                return <option key={department} value={department}>{t(known?.label) || department}</option>;
              })}
            </select>
          </label>

          <label>
            <Trans text={"Choose Specialist"} /><select
              value={selectedDoctorId}
              onChange={(e) => { const doctorId=e.target.value; setSelectedDoctorId(doctorId); loadPatientFeeQuote(doctorId,"reservation",setReservationFeeQuote,selectedUrgency,reservationConsultationKind); }}
            >
              <option value="">{t("Select a ")}{selectedDepartment} {t("doctor")}</option>
              {patientDoctors
                .filter((doctor) => doctor.department === selectedDepartment)
                .map((doctor) => (
                  <option key={doctor._id} value={doctor._id}>
                    {doctorOptionText(doctor)}
                  </option>
                ))}
            </select>
          </label>

          <DoctorRating doctor={patientDoctors.find((doctor) => String(doctor._id) === String(selectedDoctorId))} />
          {selectedDoctorId && <div className="patient-visit-type-card">
            <span><Trans text={"Visit Type"} /></span>
            <div className="patient-visit-type-options">
              <button type="button" className={reservationConsultationKind === "normal" ? "active" : ""} onClick={() => { setReservationConsultationKind("normal"); loadPatientFeeQuote(selectedDoctorId,"reservation",setReservationFeeQuote,selectedUrgency,"normal"); }}><Trans text={"Normal Consultation"} /></button>
              <button type="button" className={reservationConsultationKind === "follow_up" ? "active" : ""} onClick={() => { setReservationConsultationKind("follow_up"); loadPatientFeeQuote(selectedDoctorId,"reservation",setReservationFeeQuote,selectedUrgency,"follow_up"); }}><Trans text={"Follow-up Consultation"} /></button>
            </div>
          </div>}

          {selectedDoctorId && <div className={`patient-fee-quote fee-quote-${reservationFeeState}`}><IndianRupee size={17}/><div><span><Trans text={"Pay at reception during check-in"} /></span>{reservationFeeState === "loading" ? <strong><Trans text={"Loading fee..."} /></strong> : reservationFeeState === "error" ? <strong><Trans text={"Fee unavailable"} /></strong> : reservationFeeState === "ready" ? <strong>{reservationFeeQuote?.amount === 0 ? t("₹0 · Free") : formatInr(reservationFeeQuote?.amount)}</strong> : <strong>—</strong>}<small>{reservationFeeState === "error" ? t(reservationFeeQuote?.errorMessage || "Unable to load the configured doctor fee. Retry before booking.") : reservationFeeQuote?.feeType === "follow_up" ? t("Last visit {lastVisit} · Doctor advised {followUp} · Valid {start} to {end}", { lastVisit: reservationFeeQuote.lastConsultationDate || "—", followUp: reservationFeeQuote.advisedFollowUpDate || "—", start: reservationFeeQuote.followUpWindowStart || "—", end: reservationFeeQuote.followUpWindowEnd || "—" }) : t(reservationFeeState === "ready" ? "Final FCFS token is issued after payment confirmation and arrival." : "Fetching the latest fee configured by the clinic.")}</small>{reservationFeeState === "error" && <button type="button" className="fee-retry-button" onClick={() => loadPatientFeeQuote(selectedDoctorId,"reservation",setReservationFeeQuote,selectedUrgency,reservationConsultationKind)}><RefreshCw size={13}/> <Trans text={"Retry Fee"} /></button>}</div></div>}

          {patientDoctors.filter((doctor) => doctor.department === selectedDepartment).length === 0 && (
            <div className="login-error" role="alert">
              <Trans text={"No "} />{selectedDepartment} <Trans text={"specialist is currently registered."} /></div>
          )}

          <label>
            <Trans text={"Visit Priority"} /><select value={selectedUrgency} onChange={(e) => { const urgency=e.target.value; setSelectedUrgency(urgency); if(selectedDoctorId) loadPatientFeeQuote(selectedDoctorId,"reservation",setReservationFeeQuote,urgency,reservationConsultationKind); }}>
              <option value="normal">{t("Normal OPD Visit")}</option>
              <option value="emergency">{t("🚨 Emergency Case")}</option>
            </select>
          </label>
          {selectedUrgency === "emergency" && (
            <div className="ai-triage-emergency-action" style={{ marginTop: "8px" }}>
              <ShieldAlert size={17} />
              <span><Trans text={"Emergency cases are visibly flagged for the assigned doctor. For life-threatening symptoms, seek immediate emergency medical care."} /></span>
            </div>
          )}

          {tokenErrorMessage && <div className="login-error" role="alert">{t(tokenErrorMessage)}</div>}
          {tokenSuccessMessage && <p className="success">{t(tokenSuccessMessage)}</p>}

          <button
            type="button"
            className="primary"
            disabled={
              isGeneratingToken ||
              !selectedDoctorId ||
              reservationFeeState !== "ready" ||
              patientDoctors.filter((doctor) => doctor.department === selectedDepartment).length === 0
            }
            onClick={handleGenerateNewToken}
            style={{ marginTop: "8px" }}
          >
            <Ticket size={16} />
            {t(isGeneratingToken ? "Creating Reservation..." : "Reserve OPD Visit")}
          </button>
        </section>
      )}


      <section id="patient-appointments" className="card appointment-booking-card patient-premium-section">
        <div className="card-title"><Calendar /><h2>{t(rescheduleTarget ? "Reschedule Appointment" : "Book Scheduled Appointment")}</h2></div>
        <p className="muted"><Trans text={"Choose a department and specialist. Only working dates and free slots from the doctor's admin schedule are shown."} /></p>
        <form className="appointment-form" onSubmit={handleBookAppointment}>
          <label><Trans text={"Department"} /><select value={appointmentForm.department} onChange={async (e)=>{
              const department=e.target.value;
              setAppointmentForm({department,doctorId:"",appointmentDate:"",startTime:"",reason:"",followUpConsultationId:""});
              setAppointmentConsultationKind("normal");
              setAppointmentDates([]); setAppointmentSlots([]); setAppointmentError(""); setAppointmentFeeQuote(null); setAppointmentFeeState("idle");
              await fetchAppointmentDoctors(department);
            }}>
              {clinicDepartments.map((department) => { const known = CLINICAL_DEPARTMENTS.find((item) => item.value === department); return <option key={department} value={department}>{t(known?.label) || department}</option>; })}
            </select>
          </label>
          <label><Trans text={"Doctor"} /><select value={appointmentForm.doctorId} onChange={async(e)=>{
              const doctorId=e.target.value;
              setAppointmentForm(prev=>({...prev,doctorId,appointmentDate:"",startTime:"",followUpConsultationId: prev.doctorId === doctorId ? prev.followUpConsultationId : ""}));
              setAppointmentError(""); await loadAppointmentDates(doctorId); await loadPatientFeeQuote(doctorId,"appointment",setAppointmentFeeQuote,"normal",appointmentConsultationKind);
            }}>
              <option value="">{t("Select specialist")}</option>
              {appointmentDoctors.map(d=><option key={d._id} value={d._id}>{doctorOptionText(d)}</option>)}
            </select>
          </label>
          <DoctorRating doctor={appointmentDoctors.find((doctor) => String(doctor._id) === String(appointmentForm.doctorId))} />
          {appointmentForm.doctorId && !rescheduleTarget && <div className="patient-visit-type-card appointment-visit-type-card">
            <span><Trans text={"Visit Type"} /></span>
            <div className="patient-visit-type-options">
              <button type="button" className={appointmentConsultationKind === "normal" ? "active" : ""} onClick={() => { setAppointmentConsultationKind("normal"); setAppointmentForm(prev=>({...prev,followUpConsultationId:""})); loadPatientFeeQuote(appointmentForm.doctorId,"appointment",setAppointmentFeeQuote,"normal","normal",appointmentForm.appointmentDate); }}><Trans text={"Normal Consultation"} /></button>
              <button type="button" className={appointmentConsultationKind === "follow_up" ? "active" : ""} onClick={() => { setAppointmentConsultationKind("follow_up"); loadPatientFeeQuote(appointmentForm.doctorId,"appointment",setAppointmentFeeQuote,"normal","follow_up",appointmentForm.appointmentDate); }}><Trans text={"Follow-up Consultation"} /></button>
            </div>
          </div>}
          <label><Trans text={"Available Date"} /><select disabled={!appointmentForm.doctorId} value={appointmentForm.appointmentDate} onChange={async(e)=>{
              const appointmentDate=e.target.value;
              setAppointmentForm(prev=>({...prev,appointmentDate,startTime:""}));
              await loadAppointmentSlots(appointmentForm.doctorId,appointmentDate);
              await loadPatientFeeQuote(appointmentForm.doctorId,"appointment",setAppointmentFeeQuote,"normal",appointmentConsultationKind,appointmentDate);
            }}>
              <option value="">{t("Select available date")}</option>
              {appointmentDates.map(d=><option key={d.date} value={d.date}>{d.weekday} · {d.date} · {d.startTime}-{d.endTime}</option>)}
            </select>
          </label>
          <label><Trans text={"Available Time"} /><select disabled={!appointmentForm.appointmentDate} value={appointmentForm.startTime} onChange={e=>setAppointmentForm(prev=>({...prev,startTime:e.target.value}))}>
              <option value="">{t("Select free time slot")}</option>
              {appointmentSlots.map(s=><option key={s.startTime} value={s.startTime}>{t(s.label)}</option>)}
            </select>
          </label>
          {appointmentForm.doctorId && <div className={`patient-fee-quote appointment-fee-quote fee-quote-${appointmentFeeState}`}><IndianRupee size={17}/><div><span><Trans text={"Consultation fee payable at reception"} /></span>{appointmentFeeState === "loading" ? <strong><Trans text={"Loading fee..."} /></strong> : appointmentFeeState === "error" ? <strong><Trans text={"Fee unavailable"} /></strong> : appointmentFeeState === "ready" ? <strong>{appointmentFeeQuote?.amount === 0 ? t("₹0 · Free") : formatInr(appointmentFeeQuote?.amount)}</strong> : <strong>—</strong>}<small>{appointmentFeeState === "error" ? t(appointmentFeeQuote?.errorMessage || "Unable to load the configured doctor fee. Retry before booking.") : appointmentFeeQuote?.feeType === "follow_up" ? t("Last visit {lastVisit} · Doctor advised {followUp} · Valid {start} to {end}", { lastVisit: appointmentFeeQuote.lastConsultationDate || "—", followUp: appointmentFeeQuote.advisedFollowUpDate || "—", start: appointmentFeeQuote.followUpWindowStart || "—", end: appointmentFeeQuote.followUpWindowEnd || "—" }) : t(appointmentFeeState === "ready" ? "Booking reserves the slot; payment is collected on clinic arrival." : "Fetching the latest fee configured by the clinic.")}</small>{appointmentFeeState === "error" && <button type="button" className="fee-retry-button" onClick={() => loadPatientFeeQuote(appointmentForm.doctorId,"appointment",setAppointmentFeeQuote,"normal",appointmentConsultationKind,appointmentForm.appointmentDate)}><RefreshCw size={13}/> <Trans text={"Retry Fee"} /></button>}</div></div>}
          <label className="appointment-reason"><Trans text={"Reason / symptoms (optional)"} /><input value={appointmentForm.reason} onChange={e=>setAppointmentForm(prev=>({...prev,reason:e.target.value}))} placeholder={t("Brief reason for visit")} />
          </label>
          {appointmentError && <div className="login-error" role="alert">{t(appointmentError)}</div>}
          {appointmentMessage && <p className="success">{t(appointmentMessage)}</p>}
          <button className="primary" disabled={isBookingAppointment || !appointmentForm.startTime || appointmentFeeState !== "ready"}>
            <Calendar size={16}/>{t(isBookingAppointment ? (rescheduleTarget ? "Rescheduling..." : "Booking...") : (rescheduleTarget ? "Confirm New Slot" : "Confirm Appointment"))}
          </button>
        </form>
      </section>

        </div>

        <aside className="patient-dashboard-ai-column">
          {/* =====================================================
              UNIFIED AI HOSPITAL GUIDE & TRIAGE
          ====================================================== */}
          <section id="patient-care-assistant" className="card ai-triage-card patient-premium-section">
            <div className="card-title ai-triage-title">
              <div className="ai-triage-icon"><Sparkles size={18} /></div>
              <div>
                    <h2><Trans text={"AI Hospital Guide & Triage"} /></h2>
                    <p><Trans text={"One assistant for symptoms, department routing, token booking, live queue and waiting-time questions."} /></p>
              </div>
              <span className="ai-triage-badge"><Trans text={"LIVE + PATIENT AWARE"} /></span>
            </div>

            <div className="ai-chat-messages">
              {aiChatMessages.length === 0 && (
                    <div className="ai-welcome">
                      <Bot size={32} style={{ color: "var(--primary)", margin: "0 auto 8px" }} />
                      <p><Trans text={"Hi "} />{activePatient.name}<Trans text={"! I can book your token directly and answer questions about "} /><strong><Trans text={"your own department queue"} /></strong>.</p>
                      <div className="ai-suggestions">
                        <button type="button" onClick={() => setChatMessageInput("I have a sore throat and fever. Book an ENT token for me.")}><Trans text={"Book ENT from symptoms"} /></button>
                        <button type="button" onClick={() => setChatMessageInput("Mujhe skin par itching hai, dermatologist ko dikhana hai. Token book karo.")}><Trans text={"Hindi symptom booking"} /></button>
                        <button type="button" onClick={() => setChatMessageInput("What is the next token in my department?")}><Trans text={"My next token?"} /></button>
                        <button type="button" onClick={() => setChatMessageInput("Mera number kab tak aayega?")}><Trans text={"Mera number kab aayega?"} /></button>
                      </div>
                    </div>
              )}

              {aiChatMessages.map((messageItem, index) => (
                    <div key={index} className={messageItem.role === "user" ? "ai-message user-message" : "ai-message assistant-message"}>
                      <strong>{messageItem.role === "user" ? "You" : t("Hospital AI Assistant")}</strong>
                      <p>{messageItem.text}</p>
                      {messageItem.role === "ai" && <small className="ai-source-label"><Trans text={messageItem.externalAIContacted ? "External AI contacted" : "Built-in help · no external AI contacted"} /></small>}
                      {messageItem.token && (
                        <small>
                              <Trans text={"Token #"} />{messageItem.token.tokenNumber} · {t(messageItem.token.department)} · {messageItem.token.urgency === "emergency" ? t("🚨 EMERGENCY") : t("Normal")}
                        </small>
                      )}
                      {messageItem.doctors?.length > 0 && (
                        <div className="ai-doctor-choice-list">
                          {messageItem.doctors.map((doctor) => (
                            <button
                              key={doctor._id}
                              type="button"
                              className="ghost"
                              onClick={() =>
                                setChatMessageInput(
                                  `Book ${messageItem.department} token with Dr. ${doctor.name}`
                                )
                              }
                            >
                              <Stethoscope size={14} /> <Trans text={"Dr. "} />{doctor.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
              ))}

              {isChatThinking && (
                    <div className="ai-message assistant-message">
                      <strong><Trans text={"Hospital AI Assistant"} /></strong>
                      <p><Trans text={"Checking your personal queue..."} /></p>
                    </div>
              )}
            </div>

            {chatErrorMessage && <div className="login-error" role="alert">{chatErrorMessage}</div>}

            <form className="ai-chat-form" onSubmit={handleSendChatMessage}>
              <input
                    type="text"
                    value={chatMessageInput}
                    onChange={(e) => setChatMessageInput(e.target.value)}
                    placeholder={t("Ask in English or Hindi: 'Book ENT token', 'next token?', 'mera number kab aayega?'")}
              />
              <button type="submit" className="primary" disabled={isChatThinking || !chatMessageInput.trim()}>
                    <Send size={15} />
              </button>
            </form>
          </section>

        </aside>
      </div>

      <details id="patient-my-appointments" className="card patient-dashboard-section patient-feedback-dropdown patient-my-appointments">
        <summary className="patient-feedback-dropdown-header"><div className="card-title"><Calendar/><h2><Trans text={"My Appointments"} /><small className="patient-section-count">{patientAppointments.length}</small></h2></div><span className="feedback-dropdown-arrow" aria-hidden="true">⌄</span></summary>
        <div className="patient-feedback-dropdown-content">
        <div className="appointment-list">
          {patientAppointments.slice(0,5).map(a=>(
            <div className="patient-appointment-wrap" key={a._id}>
              <div className="appointment-row">
                <div>
                  <strong>{formatPatientDate(a.appointmentDate)} · {formatPatientClock(a.startTime)}</strong>
                  <small>{t(a.department)} <Trans text={"· Dr. "} />{a.doctorName}</small>
                  {a.cancellationReason && <small><Trans text={"Reason: "} />{a.cancellationReason}</small>}
                  {a.rescheduleCount > 0 && <small><Trans text={"Rescheduled "} />{a.rescheduleCount} <Trans text={"time(s)"} /></small>}
                </div>
                <span className={`appointment-status ${a.status}`}>{a.status.replace("_"," ")}</span>
                {a.status === "booked" && (
                  <button
                    type="button"
                    className="small appointment-qr-button"
                    onClick={() => toggleAppointmentQr(a)}
                  >
                    <QrCode size={14} />
                    {t(appointmentQr?.appointmentId === a._id ? "Hide QR" : "Check-in QR")}
                  </button>
                )}
                {a.status === "booked" && (
                  <button type="button" className="small" onClick={() => prepareAppointmentReschedule(a)}><Trans text={"Reschedule"} /></button>
                )}
                {["completed","skipped","missed","cancelled"].includes(a.status) && (
                  <button type="button" className="small" onClick={() => prepareRepeatBooking(a)}><Trans text={"Book Again"} /></button>
                )}
                {a.status === "booked" && (
                  <button
                    type="button"
                    className="small appointment-cancel-button"
                    disabled={cancellingAppointmentId === a._id}
                    onClick={() => handleCancelAppointment(a)}
                  >
                    {cancellingAppointmentId === a._id
                      ? t("Cancelling...")
                      : t("Cancel Appointment")}
                  </button>
                )}
              </div>

              {appointmentQr?.appointmentId === a._id && (
                <div className="appointment-qr-panel">
                  <div className="appointment-qr-code">
                    <QRCodeSVG
                      value={appointmentQr.token}
                      size={190}
                      level="M"
                      includeMargin
                      aria-label={t("Appointment check-in QR code")}
                    />
                  </div>
                  <div>
                    <p className="eyebrow"><Trans text={"Secure Appointment Check-in"} /></p>
                    <h3><Trans text={"Show this QR at Reception"} /></h3>
                    <p className="muted">
                      <Trans text={"Reception scans this code when you arrive. It is valid only for this appointment and creates your live OPD token without re-entering your details."} /></p>
                    <div className="qr-security-note">
                      <ShieldCheck size={16} />
                      <Trans text={"Signed appointment reference · no patient details printed in the QR"} /></div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {appointmentQrError && <div className="login-error" role="alert">{t(appointmentQrError)}</div>}
          {!patientAppointments.length && <p className="muted"><Trans text={"No scheduled appointments yet."} /></p>}
        </div>
        </div>
      </details>
      {/* PATIENT FEEDBACK */}
            {/* LAB REFERRALS */}
      <details id="patient-lab-referrals" className="card patient-dashboard-section lab-referrals-section patient-feedback-dropdown">
        <summary className="patient-feedback-dropdown-header">
          <div className="card-title">
            <FileText />
            <h2><Trans text={"Lab Referrals "} /><small className="patient-section-count">{pendingLabReferrals ? `${pendingLabReferrals} ${t("pending")}` : t("None pending")}</small></h2>
          </div>
          <span className="feedback-dropdown-arrow" aria-hidden="true">⌄</span>
        </summary>

        <div className="patient-feedback-dropdown-content">
        <p className="muted">
          <Trans text={"Laboratory tests referred by your doctor after completed consultations."} /></p>

        {labReferralMessage && <div className="feedback-message">{t(labReferralMessage)}</div>}

        {consultationHistoryList.filter(
          (consultation) =>
            consultation.labReferral?.enabled &&
            consultation.testsRecommended?.length
        ).length ? (
          <div className="lab-referral-list">
            {consultationHistoryList
              .filter(
                (consultation) =>
                  consultation.labReferral?.enabled &&
                  consultation.testsRecommended?.length
              )
              .map((consultation) => {
                const tokenItem = consultation.token || {};
                const referral = consultation.labReferral || {};
                const isCompleted = referral.status === "completed";

                return (
                  <article className="lab-referral-card" key={consultation._id}>
                    <div className="lab-referral-head">
                      <div>
                        <strong><Trans text={"Dr. "} />{consultation.doctor?.name || "Medical Officer"}</strong>
                        <span>
                          {t(consultation.department) || t(tokenItem.department) || "OPD"} <Trans text={"· Token #"} />{tokenItem.tokenNumber || "-"}
                        </span>
                      </div>
                      <div className="lab-referral-badges">
                        <span className={`lab-priority ${referral.priority || "routine"}`}>
                          {(referral.priority || "routine").toUpperCase()}
                        </span>
                        <span className={`lab-status ${isCompleted ? "completed" : "pending"}`}>
                          {t(isCompleted ? "COMPLETED" : "PENDING")}
                        </span>
                      </div>
                    </div>

                    <div className="lab-referral-meta">
                      <span>
                        <Trans text={"Referral date: "} />{new Date(referral.referralDate || consultation.createdAt).toLocaleDateString("en-IN")}
                      </span>
                      {referral.completedAt && (
                        <span><Trans text={"Completed: "} />{new Date(referral.completedAt).toLocaleString("en-IN")}</span>
                      )}
                    </div>

                    <div className="lab-test-list">
                      {consultation.testsRecommended.map((test, index) => (
                        <span key={`${consultation._id}-${test}-${index}`}>{index + 1}. {test}</span>
                      ))}
                    </div>

                    <div className="lab-referral-actions">
                      <button type="button" className="ghost" onClick={() => downloadLabReferralPdf(consultation, tokenItem, activePatient)}>
                        <Download size={15} /> <Trans text={"Download Referral PDF"} /></button>
                      <button type="button" className="ghost" onClick={() => printLabReferral(consultation, tokenItem, activePatient)}>
                        <Printer size={15} /> <Trans text={"Print Referral"} /></button>
                      {!isCompleted && (
                        <button
                          type="button"
                          className="primary"
                          disabled={labReferralUpdatingId === consultation._id}
                          onClick={() => markLabReferralCompleted(consultation)}
                        >
                          <CheckCircle size={15} />
                          {t(labReferralUpdatingId === consultation._id ? "Updating..." : "Confirm Tests Completed")}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
        ) : (
          <p className="muted"><Trans text={"No active lab referrals are available yet."} /></p>
        )}
        </div>
      </details>

<details id="patient-feedback" className="card patient-feedback-section patient-feedback-dropdown">
        <summary className="patient-feedback-dropdown-header">
          <div className="card-title">
            <HeartPulse />
            <h2><Trans text={"Rate Your Doctor "} /><small className="patient-section-count">{t(consultationHistoryList.length ? "Available after visits" : "No visits yet")}</small></h2>
          </div>

          <span className="feedback-dropdown-arrow" aria-hidden="true">
            ⌄
          </span>
        </summary>

        <div className="patient-feedback-dropdown-content">
          <p className="muted">
            <Trans text={"Share feedback after a completed consultation. One feedback entry is allowed per visit."} /></p>

          {feedbackMessage && <div className="feedback-message">{t(feedbackMessage)}</div>}

          <div className="patient-feedback-list">
            {consultationHistoryList.slice(0, 8).map((consultation) => {
              const alreadySubmitted = patientFeedbackList.find(
                (item) => String(item.consultation) === String(consultation._id)
              );
              const draft = feedbackDrafts[consultation._id] || { rating: 5, comment: "" };

              return (
                <article className="patient-feedback-card" key={consultation._id}>
                  <div className="patient-feedback-card-head">
                    <div>
                      <strong><Trans text={"Dr. "} />{consultation.doctor?.name || "Medical Officer"}</strong>
                      <span>
                        {t(consultation.department) || t(consultation.token?.department) || "OPD"} ·{" "}
                        {new Date(consultation.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>

                    {alreadySubmitted && (
                      <span className="feedback-submitted-badge">
                        <Trans text={"Submitted · "} />{alreadySubmitted.rating}/5 ★
                      </span>
                    )}
                  </div>

                  {!alreadySubmitted && (
                    <>
                      <div className="feedback-stars" aria-label={t("Doctor rating")}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            type="button"
                            key={star}
                            className={star <= Number(draft.rating || 0) ? "active" : ""}
                            onClick={() =>
                              setFeedbackDrafts((current) => ({
                                ...current,
                                [consultation._id]: {
                                  ...draft,
                                  rating: star,
                                },
                              }))
                            }
                            aria-label={`${star} star rating`}
                          >
                            ★
                          </button>
                        ))}

                        <b>{draft.rating || 0}/5</b>
                      </div>

                      <textarea
                        rows={3}
                        maxLength={1000}
                        value={draft.comment || ""}
                        placeholder={t("Tell us about your consultation experience (optional)...")}
                        onChange={(event) =>
                          setFeedbackDrafts((current) => ({
                            ...current,
                            [consultation._id]: {
                              ...draft,
                              comment: event.target.value,
                            },
                          }))
                        }
                      />

                      <button
                        type="button"
                        className="primary"
                        disabled={feedbackSubmittingId === consultation._id}
                        onClick={() => submitPatientFeedback(consultation)}
                      >
                        {feedbackSubmittingId === consultation._id
                          ? t("Submitting...")
                          : t("Submit Feedback")}
                      </button>
                    </>
                  )}

                  {alreadySubmitted?.comment && (
                    <p className="feedback-existing-comment">
                      “{alreadySubmitted.comment}”
                    </p>
                  )}
                </article>
              );
            })}

            {!isConsultationsLoading && !consultationHistoryList.length && (
              <p className="muted">
                <Trans text={"Complete a consultation to leave doctor feedback."} /></p>
            )}
          </div>
        </div>
      </details>

      {/* OPD VISIT HISTORY */}
      <details className="card patient-dashboard-section patient-feedback-dropdown" id="patient-visit-history">
        <summary className="patient-feedback-dropdown-header">
          <div className="card-title">
            <Clock3 />
            <h2><Trans text={"OPD Visit History "} /><small className="patient-section-count">{consultationHistoryList.length} <Trans text={"visits"} /></small></h2>
          </div>
          <span className="feedback-dropdown-arrow" aria-hidden="true">⌄</span>
        </summary>

        <div className="patient-feedback-dropdown-content">
        {tokenHistoryList.length === 0 ? (
          <p className="muted"><Trans text={"Your past OPD visits and token records will appear here."} /></p>
        ) : (
          <div className="patient-history-list" style={{ marginTop: "16px" }}>
            {tokenHistoryList.map((tokenItem) => (
              <button
                type="button"
                className="patient-history-row patient-history-row-button"
                key={tokenItem._id}
                onClick={() => setSelectedHistoryToken(tokenItem)}
                aria-label={`View details for token ${tokenItem.tokenNumber}`}
              >
                <div className="history-token">#{tokenItem.tokenNumber}</div>
                <div className="history-details">
                  <strong>
                    {t(tokenItem.department)} {tokenItem.urgency === "emergency" ? "· 🚨 Emergency" : "· Normal"}
                  </strong>
                  <span>{new Date(tokenItem.createdAt).toLocaleString()}</span>
                  <small><Trans text={"Click to view complete visit details"} /></small>
                </div>
                <span className={`history-status ${tokenItem.status}`}>
                  {t(formatQueueStatus(tokenItem.status))}
                </span>
              </button>
            ))}
          </div>
        )}
        </div>
      </details>


      {selectedHistoryToken && (
        <div className="history-detail-overlay" role="dialog" aria-modal="true" aria-labelledby="history-detail-title" onClick={() => setSelectedHistoryToken(null)}>
          <div className="history-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="history-detail-header">
              <div>
                <span className="eyebrow"><Trans text={"OPD VISIT DETAILS"} /></span>
                <h2 id="history-detail-title">{t(selectedHistoryToken.department)} <Trans text={"· Token #"} />{selectedHistoryToken.tokenNumber}</h2>
                <p className="muted">{new Date(selectedHistoryToken.createdAt).toLocaleString()}</p>
              </div>
              <button type="button" className="ghost history-detail-close" onClick={() => setSelectedHistoryToken(null)} aria-label={t("Close visit details")}>×</button>
            </div>

            <div className="history-detail-meta">
              <div><span><Trans text={"Visit Status"} /></span><strong>{t(formatQueueStatus(selectedHistoryToken.status))}</strong></div>
              <div><span><Trans text={"Priority"} /></span><strong>{t(selectedHistoryToken.urgency === "emergency" ? "🚨 Emergency" : "Normal")}</strong></div>
              <div><span><Trans text={"Token"} /></span><strong>#{selectedHistoryToken.tokenNumber}</strong></div>
              <div><span><Trans text={"Payment"} /></span><strong>{selectedHistoryToken.billing?.status === "paid" ? `${formatInr(selectedHistoryToken.billing?.paidAmount)} · ${String(selectedHistoryToken.billing?.method || "").toUpperCase()}` : selectedHistoryToken.billing?.status === "waived" ? "No fee due" : t(selectedHistoryToken.billing?.status) || "Not recorded"}</strong></div>
              {selectedHistoryToken.billing?.receiptNumber && <div><span><Trans text={"Receipt"} /></span><strong>{selectedHistoryToken.billing.receiptNumber}</strong></div>}
            </div>

            {(() => {
              const consultation = consultationHistoryList.find(
                (record) => String(record.token?._id || record.token) === String(selectedHistoryToken._id)
              );

              if (!consultation) {
                return (
                  <div className="history-detail-empty">
                    <FileText size={24} />
                    <strong><Trans text={"No consultation record is available for this visit yet."} /></strong>
                    <p><Trans text={"This token may still be waiting, called, skipped, or may not have a completed physician consultation."} /></p>
                  </div>
                );
              }

              return (
                <div className="history-consultation-details">
                  <div className="consultation-doctor history-detail-doctor">
                    <strong><Trans text={"Attending Physician:"} /></strong> {consultation.doctor?.name || "Medical Officer"}
                  </div>

                  {consultation.symptoms && (
                    <div className="consultation-detail">
                      <span><Trans text={"Reported Symptoms"} /></span>
                      <p>{consultation.symptoms}</p>
                    </div>
                  )}

                  <div className="consultation-detail diagnosis-detail">
                    <span><Trans text={"Clinical Diagnosis"} /></span>
                    <p>{consultation.diagnosis || "Not recorded"}</p>
                  </div>

                  {(consultation.medicines?.length > 0 || consultation.prescription) && (
                    <div className="consultation-detail">
                      <span><Trans text={"Digital Prescription & Dosages"} /></span>
                      {consultation.medicines?.length > 0 && (
                        <div className="patient-medicine-list">
                          {consultation.medicines.map((medicine, index) => (
                            <div className="patient-medicine-item" key={`${medicine.name}-${index}`}>
                              <strong>{index + 1}. {medicine.name}</strong>
                              <span>
                                {[medicine.dosage, medicine.frequency, medicine.duration].filter(Boolean).join(" · ")}
                              </span>
                              {medicine.instructions && <small>{medicine.instructions}</small>}
                            </div>
                          ))}
                        </div>
                      )}
                      {consultation.prescription && <p style={{ whiteSpace: "pre-line" }}>{consultation.prescription}</p>}
                    </div>
                  )}

                  {consultation.testsRecommended?.length > 0 && (
                    <div className="consultation-detail">
                      <span><Trans text={"Recommended Tests / Investigations"} /></span>
                      <p>{consultation.testsRecommended.join(", ")}</p>
                    </div>
                  )}

                  {consultation.labReferral?.enabled && (
                    <div className="consultation-detail visit-lab-referral">
                      <span><Trans text={"Lab Referral"} /></span>
                      <p>
                        <Trans text={"Priority: "} /><strong>{(consultation.labReferral.priority || "routine").toUpperCase()}</strong>
                        {" · "}
                        <Trans text={"Status: "} /><strong>{(consultation.labReferral.status || "pending").toUpperCase()}</strong>
                      </p>
                      <div className="prescription-actions">
                        <button type="button" className="ghost" onClick={() => downloadLabReferralPdf(consultation, selectedHistoryToken, activePatient)}>
                          <Download size={15} /> <Trans text={"Download Lab Referral"} /></button>
                        <button type="button" className="ghost" onClick={() => printLabReferral(consultation, selectedHistoryToken, activePatient)}>
                          <Printer size={15} /> <Trans text={"Print Lab Referral"} /></button>
                      </div>
                    </div>
                  )}

                  {consultation.advice && (
                    <div className="consultation-detail">
                      <span><Trans text={"Doctor Advice & Precautions"} /></span>
                      <p>{consultation.advice}</p>
                    </div>
                  )}

                  {consultation.notes && (
                    <div className="consultation-detail">
                      <span><Trans text={"Clinical Notes"} /></span>
                      <p>{consultation.notes}</p>
                    </div>
                  )}

                  {consultation.followUpDate && (
                    <div className="consultation-followup">
                      <strong><Trans text={"Scheduled Follow-Up:"} /></strong>{" "}
                      {new Date(consultation.followUpDate).toLocaleDateString(undefined, {
                        year: "numeric", month: "short", day: "numeric",
                      })}
                    </div>
                  )}

                  <div className="prescription-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => downloadPrescriptionPdf(consultation, selectedHistoryToken, activePatient, patientClinicContext)}
                    >
                      <Download size={15} /> <Trans text={"Download Prescription PDF"} /></button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => printPrescription(consultation, selectedHistoryToken, activePatient, patientClinicContext)}
                    >
                      <Printer size={15} /> <Trans text={"Print / Save as PDF"} /></button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </main>
  );
}

/* =========================================================
   STAFF LOGIN
========================================================= */

function StaffLoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [recovering, setRecovering] = useState(false);
  const [credentials, setCredentials] = useState({ clinicSlug: "", email: "", password: "" });
  const [clinics, setClinics] = useState([]);
  const [clinicsLoading, setClinicsLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    let active = true;

    onboardingApi.get("/onboarding/staff-clinics")
      .then(({ data }) => {
        if (!active) return;
        const available = (Array.isArray(data?.clinics) ? data.clinics : [])
          .map((clinic) => ({
            ...clinic,
            slug: String(clinic?.slug || "").trim().toLowerCase(),
            name: String(clinic?.name || "").trim(),
          }))
          .filter((clinic) => clinic.name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clinic.slug));
        setClinics(available);

        const rememberedSlug = getActiveClinicSlug();
        const rememberedAvailable = available.some((clinic) => clinic.slug === rememberedSlug);
        setCredentials((current) => ({
          ...current,
          clinicSlug: rememberedAvailable ? rememberedSlug : (available[0]?.slug || ""),
        }));
      })
      .catch((error) => {
        if (!active) return;
        setClinics([]);
        setLoginError(error.response?.data?.message || "Unable to load active clinic workspaces.");
      })
      .finally(() => {
        if (active) setClinicsLoading(false);
      });

    return () => { active = false; };
  }, []);

  const handleStaffLogin = async (event) => {
    event.preventDefault();
    if (!credentials.clinicSlug) {
      setLoginError("Please select your clinic before signing in.");
      return;
    }

    setIsAuthenticating(true);
    setLoginError("");

    try {
      // The selected clinic becomes the HTTP + Socket.IO tenant context before
      // credentials are verified, so the same staff account works on any device.
      setActiveClinicSlug(credentials.clinicSlug);
      const { data } = await api.post("/auth/login", {
        clinicSlug: credentials.clinicSlug,
        email: credentials.email,
        password: credentials.password,
      });
      saveAuth(data);

      const destination =
        data.user.role === "admin"
          ? "/admin"
          : data.user.role === "receptionist"
            ? "/reception"
            : "/doctor";

      navigate(destination, { replace: true });
    } catch (error) {
      setLoginError(error.response?.data?.message || "Invalid clinic, email, or password.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <main className="login premium-login">
      <SignInContext staff />
      {recovering ? <StaffPasswordRecovery clinics={clinics} initial={credentials} onBack={() => { setRecovering(false); setCredentials(c => ({ ...c, password: "" })); }} /> : <form className="loginbox" onSubmit={handleStaffLogin}>
        <div className="logo">
          <ShieldCheck size={28} />
        </div>

        <p className="eyebrow"><Trans text={"Hospital Staff Workstation"} /></p>
        <h1><Trans text={"Staff sign in"} /></h1>
        <p className="muted"><Trans text={"Select the clinic workspace, then sign in with your staff credentials."} /></p>

        <label>
          <Trans text={"Clinic / Hospital"} /><select
            name="clinicSlug"
            required
            disabled={clinicsLoading || isAuthenticating}
            value={credentials.clinicSlug}
            onChange={(e) => setCredentials({ ...credentials, clinicSlug: e.target.value })}
          >
            <option value="">{t(clinicsLoading ? "Loading clinics..." : "Select clinic")}</option>
            {clinics.map((clinic) => (
              <option key={clinic.id || clinic.slug} value={clinic.slug}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <Trans text={"Hospital Staff Email"} /><input
            type="email"
            name="email"
            autoComplete="username"
            placeholder={t("doctor@hospital.org")}
            required
            value={credentials.email}
            onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
          />
        </label>

        <label>
          <Trans text={"Staff Password"} /><input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            value={credentials.password}
            onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
          />
        </label>

        {loginError && <div className="login-error" role="alert">{t(loginError)}</div>}

        {!clinicsLoading && clinics.length === 0 && !loginError && (
          <div className="login-error" role="alert"><Trans text={"No active clinic workspace is currently available."} /></div>
        )}

        <button
          type="submit"
          className="primary"
          disabled={isAuthenticating || clinicsLoading || clinics.length === 0}
          style={{ marginTop: "6px" }}
        >
          {t(isAuthenticating ? "Authenticating Session..." : "Sign In to Workstation")}
        </button>
        <button type="button" className="ghost" disabled={isAuthenticating || clinicsLoading} onClick={() => { setLoginError(""); setRecovering(true); }}><Trans text={"Forgot password?"} /></button>
      </form>}
    </main>
  );
}



/* =========================================================
   SAAS CLINIC SELF-SERVICE ONBOARDING
========================================================= */

function ClinicRegistrationPage() {
  const { t, language } = useLanguage();
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    clinicName: "",
    clinicSlug: "",
    contactEmail: "",
    contactPhone: "",
    adminName: "",
    adminEmail: "",
    password: "",
    legalVerification: { ...EMPTY_CLINIC_VERIFICATION },
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

  const update = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "clinicName" && !slugEdited) next.clinicSlug = slugify(value);
      if (key === "contactEmail" && !current.adminEmail) next.adminEmail = value;
      return next;
    });
  };

  const updateLegal = (key, value) => setForm((current) => ({
    ...current,
    legalVerification: { ...current.legalVerification, [key]: value },
  }));

  const submit = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setLoading(true);
    try {
      if (!policyAccepted) {
        setErrorMessage(language === "hi" ? "कृपया नियम स्वीकार करें और गोपनीयता नीति पढ़ने की पुष्टि करें।" : "Please accept the terms and acknowledge the privacy notice.");
        return;
      }
      const { data } = await onboardingApi.post("/onboarding/register-clinic", {
        ...form, policyAcceptance: { accepted: policyAccepted, version: POLICY_VERSION, language },
      });
      saveOnboardingToken(data.onboardingToken);
      setActiveClinicSlug(data.clinic.slug);
      navigate("/clinic/pending", { replace: true });
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Unable to create clinic workspace.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="clinic-onboarding-shell">
      <section className="clinic-onboarding-intro">
        <span className="platform-kicker"><HeartPulse size={14} /> <Trans text={"OPDfy SaaS"} /></span>
        <h1><Trans text={"Launch your clinic workspace"} /></h1>
        <p><Trans text={"Submit your clinic for secure platform verification. Your isolated workspace is prepared immediately and activated only after approval."} /></p>
        <div className="clinic-onboarding-points">
          <span><ShieldCheck size={17} /> <Trans text={"Isolated clinic data"} /></span>
          <span><Users size={17} /> <Trans text={"Admin account created automatically"} /></span>
          <span><Activity size={17} /> <Trans text={"Queue, appointments & EHR ready after approval"} /></span>
        </div>
      </section>

      <form className="clinic-onboarding-form" onSubmit={submit}>
        <div className="clinic-form-heading">
          <span><Trans text={"Clinic Registration"} /></span>
          <h2><Trans text={"Create Workspace"} /></h2>
          <p><Trans text={"Your request goes to Platform Admin for verification before the workspace becomes active."} /></p>
        </div>

        <div className="clinic-form-grid">
          <label className="clinic-form-wide">
            <Trans text={"Clinic / Hospital Name"} /><input required maxLength="120" placeholder={t("e.g. Sunrise Multispeciality Clinic")}
              value={form.clinicName} onChange={(e) => update("clinicName", e.target.value)} />
          </label>

          <label className="clinic-form-wide">
            <Trans text={"Clinic URL"} /><div className="clinic-slug-input">
              <span><Trans text={"/clinic/"} /></span>
              <input required minLength="3" maxLength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder={t("sunrise-clinic")} value={form.clinicSlug}
                onChange={(e) => { setSlugEdited(true); update("clinicSlug", slugify(e.target.value)); }} />
            </div>
            <small><Trans text={"Unique workspace identifier. You can use this clinic slug for staff access."} /></small>
          </label>

          <label>
            <Trans text={"Clinic Contact Email"} /><input required type="email" placeholder={t("clinic@example.com")}
              value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} />
          </label>

          <label>
            <Trans text={"Contact Phone"} /><input type="tel" placeholder="+91 98765 43210"
              value={form.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} />
          </label>
        </div>

        <div className="clinic-form-divider"><span><Trans text={"Clinical Establishment Registration"} /></span></div>
        <div className="legal-verification-note"><ShieldCheck size={17} /><span><Trans text={"Submit the clinic's official registration details for an internal Platform Admin review. This does not claim government certification."} /></span></div>
        <div className="clinic-form-grid legal-verification-grid">
          <label className="clinic-form-wide"><Trans text={"Legal establishment name"} /><input required maxLength="160" value={form.legalVerification.legalName} onChange={(e) => updateLegal("legalName", e.target.value)} placeholder={t("Name exactly as shown on the certificate")} /></label>
          <label><Trans text={"Establishment type"} /><select required value={form.legalVerification.establishmentType} onChange={(e) => updateLegal("establishmentType", e.target.value)}><option value="clinic">{t("Clinic")}</option><option value="polyclinic">{t("Polyclinic")}</option><option value="hospital">{t("Hospital")}</option><option value="nursing_home">{t("Nursing home")}</option><option value="diagnostic_centre">{t("Diagnostic centre")}</option><option value="other">{t("Other")}</option></select></label>
          <label><Trans text={"Registration number"} /><input required maxLength="100" value={form.legalVerification.registrationNumber} onChange={(e) => updateLegal("registrationNumber", e.target.value)} /></label>
          <label><Trans text={"Registration authority"} /><input required maxLength="140" value={form.legalVerification.registrationAuthority} onChange={(e) => updateLegal("registrationAuthority", e.target.value)} placeholder={t("Issuing authority / department")} /></label>
          <label><Trans text={"Registration state / UT"} /><input required maxLength="80" value={form.legalVerification.registrationState} onChange={(e) => updateLegal("registrationState", e.target.value)} /></label>
          <label><Trans text={"Certificate expiry (optional)"} /><input type="date" value={form.legalVerification.certificateExpiresAt} onChange={(e) => updateLegal("certificateExpiresAt", e.target.value)} /></label>
          <label className="clinic-form-wide"><Trans text={"Evidence reference"} /><input required minLength="3" maxLength="240" value={form.legalVerification.evidenceReference} onChange={(e) => updateLegal("evidenceReference", e.target.value)} placeholder={t("Certificate file/page reference available to the reviewer")} /><small><Trans text={"Do not enter patient information or a public document link."} /></small></label>
        </div>

        <div className="clinic-form-divider"><span><Trans text={"First Administrator"} /></span></div>

        <div className="clinic-form-grid">
          <label>
            <Trans text={"Admin Name"} /><input required maxLength="100" placeholder={t("Clinic Owner / Administrator")}
              value={form.adminName} onChange={(e) => update("adminName", e.target.value)} />
          </label>
          <label>
            <Trans text={"Admin Email"} /><input required type="email" placeholder={t("admin@example.com")}
              value={form.adminEmail} onChange={(e) => update("adminEmail", e.target.value)} />
          </label>
          <label className="clinic-form-wide">
            <Trans text={"Admin Password"} /><input required type="password" minLength="12" autoComplete="new-password"
              placeholder={t("Minimum 12 characters")} value={form.password}
              onChange={(e) => update("password", e.target.value)} />
            <small><Trans text={"Use a strong password of at least 12 characters."} /></small>
          </label>
        </div>

        {errorMessage && <div className="clinic-onboarding-error">{t(errorMessage)}</div>}

        <ClinicPolicyAcceptance checked={policyAccepted} onChange={setPolicyAccepted} />
        <button className="clinic-create-button" type="submit" disabled={loading}>
          {loading ? <><RefreshCw size={16} /> <Trans text={"Submitting for review..."} /></> : <><Send size={16} /> <Trans text={"Submit Clinic for Approval"} /></>}
        </button>

        <p className="clinic-login-note">
          <Trans text={"Already registered? "} /><Link to="/login"><Trans text={"Staff Sign In"} /></Link>
        </p>
      </form>
    </main>
  );
}


function ClinicApprovalWaitingPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [clinic, setClinic] = useState(null);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");

  const checkStatus = async ({ silent = false } = {}) => {
    if (!getOnboardingToken()) {
      navigate("/clinic/register", { replace: true });
      return;
    }
    if (!silent) setChecking(true);
    try {
      const { data } = await onboardingApi.get("/onboarding/status");
      setClinic(data.clinic);
      setMessage("");
      if (data.clinic?.status === "active" && data.approvedSession) {
        setActiveClinicSlug(data.clinic.slug);
        saveAuth(data.approvedSession);
        clearOnboardingToken();
        navigate("/admin", { replace: true });
      }
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to check approval status.");
    } finally {
      if (!silent) setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const timer = window.setInterval(() => checkStatus({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const rejected = clinic?.status === "rejected";
  return (
    <main className="approval-wait-shell">
      <section className={`approval-wait-card ${rejected ? "is-rejected" : ""}`}>
        <div className="approval-orbit">
          <div className="approval-orbit-ring" />
          <div className="approval-icon">{rejected ? <AlertTriangle size={34} /> : <Clock3 size={34} />}</div>
        </div>
        <span className={`approval-status-pill ${rejected ? "rejected" : "pending"}`}>
          <span /> {t(rejected ? "Registration Rejected" : "Pending Platform Review")}
        </span>
        <h1>{t(rejected ? "Your clinic needs an update" : "Thanks for registering!")}</h1>
        <p className="approval-lead">
          {t(rejected
            ? "The Platform Admin reviewed your clinic request and could not approve it yet."
            : "Your clinic request has been securely submitted to the OPDfy Platform team. Full workspace access unlocks automatically after approval.")}
        </p>

        <div className="approval-detail-card">
          <div><span><Trans text={"Clinic"} /></span><strong>{clinic?.name || t("Loading...")}</strong></div>
          <div><span><Trans text={"Workspace"} /></span><strong>{clinic?.slug || "—"}</strong></div>
          <div><span><Trans text={"Status"} /></span><strong className={rejected ? "text-danger" : "text-warning"}>{t(clinic?.status) || "checking"}</strong></div>
          <div><span><Trans text={"Submitted"} /></span><strong>{clinic?.submittedAt ? new Date(clinic.submittedAt).toLocaleString() : "—"}</strong></div>
        </div>

        {rejected && clinic?.rejectionReason && (
          <div className="approval-reason"><AlertTriangle size={18} /><div><span><Trans text={"Review note"} /></span><p>{clinic.rejectionReason}</p></div></div>
        )}
        {!rejected && (
          <div className="approval-timeline">
            <div className="done"><CheckCircle size={18} /><span><Trans text={"Registration submitted"} /></span></div>
            <i />
            <div className="current"><Clock3 size={18} /><span><Trans text={"Platform verification"} /></span></div>
            <i />
            <div><ShieldCheck size={18} /><span><Trans text={"Workspace activated"} /></span></div>
          </div>
        )}
        {message && <div className="clinic-onboarding-error">{t(message)}</div>}
        <button className="approval-refresh-button" type="button" onClick={() => checkStatus()} disabled={checking}>
          <RefreshCw size={16} /> {t(checking ? "Checking status..." : "Refresh Approval Status")}
        </button>
        <p className="approval-footnote"><Trans text={"This page checks approval status automatically every 15 seconds."} /></p>
      </section>
    </main>
  );
}

/* =========================================================
   SAAS PLATFORM SUPER ADMIN
========================================================= */

function PlatformProtectedRoute({ children }) {
  const { t } = useLanguage();
  return getStoredPlatformUser()
    ? children
    : <Navigate to="/platform/login" replace />;
}

function PlatformLoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage("");
    try {
      const { data } = await platformApi.post("/platform/auth/login", credentials);
      savePlatformAuth(data);
      navigate("/platform", { replace: true });
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Unable to sign in to platform console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login premium-login">
      <form className="loginbox" onSubmit={submit}>
        <div className="logo"><ShieldAlert size={28} /></div>
        <p className="eyebrow"><Trans text={"SaaS Platform Control Plane"} /></p>
        <h1><Trans text={"Super Admin"} /></h1>
        <p className="muted"><Trans text={"Manage clinics without opening tenant clinical records."} /></p>
        <label><Trans text={"Platform Email"} /><input type="email" required autoComplete="username" value={credentials.email}
            onChange={(e) => setCredentials({ ...credentials, email: e.target.value })} />
        </label>
        <label><Trans text={"Platform Password"} /><input type="password" required autoComplete="current-password" value={credentials.password}
            onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} />
        </label>
        {errorMessage && <div className="login-error" role="alert">{t(errorMessage)}</div>}
        <button type="submit" className="primary" disabled={loading}>
          {t(loading ? "Authenticating..." : "Open Platform Console")}
        </button>
      </form>
    </main>
  );
}

function PlatformDashboardPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const current = getStoredPlatformUser();
  const [overview, setOverview] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [subscriptionClinic, setSubscriptionClinic] = useState(null);
  const [subscriptionMode, setSubscriptionMode] = useState("approve");
  const [subscriptionMonths, setSubscriptionMonths] = useState(1);
  const [paymentNote, setPaymentNote] = useState("");
  const [verificationClinic, setVerificationClinic] = useState(null);
  const [verificationForm, setVerificationForm] = useState({ decision: "platform_reviewed", note: "", evidenceReference: "", password: "" });
  const [verificationSaving, setVerificationSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [overviewResponse, clinicsResponse] = await Promise.all([
        platformApi.get("/platform/overview"), platformApi.get("/platform/clinics"),
      ]);
      setOverview(overviewResponse.data);
      setClinics(clinicsResponse.data?.clinics || []);
    } catch (error) {
      if (error.response?.status === 401) {
        logoutPlatform(); navigate("/platform/login", { replace: true });
      } else setMessage(error.response?.data?.message || "Unable to load platform data.");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const reviewClinic = async (clinic, decision, reason = "", durationMonths = 1, note = "") => {
    setMessage("");
    try {
      const { data } = await platformApi.patch(`/platform/clinics/${clinic._id}/review`, { decision, reason, durationMonths, paymentNote: note });
      setMessage(data.message);
      setRejecting(null); setRejectReason("");
      await load();
    } catch (error) { setMessage(error.response?.data?.message || "Unable to review clinic."); }
  };

  const openSubscriptionModal = (clinic, mode) => {
    setSubscriptionClinic(clinic);
    setSubscriptionMode(mode);
    setSubscriptionMonths(1);
    setPaymentNote("");
  };

  const submitSubscription = async () => {
    if (!subscriptionClinic) return;
    setMessage("");
    try {
      if (subscriptionMode === "approve") {
        await reviewClinic(subscriptionClinic, "approve", "", Number(subscriptionMonths), paymentNote);
      } else {
        const { data } = await platformApi.patch(`/platform/clinics/${subscriptionClinic._id}/renew`, {
          durationMonths: Number(subscriptionMonths),
          paymentNote,
        });
        setMessage(data.message);
        await load();
      }
      setSubscriptionClinic(null);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to update clinic subscription.");
    }
  };

  const setClinicStatus = async (clinic, status) => {
    const verb = status === "suspended" ? "suspend" : "reactivate";
    if (!confirm(localizeUi(`${verb} ${clinic.name}?`))) return;
    try {
      const { data } = await platformApi.patch(`/platform/clinics/${clinic._id}/status`, { status });
      setMessage(data.message); await load();
    } catch (error) { setMessage(error.response?.data?.message || "Unable to update clinic."); }
  };

  const openVerificationReview = (clinic) => {
    setVerificationClinic(clinic);
    setVerificationForm({ decision: "platform_reviewed", note: "", evidenceReference: clinic.legalVerification?.evidenceReference || "", password: "" });
  };

  const submitVerificationReview = async () => {
    if (!verificationClinic) return;
    setVerificationSaving(true); setMessage("");
    try {
      const { data } = await platformApi.patch(`/platform/clinics/${verificationClinic._id}/legal-verification`, verificationForm);
      setMessage(data?.message || "Clinic verification review saved.");
      setVerificationClinic(null);
      await load();
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to save clinic verification review.");
    } finally { setVerificationSaving(false); }
  };

  const signOut = () => { logoutPlatform(); navigate("/platform/login", { replace: true }); };
  const pending = clinics.filter((c) => c.status === "pending");
  const active = clinics.filter((c) => ["active", "suspended", "expired"].includes(c.status));
  const rejected = clinics.filter((c) => c.status === "rejected");
  const visible = activeTab === "pending" ? pending : activeTab === "active" ? active : rejected;

  const cards = [
    { label: "Total Clinics", value: overview?.clinics?.total, note: t("{active} active · {expired} expired", { active: overview?.clinics?.active ?? 0, expired: overview?.clinics?.expired ?? 0 }), icon: <HeartPulse size={20} /> },
    { label: "Pending Reviews", value: overview?.clinics?.pending, note: "Needs your attention", icon: <Clock3 size={20} />, urgent: (overview?.clinics?.pending || 0) > 0 },
    { label: "Patients", value: overview?.platform?.patients, note: "Privacy-safe aggregate", icon: <Users size={20} /> },
    { label: "Consultations", value: overview?.platform?.consultations, note: "Count only", icon: <Stethoscope size={20} /> },
  ];

  return (
    <main className="platform-shell">
      <section className="platform-hero platform-hero-v2">
        <div>
          <span className="platform-kicker"><ShieldAlert size={14} /> <Trans text={"SaaS Platform Control Plane"} /></span>
          <h1><Trans text={"Clinic Operations"} /></h1>
          <p><Trans text={"Verify new organizations, manage tenant lifecycle and monitor platform health without opening clinical records."} /></p>
        </div>
        <div className="platform-owner-actions">
          <div className="platform-notification"><Bell size={17} />{pending.length > 0 && <b>{pending.length}</b>}</div>
          <span className="platform-owner-chip"><ShieldCheck size={15} /> {current?.name || "Platform Owner"}</span>
          <button type="button" className="platform-signout" onClick={signOut}><LogOut size={15} /> <Trans text={"Sign Out"} /></button>
        </div>
      </section>

      {message && <div className="platform-message">{t(message)}</div>}
      <section className="platform-stats">
        {cards.map((card) => (
          <article className={`platform-stat-card ${card.urgent ? "urgent" : ""}`} key={card.label}>
            <div className="platform-stat-icon">{card.icon}</div>
            <div><span>{t(card.label)}</span><strong>{card.value ?? "—"}</strong><small>{t(card.note)}</small></div>
          </article>
        ))}
      </section>

      <section className="platform-panel platform-registry-v2">
        <div className="platform-panel-head">
          <div><span className="platform-section-label"><Trans text={"Tenant Registry"} /></span><h2><Trans text={"Clinic Approval Center"} /></h2><p><Trans text={"Review registration requests and control active workspaces."} /></p></div>
          <button type="button" className="platform-refresh" onClick={load}><RefreshCw size={15} /> <Trans text={"Refresh"} /></button>
        </div>

        <div className="platform-tabs">
          <button className={activeTab === "pending" ? "active" : ""} onClick={() => setActiveTab("pending")}><Trans text={"Pending Clinics "} /><span>{pending.length}</span></button>
          <button className={activeTab === "active" ? "active" : ""} onClick={() => setActiveTab("active")}><Trans text={"Active Clinics "} /><span>{active.length}</span></button>
          <button className={activeTab === "rejected" ? "active" : ""} onClick={() => setActiveTab("rejected")}><Trans text={"Rejected "} /><span>{rejected.length}</span></button>
        </div>

        {loading ? <div className="platform-empty"><Trans text={"Loading clinic registry..."} /></div> : (
          <div className="approval-clinic-list">
            {visible.map((clinic) => (
              <article className="approval-clinic-row" key={clinic._id}>
                <div className="approval-clinic-avatar">{String(clinic.name || "C").slice(0, 1).toUpperCase()}</div>
                <div className="approval-clinic-main">
                  <div className="approval-clinic-title">
                    <strong>{clinic.name}</strong>
                    <span className={`platform-status ${clinic.status}`}>{t(clinic.status)}</span>
                  </div>
                  <small>{clinic.slug}</small>
                  <div className="approval-clinic-meta">
                    <span><UserRound size={13} /> {clinic.onboarding?.ownerName || "Clinic Owner"}</span>
                    <span><Mail size={13} /> {clinic.onboarding?.adminEmail || clinic.contactEmail}</span>
                    {clinic.contactPhone && <span><Phone size={13} /> {clinic.contactPhone}</span>}
                    <span><Clock3 size={13} /> {new Date(clinic.onboarding?.submittedAt || clinic.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="legal-review-summary">
                    <span className={`verification-status verification-${clinic.legalVerification?.status || "not_submitted"}`}><ShieldCheck size={13} /> {t(verificationStatusLabel(clinic.legalVerification?.status))}</span>
                    {clinic.legalVerification?.legalName && <span><b>{clinic.legalVerification.legalName}</b> · {t(String(clinic.legalVerification.establishmentType || "clinic").replaceAll("_", " "))}</span>}
                    {clinic.legalVerification?.registrationAuthority && <span>{clinic.legalVerification.registrationAuthority} · {clinic.legalVerification.registrationState}</span>}
                  </div>
                  {clinic.subscription?.status && clinic.subscription.status !== "unmanaged" && (
                    <div className="platform-subscription-line">
                      <span><Trans text={"Manual subscription: "} /><b>{t(clinic.subscription.status)}</b></span>
                      <span><Trans text={"Expires: "} /><b>{clinic.subscription.endsAt ? new Date(clinic.subscription.endsAt).toLocaleDateString() : "—"}</b></span>
                      {clinic.subscription.paymentNote && <span><Trans text={"Note: "} /><b>{clinic.subscription.paymentNote}</b></span>}
                    </div>
                  )}
                  {clinic.status === "rejected" && clinic.onboarding?.rejectionReason && (
                    <div className="platform-rejection-note"><AlertTriangle size={14} /> {clinic.onboarding.rejectionReason}</div>
                  )}
                </div>
                <div className="approval-clinic-metrics">
                  <span><b>{clinic.staffCount}</b> <Trans text={"Staff"} /></span><span><b>{clinic.patientCount}</b> <Trans text={"Patients"} /></span>
                </div>
                <div className="approval-clinic-actions">
                  {clinic.legalVerification?.legalName && <button className="platform-review-registration" onClick={() => openVerificationReview(clinic)}><ShieldCheck size={15} /> <Trans text={"Review Registration"} /></button>}
                  {clinic.status === "pending" && <>
                    <button className="platform-approve" onClick={() => openSubscriptionModal(clinic, "approve")}><CheckCircle size={15} /> <Trans text={"Payment Received"} /></button>
                    <button className="platform-reject" onClick={() => { setRejecting(clinic); setRejectReason(""); }}><AlertTriangle size={15} /> <Trans text={"Reject"} /></button>
                  </>}
                  {clinic.status === "rejected" && <button className="platform-approve" onClick={() => openSubscriptionModal(clinic, "approve")}><ShieldCheck size={15} /> <Trans text={"Approve After Payment"} /></button>}
                  {clinic.status === "active" && <>
                    <button className="platform-renew" onClick={() => openSubscriptionModal(clinic, "renew")}><Calendar size={15} /> <Trans text={"Renew"} /></button>
                    <button className="platform-suspend" onClick={() => setClinicStatus(clinic, "suspended")}><Trans text={"Suspend"} /></button>
                  </>}
                  {clinic.status === "suspended" && <>
                    <button className="platform-renew" onClick={() => openSubscriptionModal(clinic, "renew")}><Calendar size={15} /> <Trans text={"Renew & Activate"} /></button>
                    {clinic.subscription?.status !== "expired" && <button className="platform-reactivate" onClick={() => setClinicStatus(clinic, "active")}><Trans text={"Reactivate"} /></button>}
                  </>}
                  {clinic.status === "expired" && <button className="platform-renew" onClick={() => openSubscriptionModal(clinic, "renew")}><Calendar size={15} /> <Trans text={"Payment Received · Renew"} /></button>}
                </div>
              </article>
            ))}
            {!visible.length && <div className="platform-empty platform-empty-v2"><CheckCircle size={26} /><strong><Trans text={"All clear"} /></strong><span><Trans text={"No clinics in this category."} /></span></div>}
          </div>
        )}
      </section>

      {subscriptionClinic && (
        <div className="platform-modal-backdrop" onMouseDown={() => setSubscriptionClinic(null)}>
          <div className="platform-review-modal platform-subscription-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="platform-modal-icon subscription"><Calendar size={22} /></div>
            <h3>{t(subscriptionMode === "approve" ? "Confirm payment & activate" : "Renew subscription")}</h3>
            <p><Trans text={"Record the personal/offline payment for "} /><strong>{subscriptionClinic.name}</strong><Trans text={". No online payment gateway is used."} /></p>
            <label className="platform-subscription-field">
              <span><Trans text={"Subscription duration"} /></span>
              <select value={subscriptionMonths} onChange={(e) => setSubscriptionMonths(Number(e.target.value))}>
                <option value={1}>{t("1 month")}</option>
                <option value={3}>{t("3 months")}</option>
                <option value={6}>{t("6 months")}</option>
                <option value={12}>{t("1 year")}</option>
              </select>
            </label>
            <label className="platform-subscription-field">
              <span><Trans text={"Payment note (optional)"} /></span>
              <input maxLength="300" placeholder={t("e.g. UPI received / cash / bank transfer ref")} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
            </label>
            <div className="platform-subscription-info"><Trans text={"The clinic stays active until the calculated expiry date. After expiry it is blocked automatically, but its data is preserved."} /></div>
            <div className="platform-modal-actions">
              <button onClick={() => setSubscriptionClinic(null)}><Trans text={"Cancel"} /></button>
              <button className="platform-confirm-payment" onClick={submitSubscription}>
                {subscriptionMode === "approve" ? "Confirm Payment & Activate" : t("Renew & Activate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {verificationClinic && (
        <div className="platform-modal-backdrop" onMouseDown={() => setVerificationClinic(null)}>
          <div className="platform-review-modal legal-review-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="platform-modal-icon subscription"><ShieldCheck size={22} /></div>
            <h3><Trans text={"Review clinic registration"} /></h3>
            <p><strong>{verificationClinic.legalVerification?.legalName || verificationClinic.name}</strong> · {verificationClinic.legalVerification?.registrationAuthority || t("Authority not supplied")}</p>
            <div className="legal-review-sensitive"><span><Trans text={"Registration number"} /></span><b>{verificationClinic.legalVerification?.registrationNumber || "—"}</b><span><Trans text={"Evidence reference"} /></span><b>{verificationClinic.legalVerification?.evidenceReference || "—"}</b></div>
            <label><Trans text={"Decision"} /><select value={verificationForm.decision} onChange={(e) => setVerificationForm((current) => ({ ...current, decision: e.target.value }))}><option value="platform_reviewed">{t("Platform reviewed")}</option><option value="rejected">{t("Reject verification")}</option></select></label>
            <label><Trans text={"Reviewer evidence reference"} /><input maxLength="240" value={verificationForm.evidenceReference} onChange={(e) => setVerificationForm((current) => ({ ...current, evidenceReference: e.target.value }))} placeholder={t("Internal case/file reference")} /></label>
            <label><Trans text={"Review note"} /><textarea maxLength="1000" value={verificationForm.note} onChange={(e) => setVerificationForm((current) => ({ ...current, note: e.target.value }))} placeholder={t("Record what was checked and any limitation")} /></label>
            <label><Trans text={"Confirm with platform password"} /><input type="password" autoComplete="current-password" value={verificationForm.password} onChange={(e) => setVerificationForm((current) => ({ ...current, password: e.target.value }))} /></label>
            <div className="legal-review-disclaimer"><AlertTriangle size={16} /><Trans text={"This records an internal platform review and is not a government verification or legal certification."} /></div>
            <div className="platform-modal-actions"><button onClick={() => setVerificationClinic(null)}><Trans text={"Cancel"} /></button><button className={verificationForm.decision === "rejected" ? "danger" : "platform-confirm-payment"} disabled={verificationSaving || verificationForm.note.trim().length < 10 || verificationForm.evidenceReference.trim().length < 3 || !verificationForm.password} onClick={submitVerificationReview}>{verificationSaving ? t("Saving...") : t("Save Review")}</button></div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="platform-modal-backdrop" onMouseDown={() => setRejecting(null)}>
          <div className="platform-review-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="platform-modal-icon"><AlertTriangle size={22} /></div>
            <h3><Trans text={"Reject "} />{rejecting.name}?</h3>
            <p><Trans text={"Add a clear review note. The clinic owner will see this reason on their approval-status screen."} /></p>
            <textarea maxLength="500" autoFocus placeholder={t("e.g. Please provide valid clinic contact information.")}
              value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <small>{rejectReason.length}/500</small>
            <div className="platform-modal-actions">
              <button onClick={() => setRejecting(null)}><Trans text={"Cancel"} /></button>
              <button className="danger" disabled={rejectReason.trim().length < 3} onClick={() => reviewClinic(rejecting, "reject", rejectReason)}><Trans text={"Reject Registration"} /></button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* =========================================================
   QUICK KIOSK TOKEN PAGE (/token)
========================================================= */

function KioskTokenGenerationPage() {
  const { t } = useLanguage();
  const liveQueue = useLiveQueue();
  const [kioskForm, setKioskForm] = useState({
    patientName: "",
    phone: "",
    department: "General OPD",
    doctorId: "",
  });
  const [kioskDoctors, setKioskDoctors] = useState([]);
  const [myActiveToken, setMyActiveToken] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  const [quickChatMessage, setQuickChatMessage] = useState("");
  const [kioskEta, setKioskEta] = useState(null);

  const activeCalledToken = liveQueue.find(
    (item) => item.status === "called" && item.department === kioskForm.department
  );
  const waitingTokenList = liveQueue
    .filter(
      (item) => item.status === "waiting" && item.department === kioskForm.department
    )
    .sort((a, b) => Number(a.tokenNumber) - Number(b.tokenNumber));

  useEffect(() => {
    api
      .get("/tokens/doctors", { params: { department: kioskForm.department } })
      .then((response) => {
        const doctors = response.data?.doctors || [];
        setKioskDoctors(doctors);
        setKioskForm((current) => ({
          ...current,
          doctorId: doctors.length === 1 ? String(doctors[0]._id) : "",
        }));
      })
      .catch(() => {
        setKioskDoctors([]);
        setKioskForm((current) => ({ ...current, doctorId: "" }));
      });
  }, [kioskForm.department]);

  const publicStatusForMyToken =
    myActiveToken &&
    liveQueue.find(
      (item) =>
        item.department === myActiveToken.department &&
        Number(item.tokenNumber) === Number(myActiveToken.tokenNumber)
    );

  const currentTokenStatus = publicStatusForMyToken
    ? { ...myActiveToken, ...publicStatusForMyToken }
    : myActiveToken;

  useEffect(() => {
    if (!currentTokenStatus?._id) {
      setKioskEta(null);
      return undefined;
    }

    const fetchKioskEta = async () => {
      try {
        const { data } =
          await api.get(
            `/tokens/${currentTokenStatus._id}/eta`
          );

        setKioskEta(
          data.eta || null
        );
      } catch (error) {
        console.error(
          "Unable to load kiosk ETA:",
          error
        );
      }
    };

    fetchKioskEta();

    const etaTimer =
      window.setInterval(
        fetchKioskEta,
        30000
      );

    return () =>
      window.clearInterval(
        etaTimer
      );
  }, [
    currentTokenStatus?._id,
    currentTokenStatus?.status,
    liveQueue,
  ]);

  const patientsAheadInQueue =
    currentTokenStatus?.status === "waiting"
      ? liveQueue.filter(
          (item) =>
            item.status === "waiting" &&
            item.department === currentTokenStatus.department &&
            item.tokenNumber < currentTokenStatus.tokenNumber
        ).length
      : 0;

  const kioskPatientsAhead =
    kioskEta?.patientsAhead ??
    patientsAheadInQueue;

  useEffect(() => {
    if (currentTokenStatus?.status !== "called") return;
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("OPDfy", { body: "Your token has been called!" });
    }
    playQueueNotificationChime();
  }, [currentTokenStatus?.status]);

  const handleIssueKioskToken = async (event) => {
    event.preventDefault();
    alert(
      localizeUi("Anonymous token issuance is disabled for patient safety. Please sign in as a patient or visit the reception desk to receive a token.")
    );
  };

  const handleSendQuickChat = async (event) => {
    event.preventDefault();
    const cleanMsg = quickChatMessage.trim();
    if (!cleanMsg) return;

    setQuickChatMessage("");
    setChatLog((curr) => [...curr, { role: "user", text: cleanMsg }]);

    try {
      const { data } = await api.post("/ai/chat", { message: cleanMsg, allowExternalAI: await getExternalAiConsent() });
      setChatLog((curr) => [...curr, { role: "ai", text: data.reply, externalAIContacted: data.externalAIContacted === true }]);
    } catch {
      setChatLog((curr) => [
        ...curr,
        { role: "ai", text: "AI assistant is temporarily unavailable." },
      ]);
    }
  };

  if (!currentTokenStatus) {
    return (
      <main className="page premium-page">
        <section className="hero">
          <div>
            <p className="eyebrow"><Trans text={"Instant Kiosk Dispatch"} /></p>
            <h1><Trans text={"Know your turn before you reach the physician."} /></h1>
            <p className="lead">
              <Trans text={"Monitor the privacy-safe live OPD queue from any hospital display. For security, tokens are issued only to authenticated patients or by reception."} /></p>
          </div>
          <div className="flow">
            <Ticket size={24} />
            <ChevronRight size={18} />
            <Stethoscope size={24} />
            <ChevronRight size={18} />
            <Monitor size={24} />
          </div>
        </section>

        <div className="cols">
          <section className="card">
            <h2>
              <Ticket size={18} /> <Trans text={"Secure Token Issuance"} /></h2>
            <form onSubmit={handleIssueKioskToken}>
              <label>
                <Trans text={"Patient Full Name"} /><input
                  required
                  placeholder={t("e.g. Ananya Verma")}
                  value={kioskForm.patientName}
                  onChange={(e) => setKioskForm({ ...kioskForm, patientName: e.target.value })}
                />
              </label>

              <label>
                <Trans text={"Mobile Number (optional)"} /><input
                  placeholder={t("10-digit mobile number")}
                  value={kioskForm.phone}
                  onChange={(e) => setKioskForm({ ...kioskForm, phone: e.target.value })}
                />
              </label>

              <label>
                <Trans text={"Department Specialty"} /><select
                  value={kioskForm.department}
                  onChange={(e) =>
                    setKioskForm({
                      ...kioskForm,
                      department: e.target.value,
                      doctorId: "",
                    })
                  }
                >
                  {CLINICAL_DEPARTMENTS.map((departmentOption) => (
                    <option key={departmentOption.value} value={departmentOption.value}>
                      {t(departmentOption.label)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <Trans text={"Choose Specialist"} /><select
                  value={kioskForm.doctorId}
                  onChange={(e) =>
                    setKioskForm({ ...kioskForm, doctorId: e.target.value })
                  }
                >
                  <option value="">{t("Select doctor")}</option>
                  {kioskDoctors.map((doctor) => (
                    <option key={doctor._id} value={doctor._id}>
                      {t("Dr. ")}{doctor.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                className="primary"
                disabled={!kioskForm.doctorId || kioskDoctors.length === 0}
              >
                <Trans text={"Sign in / Visit Reception"} /></button>
            </form>
          </section>

          <section className="card center">
            <p className="eyebrow"><Trans text={"Live Consultation Status"} /></p>
            <strong className="number">#{activeCalledToken?.tokenNumber ?? "—"}</strong>
            <p className="muted">{waitingTokenList.length} <Trans text={"patients currently waiting in lounge"} /></p>
          </section>
        </div>
      </main>
    );
  }

  const queueProgressPercent =
    currentTokenStatus.status === "waiting"
      ? Math.max(
          5,
          Math.min(
            100,
            100 -
              (patientsAheadInQueue / Math.max(waitingTokenList.length + patientsAheadInQueue, 1)) *
                100
          )
        )
      : 100;

  return (
    <main className="page premium-page">
      <section className={`live ${currentTokenStatus.status === "called" ? "called" : ""}`}>
        <div className="livehead">
          <div>
            <p className="eyebrow"><Trans text={"Live Token Telemetry"} /></p>
            <div className="token">#{currentTokenStatus.tokenNumber}</div>
          </div>
          <div className="status">
            {currentTokenStatus.status === "called"
              ? "🔔 Proceed to Consultation"
              : currentTokenStatus.status === "completed"
              ? "✓ Consultation Completed"
              : currentTokenStatus.status === "skipped"
              ? t("Skipped")
              : "⏳ In Waiting Queue"}
          </div>
        </div>

        <div className="livegrid">
          <div>
            <span><Trans text={"Now Serving"} /></span>
            <b>#{activeCalledToken?.tokenNumber ?? "—"}</b>
          </div>
          <div>
            <span><Trans text={"Patients Ahead"} /></span>
            <b>{kioskPatientsAhead}</b>
          </div>
          <div>
            <span><Trans text={"Estimated Wait"} /></span>
            <b>
              {currentTokenStatus.status === "waiting"
                ? kioskEta
                  ? kioskEta.estimatedMinutes > 0
                    ? `${kioskEta.lowerMinutes}-${kioskEta.upperMinutes} min`
                    : "Almost your turn"
                  : kioskPatientsAhead
                    ? `~${Math.ceil(kioskPatientsAhead * 7)} min`
                    : "Almost your turn"
                : currentTokenStatus.status === "called"
                  ? "Now"
                  : "No wait"}
            </b>
          </div>
        </div>

        <div className="progress">
          <i style={{ width: `${queueProgressPercent}%` }} />
        </div>

        <p className="livefoot">
          <span /> <Trans text={"Live WebSocket stream · "} />{kioskEta?.isDynamic
            ? t("{scope} recent {count} consultations average {minutes} min", {
                scope: t(kioskEta.source === "doctor_recent" ? "Doctor" : "Department"),
                count: kioskEta.sampleSize,
                minutes: kioskEta.averageMinutes,
              })
            : t("Learning pace {current}/{minimum} · temporary {minutes} min baseline", {
                current: kioskEta?.doctorSampleSize ?? 0,
                minimum: kioskEta?.minimumDynamicSamples ?? 5,
                minutes: kioskEta?.averageMinutes ?? 7,
              })}
        </p>
      </section>

      <section className="card chat">
        <h2>
          <Bot size={18} /> <Trans text={"Queue Assistant"} /></h2>
        <div className="messages">
          {chatLog.length === 0 && (
            <p className="muted"><Trans text={"Ask \"Which token is currently running?\" or \"How many patients are waiting?\""} /></p>
          )}
          {chatLog.map((chatItem, index) => (
            <div
              key={index}
              className={`bubble ${chatItem.role === "user" ? "u" : "a"}`}
            >
              {chatItem.text}
              {chatItem.role === "ai" && <small className="ai-source-label"><Trans text={chatItem.externalAIContacted ? "External AI contacted" : "Built-in help · no external AI contacted"} /></small>}
            </div>
          ))}
        </div>
        <form onSubmit={handleSendQuickChat}>
          <input
            value={quickChatMessage}
            onChange={(e) => setQuickChatMessage(e.target.value)}
            placeholder={t("Ask about queue wait times...")}
          />
          <button type="submit" className="primary">
            <Trans text={"Send"} /></button>
        </form>
      </section>
    </main>
  );
}

/* =========================================================
   DOCTOR WORKSTATION & CLINICAL DASHBOARD
========================================================= */

function DoctorDashboardPage() {
  const { t } = useLanguage();
  const liveQueue = useLiveQueue("staff");
  const navigate = useNavigate();
  const currentDoctor = getLoggedInStaff();

  const [activePatientEhr, setActivePatientEhr] = useState(null);
  const [isEhrLoading, setIsEhrLoading] = useState(false);
  const [ehrErrorMessage, setEhrErrorMessage] = useState("");
  const [previousConsultations, setPreviousConsultations] = useState([]);
  const [isPreviousConsultationsLoading, setIsPreviousConsultationsLoading] = useState(false);
  const [previousConsultationsError, setPreviousConsultationsError] = useState("");

  const [consultationFormData, setConsultationFormData] = useState({
    symptoms: "",
    diagnosis: "",
    prescription: "",
    medicines: [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
    testsRecommended: "",
    labReferralEnabled: false,
    labReferralDate: "",
    labReferralPriority: "routine",
    advice: "",
    notes: "",
    followUpDate: "",
    completedFollowUpConsultationId: "",
  });

  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [followUpRecommendationError, setFollowUpRecommendationError] = useState("");
  const [isSavingConsultation, setIsSavingConsultation] = useState(false);
  const [consultationErrorMessage, setConsultationErrorMessage] = useState("");
  const [todayDoctorAppointments, setTodayDoctorAppointments] = useState([]);
  const [doctorFeedback, setDoctorFeedback] = useState([]);
  const [doctorFeedbackSummary, setDoctorFeedbackSummary] = useState({ total: 0, averageRating: 0 });
  const [doctorFeedbackLoading, setDoctorFeedbackLoading] = useState(false);
  const [doctorClinicContext, setDoctorClinicContext] = useState(null);
  const [doctorPrescriptionProfile, setDoctorPrescriptionProfileState] = useState(currentDoctor?.prescriptionProfile || {});
  const [lastCompletedPrescription, setLastCompletedPrescription] = useState(null);

  const doctorDepartment = currentDoctor?.department || "General OPD";
  const isAssignedToCurrentDoctor = (item) =>
    String(item.assignedDoctor?._id || item.assignedDoctor || "") === String(currentDoctor?.id || "");

  const doctorQueue = liveQueue.filter(
    (item) => item.department === doctorDepartment && isAssignedToCurrentDoctor(item)
  );
  const activeCalledPatient = doctorQueue.find(
    (item) => item.status === "called"
  );
  const waitingPatientsList = doctorQueue
    .filter((item) => item.status === "waiting")
    .sort((a, b) => Number(a.tokenNumber) - Number(b.tokenNumber));
  const completedPatientsList = doctorQueue.filter((item) => item.status === "completed");
  const walkInWaitingPatients = waitingPatientsList.filter((item) => item.queueSource !== "appointment");
  const appointmentWaitingPatients = waitingPatientsList.filter((item) => item.queueSource === "appointment");

  const fetchTodayDoctorAppointments = async () => {
    try {
      const { data } = await api.get("/tokens/doctor/appointments/today");
      setTodayDoctorAppointments(data.appointments || []);
    } catch { setTodayDoctorAppointments([]); }
  };

  const fetchDoctorFeedback = async () => {
    setDoctorFeedbackLoading(true);
    try {
      const { data } = await api.get("/feedback/doctor");
      setDoctorFeedback(data.feedback || []);
      setDoctorFeedbackSummary(data.summary || { total: 0, averageRating: 0 });
    } catch {
      setDoctorFeedback([]);
      setDoctorFeedbackSummary({ total: 0, averageRating: 0 });
    } finally {
      setDoctorFeedbackLoading(false);
    }
  };

  useEffect(() => {
    fetchTodayDoctorAppointments();
    fetchDoctorFeedback();
  }, []);

  useEffect(() => {
    const handleOperationsUpdate = (update) => {
      if (hasOperationalDomain(update, "appointments")) {
        fetchTodayDoctorAppointments();
      }
      if (hasOperationalDomain(update, "feedback")) {
        fetchDoctorFeedback();
      }
    };

    const handleReconnect = () => {
      fetchTodayDoctorAppointments();
      fetchDoctorFeedback();
    };

    socket.on("operations:updated", handleOperationsUpdate);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("operations:updated", handleOperationsUpdate);
      socket.off("connect", handleReconnect);
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.get("/tenant/current"), api.get("/auth/me")]).then((results) => {
      if (!active) return;
      if (results[0].status === "fulfilled") setDoctorClinicContext(results[0].value.data?.tenant || null);
      if (results[1].status === "fulfilled") setDoctorPrescriptionProfileState(results[1].value.data?.user?.prescriptionProfile || {});
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const fetchActivePatientEhr = async () => {
      if (!activeCalledPatient?._id) {
        setActivePatientEhr(null);
        setEhrErrorMessage("");
        setIsEhrLoading(false);
        return;
      }

      if (!activeCalledPatient.patient) {
        setActivePatientEhr(null);
        setIsEhrLoading(false);
        setEhrErrorMessage("This token is not linked to a registered electronic medical file.");
        return;
      }

      setIsEhrLoading(true);
      setEhrErrorMessage("");

      try {
        const { data } = await api.get(
          `/tokens/${activeCalledPatient._id}/patient-profile`
        );
        setActivePatientEhr(data.patient);
      } catch (error) {
        console.error("Load patient EHR error:", error);
        setActivePatientEhr(null);
        setEhrErrorMessage(
          error.response?.data?.message || "Unable to retrieve patient EHR records."
        );
      } finally {
        setIsEhrLoading(false);
      }
    };

    fetchActivePatientEhr();
  }, [activeCalledPatient?._id]);

  useEffect(() => {
    const fetchPreviousConsultations = async () => {
      if (!activeCalledPatient?._id || !activeCalledPatient.patient) {
        setPreviousConsultations([]);
        setPreviousConsultationsError("");
        setIsPreviousConsultationsLoading(false);
        return;
      }

      setIsPreviousConsultationsLoading(true);
      setPreviousConsultationsError("");

      try {
        const { data } = await api.get(
          `/consultations/token/${activeCalledPatient._id}/previous`
        );
        setPreviousConsultations(Array.isArray(data.consultations) ? data.consultations : []);
      } catch (error) {
        console.error("Load previous clinical visits error:", error);
        setPreviousConsultations([]);
        setPreviousConsultationsError(
          error.response?.data?.message || "Unable to retrieve previous clinical visits."
        );
      } finally {
        setIsPreviousConsultationsLoading(false);
      }
    };

    fetchPreviousConsultations();
  }, [activeCalledPatient?._id]);

  useEffect(() => {
    setConsultationFormData({
      symptoms: "",
      diagnosis: "",
      prescription: "",
      medicines: [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
      testsRecommended: "",
      labReferralEnabled: false,
      labReferralDate: "",
      labReferralPriority: "routine",
      advice: "",
      notes: "",
      followUpDate: "",
      completedFollowUpConsultationId: "",
    });
    setConsultationErrorMessage("");
  }, [activeCalledPatient?._id]);

  useEffect(() => {
    let active = true;
    setPendingFollowUps([]);
    setFollowUpRecommendationError("");
    if (!activeCalledPatient?._id || !activeCalledPatient.patient) return () => { active = false; };
    api.get(`/consultations/token/${activeCalledPatient._id}/follow-ups`)
      .then(({ data }) => { if (active) setPendingFollowUps(data.followUps || []); })
      .catch((error) => {
        if (active) setFollowUpRecommendationError(error.response?.data?.message || "Unable to load follow-up recommendations.");
      });
    return () => { active = false; };
  }, [activeCalledPatient?._id]);

  const updateTokenStatus = async (tokenId, status) => {
    try {
      await api.patch(`/tokens/${tokenId}/status`, { status });
      return true;
    } catch (error) {
      alert(localizeUi(error.response?.data?.message || "Action failed."));
      return false;
    }
  };

  const callNextPatientInQueue = async () => {
    if (activeCalledPatient) return;
    const nextPatient = waitingPatientsList[0];
    if (!nextPatient) return;
    await updateTokenStatus(nextPatient._id, "called");
  };

  const handleConsultationInputChange = (event) => {
    const { name, value } = event.target;
    setConsultationFormData((prev) => ({ ...prev, [name]: value }));
  };

  const updateMedicineRow = (index, field, value) => {
    setConsultationFormData((prev) => ({
      ...prev,
      medicines: (prev.medicines || []).map((medicine, medicineIndex) =>
        medicineIndex === index ? { ...medicine, [field]: value } : medicine
      ),
    }));
  };

  const addMedicineRow = () => {
    setConsultationFormData((prev) => ({
      ...prev,
      medicines: [...(prev.medicines || []), { name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
    }));
  };

  const removeMedicineRow = (index) => {
    setConsultationFormData((prev) => ({
      ...prev,
      medicines:
        (prev.medicines || []).length <= 1
          ? [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]
          : (prev.medicines || []).filter((_, medicineIndex) => medicineIndex !== index),
    }));
  };

  const handleCompleteConsultation = async (event) => {
    event.preventDefault();
    setConsultationErrorMessage("");

    if (!activeCalledPatient?._id) {
      setConsultationErrorMessage("No patient token is actively being served.");
      return;
    }

    if (!activeCalledPatient.patient) {
      setConsultationErrorMessage("This token is not linked to an EHR profile.");
      return;
    }

    if (!consultationFormData.diagnosis.trim()) {
      setConsultationErrorMessage("Clinical diagnosis is mandatory.");
      return;
    }

    setIsSavingConsultation(true);

    try {
      const prescriptionPatientSnapshot = activePatientEhr ? { ...activePatientEhr } : { name: activeCalledPatient.patientName };
      const prescriptionTokenSnapshot = { ...activeCalledPatient };
      const { data: consultationResponse } = await api.post("/consultations", {
        tokenId: activeCalledPatient._id,
        symptoms: consultationFormData.symptoms,
        diagnosis: consultationFormData.diagnosis,
        prescription: consultationFormData.prescription,
        medicines: consultationFormData.medicines,
        testsRecommended: consultationFormData.testsRecommended
          .split(",")
          .map((test) => test.trim())
          .filter(Boolean),
        labReferralEnabled: consultationFormData.labReferralEnabled,
        labReferralDate: consultationFormData.labReferralDate || null,
        labReferralPriority: consultationFormData.labReferralPriority,
        advice: consultationFormData.advice,
        notes: consultationFormData.notes,
        followUpDate: consultationFormData.followUpDate || null,
        completedFollowUpConsultationId: consultationFormData.completedFollowUpConsultationId || null,
      });
      const savedConsultation = consultationResponse?.consultation;
      if (savedConsultation) {
        setLastCompletedPrescription({
          consultation: {
            ...savedConsultation,
            doctor: {
              ...(savedConsultation.doctor && typeof savedConsultation.doctor === "object" ? savedConsultation.doctor : {}),
              name: currentDoctor?.name || "Medical Officer",
              department: currentDoctor?.department || savedConsultation.department,
              prescriptionProfile: doctorPrescriptionProfile || {},
            },
          },
          token: prescriptionTokenSnapshot,
          patient: prescriptionPatientSnapshot,
        });
      }
      await fetchTodayDoctorAppointments();

      setConsultationFormData({
      symptoms: "",
      diagnosis: "",
      prescription: "",
      medicines: [{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
      testsRecommended: "",
      labReferralEnabled: false,
      labReferralDate: "",
      labReferralPriority: "routine",
      advice: "",
      notes: "",
      followUpDate: "",
      completedFollowUpConsultationId: "",
    });
      setPendingFollowUps([]);
      setConsultationErrorMessage("");
    } catch (error) {
      console.error("Complete consultation error:", error);
      setConsultationErrorMessage(
        error.response?.data?.message || "Unable to save consultation record."
      );
    } finally {
      setIsSavingConsultation(false);
    }
  };

  const handleDoctorSignOut = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const patientAge = activePatientEhr ? calculatePatientAge(activePatientEhr.dateOfBirth) : null;
  const doctorNormalizedAllergies = normalizeToArray(activePatientEhr?.allergies);
  const doctorNormalizedHistory = normalizeToArray(activePatientEhr?.medicalHistory);
  const doctorNormalizedMedications = normalizeToArray(activePatientEhr?.currentMedications);
  const doctorNormalizedSurgeries = normalizeToArray(activePatientEhr?.pastSurgeries);
  const doctorCompletionRate = doctorQueue.length
    ? Math.round((completedPatientsList.length / doctorQueue.length) * 100)
    : 0;
  const emergencyWaitingPatients = waitingPatientsList.filter((item) => item.urgency === "emergency");
  const nextThreePatients = waitingPatientsList.slice(0, 3);
  const bookedAppointments = todayDoctorAppointments.filter((item) => item.status === "booked").length;
  const checkedInAppointments = todayDoctorAppointments.filter((item) => item.status === "checked_in").length;

  return (
    <main className="page premium-page">
      <section className="doctor-command-hero">
        <div className="doctor-command-intro">
          <span className="doctor-command-kicker"><Stethoscope size={15} /> <Trans text={"Clinical Command Center"} /></span>
          <h1><Trans text={"Good day, Dr. "} />{currentDoctor?.name || t("Practitioner")}</h1>
          <p><Trans text={"Run today’s queue, review patient context, document consultations and issue prescriptions from one focused workspace."} /></p>
          <div className="doctor-command-meta">
            <span><Activity size={14} /> {doctorDepartment}</span>
            <span><ShieldCheck size={14} /> <Trans text={"Secure clinical session"} /></span>
            <span className={emergencyWaitingPatients.length ? "doctor-meta-alert" : ""}>
              <ShieldAlert size={14} /> {emergencyWaitingPatients.length} <Trans text={"emergency waiting"} /></span>
          </div>
        </div>
        <div className="doctor-command-actions">
          <div className="doctor-shift-status">
            <i className={activeCalledPatient ? "busy" : "ready"} />
            <div>
              <small><Trans text={"WORKSTATION STATUS"} /></small>
              <strong>{t(activeCalledPatient ? "Consultation in progress" : "Ready for next patient")}</strong>
            </div>
          </div>
          <button type="button" className="ghost" onClick={handleDoctorSignOut}>
            <LogOut size={15} /> <Trans text={"End Shift"} /></button>
        </div>
      </section>

      <section className="doctor-command-kpis">
        <article>
          <span className="doctor-kpi-icon"><Users size={18} /></span>
          <div><small><Trans text={"Today’s Queue"} /></small><strong>{doctorQueue.length}</strong><em>{waitingPatientsList.length} <Trans text={"waiting"} /></em></div>
        </article>
        <article>
          <span className="doctor-kpi-icon"><CheckCircle size={18} /></span>
          <div><small><Trans text={"Completed"} /></small><strong>{completedPatientsList.length}</strong><em>{doctorCompletionRate}<Trans text={"% throughput"} /></em></div>
        </article>
        <article>
          <span className="doctor-kpi-icon"><Calendar size={18} /></span>
          <div><small><Trans text={"Appointments"} /></small><strong>{todayDoctorAppointments.length}</strong><em>{checkedInAppointments} <Trans text={"checked in · "} />{bookedAppointments} <Trans text={"booked"} /></em></div>
        </article>
        <article className={emergencyWaitingPatients.length ? "critical" : ""}>
          <span className="doctor-kpi-icon"><ShieldAlert size={18} /></span>
          <div><small><Trans text={"Emergency"} /></small><strong>{emergencyWaitingPatients.length}</strong><em>{t(emergencyWaitingPatients.length ? "Needs priority review" : "No urgent cases")}</em></div>
        </article>
        <article>
          <span className="doctor-kpi-icon"><BarChart3 size={18} /></span>
          <div><small><Trans text={"Patient Rating"} /></small><strong>{doctorFeedbackSummary.averageRating || "—"}</strong><em>{doctorFeedbackSummary.total} <Trans text={"feedback"} /></em></div>
        </article>
      </section>

      <div className="doctor-focus-grid">
        <section className={`card doctor-current-focus ${activeCalledPatient?.urgency === "emergency" ? "emergency" : ""}`}>
          <div className="doctor-section-heading">
            <div>
              <p className="eyebrow"><Trans text={"Current Consultation"} /></p>
              <h2>{activeCalledPatient ? activeCalledPatient.patientName : t("No patient in room")}</h2>
            </div>
            <span className="doctor-current-token">#{activeCalledPatient?.tokenNumber ?? "—"}</span>
          </div>

          {activeCalledPatient ? (
            <>
              <div className="doctor-current-details">
                <span><b>{t(activeCalledPatient.department)}</b><small><Trans text={"Department"} /></small></span>
                <span><b>{t(activeCalledPatient.queueSource === "appointment" ? "Appointment" : "FCFS")}</b><small><Trans text={"Visit source"} /></small></span>
                <span><b>{activeCalledPatient.urgency === "emergency" ? t("Emergency") : t("Normal")}</b><small><Trans text={"Priority"} /></small></span>
              </div>
              {activeCalledPatient.urgency === "emergency" && (
                <div className="doctor-emergency-alert" role="alert">
                  <ShieldAlert size={18} />
                  <div><strong><Trans text={"EMERGENCY CASE"} /></strong><span><Trans text={"Prioritize clinical assessment for this patient."} /></span></div>
                </div>
              )}
              <div className="doctor-current-actions">
                <button type="button" className="danger" disabled={isSavingConsultation} onClick={() => updateTokenStatus(activeCalledPatient._id, "skipped")}>
                  <SkipForward size={16} /> <Trans text={"Mark Skipped"} /></button>
                <a className="ghost doctor-jump-link" href="#doctor-consultation-form"><FileText size={15} /> <Trans text={"Open Consultation"} /></a>
              </div>
            </>
          ) : (
            <div className="doctor-empty-current">
              <Stethoscope size={36} />
              <strong><Trans text={"Ready for the next consultation"} /></strong>
              <span>{waitingPatientsList.length ? t("{count} patients are waiting in your queue.", { count: waitingPatientsList.length }) : t("Your queue is currently clear.")}</span>
              <button type="button" className="primary" disabled={!waitingPatientsList.length} onClick={callNextPatientInQueue}>
                <UserCheck size={16} /> <Trans text={"Call Next Patient"} /></button>
            </div>
          )}
        </section>

        <section className="card doctor-next-panel">
          <div className="doctor-section-heading compact">
            <div><p className="eyebrow"><Trans text={"Queue Preview"} /></p><h2><Trans text={"Next Patients"} /></h2></div>
            <span className="doctor-queue-count">{waitingPatientsList.length} <Trans text={"waiting"} /></span>
          </div>
          <div className="doctor-next-list">
            {nextThreePatients.map((tokenItem, index) => (
              <article className={tokenItem.urgency === "emergency" ? "emergency" : ""} key={tokenItem._id}>
                <span className="doctor-next-rank">{index + 1}</span>
                <div><strong>#{tokenItem.tokenNumber} · {tokenItem.patientName}</strong><small>{t(tokenItem.queueSource === "appointment" ? "Scheduled appointment" : "FCFS / checked-in")}</small></div>
                <span className={`doctor-priority-chip ${tokenItem.urgency}`}>{t(tokenItem.urgency)}</span>
                <button type="button" className="small" disabled={Boolean(activeCalledPatient)} onClick={() => updateTokenStatus(tokenItem._id, "called")}><Trans text={"Call"} /></button>
              </article>
            ))}
            {!nextThreePatients.length && <div className="doctor-next-empty"><CheckCircle size={22} /><span><Trans text={"No patients are waiting."} /></span></div>}
          </div>
          {waitingPatientsList.length > 3 && <small className="doctor-more-queue">+{waitingPatientsList.length - 3} <Trans text={"more patients in queue"} /></small>}
        </section>
      </div>

      <details className="card doctor-appointments-card doctor-workspace-dropdown">
        <summary>
          <div><Calendar size={18}/><span><b><Trans text={"Today’s Scheduled Appointments"} /></b><small><Trans text={"Booked visits and live check-in status"} /></small></span></div>
          <strong>{todayDoctorAppointments.length}</strong>
        </summary>
        <div className="doctor-dropdown-body">
          <div className="appointment-list">
            {todayDoctorAppointments.map(a=>{
              const liveToken=doctorQueue.find(t=>String(t.appointment||"")===String(a._id));
              return <div className="appointment-row" key={a._id}>
                <div><strong>{a.startTime} · {a.patientName}</strong><small>{a.reason||t(a.department)}</small></div>
                <span className={`appointment-status ${a.status}`}>{a.status.replace("_"," ")}</span>
                {liveToken && <span className="appointment-token-chip"><Trans text={"Token #"} />{liveToken.tokenNumber}</span>}
                {liveToken?.status==="waiting" && <button type="button" className="small" disabled={Boolean(activeCalledPatient)} onClick={()=>updateTokenStatus(liveToken._id,"called")}><Trans text={"Call Appointment"} /></button>}
              </div>
            })}
            {!todayDoctorAppointments.length && <p className="muted"><Trans text={"No appointments scheduled for today."} /></p>}
          </div>
        </div>
      </details>

      {/* PATIENT EHR SNAPSHOT */}
      <section className="card doctor-medical-profile">
        <div className="card-title">
          <Activity />
          <h2><Trans text={"Active Patient EHR Profile"} /></h2>
        </div>

        {!activeCalledPatient && (
          <p className="muted"><Trans text={"Call a patient to inspect their comprehensive medical history, allergies, and prescriptions."} /></p>
        )}

        {activeCalledPatient && isEhrLoading && (
          <p className="muted"><Trans text={"Retrieving electronic health records..."} /></p>
        )}

        {activeCalledPatient && !isEhrLoading && ehrErrorMessage && (
          <div className="doctor-profile-warning">{t(ehrErrorMessage)}</div>
        )}

        {activeCalledPatient && !isEhrLoading && activePatientEhr && (
          <>
            <div className="doctor-patient-summary">
              <div>
                <span><Trans text={"Patient ID"} /></span>
                <strong>{activePatientEhr.patientId || "—"}</strong>
              </div>
              <div>
                <span><Trans text={"Blood Group"} /></span>
                <strong>{activePatientEhr.bloodGroup || "Unrecorded"}</strong>
              </div>
              <div>
                <span><Trans text={"Biological Gender"} /></span>
                <strong>{t(activePatientEhr.gender) || "Unrecorded"}</strong>
              </div>
              <div>
                <span><Trans text={"Age / DOB"} /></span>
                <strong>{patientAge !== null ? `${patientAge} yrs` : "Unrecorded"}</strong>
              </div>
            </div>

            <div className="doctor-medical-section">
              <h3><Trans text={"Known Allergies & Drug Reactions"} /></h3>
              {doctorNormalizedAllergies.length > 0 ? (
                <div className="medical-tags">
                  {doctorNormalizedAllergies.map((allergy, index) => (
                    <span key={index} className="medical-tag allergy-tag">
                      {allergy}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted"><Trans text={"No known allergies documented."} /></p>
              )}
            </div>

            <div className="doctor-medical-section">
              <h3><Trans text={"Past Medical History & Chronic Conditions"} /></h3>
              {doctorNormalizedHistory.length > 0 ? (
                <ul className="medical-list">
                  {doctorNormalizedHistory.map((condition, index) => (
                    <li key={index}>{condition}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted"><Trans text={"No prior chronic conditions recorded."} /></p>
              )}
            </div>

            <div className="doctor-medical-section">
              <h3><Trans text={"Current Medications & Regular Dosages"} /></h3>
              {doctorNormalizedMedications.length > 0 ? (
                <ul className="medical-list">
                  {doctorNormalizedMedications.map((medicine, index) => (
                    <li key={index}>{medicine}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted"><Trans text={"No ongoing prescriptions on file."} /></p>
              )}
            </div>

            <div className="doctor-medical-section">
              <h3><Trans text={"Past Surgeries & Major Procedures"} /></h3>
              {doctorNormalizedSurgeries.length > 0 ? (
                <ul className="medical-list">
                  {doctorNormalizedSurgeries.map((surgery, index) => (
                    <li key={index}>{surgery}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted"><Trans text={"No past surgeries recorded."} /></p>
              )}
            </div>

            <div className="doctor-medical-section">
              <h3><Trans text={"Emergency Contact"} /></h3>
              {activePatientEhr.emergencyContact?.name || activePatientEhr.emergencyContact?.phone ? (
                <p style={{ margin: 0 }}>
                  <strong>{activePatientEhr.emergencyContact?.name || "Unnamed contact"}</strong>
                  {activePatientEhr.emergencyContact?.phone && ` · ${activePatientEhr.emergencyContact.phone}`}
                </p>
              ) : (
                <p className="muted"><Trans text={"No emergency contact provided."} /></p>
              )}
            </div>
          </>
        )}
      </section>

      {/* PREVIOUS CLINICAL HISTORY SNAPSHOT */}
      <section className="card doctor-history-snapshot">
        <div className="card-title">
          <Activity />
          <h2><Trans text={"Previous Clinical History · Last 3 Visits"} /></h2>
        </div>

        {!activeCalledPatient && (
          <p className="muted"><Trans text={"Call a registered patient to securely review their recent completed visits."} /></p>
        )}

        {activeCalledPatient && !activeCalledPatient.patient && (
          <div className="doctor-profile-warning">
            <Trans text={"Previous clinical history is unavailable because this token is not linked to a registered EHR profile."} /></div>
        )}

        {activeCalledPatient?.patient && isPreviousConsultationsLoading && (
          <p className="muted"><Trans text={"Loading the patient's recent clinical visits..."} /></p>
        )}

        {activeCalledPatient?.patient && !isPreviousConsultationsLoading && previousConsultationsError && (
          <div className="doctor-profile-warning">{t(previousConsultationsError)}</div>
        )}

        {activeCalledPatient?.patient &&
          !isPreviousConsultationsLoading &&
          !previousConsultationsError &&
          previousConsultations.length === 0 && (
            <div className="doctor-history-empty">
              <strong><Trans text={"No previous completed visits found."} /></strong>
              <span><Trans text={"This may be the patient's first recorded consultation in OPDfy."} /></span>
            </div>
          )}

        {activeCalledPatient?.patient &&
          !isPreviousConsultationsLoading &&
          previousConsultations.length > 0 && (
            <div className="doctor-history-list">
              {previousConsultations.map((visit, index) => {
                const visitMedicines = Array.isArray(visit.medicines)
                  ? visit.medicines.filter((medicine) => medicine?.name)
                  : [];
                const visitTests = Array.isArray(visit.testsRecommended)
                  ? visit.testsRecommended.filter(Boolean)
                  : [];

                return (
                  <details
                    className="doctor-history-visit"
                    key={visit._id}
                    open={index === 0}
                  >
                    <summary>
                      <div>
                        <strong><Trans text={"Visit "} />{index + 1}{index === 0 ? " · Most Recent" : ""}</strong>
                        <span>
                          {visit.createdAt ? new Date(visit.createdAt).toLocaleDateString("en-IN") : "Date unavailable"}
                          {" · "}
                          <Trans text={"Dr. "} />{visit.doctor?.name || "Unknown"}
                          {" · "}
                          {t(visit.department) || t(visit.token?.department) || "Department unavailable"}
                        </span>
                      </div>
                      {visit.token?.tokenNumber && (
                        <b><Trans text={"Token #"} />{visit.token.tokenNumber}</b>
                      )}
                    </summary>

                    <div className="doctor-history-grid">
                      <div>
                        <span><Trans text={"Symptoms"} /></span>
                        <p>{visit.symptoms || "Not documented"}</p>
                      </div>
                      <div>
                        <span><Trans text={"Diagnosis"} /></span>
                        <p><strong>{visit.diagnosis || "Not documented"}</strong></p>
                      </div>
                    </div>

                    <div className="doctor-history-section">
                      <span><Trans text={"Prescription / Medicines"} /></span>
                      {visitMedicines.length > 0 ? (
                        <div className="doctor-history-medicines">
                          {visitMedicines.map((medicine, medicineIndex) => (
                            <div className="doctor-history-medicine" key={`${visit._id}-medicine-${medicineIndex}`}>
                              <strong>{medicine.name}</strong>
                              <small>
                                {[medicine.dosage, medicine.frequency, medicine.duration]
                                  .filter(Boolean)
                                  .join(" · ") || "Dose details not recorded"}
                              </small>
                              {medicine.instructions && <em>{medicine.instructions}</em>}
                            </div>
                          ))}
                        </div>
                      ) : visit.prescription ? (
                        <p className="doctor-history-legacy-rx">{visit.prescription}</p>
                      ) : (
                        <p className="muted"><Trans text={"No prescription recorded."} /></p>
                      )}

                      {visitMedicines.length > 0 && visit.prescription && (
                        <p className="doctor-history-legacy-rx">
                          <strong><Trans text={"Additional Rx Notes:"} /></strong> {visit.prescription}
                        </p>
                      )}
                    </div>

                    <div className="doctor-history-grid">
                      <div>
                        <span><Trans text={"Tests Recommended"} /></span>
                        <p>{visitTests.length ? visitTests.join(", ") : "None recorded"}</p>
                      </div>
                      <div>
                        <span><Trans text={"Advice"} /></span>
                        <p>{visit.advice || "Not documented"}</p>
                      </div>
                      <div>
                        <span><Trans text={"Follow-up"} /></span>
                        <p>
                          {visit.followUpDate
                            ? new Date(visit.followUpDate).toLocaleDateString("en-IN")
                            : "No follow-up date"}
                        </p>
                      </div>
                      <div>
                        <span><Trans text={"Clinical Notes"} /></span>
                        <p>{visit.notes || "Not documented"}</p>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}

        {activeCalledPatient?.patient && (
          <p className="doctor-history-privacy-note">
            <Trans text={"Secure snapshot: only the doctor currently assigned to this called patient can load these previous visits."} /></p>
        )}
      </section>

      {/* DIGITAL CONSULTATION RECORD / SOAP FORM */}
      <section className="card doctor-consultation-card" id="doctor-consultation-form">
        <div className="card-title">
          <Stethoscope />
          <h2><Trans text={"Consultation Record & Digital Prescription"} /></h2>
        </div>

        {!activeCalledPatient && (
          <p className="muted"><Trans text={"Call a patient to initiate the digital consultation SOAP form."} /></p>
        )}

        {activeCalledPatient && !activeCalledPatient.patient && (
          <div className="doctor-profile-warning">
            <Trans text={"This token was issued as an anonymous walk-in. An official EHR prescription record cannot be bound to this token."} /></div>
        )}

        {activeCalledPatient && activeCalledPatient.patient && (
          <form className="consultation-form" onSubmit={handleCompleteConsultation}>
            <div className="consultation-patient-banner">
              <div>
                <span><Trans text={"Patient Name"} /></span>
                <strong>{activeCalledPatient.patientName}</strong>
              </div>
              <div>
                <span><Trans text={"Queue Token"} /></span>
                <strong>#{activeCalledPatient.tokenNumber}</strong>
              </div>
              <div>
                <span><Trans text={"Department"} /></span>
                <strong>{t(activeCalledPatient.department)}</strong>
              </div>
            </div>

            <label>
              <Trans text={"Presenting Symptoms & Clinical Complaints"} /><textarea
                name="symptoms"
                value={consultationFormData.symptoms}
                onChange={handleConsultationInputChange}
                placeholder={t("Detail patient symptoms, duration, and severity...")}
                rows={3}
              />
            </label>

            <label>
              <Trans text={"Clinical Diagnosis *"} /><textarea
                name="diagnosis"
                value={consultationFormData.diagnosis}
                onChange={handleConsultationInputChange}
                placeholder={t("Enter clinical assessment or ICD-10 code...")}
                rows={2}
                required
              />
            </label>

            <div className="prescription-editor">
              <div className="prescription-editor-title">
                <div>
                  <strong><Trans text={"Digital Prescription (Rx)"} /></strong>
                  <small><Trans text={"Add medicines with dosage, frequency and duration."} /></small>
                </div>
                <button type="button" className="small" onClick={addMedicineRow}>
                  <Plus size={14} /> <Trans text={"Add Medicine"} /></button>
              </div>

              {(consultationFormData.medicines || []).map((medicine, index) => (
                <div className="medicine-row" key={`medicine-${index}`}>
                  <input value={medicine.name} onChange={(e) => updateMedicineRow(index, "name", e.target.value)} placeholder={t("Medicine name")} />
                  <input value={medicine.dosage} onChange={(e) => updateMedicineRow(index, "dosage", e.target.value)} placeholder={t("Dosage (500 mg)")} />
                  <input value={medicine.frequency} onChange={(e) => updateMedicineRow(index, "frequency", e.target.value)} placeholder={t("Frequency (BD/TDS)")} />
                  <input value={medicine.duration} onChange={(e) => updateMedicineRow(index, "duration", e.target.value)} placeholder={t("Duration (5 days)")} />
                  <input value={medicine.instructions} onChange={(e) => updateMedicineRow(index, "instructions", e.target.value)} placeholder={t("After food / bedtime")} />
                  <button type="button" className="ghost medicine-remove" onClick={() => removeMedicineRow(index)} aria-label={t("Remove medicine")}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}

              <label>
                <Trans text={"Additional Rx Notes"} /><textarea
                  name="prescription"
                  value={consultationFormData.prescription}
                  onChange={handleConsultationInputChange}
                  placeholder={t("Optional additional prescription instructions...")}
                  rows={2}
                />
              </label>

              <div className="doctor-lab-referral-editor">
                <div className="doctor-lab-referral-title">
                  <div>
                    <strong><Trans text={"Lab Referral"} /></strong>
                    <span><Trans text={"Create a structured referral with tests, date, priority, and status tracking."} /></span>
                  </div>
                  <label className="lab-referral-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(consultationFormData.labReferralEnabled)}
                      onChange={(event) =>
                        setConsultationFormData((current) => ({
                          ...current,
                          labReferralEnabled: event.target.checked,
                        }))
                      }
                    />
                    <Trans text={"Create Lab Referral"} /></label>
                </div>

                <label>
                  <Trans text={"Tests / Investigations"} /><input
                    name="testsRecommended"
                    value={consultationFormData.testsRecommended}
                    onChange={handleConsultationInputChange}
                    placeholder={t("CBC, LFT, ECG (comma separated)")}
                  />
                </label>

                {consultationFormData.labReferralEnabled && (
                  <div className="lab-referral-fields">
                    <label>
                      <Trans text={"Referral Date"} /><input
                        type="date"
                        name="labReferralDate"
                        value={consultationFormData.labReferralDate}
                        onChange={handleConsultationInputChange}
                      />
                    </label>
                    <label>
                      <Trans text={"Priority"} /><select
                        name="labReferralPriority"
                        value={consultationFormData.labReferralPriority}
                        onChange={handleConsultationInputChange}
                      >
                        <option value="routine">{t("Routine")}</option>
                        <option value="urgent">{t("Urgent")}</option>
                      </select>
                    </label>
                  </div>
                )}

                {consultationFormData.labReferralEnabled &&
                  !consultationFormData.testsRecommended.trim() && (
                    <small className="lab-referral-hint">
                      <Trans text={"Add at least one test to create the lab referral."} /></small>
                  )}
              </div>
            </div>

            <label>
              <Trans text={"Physician Advice & Lifestyle Instructions"} /><textarea
                name="advice"
                value={consultationFormData.advice}
                onChange={handleConsultationInputChange}
                placeholder={t("Dietary instructions, rest, hydration, clinical tests to order...")}
                rows={2}
              />
            </label>

            <label>
              <Trans text={"Physician Notes (Internal Record)"} /><textarea
                name="notes"
                value={consultationFormData.notes}
                onChange={handleConsultationInputChange}
                placeholder={t("Confidential doctor notes, differentials, or internal hospital flags...")}
                rows={2}
              />
            </label>

            <div className="followup-source-field">
              <label>
                {t("Complete a previous follow-up (optional)")}
                <select name="completedFollowUpConsultationId"
                  value={consultationFormData.completedFollowUpConsultationId}
                  onChange={handleConsultationInputChange}>
                  <option value="">{t("No previous follow-up selected")}</option>
                  {pendingFollowUps.map((plan) => (
                    <option key={plan.consultationId} value={plan.consultationId}>
                      {t(plan.department)} · {t("Recommended date")}: {plan.dueDate} · {t(plan.status)}
                    </option>
                  ))}
                </select>
              </label>
              <small className="muted">{t("Select the earlier recommendation only if this consultation completes that follow-up. Linked appointments are recognized automatically.")}</small>
              {followUpRecommendationError && <small className="login-error" role="alert">{t(followUpRecommendationError)}</small>}
            </div>

            <label>
              <Trans text={"Follow-Up Review Date"} /><input
                type="date"
                name="followUpDate"
                value={consultationFormData.followUpDate}
                onChange={handleConsultationInputChange}
              />
            </label>

            {consultationErrorMessage && <div className="login-error" role="alert">{t(consultationErrorMessage)}</div>}

            <button type="submit" className="primary wide" disabled={isSavingConsultation}>
              <CheckCircle size={16} />
              {t(isSavingConsultation ? "Saving Consultation..." : "Complete Consultation & Save Prescription")}
            </button>
          </form>
        )}
      </section>

      <DoctorReferrals currentDoctor={currentDoctor} activeToken={activeCalledPatient} recentTokens={completedPatientsList} />

      {lastCompletedPrescription && (
        <details className="card doctor-prescription-ready" open>
          <summary>
            <span><FileText size={17} /> <Trans text={"Prescription Ready"} /></span>
            <small><Trans text={"Clinic-branded A4 parcha for the consultation just completed"} /></small>
          </summary>
          <div className="doctor-prescription-ready-body">
            <div>
              <strong>{lastCompletedPrescription.patient?.name || t("Patient")}</strong>
              <span><Trans text={"Token #"} />{lastCompletedPrescription.token?.tokenNumber || "-"} · {t(lastCompletedPrescription.token?.department) || t(lastCompletedPrescription.consultation?.department) || "OPD"}</span>
            </div>
            <div className="doctor-prescription-ready-actions">
              <button type="button" className="ghost" onClick={() => downloadPrescriptionPdf(lastCompletedPrescription.consultation, lastCompletedPrescription.token, lastCompletedPrescription.patient, doctorClinicContext)}><Download size={15} /> <Trans text={"Download PDF"} /></button>
              <button type="button" className="primary" onClick={() => printPrescription(lastCompletedPrescription.consultation, lastCompletedPrescription.token, lastCompletedPrescription.patient, doctorClinicContext)}><Printer size={15} /> <Trans text={"Print Branded Parcha"} /></button>
            </div>
          </div>
        </details>
      )}

      {/* DOCTOR FEEDBACK SECTION */}
      <details className="card doctor-feedback-section doctor-feedback-dropdown">
        <summary className="doctor-feedback-dropdown-header">
          <div className="doctor-feedback-dropdown-title">
            <div>
              <p className="eyebrow"><Trans text={"Patient Experience"} /></p>
              <h2><Trans text={"Patient Feedback"} /></h2>
              <p className="muted">
                <Trans text={"Feedback submitted by patients after completed consultations with you."} /></p>
            </div>

            <div className="feedback-summary-chip">
              <strong>{doctorFeedbackSummary.averageRating || "—"} ★</strong>
              <span>{doctorFeedbackSummary.total} <Trans text={"feedback"} /></span>
            </div>
          </div>

          <span className="feedback-dropdown-arrow doctor-feedback-dropdown-arrow" aria-hidden="true">
            ⌄
          </span>
        </summary>

        <div className="doctor-feedback-dropdown-content">
          {doctorFeedbackLoading ? (
            <p className="muted"><Trans text={"Loading patient feedback..."} /></p>
          ) : doctorFeedback.length ? (
            <div className="feedback-record-list">
              {doctorFeedback.map((item) => (
                <article className="feedback-record" key={item._id}>
                  <div className="feedback-record-head">
                    <div>
                      <strong>{item.patient?.name || t("Patient")}</strong>
                      <span>
                        {item.patient?.patientId || "Registered patient"} · {t(item.department)}
                      </span>
                    </div>
                    <b>{item.rating}/5 ★</b>
                  </div>
                  <p>
                    {item.comment ||
                      "Patient submitted a rating without a written comment."}
                  </p>
                  <small>{new Date(item.createdAt).toLocaleString("en-IN")}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted"><Trans text={"No patient feedback has been submitted yet."} /></p>
          )}
        </div>
      </details>


    </main>
  );
}

/* =========================================================
   ADMIN: SECURE WAITING LOUNGE DISPLAY MANAGER
========================================================= */

function AdminWaitingLoungeDisplaysPage() {
  const { t } = useLanguage();
  const [displays, setDisplays] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "Waiting Lounge TV",
    department: "All Departments",
    doctorId: "",
    voiceEnabled: true,
    language: "en-IN",
    volume: 1,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: displayData }, { data: staffData }] = await Promise.all([
        api.get("/admin/waiting-lounge-displays"),
        api.get("/admin/users"),
      ]);
      setDisplays(displayData?.displays || []);
      setDoctors((staffData || []).filter((item) => item.role === "doctor"));
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load TV display settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visibleDoctors = form.department === "All Departments"
    ? doctors
    : doctors.filter((doctor) => doctor.department === form.department);

  const createDisplay = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await api.post("/admin/waiting-lounge-displays", {
        name: form.name,
        department: form.department,
        doctorId: form.doctorId || null,
        voice: {
          enabled: form.voiceEnabled,
          language: form.language,
          volume: Number(form.volume),
        },
      });
      setMessage("Secure TV display created. Open or copy its dedicated link below.");
      setForm((current) => ({ ...current, name: "Waiting Lounge TV", doctorId: "" }));
      await load();
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to create TV display.");
    } finally {
      setSaving(false);
    }
  };

  const patchDisplay = async (display, patch) => {
    try {
      const next = {
        name: patch.name ?? display.name,
        department: patch.department ?? display.department,
        doctorId: patch.doctorId !== undefined
          ? patch.doctorId
          : (display.doctor?._id || display.doctor || ""),
        voice: patch.voice ?? display.voice,
        isEnabled: patch.isEnabled ?? display.isEnabled,
      };
      await api.patch(`/admin/waiting-lounge-displays/${display._id}`, next);
      await load();
    } catch (error) {
      alert(localizeUi(error.response?.data?.message || "Unable to update display."));
    }
  };

  const copyDisplayLink = async (display) => {
    const url = `${window.location.origin}${display.displayPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Copied secure link for ${display.name}.`);
    } catch {
      window.prompt(localizeUi("Copy this secure TV link:"), url);
    }
  };

  const rotateKey = async (display) => {
    if (!confirm(localizeUi(`Regenerate the secure link for ${display.name}? The old TV link will stop working.`))) return;
    try {
      await api.post(`/admin/waiting-lounge-displays/${display._id}/rotate-key`);
      setMessage(`New secure link generated for ${display.name}.`);
      await load();
    } catch (error) {
      alert(localizeUi(error.response?.data?.message || "Unable to regenerate display link."));
    }
  };

  const deleteDisplay = async (display) => {
    if (!confirm(localizeUi(`Remove ${display.name}? Its secure TV link will stop working.`))) return;
    try {
      await api.delete(`/admin/waiting-lounge-displays/${display._id}`);
      await load();
    } catch (error) {
      alert(localizeUi(error.response?.data?.message || "Unable to remove display."));
    }
  };

  return (
    <main className="page premium-page">
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Hospital Display Control"} /></p>
          <h1><Trans text={"Waiting Lounge TV Displays"} /></h1>
          <p className="page-subtitle">
            <Trans text={"Create a separate secure display for each department or doctor. Only the queue shown on that TV can trigger its voice announcement."} /></p>
        </div>
        <Link to="/admin" className="ghost button-like"><ChevronRight size={15} /> <Trans text={"Back to Admin"} /></Link>
      </div>

      <section className="card display-manager-create">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow"><Trans text={"New Physical Display"} /></p>
            <h2><Monitor size={20} /> <Trans text={"Provision TV / Monitor"} /></h2>
            <p className="muted"><Trans text={"The generated link is clinic-specific and can run continuously in a browser on a Smart TV, PC, Android TV box, or mini-PC."} /></p>
          </div>
        </div>

        <form className="display-config-grid" onSubmit={createDisplay}>
          <label>
            <Trans text={"Display name"} /><input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            <Trans text={"View department"} /><select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value, doctorId: "" })}
            >
              <option value="All Departments">{t("All Departments")}</option>
              {CLINICAL_DEPARTMENTS.map((department) => (
                <option key={department.value} value={department.value}>{t(department.label)}</option>
              ))}
            </select>
          </label>
          <label>
            <Trans text={"Doctor filter "} /><small><Trans text={"(optional)"} /></small>
            <select value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
              <option value="">{t("All doctors in selection")}</option>
              {visibleDoctors.map((doctor) => (
                <option key={doctor._id} value={doctor._id}>{t("Dr. ")}{doctor.name} — {t(doctor.department)}</option>
              ))}
            </select>
          </label>
          <label>
            <Trans text={"Voice language"} /><select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              <option value="en-IN">{t("English")}</option>
              <option value="hi-IN">हिन्दी</option>
            </select>
          </label>
          <label className="display-volume-field">
            <Trans text={"Voice volume "} /><b>{Math.round(Number(form.volume) * 100)}%</b>
            <input type="range" min="0.2" max="1" step="0.1" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} />
          </label>
          <label className="display-toggle-field">
            <input type="checkbox" checked={form.voiceEnabled} onChange={(e) => setForm({ ...form, voiceEnabled: e.target.checked })} />
            <span><Volume2 size={16} /> <Trans text={"Enable voice on this TV"} /></span>
          </label>
          <button type="submit" className="primary" disabled={saving}>
            <Plus size={16} /> {t(saving ? "Creating..." : "Create Secure Display")}
          </button>
        </form>
        {message && <p className="display-manager-message">{t(message)}</p>}
      </section>

      <section className="card">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow"><Trans text={"Active Screens"} /></p>
            <h2><Trans text={"Configured Displays"} /></h2>
          </div>
          <button type="button" className="ghost small" onClick={load}><RefreshCw size={14} /> <Trans text={"Refresh"} /></button>
        </div>

        {loading ? (
          <div className="analytics-empty"><Trans text={"Loading TV displays..."} /></div>
        ) : !displays.length ? (
          <div className="analytics-empty"><Trans text={"No physical waiting-lounge displays have been provisioned yet."} /></div>
        ) : (
          <div className="display-profile-list">
            {displays.map((display) => {
              const selectedDoctorId = display.doctor?._id || display.doctor || "";
              const doctorOptions = display.department === "All Departments"
                ? doctors
                : doctors.filter((doctor) => doctor.department === display.department);
              return (
                <article className={`display-profile-card ${display.isEnabled ? "" : "disabled"}`} key={display._id}>
                  <div className="display-profile-head">
                    <div>
                      <span className="display-screen-icon"><Monitor size={20} /></span>
                      <div><b>{display.name}</b><small>{t(display.isEnabled ? "Secure display active" : "Display disabled")}</small></div>
                    </div>
                    <label className="display-inline-toggle">
                      <input type="checkbox" checked={display.isEnabled} onChange={(e) => patchDisplay(display, { isEnabled: e.target.checked })} />
                      <Trans text={"Enabled"} /></label>
                  </div>

                  <div className="display-profile-settings">
                    <label>
                      <Trans text={"View department"} /><select value={display.department} onChange={(e) => patchDisplay(display, { department: e.target.value, doctorId: "" })}>
                        <option value="All Departments">{t("All Departments")}</option>
                        {CLINICAL_DEPARTMENTS.map((department) => <option key={department.value} value={department.value}>{t(department.label)}</option>)}
                      </select>
                    </label>
                    <label>
                      <Trans text={"Doctor"} /><select value={selectedDoctorId} onChange={(e) => patchDisplay(display, { doctorId: e.target.value })}>
                        <option value="">{t("All doctors in selection")}</option>
                        {doctorOptions.map((doctor) => <option key={doctor._id} value={doctor._id}>{t("Dr. ")}{doctor.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <Trans text={"Voice"} /><select
                        value={display.voice?.enabled === false ? "off" : display.voice?.language || "en-IN"}
                        onChange={(e) => patchDisplay(display, {
                          voice: {
                            ...(display.voice || {}),
                            enabled: e.target.value !== "off",
                            language: e.target.value === "off" ? (display.voice?.language || "en-IN") : e.target.value,
                          },
                        })}
                      >
                        <option value="en-IN">{t("English voice")}</option>
                        <option value="hi-IN">{t("हिन्दी voice")}</option>
                        <option value="off">{t("Voice off")}</option>
                      </select>
                    </label>
                    <label>
                      <Trans text={"Volume "} />{Math.round(Number(display.voice?.volume || 1) * 100)}%
                      <input
                        type="range"
                        min="0.2"
                        max="1"
                        step="0.1"
                        value={display.voice?.volume || 1}
                        onChange={(e) => patchDisplay(display, { voice: { ...(display.voice || {}), volume: Number(e.target.value) } })}
                      />
                    </label>
                  </div>

                  <div className="display-profile-summary">
                    <span><Stethoscope size={14} /> {t(display.department)}</span>
                    <span><UserCheck size={14} /> {display.doctor?.name ? `Dr. ${display.doctor.name}` : t("All matching doctors")}</span>
                    <span>{display.voice?.enabled === false ? <VolumeX size={14} /> : <Volume2 size={14} />} {t(display.voice?.enabled === false ? "Silent" : "TV voice enabled")}</span>
                  </div>

                  <div className="display-profile-actions">
                    <button type="button" className="primary small" onClick={() => window.open(display.displayPath, "_blank", "noopener,noreferrer")} disabled={!display.isEnabled}>
                      <Monitor size={14} /> <Trans text={"Open TV Display"} /></button>
                    <button type="button" className="ghost small" onClick={() => copyDisplayLink(display)}><Trans text={"Copy Secure Link"} /></button>
                    <button type="button" className="ghost small" onClick={() => rotateKey(display)}><RefreshCw size={14} /> <Trans text={"Regenerate Link"} /></button>
                    <button type="button" className="danger small" onClick={() => deleteDisplay(display)}><Trash2 size={14} /> <Trans text={"Remove"} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

/* =========================================================
   SECURE PHYSICAL TV DISPLAY
   Voice can run here only; patient lounge never calls speech synthesis.
========================================================= */

function AdminClinicSettingsPage() {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    displayName: "",
    shortName: "",
    logoUrl: "",
    address: "",
    website: "",
    contactEmail: "",
    contactPhone: "",
    primaryColor: "#0f766e",
    accentColor: "#14b8a6",
    waitingLoungeWelcome: "Welcome. Please watch the screen for your token.",
    footerText: "",
  });
  const [clinicMeta, setClinicMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [prescriptionTemplate, setPrescriptionTemplate] = useState({
    title: "Prescription", headerNote: "", footerNote: "Please follow the treating physician's instructions.", watermarkText: "",
    showLogo: true, showClinicContact: true, showPatientId: true, showPatientAgeGender: true, showToken: true,
    showSymptoms: true, showDiagnosis: true, showTests: true, showAdvice: true, showFollowUp: true,
    showDoctorRegistration: true, showSignatureLine: true, watermarkEnabled: true,
  });
  const [prescriptionDoctors, setPrescriptionDoctors] = useState([]);
  const [selectedPrescriptionDoctorId, setSelectedPrescriptionDoctorId] = useState("");
  const [doctorPrescriptionProfile, setDoctorPrescriptionProfile] = useState({ qualification: "", specialization: "", registrationNumber: "", designation: "", signatureDataUrl: "" });
  const [clinicLegalVerification, setClinicLegalVerification] = useState({ ...EMPTY_CLINIC_VERIFICATION });
  const [clinicVerificationSaving, setClinicVerificationSaving] = useState(false);
  const [doctorProfessionalVerification, setDoctorProfessionalVerification] = useState({ ...EMPTY_DOCTOR_VERIFICATION });
  const [doctorVerificationDecision, setDoctorVerificationDecision] = useState("clinic_reviewed");
  const [doctorVerificationConfirmed, setDoctorVerificationConfirmed] = useState(false);
  const [doctorVerificationSaving, setDoctorVerificationSaving] = useState(false);
  const [prescriptionSaving, setPrescriptionSaving] = useState(false);
  const [doctorProfileSaving, setDoctorProfileSaving] = useState(false);
  const [operationsSettings, setOperationsSettings] = useState({
    clinicHoursEnabled: false,
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    openTime: "08:00", closeTime: "20:00", bookingCutoffMinutes: 30, checkInCutoffMinutes: 30, missedGraceMinutes: 30,
  });
  const [operationsStatus, setOperationsStatus] = useState(null);
  const [operationsSaving, setOperationsSaving] = useState(false);
  const [billingSettings, setBillingSettings] = useState({ enabled: true, clinicDefaultFee: 0, departmentFees: [], allowReceptionFeeOverride: false, maxDiscountPercent: 0 });
  const [billingSaving, setBillingSaving] = useState(false);
  const [exportRange, setExportRange] = useState({ fromDate: new Date().toISOString().slice(0,10), toDate: new Date().toISOString().slice(0,10) });

  const loadBranding = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/clinic-branding");
      const clinic = data?.clinic || {};
      setClinicMeta({ name: clinic.name || "Clinic", slug: clinic.slug || "" });
      setForm((current) => ({ ...current, ...clinic }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load clinic settings.");
    } finally {
      setLoading(false);
    }
  };

  const loadPrescriptionSettings = async () => {
    try {
      const { data } = await api.get("/admin/prescription-template");
      setPrescriptionTemplate((current) => ({ ...current, ...(data?.template || {}) }));
      const doctors = data?.doctors || [];
      setPrescriptionDoctors(doctors);
      if (doctors.length) {
        const first = doctors[0];
        setSelectedPrescriptionDoctorId(String(first._id));
        setDoctorPrescriptionProfile({ qualification: "", specialization: "", registrationNumber: "", designation: "", signatureDataUrl: "", ...(first.prescriptionProfile || {}) });
        setDoctorProfessionalVerification({ ...EMPTY_DOCTOR_VERIFICATION, ...(first.professionalVerification || {}), registrationExpiresAt: dateInputValue(first.professionalVerification?.registrationExpiresAt) });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load prescription designer.");
    }
  };

  const loadClinicLegalVerification = async () => {
    try {
      const { data } = await api.get("/admin/legal-verification");
      const verification = data?.legalVerification || {};
      setClinicLegalVerification({ ...EMPTY_CLINIC_VERIFICATION, ...verification, certificateExpiresAt: dateInputValue(verification.certificateExpiresAt) });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load clinic registration verification.");
    }
  };


  const loadOperationsSettings = async () => {
    try {
      const { data } = await api.get("/admin/operations-settings");
      if (data?.settings) setOperationsSettings((current) => ({ ...current, ...data.settings }));
      setOperationsStatus(data?.status || null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load clinic operating rules.");
    }
  };

  const loadBillingSettings = async () => {
    try {
      const { data } = await api.get("/admin/billing-settings");
      if (data?.settings) setBillingSettings((current) => ({ ...current, ...data.settings }));
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to load OPD billing rules."); }
  };

  const saveBillingSettings = async () => {
    setBillingSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.put("/admin/billing-settings", billingSettings);
      if (data?.settings) setBillingSettings((current) => ({ ...current, ...data.settings }));
      setMessage(data?.message || "OPD billing rules saved.");
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to save OPD billing rules."); }
    finally { setBillingSaving(false); }
  };

  const setDepartmentFee = (department, amount) => {
    setBillingSettings((current) => {
      const rest = (current.departmentFees || []).filter((item) => item.department !== department);
      if (String(amount).trim() === "") return { ...current, departmentFees: rest };
      return { ...current, departmentFees: [...rest, { department, amount: Number(amount) }] };
    });
  };

  const saveOperationsSettings = async () => {
    setOperationsSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.put("/admin/operations-settings", operationsSettings);
      if (data?.settings) setOperationsSettings((current) => ({ ...current, ...data.settings }));
      setOperationsStatus(data?.status || null);
      setMessage(data?.message || "Clinic operating rules saved.");
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to save operating rules."); }
    finally { setOperationsSaving(false); }
  };

  const changeQueueLifecycle = async (action) => {
    setError(""); setMessage("");
    try {
      const body = action === "close" ? { reason: window.prompt(localizeUi("Reason for closing new arrivals?"), "Front desk closed for new arrivals.") || "Front desk closed for new arrivals." } : {};
      const { data } = await api.post(`/admin/queue-lifecycle/${action}`, body);
      setOperationsStatus(data?.status || null);
      setMessage(data?.message || `Queue ${action}d.`);
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to update queue state."); }
  };

  const endDayAndArchive = async () => {
    if (!window.confirm(localizeUi("End today's queue? Waiting/called visits will be closed as skipped and all current tokens archived. Patient history is preserved."))) return;
    setError(""); setMessage("");
    try {
      const { data } = await api.post("/tokens/reset");
      setMessage(data?.message || "Daily queue archived.");
      await changeQueueLifecycle("close");
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to close the day."); }
  };

  const downloadAdminCsv = async (type) => {
    setError("");
    try {
      const response = await api.get("/admin/export", { params: { type, ...exportRange }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a"); link.href = url;
      link.download = `${type}-${exportRange.fromDate}-to-${exportRange.toDate}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (requestError) { setError("Unable to export this report."); }
  };

  useEffect(() => { loadBranding(); loadClinicLegalVerification(); loadPrescriptionSettings(); loadOperationsSettings(); loadBillingSettings(); }, []);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updatePrescriptionField = (field, value) => setPrescriptionTemplate((current) => ({ ...current, [field]: value }));

  const savePrescriptionTemplate = async () => {
    setPrescriptionSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.put("/admin/prescription-template", prescriptionTemplate);
      if (data?.template) setPrescriptionTemplate((current) => ({ ...current, ...data.template }));
      setMessage("Prescription template saved for this clinic.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save prescription template.");
    } finally { setPrescriptionSaving(false); }
  };

  const selectPrescriptionDoctor = (doctorId) => {
    setSelectedPrescriptionDoctorId(doctorId);
    const doctor = prescriptionDoctors.find((item) => String(item._id) === String(doctorId));
    setDoctorPrescriptionProfile({ qualification: "", specialization: "", registrationNumber: "", designation: "", signatureDataUrl: "", ...(doctor?.prescriptionProfile || {}) });
    setDoctorProfessionalVerification({ ...EMPTY_DOCTOR_VERIFICATION, ...(doctor?.professionalVerification || {}), registrationExpiresAt: dateInputValue(doctor?.professionalVerification?.registrationExpiresAt) });
    setDoctorVerificationDecision(doctor?.professionalVerification?.status === "rejected" ? "submitted" : "clinic_reviewed");
    setDoctorVerificationConfirmed(false);
  };

  const saveClinicLegalVerification = async () => {
    setClinicVerificationSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.put("/admin/legal-verification", clinicLegalVerification);
      const verification = data?.legalVerification || {};
      setClinicLegalVerification((current) => ({ ...current, ...verification, certificateExpiresAt: dateInputValue(verification.certificateExpiresAt) }));
      setMessage(data?.message || "Clinic registration details submitted for platform review.");
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to submit clinic registration details."); }
    finally { setClinicVerificationSaving(false); }
  };

  const saveDoctorProfessionalVerification = async () => {
    if (!selectedPrescriptionDoctorId) return;
    setDoctorVerificationSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.patch(`/admin/users/${selectedPrescriptionDoctorId}/professional-verification`, {
        ...doctorProfessionalVerification, decision: doctorVerificationDecision,
        confirmed: doctorVerificationDecision === "clinic_reviewed" ? doctorVerificationConfirmed : false,
      });
      const verification = data?.doctor?.professionalVerification || {};
      setDoctorProfessionalVerification((current) => ({ ...current, ...verification, registrationExpiresAt: dateInputValue(verification.registrationExpiresAt) }));
      setPrescriptionDoctors((current) => current.map((doctor) => String(doctor._id) === String(selectedPrescriptionDoctorId) ? { ...doctor, professionalVerification: verification } : doctor));
      setMessage(data?.message || "Doctor registration review saved."); setDoctorVerificationConfirmed(false);
    } catch (requestError) { setError(requestError.response?.data?.message || "Unable to save doctor registration review."); }
    finally { setDoctorVerificationSaving(false); }
  };

  const saveDoctorPrescriptionProfile = async () => {
    if (!selectedPrescriptionDoctorId) return;
    setDoctorProfileSaving(true); setError(""); setMessage("");
    try {
      const { data } = await api.patch(`/admin/users/${selectedPrescriptionDoctorId}/prescription-profile`, doctorPrescriptionProfile);
      setPrescriptionDoctors((current) => current.map((doctor) => String(doctor._id) === String(selectedPrescriptionDoctorId) ? { ...doctor, prescriptionProfile: data?.doctor?.prescriptionProfile || doctorPrescriptionProfile, professionalVerification: data?.doctor?.professionalVerification || doctor.professionalVerification } : doctor));
      if (data?.doctor?.professionalVerification) setDoctorProfessionalVerification((current) => ({ ...current, ...data.doctor.professionalVerification, registrationExpiresAt: dateInputValue(data.doctor.professionalVerification.registrationExpiresAt) }));
      setMessage(data?.message || "Doctor prescription details saved.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save doctor prescription details.");
    } finally { setDoctorProfileSaving(false); }
  };

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Logo upload supports PNG, JPG or WebP only.");
      event.target.value = "";
      return;
    }
    if (file.size > 150 * 1024) {
      setError("Keep the clinic logo under 150 KB so MongoDB storage stays lean.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateField("logoUrl", String(reader.result || ""));
      setError("");
    };
    reader.onerror = () => setError("Unable to read this logo file.");
    reader.readAsDataURL(file);
  };

  const handleDoctorSignatureUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Doctor signature supports PNG, JPG or WebP only.");
      event.target.value = "";
      return;
    }
    if (file.size > 150 * 1024) {
      setError("Keep the doctor signature under 150 KB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDoctorPrescriptionProfile((current) => ({ ...current, signatureDataUrl: String(reader.result || "") }));
      setError("");
    };
    reader.onerror = () => setError("Unable to read this signature image.");
    reader.readAsDataURL(file);
  };

  const saveBranding = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.put("/admin/clinic-branding", form);
      if (data?.clinic) setForm((current) => ({ ...current, ...data.clinic }));
      setMessage("Clinic branding saved. Portal and TV branding will use these settings.");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save clinic branding.");
    } finally {
      setSaving(false);
    }
  };

  const brandingStyle = {
    "--clinic-primary": form.primaryColor || "#0f766e",
    "--clinic-accent": form.accentColor || "#14b8a6",
  };

  return (
    <main className="page admin-clinic-settings-page" style={brandingStyle}>
      <section className="dashboard-banner clinic-settings-banner">
        <div>
          <span className="dashboard-kicker"><Palette size={15} /> <Trans text={"Clinic Identity & Prescription Settings"} /></span>
          <h1><Trans text={"Clinic Branding & Settings"} /></h1>
          <p><Trans text={"Customize your clinic identity across staff portals, patient discovery and secure waiting-lounge TVs. Core queue and security settings are not exposed here."} /></p>
        </div>
        <div className="clinic-settings-tenant-chip">
          <Building2 size={19} />
          <span><small><Trans text={"Current clinic"} /></small><b>{clinicMeta?.name || t("Loading...")}</b>{clinicMeta?.slug && <em>{clinicMeta.slug}</em>}</span>
        </div>
      </section>

      {error && <div className="login-error" role="alert">{t(error)}</div>}
      {message && <div className="clinic-settings-success"><CheckCircle size={17} /> {t(message)}</div>}

      {loading ? (
        <section className="card clinic-settings-loading"><RefreshCw className="animate-spin" size={22} /><span><Trans text={"Loading clinic branding..."} /></span></section>
      ) : (
        <form onSubmit={saveBranding} className="clinic-settings-layout">
          <section className="clinic-settings-main">
            <details className="card clinic-settings-dropdown" open>
              <summary>
                <span className="clinic-settings-summary-icon"><Building2 size={18} /></span>
                <div><b><Trans text={"Brand Identity"} /></b><small><Trans text={"Clinic name, short name, logo and brand colors"} /></small></div>
                <span className="feedback-dropdown-arrow">⌄</span>
              </summary>
              <div className="clinic-settings-dropdown-body">
                <div className="clinic-settings-grid two-col">
                  <label><Trans text={"Clinic display name"} /><input value={form.displayName} maxLength={120} onChange={(e) => updateField("displayName", e.target.value)} placeholder={clinicMeta?.name || "Clinic name"} /></label>
                  <label><Trans text={"Short name"} /><input value={form.shortName} maxLength={40} onChange={(e) => updateField("shortName", e.target.value)} placeholder={t("e.g. CityCare")} /></label>
                </div>
                <div className="clinic-logo-editor">
                  <div className={`clinic-logo-preview ${form.logoUrl ? "has-logo" : ""}`}>
                    {form.logoUrl ? <img src={form.logoUrl} alt={t("Clinic logo preview")} /> : <HeartPulse size={28} />}
                  </div>
                  <div className="clinic-logo-controls">
                    <label className="clinic-logo-upload"><ImageIcon size={16} /> <Trans text={"Upload logo"} /><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} /></label>
                    <span><Trans text={"PNG, JPG or WebP · maximum 150 KB"} /></span>
                    <label><Trans text={"Or logo image URL"} /><input value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl} onChange={(e) => updateField("logoUrl", e.target.value)} placeholder={t("https://clinic.example/logo.png")} /></label>
                    {form.logoUrl && <button type="button" className="ghost compact" onClick={() => updateField("logoUrl", "")}><Trans text={"Remove logo"} /></button>}
                  </div>
                </div>
                <div className="clinic-settings-grid two-col color-settings-grid">
                  <label><Trans text={"Primary color"} /><div className="clinic-color-input"><input type="color" value={form.primaryColor} onChange={(e) => updateField("primaryColor", e.target.value)} /><input value={form.primaryColor} maxLength={7} onChange={(e) => updateField("primaryColor", e.target.value)} /></div></label>
                  <label><Trans text={"Accent color"} /><div className="clinic-color-input"><input type="color" value={form.accentColor} onChange={(e) => updateField("accentColor", e.target.value)} /><input value={form.accentColor} maxLength={7} onChange={(e) => updateField("accentColor", e.target.value)} /></div></label>
                </div>
              </div>
            </details>

            <details className="card clinic-settings-dropdown">
              <summary>
                <span className="clinic-settings-summary-icon"><MapPin size={18} /></span>
                <div><b><Trans text={"Contact & Location"} /></b><small><Trans text={"Information patients can see while choosing the clinic"} /></small></div>
                <span className="feedback-dropdown-arrow">⌄</span>
              </summary>
              <div className="clinic-settings-dropdown-body">
                <label><Trans text={"Clinic address"} /><textarea rows={3} value={form.address} maxLength={240} onChange={(e) => updateField("address", e.target.value)} placeholder={t("Building, road, city, state")} /></label>
                <div className="clinic-settings-grid two-col">
                  <label><span><Phone size={14} /> <Trans text={"Contact phone"} /></span><input value={form.contactPhone} maxLength={40} onChange={(e) => updateField("contactPhone", e.target.value)} /></label>
                  <label><span><Mail size={14} /> <Trans text={"Contact email"} /></span><input type="email" value={form.contactEmail} maxLength={160} onChange={(e) => updateField("contactEmail", e.target.value)} /></label>
                </div>
                <label><span><Globe2 size={14} /> <Trans text={"Website"} /></span><input value={form.website} maxLength={180} onChange={(e) => updateField("website", e.target.value)} placeholder={t("https://www.example.com")} /></label>
              </div>
            </details>

            <details className="card clinic-settings-dropdown legal-verification-card" open>
              <summary><span className="clinic-settings-summary-icon"><ShieldCheck size={18} /></span><div><b><Trans text={"Clinic Legal Verification"} /></b><small><Trans text={"Clinical establishment details and Platform Admin review status"} /></small></div><span className={`verification-status verification-${clinicLegalVerification.status}`}><Trans text={verificationStatusLabel(clinicLegalVerification.status)} /></span><span className="feedback-dropdown-arrow">⌄</span></summary>
              <div className="clinic-settings-dropdown-body">
                <div className="legal-verification-note"><ShieldCheck size={17} /><span><Trans text={"Existing clinic access remains unchanged. Submitting updated details opens a new platform review and replaces any prior review status."} /></span></div>
                <div className="clinic-settings-grid two-col">
                  <label><Trans text={"Legal establishment name"} /><input required maxLength="160" value={clinicLegalVerification.legalName} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, legalName: e.target.value }))} /></label>
                  <label><Trans text={"Establishment type"} /><select value={clinicLegalVerification.establishmentType} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, establishmentType: e.target.value }))}><option value="clinic">{t("Clinic")}</option><option value="polyclinic">{t("Polyclinic")}</option><option value="hospital">{t("Hospital")}</option><option value="nursing_home">{t("Nursing home")}</option><option value="diagnostic_centre">{t("Diagnostic centre")}</option><option value="other">{t("Other")}</option></select></label>
                  <label><Trans text={"Registration number"} /><input required maxLength="100" value={clinicLegalVerification.registrationNumber} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, registrationNumber: e.target.value }))} /></label>
                  <label><Trans text={"Registration authority"} /><input required maxLength="140" value={clinicLegalVerification.registrationAuthority} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, registrationAuthority: e.target.value }))} /></label>
                  <label><Trans text={"Registration state / UT"} /><input required maxLength="80" value={clinicLegalVerification.registrationState} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, registrationState: e.target.value }))} /></label>
                  <label><Trans text={"Certificate expiry (optional)"} /><input type="date" value={clinicLegalVerification.certificateExpiresAt} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, certificateExpiresAt: e.target.value }))} /></label>
                </div>
                <label><Trans text={"Evidence reference"} /><input required minLength="3" maxLength="240" value={clinicLegalVerification.evidenceReference} onChange={(e) => setClinicLegalVerification((current) => ({ ...current, evidenceReference: e.target.value }))} placeholder={t("Internal certificate file/page reference")} /></label>
                {clinicLegalVerification.reviewNote && <div className={`legal-review-result verification-${clinicLegalVerification.status}`}><b><Trans text={"Latest platform review note"} /></b><span>{clinicLegalVerification.reviewNote}</span></div>}
                <div className="operations-actions"><button type="button" className="primary" onClick={saveClinicLegalVerification} disabled={clinicVerificationSaving}><ShieldCheck size={15} />{clinicVerificationSaving ? t("Submitting...") : t("Submit for Platform Review")}</button></div>
                <p className="clinic-settings-safety-note"><AlertTriangle size={16} /><Trans text={"Platform review is an internal evidence check. It is not a government verification or legal certification."} /></p>
              </div>
            </details>

            <details className="card clinic-settings-dropdown operations-settings-card" open>
              <summary>
                <span className="clinic-settings-summary-icon"><Clock3 size={18} /></span>
                <div><b><Trans text={"Clinic Hours & Daily Queue"} /></b><small><Trans text={"Booking cutoffs, working days and front-desk day lifecycle"} /></small></div>
                <span className="feedback-dropdown-arrow">⌄</span>
              </summary>
              <div className="clinic-settings-dropdown-body">
                <div className="operations-status-strip">
                  <span className={`operations-state ${operationsStatus?.effectiveQueueState === "closed" ? "closed" : "open"}`}><i /> {t(operationsStatus?.effectiveQueueState === "closed" ? "New arrivals closed" : "Queue open")}</span>
                  <span>{operationsStatus?.weekday || "Today"} · {operationsStatus?.currentTime || "--:--"}</span>
                  <span>{t(operationsStatus?.isWithinHours === false ? "Outside clinic hours" : "Within clinic hours")}</span>
                </div>
                <label className="prescription-toggle operations-enable"><input type="checkbox" checked={Boolean(operationsSettings.clinicHoursEnabled)} onChange={(e)=>setOperationsSettings((c)=>({...c,clinicHoursEnabled:e.target.checked}))}/><span><Trans text={"Enforce clinic hours and booking/check-in cutoffs"} /></span></label>
                <div className="clinic-settings-grid two-col">
                  <label><Trans text={"Clinic opens"} /><input type="time" value={operationsSettings.openTime} onChange={(e)=>setOperationsSettings((c)=>({...c,openTime:e.target.value}))}/></label>
                  <label><Trans text={"Clinic closes"} /><input type="time" value={operationsSettings.closeTime} onChange={(e)=>setOperationsSettings((c)=>({...c,closeTime:e.target.value}))}/></label>
                  <label><Trans text={"Booking cutoff (minutes)"} /><input type="number" min="0" max="240" value={operationsSettings.bookingCutoffMinutes} onChange={(e)=>setOperationsSettings((c)=>({...c,bookingCutoffMinutes:Number(e.target.value)}))}/></label>
                  <label><Trans text={"Check-in cutoff (minutes)"} /><input type="number" min="0" max="240" value={operationsSettings.checkInCutoffMinutes} onChange={(e)=>setOperationsSettings((c)=>({...c,checkInCutoffMinutes:Number(e.target.value)}))}/></label>
                  <label><Trans text={"Missed appointment grace (minutes)"} /><input type="number" min="5" max="240" value={operationsSettings.missedGraceMinutes} onChange={(e)=>setOperationsSettings((c)=>({...c,missedGraceMinutes:Number(e.target.value)}))}/></label>
                </div>
                <div className="operations-days"><small><Trans text={"CLINIC WORKING DAYS"} /></small><div>{["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day)=><label key={day}><input type="checkbox" checked={operationsSettings.workingDays?.includes(day)} onChange={(e)=>setOperationsSettings((c)=>({...c,workingDays:e.target.checked?[...(c.workingDays||[]),day]:(c.workingDays||[]).filter((d)=>d!==day)}))}/><span>{day.slice(0,3)}</span></label>)}</div></div>
                <div className="operations-actions">
                  <button type="button" className="primary" disabled={operationsSaving} onClick={saveOperationsSettings}><Save size={15}/>{t(operationsSaving?"Saving...":"Save Operating Rules")}</button>
                  <button type="button" className="ghost" onClick={()=>changeQueueLifecycle("open")}><CheckCircle size={15}/><Trans text={"Open Today's Queue"} /></button>
                  <button type="button" className="ghost danger-soft" onClick={()=>changeQueueLifecycle("close")}><AlertTriangle size={15}/><Trans text={"Close New Arrivals"} /></button>
                  <button type="button" className="ghost danger-soft" onClick={endDayAndArchive}><Trash2 size={15}/><Trans text={"End Day & Archive"} /></button>
                </div>
                <p className="clinic-settings-safety-note"><ShieldCheck size={16}/> <Trans text={"Closing new arrivals does not interrupt patients already waiting or consulting. End Day archives the current queue after confirmation."} /></p>
              </div>
            </details>

            <details className="card clinic-settings-dropdown clinic-billing-settings">
              <summary><span className="clinic-settings-summary-icon"><IndianRupee size={18}/></span><div><b><Trans text={"OPD Billing & Fee Rules"} /></b><small><Trans text={"Clinic fallback fee, department defaults and reception discount policy"} /></small></div><span className="feedback-dropdown-arrow">⌄</span></summary>
              <div className="clinic-settings-dropdown-body">
                <label className="doctor-break-switch"><input type="checkbox" checked={billingSettings.enabled !== false} onChange={(e)=>setBillingSettings((c)=>({...c,enabled:e.target.checked}))}/><span><b><Trans text={"Enable OPD fee collection"} /></b><small><Trans text={"When enabled, paid visits require reception payment confirmation before the live queue token is issued."} /></small></span></label>
                <div className="clinic-settings-grid two-col">
                  <label><Trans text={"Clinic default consultation fee (₹)"} /><input type="number" min="0" step="1" value={billingSettings.clinicDefaultFee ?? 0} onChange={(e)=>setBillingSettings((c)=>({...c,clinicDefaultFee:Number(e.target.value||0)}))}/></label>
                  <label><Trans text={"Maximum reception discount (%)"} /><input type="number" min="0" max="100" step="1" value={billingSettings.maxDiscountPercent ?? 0} onChange={(e)=>setBillingSettings((c)=>({...c,maxDiscountPercent:Number(e.target.value||0)}))}/></label>
                </div>
                <label className="doctor-break-switch"><input type="checkbox" checked={Boolean(billingSettings.allowReceptionFeeOverride)} onChange={(e)=>setBillingSettings((c)=>({...c,allowReceptionFeeOverride:e.target.checked}))}/><span><b><Trans text={"Allow receptionist fee override / discount"} /></b><small><Trans text={"A reason is mandatory whenever reception collects less than the configured fee."} /></small></span></label>
                <div className="department-fee-grid">
                  {CLINICAL_DEPARTMENTS.map((item)=>{ const existing=(billingSettings.departmentFees||[]).find((fee)=>fee.department===item.value); return <label key={item.value}>{item.value}<input type="number" min="0" step="1" value={existing?.amount ?? ""} placeholder={t("Use clinic default")} onChange={(e)=>setDepartmentFee(item.value,e.target.value)}/></label>; })}
                </div>
                <p className="clinic-settings-safety-note"><ShieldCheck size={16}/> <Trans text={"Fee priority: doctor-specific fee → department default → clinic default. Emergency clinical priority is never affected by payment."} /></p>
                <button type="button" className="primary" disabled={billingSaving} onClick={saveBillingSettings}><Save size={15}/>{t(billingSaving?"Saving Billing...":"Save Billing Rules")}</button>
              </div>
            </details>

            <details className="card clinic-settings-dropdown admin-export-card">
              <summary><span className="clinic-settings-summary-icon"><Download size={18}/></span><div><b><Trans text={"Data Export"} /></b><small><Trans text={"CSV reports for operations and clinic records"} /></small></div><span className="feedback-dropdown-arrow">⌄</span></summary>
              <div className="clinic-settings-dropdown-body">
                <div className="clinic-settings-grid two-col"><label><Trans text={"From date"} /><input type="date" value={exportRange.fromDate} onChange={(e)=>setExportRange((c)=>({...c,fromDate:e.target.value}))}/></label><label><Trans text={"To date"} /><input type="date" value={exportRange.toDate} onChange={(e)=>setExportRange((c)=>({...c,toDate:e.target.value}))}/></label></div>
                <div className="operations-actions"><button type="button" className="ghost" onClick={()=>downloadAdminCsv("patients")}><Download size={15}/><Trans text={"Patient Visits CSV"} /></button><button type="button" className="ghost" onClick={()=>downloadAdminCsv("appointments")}><Download size={15}/><Trans text={"Appointments CSV"} /></button><button type="button" className="ghost" onClick={()=>downloadAdminCsv("doctor-performance")}><Download size={15}/><Trans text={"Doctor Performance CSV"} /></button><button type="button" className="ghost" onClick={()=>downloadAdminCsv("payments")}><Download size={15}/><Trans text={"Payments CSV"} /></button></div>
              </div>
            </details>

            <details className="card clinic-settings-dropdown prescription-template-dropdown">
              <summary>
                <span className="clinic-settings-summary-icon"><FileText size={18} /></span>
                <div><b><Trans text={"Prescription Paper Designer"} /></b><small><Trans text={"Clinic-branded A4 parcha plus per-doctor professional details"} /></small></div>
                <span className="feedback-dropdown-arrow">⌄</span>
              </summary>
              <div className="clinic-settings-dropdown-body">
                <div className="prescription-designer-note"><ShieldCheck size={16} /><span><Trans text={"Admin controls the paper design. Doctors only enter clinical content; diagnosis, medicines and advice remain visit-specific."} /></span></div>
                <div className="clinic-settings-grid two-col">
                  <label><Trans text={"Prescription title"} /><input value={prescriptionTemplate.title} maxLength={80} onChange={(e) => updatePrescriptionField("title", e.target.value)} placeholder={t("Prescription")} /></label>
                  <label><Trans text={"Watermark text"} /><input value={prescriptionTemplate.watermarkText} maxLength={60} onChange={(e) => updatePrescriptionField("watermarkText", e.target.value)} placeholder={form.shortName || form.displayName || "Clinic name"} /></label>
                </div>
                <label><Trans text={"Header note"} /><textarea rows={2} value={prescriptionTemplate.headerNote} maxLength={180} onChange={(e) => updatePrescriptionField("headerNote", e.target.value)} placeholder={t("Optional clinic / OPD header note")} /></label>
                <label><Trans text={"Footer note"} /><textarea rows={2} value={prescriptionTemplate.footerNote} maxLength={240} onChange={(e) => updatePrescriptionField("footerNote", e.target.value)} placeholder={t("Instructions or clinic footer note")} /></label>
                <div className="prescription-toggle-grid">
                  {[
                    ["showLogo", "Clinic logo"], ["showClinicContact", "Clinic contact"], ["showPatientId", "Patient ID"],
                    ["showPatientAgeGender", "Age & gender"], ["showToken", "Token number"], ["showSymptoms", "Symptoms"],
                    ["showDiagnosis", "Diagnosis"], ["showTests", "Tests"], ["showAdvice", "Advice"],
                    ["showFollowUp", "Follow-up"], ["showDoctorRegistration", "Doctor registration no."], ["showSignatureLine", "Signature line"],
                    ["watermarkEnabled", "Watermark"],
                  ].map(([key, label]) => (
                    <label className="prescription-toggle" key={key}><input type="checkbox" checked={Boolean(prescriptionTemplate[key])} onChange={(e) => updatePrescriptionField(key, e.target.checked)} /><span>{label}</span></label>
                  ))}
                </div>
                <button type="button" className="primary prescription-save-button" onClick={savePrescriptionTemplate} disabled={prescriptionSaving}><Save size={15} /> {t(prescriptionSaving ? "Saving Template..." : "Save Prescription Template")}</button>

                <div className="prescription-doctor-divider"><span><Trans text={"Doctor-specific details"} /></span></div>
                {prescriptionDoctors.length ? <>
                  <label><Trans text={"Select doctor"} /><select value={selectedPrescriptionDoctorId} onChange={(e) => selectPrescriptionDoctor(e.target.value)}>{prescriptionDoctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{t("Dr. ")}{doctor.name} · {t(doctor.department)}</option>)}</select></label>
                  <div className="clinic-settings-grid two-col">
                    <label><Trans text={"Qualification"} /><input value={doctorPrescriptionProfile.qualification} maxLength={120} onChange={(e) => setDoctorPrescriptionProfile((current) => ({ ...current, qualification: e.target.value }))} placeholder={t("MBBS, MD")} /></label>
                    <label><Trans text={"Specialization"} /><input value={doctorPrescriptionProfile.specialization} maxLength={120} onChange={(e) => setDoctorPrescriptionProfile((current) => ({ ...current, specialization: e.target.value }))} placeholder={t("Consultant Cardiologist")} /></label>
                    <label><Trans text={"Registration number"} /><input value={doctorPrescriptionProfile.registrationNumber} maxLength={80} onChange={(e) => setDoctorPrescriptionProfile((current) => ({ ...current, registrationNumber: e.target.value }))} placeholder={t("Medical Council Reg. No.")} /></label>
                    <label><Trans text={"Designation"} /><input value={doctorPrescriptionProfile.designation} maxLength={120} onChange={(e) => setDoctorPrescriptionProfile((current) => ({ ...current, designation: e.target.value }))} placeholder={t("Senior Consultant")} /></label>
                  </div>
                  <div className="doctor-signature-editor">
                    <div className="doctor-signature-preview">
                      {doctorPrescriptionProfile.signatureDataUrl ? <img src={doctorPrescriptionProfile.signatureDataUrl} alt={t("Doctor signature preview")} /> : <span><Trans text={"No signature uploaded"} /></span>}
                    </div>
                    <div>
                      <label className="clinic-logo-upload"><ImageIcon size={16} /> <Trans text={"Upload digital signature"} /><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleDoctorSignatureUpload} /></label>
                      <small><Trans text={"Transparent PNG works best · maximum 150 KB · controlled by clinic admin"} /></small>
                      {doctorPrescriptionProfile.signatureDataUrl && <button type="button" className="ghost compact" onClick={() => setDoctorPrescriptionProfile((current) => ({ ...current, signatureDataUrl: "" }))}><Trans text={"Remove signature"} /></button>}
                    </div>
                  </div>
                  <button type="button" className="ghost prescription-save-button" onClick={saveDoctorPrescriptionProfile} disabled={doctorProfileSaving}><Save size={15} /> {t(doctorProfileSaving ? "Saving Doctor Details..." : "Save Doctor Details")}</button>
                  <div className="doctor-verification-panel">
                    <div className="doctor-verification-head"><div><b><Trans text={"Professional Registration Review"} /></b><small><Trans text={"Clinic admin records the medical council evidence review"} /></small></div><span className={`verification-status verification-${doctorProfessionalVerification.status}`}><Trans text={verificationStatusLabel(doctorProfessionalVerification.status, "doctor")} /></span></div>
                    <div className="clinic-settings-grid two-col">
                      <label><Trans text={"Medical council"} /><input maxLength="140" value={doctorProfessionalVerification.councilName} onChange={(e) => setDoctorProfessionalVerification((current) => ({ ...current, councilName: e.target.value }))} placeholder={t("Council / authority name")} /></label>
                      <label><Trans text={"Registration state"} /><input maxLength="80" value={doctorProfessionalVerification.registrationState} onChange={(e) => setDoctorProfessionalVerification((current) => ({ ...current, registrationState: e.target.value }))} /></label>
                      <label><Trans text={"Registration expiry (optional)"} /><input type="date" value={doctorProfessionalVerification.registrationExpiresAt} onChange={(e) => setDoctorProfessionalVerification((current) => ({ ...current, registrationExpiresAt: e.target.value }))} /></label>
                      <label><Trans text={"Evidence reference"} /><input maxLength="240" value={doctorProfessionalVerification.evidenceReference} onChange={(e) => setDoctorProfessionalVerification((current) => ({ ...current, evidenceReference: e.target.value }))} placeholder={t("Internal file/register reference")} /></label>
                      <label><Trans text={"Decision"} /><select value={doctorVerificationDecision} onChange={(e) => { setDoctorVerificationDecision(e.target.value); setDoctorVerificationConfirmed(false); }}><option value="submitted">{t("Submit for review")}</option><option value="clinic_reviewed">{t("Clinic reviewed")}</option><option value="rejected">{t("Reject evidence")}</option></select></label>
                      <label><Trans text={"Review note"} /><input maxLength="1000" value={doctorProfessionalVerification.reviewNote} onChange={(e) => setDoctorProfessionalVerification((current) => ({ ...current, reviewNote: e.target.value }))} placeholder={t("What was checked / reason for rejection")} /></label>
                    </div>
                    {doctorVerificationDecision === "clinic_reviewed" && <label className="legal-review-confirm"><input type="checkbox" checked={doctorVerificationConfirmed} onChange={(e) => setDoctorVerificationConfirmed(e.target.checked)} /><span><Trans text={"I confirm that the clinic reviewed the doctor's original registration evidence."} /></span></label>}
                    <button type="button" className="primary prescription-save-button" onClick={saveDoctorProfessionalVerification} disabled={doctorVerificationSaving || (doctorVerificationDecision === "clinic_reviewed" && !doctorVerificationConfirmed)}><ShieldCheck size={15} />{doctorVerificationSaving ? t("Saving Review...") : t("Save Registration Review")}</button>
                    <p className="clinic-settings-safety-note"><AlertTriangle size={16} /><Trans text={"This clinic-managed badge does not claim verification by OPDfy, NMC or a government authority."} /></p>
                  </div>
                </> : <p className="muted"><Trans text={"Create a doctor account first to configure doctor-specific prescription details."} /></p>}
              </div>
            </details>

            <details className="card clinic-settings-dropdown">
              <summary>
                <span className="clinic-settings-summary-icon"><Monitor size={18} /></span>
                <div><b><Trans text={"Waiting Lounge Branding"} /></b><small><Trans text={"Text shown on the clinic's secure physical TV displays"} /></small></div>
                <span className="feedback-dropdown-arrow">⌄</span>
              </summary>
              <div className="clinic-settings-dropdown-body">
                <label><Trans text={"Welcome message"} /><textarea rows={3} value={form.waitingLoungeWelcome} maxLength={180} onChange={(e) => updateField("waitingLoungeWelcome", e.target.value)} /></label>
                <label><Trans text={"Footer / contact message"} /><textarea rows={3} value={form.footerText} maxLength={240} onChange={(e) => updateField("footerText", e.target.value)} placeholder={t("Optional: For assistance, please contact reception.")} /></label>
                <p className="clinic-settings-safety-note"><ShieldCheck size={16} /> <Trans text={"Department/doctor assignment, secure TV link and voice settings remain controlled separately under TV Displays."} /></p>
              </div>
            </details>
          </section>

          <aside className="clinic-brand-preview card">
            <span className="clinic-preview-label"><Trans text={"LIVE BRAND PREVIEW"} /></span>
            <div className="clinic-preview-header">
              <span className={`clinic-preview-logo ${form.logoUrl ? "has-logo" : ""}`}>{form.logoUrl ? <img src={form.logoUrl} alt="" /> : <HeartPulse size={25} />}</span>
              <div><b>{form.shortName || form.displayName || clinicMeta?.name || "Your Clinic"}</b><small><Trans text={"Powered by OPDfy"} /></small></div>
            </div>
            <div className="clinic-preview-tv">
              <span><Trans text={"WAITING LOUNGE"} /></span>
              <h3>{form.displayName || clinicMeta?.name || "Your Clinic"}</h3>
              <p>{form.waitingLoungeWelcome || "Welcome. Please watch the screen for your token."}</p>
              <strong>#24</strong>
              <small><Trans text={"NOW SERVING"} /></small>
            </div>
            <div className="clinic-preview-contact">
              {form.address && <span><MapPin size={13} /> {form.address}</span>}
              {form.contactPhone && <span><Phone size={13} /> {form.contactPhone}</span>}
              {form.website && <span><Globe2 size={13} /> {form.website.replace(/^https?:\/\//, "")}</span>}
            </div>
            <button type="submit" className="primary clinic-settings-save" disabled={saving}><Save size={16} /> {t(saving ? "Saving..." : "Save Clinic Branding")}</button>
            <small className="clinic-preview-security"><ShieldCheck size={13} /> <Trans text={"Only this clinic's admin can change these settings."} /></small>
          </aside>
        </form>
      )}
    </main>
  );
}


function SecureWaitingLoungeDisplayPage() {
  const { t } = useLanguage();
  const { accessKey } = useParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [audioArmed, setAudioArmed] = useState(false);
  const lastAnnouncedKeyRef = useRef("");

  const refreshDisplay = async ({ quiet = false } = {}) => {
    try {
      const { data } = await api.get(`/display/${accessKey}`);
      setPayload(data);
      setError("");
    } catch (requestError) {
      if (!quiet) setError(requestError.response?.data?.message || "This waiting-lounge display is unavailable.");
    }
  };

  useEffect(() => {
    setPayload(null);
    setError("");
    setAudioArmed(false);
    lastAnnouncedKeyRef.current = "";
    refreshDisplay();
    const timer = window.setInterval(() => refreshDisplay({ quiet: true }), 2500);
    return () => window.clearInterval(timer);
  }, [accessKey]);

  const display = payload?.display;
  const clinic = payload?.clinic;
  const queue = payload?.queue || [];
  const current = queue
    .filter((item) => item.status === "called")
    .sort((a, b) => new Date(b.calledAt || 0).getTime() - new Date(a.calledAt || 0).getTime())[0] || null;
  const waiting = queue
    .filter((item) => item.status === "waiting")
    .sort((a, b) => Number(a.tokenNumber) - Number(b.tokenNumber));

  const buildTvAnnouncement = (tokenItem) => {
    if (!tokenItem) return "";
    const language = display?.voice?.language || "en-IN";
    if (language === "hi-IN") {
      return `टोकन नंबर ${tokenItem.tokenNumber}, ${tokenItem.department}। कृपया ${tokenItem.roomNumber ? `कमरा ${tokenItem.roomNumber}` : "परामर्श कक्ष"} की ओर जाएँ।${tokenItem.doctorName ? ` डॉक्टर ${tokenItem.doctorName}।` : ""}`;
    }
    return `Token number ${tokenItem.tokenNumber}, ${tokenItem.department}. Please proceed to ${tokenItem.roomNumber ? `room ${tokenItem.roomNumber}` : "the consultation room"}.${tokenItem.doctorName ? ` Doctor ${tokenItem.doctorName}.` : ""}`;
  };

  const speakCurrent = (tokenItem, { force = false } = {}) => {
    if (!audioArmed || display?.voice?.enabled === false || !tokenItem || !("speechSynthesis" in window)) return;
    const key = `${tokenItem.department}:${tokenItem.tokenNumber}:${tokenItem.doctorName || ""}:${tokenItem.calledAt || "called"}`;
    if (!force && key === lastAnnouncedKeyRef.current) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(buildTvAnnouncement(tokenItem));
    utterance.lang = display?.voice?.language || "en-IN";
    utterance.volume = Math.min(1, Math.max(0.2, Number(display?.voice?.volume || 1)));
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
    lastAnnouncedKeyRef.current = key;
  };

  useEffect(() => {
    if (current) speakCurrent(current);
  }, [current?.tokenNumber, current?.department, current?.doctorName, current?.calledAt, audioArmed, display?.voice?.enabled, display?.voice?.language, display?.voice?.volume]);

  useEffect(() => () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  if (error) {
    return <main className="secure-display-error"><ShieldAlert size={42} /><h1><Trans text={"Display unavailable"} /></h1><p>{t(error)}</p></main>;
  }
  if (!payload) {
    return <main className="secure-display-error"><RefreshCw className="spin" size={32} /><h1><Trans text={"Connecting to hospital display..."} /></h1></main>;
  }

  return (
    <main
      className="tv premium-tv professional-waiting-lounge secure-physical-display"
      style={{
        "--clinic-primary": clinic?.branding?.primaryColor || "#0f766e",
        "--clinic-accent": clinic?.branding?.accentColor || "#14b8a6",
      }}
    >
      <div className="tvtop waiting-lounge-topbar">
        <span className="waiting-lounge-brand">
          <span className={`waiting-lounge-brand-mark ${clinic?.branding?.logoUrl ? "has-clinic-logo" : ""}`}>
            {clinic?.branding?.logoUrl ? <img src={clinic.branding.logoUrl} alt="" /> : <HeartPulse size={24} />}
          </span>
          <span><small>{clinic?.branding?.shortName || clinic?.name || "OPDfy"}</small><strong>{display?.name || t("Waiting Lounge")}</strong></span>
        </span>
        <b className="waiting-lounge-live"><i /> <Trans text={"SECURE LIVE DISPLAY"} /></b>
      </div>

      <section className="waiting-lounge-welcome">
        <div>
          <p className="eyebrow"><Trans text={"Clinic-controlled display"} /></p>
          <h1>{t(display?.doctorId ? "Dedicated doctor queue" : "Live waiting lounge")}</h1>
          <p>{clinic?.branding?.waitingLoungeWelcome || t("This screen is locked to the department/doctor selected by the hospital administrator.")}</p>
        </div>
        <div className="waiting-lounge-summary">
          <div><Users size={18} /><span><Trans text={"Waiting"} /></span><b>{waiting.length}</b></div>
          <div><Activity size={18} /><span><Trans text={"Active"} /></span><b>{waiting.length + (current ? 1 : 0)}</b></div>
          <div><Volume2 size={18} /><span><Trans text={"Voice"} /></span><b>{t(display?.voice?.enabled === false ? "Off" : audioArmed ? "On" : "Ready")}</b></div>
        </div>
      </section>

      <div className="waiting-lounge-filter professional-lounge-filter locked-display-filter">
        <div><span className="waiting-lounge-filter-label"><Trans text={"VIEW DEPARTMENT"} /></span><strong>{t(display?.department) || t("All Departments")}</strong></div>
        <div className="locked-filter-value">
          <ShieldCheck size={16} /> <Trans text={"Admin locked"} />{current?.doctorName && <span><Trans text={"· Dr. "} />{current.doctorName}</span>}
        </div>
      </div>

      {display?.voice?.enabled !== false && !audioArmed && (
        <section className="tv-audio-activation">
          <Volume2 size={22} />
          <div><b><Trans text={"Activate this TV speaker"} /></b><span><Trans text={"One click is required by many TV/browser devices before automatic voice announcements can play."} /></span></div>
          <button type="button" className="primary" onClick={() => {
            setAudioArmed(true);
            setTimeout(() => current && speakCurrent(current, { force: true }), 0);
          }}><Volume2 size={16} /> <Trans text={"Start TV Audio"} /></button>
        </section>
      )}

      <div className="tvgrid professional-lounge-grid">
        <section className={`now-serving-card ${current ? "has-current-token" : ""}`}>
          <div className="now-serving-label"><span className="pulse-dot" /> <Trans text={"NOW SERVING"} /></div>
          <strong>#{current?.tokenNumber ?? "—"}</strong>
          <h2>{t(current ? "Please proceed to the consultation room" : "Next called token will appear here")}</h2>
          <div className="now-serving-meta">
            <span><Stethoscope size={15} /> {t(current?.department) || t(display?.department) || t("All Departments")}</span>
            {current?.doctorName && <span><UserCheck size={15} /> <Trans text={"Dr. "} />{current.doctorName}</span>}
            {current?.roomNumber && <span><Monitor size={15} /> <Trans text={"Room "} />{current.roomNumber}</span>}
            <span><Activity size={15} /> <Trans text={"Auto-refreshing live feed"} /></span>
          </div>
        </section>

        <aside className="upcoming-queue-card">
          <div className="waiting-lounge-list-head"><div><small><Trans text={"LIVE QUEUE"} /></small><h2><Trans text={"Up Next"} /></h2></div><span>{waiting.length} <Trans text={"waiting"} /></span></div>
          <div className="upcoming-token-list">
            {waiting.slice(0, 8).map((item, index) => (
              <div className="upcoming-token-row" key={`${item.department}-${item.tokenNumber}-${item.doctorName || ""}`}>
                <span className="queue-position">{String(index + 1).padStart(2, "0")}</span>
                <b>#{item.tokenNumber}</b>
                <span className="queue-department">{t(item.department)}</span>
                <ChevronRight size={16} />
              </div>
            ))}
          </div>
          {!waiting.length && <div className="waiting-lounge-empty"><CheckCircle size={22} /><b><Trans text={"Queue is clear"} /></b><span><Trans text={"No waiting tokens match this display."} /></span></div>}
        </aside>
      </div>

      <footer className="professional-lounge-footer">
        <span><i /> <Trans text={"Secure clinic display"} /></span>
        <span><Trans text={"Showing: "} /><b>{t(display?.department) || t("All Departments")}</b></span>
        <span>{clinic?.branding?.footerText || t(display?.voice?.enabled === false ? "Voice disabled by admin" : "Voice plays only from this TV/device")}</span>
      </footer>
    </main>
  );
}


/* =========================================================
   WAITING LOUNGE DISPLAY SCREEN
========================================================= */

function LiveWaitingRoomDisplayPage({ patientView = false }) {
  const { t } = useLanguage();
  const liveQueue = useLiveQueue();
  const patientTokens = useLiveQueue(patientView ? "patient" : "public");
  const [selectedDepartment, setSelectedDepartment] = useState("All Departments");
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(false);
  const [announcementsMuted, setAnnouncementsMuted] = useState(false);
  const [announcementLanguage, setAnnouncementLanguage] = useState("en-IN");
  const [announcementVolume, setAnnouncementVolume] = useState(1);
  const lastAnnouncedKeyRef = useRef("");

  const patientActiveToken = patientView
    ? patientTokens.find((item) => ["waiting", "called"].includes(item.status))
    : null;

  useEffect(() => {
    if (patientView && patientActiveToken?.department) {
      setSelectedDepartment(patientActiveToken.department);
    }
  }, [patientView, patientActiveToken?.department]);

  const departments = Array.from(
    new Set(liveQueue.map((item) => item.department).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const departmentQueue = selectedDepartment === "All Departments"
    ? liveQueue
    : liveQueue.filter((item) => item.department === selectedDepartment);

  const currentTokenInRoom = departmentQueue
    .filter((item) => item.status === "called")
    .sort((a, b) => new Date(b.calledAt || 0).getTime() - new Date(a.calledAt || 0).getTime())[0] || null;
  const allWaitingTokens = departmentQueue
    .filter((item) => item.status === "waiting")
    .sort((a, b) => Number(a.tokenNumber) - Number(b.tokenNumber));
  const upcomingWaitingTokens = allWaitingTokens.slice(0, 8);
  const calledCount = departmentQueue.filter((item) => item.status === "called").length;
  const activeCount = allWaitingTokens.length + calledCount;

  const buildAnnouncement = (tokenItem) => {
    if (!tokenItem) return "";
    const tokenNumber = tokenItem.tokenNumber ?? "";
    const department = tokenItem.department || "OPD";
    const doctorName = tokenItem.doctorName ? ` Doctor ${tokenItem.doctorName}.` : "";
    const room = tokenItem.roomNumber ? ` Room ${tokenItem.roomNumber}.` : "";

    if (announcementLanguage === "hi-IN") {
      return `टोकन नंबर ${tokenNumber}, ${department}। कृपया परामर्श कक्ष की ओर जाएँ।${tokenItem.doctorName ? ` डॉक्टर ${tokenItem.doctorName}।` : ""}${tokenItem.roomNumber ? ` कमरा ${tokenItem.roomNumber}।` : ""}`;
    }

    return `Token number ${tokenNumber}, ${department}. Please proceed to the consultation room.${doctorName}${room}`;
  };

  const speakToken = (tokenItem, { force = false } = {}) => {
    if (patientView || !announcementsEnabled || announcementsMuted || !tokenItem) return;
    if (!("speechSynthesis" in window)) return;

    const key = `${tokenItem.department || ""}:${tokenItem.tokenNumber || ""}:${tokenItem.calledAt || "called"}`;
    if (!force && lastAnnouncedKeyRef.current === key) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(buildAnnouncement(tokenItem));
    utterance.lang = announcementLanguage;
    utterance.volume = announcementVolume;
    utterance.rate = 0.92;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    lastAnnouncedKeyRef.current = key;
  };

  useEffect(() => {
    if (!patientView && currentTokenInRoom) speakToken(currentTokenInRoom);
  }, [
    patientView,
    currentTokenInRoom?.tokenNumber,
    currentTokenInRoom?.department,
    currentTokenInRoom?.doctorName,
    currentTokenInRoom?.roomNumber,
    announcementsEnabled,
    announcementsMuted,
    announcementLanguage,
    announcementVolume,
  ]);

  useEffect(() => () => {
    if (!patientView && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [patientView]);

  const patientQueuePosition = patientActiveToken?.status === "waiting"
    ? Math.max(
        1,
        allWaitingTokens.findIndex(
          (item) =>
            (item._id && patientActiveToken._id && String(item._id) === String(patientActiveToken._id)) ||
            (Number(item.tokenNumber) === Number(patientActiveToken.tokenNumber) &&
              item.department === patientActiveToken.department)
        ) + 1
      )
    : patientActiveToken?.status === "called"
      ? 0
      : null;

  return (
    <main className={`tv premium-tv professional-waiting-lounge ${patientView ? "patient-waiting-lounge" : ""}`}>
      <div className="tvtop waiting-lounge-topbar">
        <span className="waiting-lounge-brand">
          <span className="waiting-lounge-brand-mark"><HeartPulse size={24} /></span>
          <span>
            <small><Trans text={"OPDfy"} /></small>
            <strong><Trans text={"Waiting Lounge"} /></strong>
          </span>
        </span>
        <b className="waiting-lounge-live"><i /> <Trans text={"LIVE QUEUE"} /></b>
      </div>

      <section className="waiting-lounge-welcome">
        <div>
          <p className="eyebrow"><Trans text={"Live Patient Flow"} /></p>
          <h1>{t(patientView ? "Your clinic waiting lounge" : "Comfortable waiting. Clear turn visibility.")}</h1>
          <p>{patientView ? t("This lounge is unlocked for your confirmed visit at {clinic}.", { clinic: getActiveClinicSlug() }) : t("Real-time token movement for the selected department. The screen updates automatically as the doctor calls the next patient.")}</p>
        </div>
        <div className="waiting-lounge-summary">
          <div><Users size={18} /><span><Trans text={"Waiting"} /></span><b>{allWaitingTokens.length}</b></div>
          <div><Activity size={18} /><span><Trans text={"Active"} /></span><b>{activeCount}</b></div>
          <div><Stethoscope size={18} /><span><Trans text={"Departments"} /></span><b>{selectedDepartment === "All Departments" ? departments.length : 1}</b></div>
        </div>
      </section>

      {!patientView && (
        <section className="lounge-announcement-controls" aria-label={t("Waiting lounge voice announcement controls")}>
          <div className="announcement-control-copy">
            <Volume2 size={20} />
            <div>
              <strong><Trans text={"Central Voice Announcements"} /></strong>
              <span><Trans text={"Audio plays only on this hospital waiting-lounge screen."} /></span>
            </div>
          </div>
          <div className="announcement-control-actions">
            <button
              type="button"
              className={announcementsEnabled ? "small" : "primary small"}
              onClick={() => {
                setAnnouncementsEnabled(true);
                setAnnouncementsMuted(false);
                if (currentTokenInRoom) setTimeout(() => speakToken(currentTokenInRoom, { force: true }), 0);
              }}
            >
              <Volume2 size={15} /> {t(announcementsEnabled ? "Announcements On" : "Enable Announcements")}
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={!announcementsEnabled}
              onClick={() => {
                const nextMuted = !announcementsMuted;
                setAnnouncementsMuted(nextMuted);
                if (nextMuted && "speechSynthesis" in window) window.speechSynthesis.cancel();
              }}
            >
              {announcementsMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              {t(announcementsMuted ? "Unmute" : "Mute")}
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={!announcementsEnabled || announcementsMuted || !currentTokenInRoom}
              onClick={() => speakToken(currentTokenInRoom, { force: true })}
            >
              <RefreshCw size={15} /> <Trans text={"Repeat"} /></button>
            <label className="announcement-language-control">
              <Languages size={15} />
              <select value={announcementLanguage} onChange={(event) => setAnnouncementLanguage(event.target.value)}>
                <option value="en-IN">{t("English")}</option>
                <option value="hi-IN">हिन्दी</option>
              </select>
            </label>
            <label className="announcement-volume-control">
              <span><Trans text={"Volume"} /></span>
              <input
                type="range"
                min="0.2"
                max="1"
                step="0.1"
                value={announcementVolume}
                onChange={(event) => setAnnouncementVolume(Number(event.target.value))}
                aria-label={t("Announcement volume")}
              />
            </label>
          </div>
        </section>
      )}

      {patientView && patientActiveToken && (
        <section className={`patient-lounge-token-strip ${patientActiveToken.status === "called" ? "called" : ""}`}>
          <div>
            <span><Trans text={"Your token"} /></span>
            <strong>#{patientActiveToken.tokenNumber}</strong>
          </div>
          <div>
            <span><Trans text={"Department"} /></span>
            <strong>{t(patientActiveToken.department)}</strong>
          </div>
          <div>
            <span><Trans text={"Queue position"} /></span>
            <strong>{patientActiveToken.status === "called" ? t("Now Serving") : patientQueuePosition || "—"}</strong>
          </div>
          <div className="patient-lounge-status">
            {t(patientActiveToken.status === "called" ? "Please proceed to consultation room" : "Stay ready — this view updates live")}
          </div>
        </section>
      )}

      {patientView && !patientActiveToken && (
        <section className="patient-lounge-reservation-strip">
          <CheckCircle size={20} />
          <div>
            <strong><Trans text={"Online reservation confirmed"} /></strong>
            <span><Trans text={"Your lounge access is active for this clinic. Your FCFS token and queue position will appear after hospital check-in."} /></span>
          </div>
        </section>
      )}

      <div className="waiting-lounge-filter professional-lounge-filter">
        <div>
          <span className="waiting-lounge-filter-label"><Trans text={"VIEW DEPARTMENT"} /></span>
          <strong>{selectedDepartment}</strong>
        </div>
        <select
          value={selectedDepartment}
          onChange={(event) => setSelectedDepartment(event.target.value)}
          aria-label={t("Select department for waiting lounge")}
        >
          <option value="All Departments">{t("All Departments")}</option>
          {departments.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
      </div>

      <div className="tvgrid professional-lounge-grid">
        <section className={`now-serving-card ${currentTokenInRoom ? "has-current-token" : ""}`}>
          <div className="now-serving-label"><span className="pulse-dot" /> <Trans text={"NOW SERVING"} /></div>
          <strong>#{currentTokenInRoom?.tokenNumber ?? "—"}</strong>
          <h2>{t(currentTokenInRoom ? "Please proceed to the consultation room" : "Next token will appear here")}</h2>
          <div className="now-serving-meta">
            <span><Stethoscope size={15} /> {t(currentTokenInRoom?.department) || selectedDepartment}</span>
            {currentTokenInRoom?.doctorName && <span><UserCheck size={15} /> <Trans text={"Dr. "} />{currentTokenInRoom.doctorName}</span>}
            {currentTokenInRoom?.roomNumber && <span><Monitor size={15} /> <Trans text={"Room "} />{currentTokenInRoom.roomNumber}</span>}
            <span><Activity size={15} /> <Trans text={"Real-time synchronized"} /></span>
          </div>
        </section>

        <aside className="upcoming-queue-card">
          <div className="waiting-lounge-list-head">
            <div>
              <small><Trans text={"LIVE QUEUE"} /></small>
              <h2><Trans text={"Up Next"} /></h2>
            </div>
            <span>{allWaitingTokens.length} <Trans text={"waiting"} /></span>
          </div>

          <div className="upcoming-token-list">
            {upcomingWaitingTokens.map((tokenItem, index) => (
              <div className="upcoming-token-row" key={`${tokenItem.department}-${tokenItem.tokenNumber}`}>
                <span className="queue-position">{String(index + 1).padStart(2, "0")}</span>
                <b>#{tokenItem.tokenNumber}</b>
                <span className="queue-department">{t(tokenItem.department)}</span>
                <ChevronRight size={16} />
              </div>
            ))}
          </div>

          {!upcomingWaitingTokens.length && (
            <div className="waiting-lounge-empty">
              <CheckCircle size={22} />
              <b><Trans text={"Queue is clear"} /></b>
              <span>{selectedDepartment === "All Departments" ? "All queued patients have been attended." : `No waiting patients in ${selectedDepartment}.`}</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="professional-lounge-footer">
        <span><i /> <Trans text={"Live sync active"} /></span>
        <span><Trans text={"Showing: "} /><b>{selectedDepartment}</b></span>
        <span>{patientView ? t("Clinic: {clinic}", { clinic: getActiveClinicSlug() }) : t("Central announcements play only on this hospital display")}</span>
      </footer>
    </main>
  );
}

function PatientWaitingLoungePage() {
  const { t } = useLanguage();
  const [accessState, setAccessState] = useState({ loading: true, allowed: false });

  useEffect(() => {
    let active = true;
    const checkAccess = async () => {
      try {
        const { data } = await api.get("/patients/me/lounge-access");
        if (active) setAccessState({ loading: false, allowed: Boolean(data?.allowed) });
      } catch {
        if (active) setAccessState({ loading: false, allowed: false });
      }
    };
    checkAccess();
    return () => { active = false; };
  }, []);

  if (!getPatientToken()) return <Navigate to="/patient-login" replace />;
  if (accessState.loading) {
    return (
      <main className="page premium-page">
        <section className="card center">
          <RefreshCw className="animate-spin" size={24} />
          <h2><Trans text={"Checking waiting lounge access..."} /></h2>
        </section>
      </main>
    );
  }
  if (!accessState.allowed) return <Navigate to="/patient" replace />;
  return <LiveWaitingRoomDisplayPage patientView />;
}

/* =========================================================
   RECEPTION / FRONT-DESK WORKSPACE
========================================================= */


/* =========================================================
   RECEPTION QR SCANNER
========================================================= */

function ReceptionQrScannerPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [decodedToken, setDecodedToken] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [verifiedAppointment, setVerifiedAppointment] = useState(null);
  const [scannerMessage, setScannerMessage] = useState("");
  const [scannerError, setScannerError] = useState("");
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(true);
  const [qrPaymentDraft, setQrPaymentDraft] = useState(emptyPaymentDraft(0));

  const scanLock = useRef({ token: "", at: 0, busy: false });
  const clinicCheckInUrl = `${window.location.origin}/qr-checkin?clinic=${encodeURIComponent(getActiveClinicSlug())}`;

  const verifyQr = async (tokenValue) => {
    const cleanToken = String(tokenValue || "").trim();
    if (!cleanToken || scanLock.current.busy || (scanLock.current.token === cleanToken && Date.now() - scanLock.current.at < 5000)) return;
    scanLock.current = { token: cleanToken, at: Date.now(), busy: true };

    setDecodedToken(cleanToken);
    setVerifiedAppointment(null);
    setScannerError("");
    setScannerMessage("");

    try {
      const { data } = await api.post("/check-in/verify", {
        token: cleanToken,
      });

      setVerifiedAppointment(data.visit || null);
      setQrPaymentDraft(emptyPaymentDraft(data.visit?.billing?.quotedAmount || 0));
      setScannerMessage(
        data.visit?.alreadyCheckedIn
          ? t("This visit is already checked in.")
          : t("{kind} verified. Confirm physical arrival below.", { kind: t(data.kind === "reservation" ? "Online reservation" : "Appointment") })
      );
    } catch (error) {
      setScannerError(
        t(error.response?.data?.message || "Unable to verify QR code.")
      );
    } finally {
      scanLock.current.busy = false;
    }
  };

  useEffect(() => {
    let scannerInstance = null;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5QrcodeScanner } = await import("html5-qrcode");

        if (cancelled) return;

        scannerInstance = new Html5QrcodeScanner(
          "appointment-qr-reader",
          {
            fps: 10,
            qrbox: { width: 240, height: 240 },
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true,
          },
          false
        );

        scannerInstance.render(
          (decodedText) => {
            verifyQr(decodedText);
          },
          () => {
            // Continuous scan failures are normal while the camera is looking
            // for a QR code, so they are intentionally not shown to the user.
          }
        );
      } catch (error) {
        console.error("QR scanner initialization error:", error);
        setCameraSupported(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      if (scannerInstance) {
        scannerInstance.clear().catch(() => {});
      }
    };
  }, []);

  const checkInScannedAppointment = async () => {
    if (!decodedToken) return;

    setIsCheckingIn(true);
    setScannerError("");
    setScannerMessage("");

    try {
      const { data } = await api.post("/check-in", {
        token: decodedToken,
        payment: { ...qrPaymentDraft, paidAmount: Number(qrPaymentDraft.paidAmount || 0) },
      });

      setScannerMessage(data.message || "Patient checked in successfully.");
      setVerifiedAppointment((previous) =>
        previous
          ? {
              ...previous,
              status: "checked_in",
              alreadyCheckedIn: true,
              tokenNumber: data.token?.tokenNumber,
            }
          : previous
      );
    } catch (error) {
      setScannerError(
        error.response?.data?.message || "Unable to check in appointment."
      );
    } finally {
      setIsCheckingIn(false);
    }
  };

  return (
    <main className="page premium-page">
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Front Desk QR Check-in"} /></p>
          <h1><Trans text={"Scan Patient Check-in QR"} /></h1>
          <p className="page-subtitle">
            <Trans text={"Verify a scheduled appointment or online queue reservation. The live FCFS token is created only when physical arrival is confirmed."} /></p>
        </div>
        <button type="button" className="ghost" onClick={() => navigate("/reception")}>
          <Trans text={"Back to Reception"} /></button>
      </div>

      <div className="qr-reception-grid">
        <section className="card qr-scanner-card">
          <div className="card-title">
            <QrCode size={19} />
            <h2><Trans text={"Check-in Scanner"} /></h2>
          </div>

          <div id="appointment-qr-reader" className="appointment-qr-reader" />

          {!cameraSupported && (
            <div className="doctor-profile-warning">
              <Trans text={"Camera scanner could not start in this browser. You can still paste the QR check-in code below."} /></div>
          )}

          <div className="qr-manual-entry">
            <label>
              <Trans text={"Manual QR Code / Scanner Input"} /><textarea
                rows={3}
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder={t("Paste the scanned check-in QR content here")}
              />
            </label>
            <button
              type="button"
              className="ghost"
              disabled={!manualToken.trim()}
              onClick={() => verifyQr(manualToken)}
            >
              <ShieldCheck size={16} /> <Trans text={"Verify Code"} /></button>
          </div>

          {scannerError && <div className="login-error" role="alert">{t(scannerError)}</div>}
          {scannerMessage && <p className="success">{t(scannerMessage)}</p>}

          {verifiedAppointment && (
            <div className="qr-verified-card">
              <div className="qr-verified-head">
                <CheckCircle size={22} />
                <div>
                  <span><Trans text={"Verified Visit"} /></span>
                  <strong>{verifiedAppointment.patientName}</strong>
                </div>
              </div>

              <div className="qr-verified-grid">
                <div><span><Trans text={"Doctor"} /></span><b><Trans text={"Dr. "} />{verifiedAppointment.doctorName}</b></div>
                <div><span><Trans text={"Department"} /></span><b>{t(verifiedAppointment.department)}</b></div>
                <div><span><Trans text={"Date"} /></span><b>{verifiedAppointment.appointmentDate}</b></div>
                <div><span><Trans text={"Time"} /></span><b>{verifiedAppointment.startTime}</b></div>
              </div>

              {!verifiedAppointment.alreadyCheckedIn && <ReceptionPaymentBox amount={verifiedAppointment.billing?.quotedAmount || 0} feeType={verifiedAppointment.billing?.feeType || "consultation"} draft={qrPaymentDraft} onChange={setQrPaymentDraft} compact />}

              {!verifiedAppointment.alreadyCheckedIn ? (
                <button
                  type="button"
                  className="primary wide"
                  disabled={isCheckingIn}
                  onClick={checkInScannedAppointment}
                >
                  <UserCheck size={17} />
                  {t(isCheckingIn ? "Processing..." : Number(verifiedAppointment.billing?.quotedAmount || 0) > 0 ? "Confirm Payment & Create Token" : "Confirm Arrival & Create Token")}
                </button>
              ) : (
                <div className="qr-already-checked">
                  <CheckCircle size={16} />
                  <Trans text={"Patient is already checked in"} />{verifiedAppointment.tokenNumber
                    ? ` · Token #${verifiedAppointment.tokenNumber}`
                    : ""}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card clinic-qr-card">
          <div className="card-title">
            <QrCode size={19} />
            <h2><Trans text={"Permanent Clinic Self Check-in QR"} /></h2>
          </div>
          <p className="muted">
            <Trans text={"Print and place this QR at reception. Patients with a scheduled appointment can scan it using their own phone, sign in, and check themselves into the live queue."} /></p>

          <div className="clinic-qr-display">
            <QRCodeSVG
              value={clinicCheckInUrl}
              size={240}
              level="M"
              includeMargin
              aria-label={t("Permanent clinic self check-in QR code")}
            />
          </div>

          <div className="clinic-qr-url">
            <span><Trans text={"Clinic check-in address"} /></span>
            <code>{clinicCheckInUrl}</code>
          </div>

          <button type="button" className="ghost wide" onClick={() => window.print()}>
            <FileText size={16} /> <Trans text={"Print Clinic QR"} /></button>
        </section>
      </div>
    </main>
  );
}

function ReceptionQueueIntervention({ tokenItem, doctors, onApply }) {
  const { t } = useLanguage();
  const held = Boolean(tokenItem.queueControl?.isOnHold);
  const [action, setAction] = useState(held ? "resume" : "hold");
  const [department, setDepartment] = useState(tokenItem.department || "General OPD");
  const [doctorId, setDoctorId] = useState(String(tokenItem.assignedDoctor?._id || tokenItem.assignedDoctor || ""));
  const [urgency, setUrgency] = useState(tokenItem.urgency === "emergency" ? "emergency" : "normal");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const requiresDoctor = action === "reassign" || action === "transfer";
  const targetDepartment = action === "transfer" ? department : tokenItem.department;
  const availableDoctors = doctors.filter((doctor) => doctor.department === targetDepartment);

  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) return alert(localizeUi("Enter a reason for this intervention."));
    if (requiresDoctor && !doctorId) return alert(localizeUi("Select a target doctor."));
    setBusy(true);
    try {
      await onApply(tokenItem, {
        action,
        reason: reason.trim(),
        doctorId: requiresDoctor ? doctorId : undefined,
        department: action === "transfer" ? department : undefined,
        urgency: action === "priority" ? urgency : undefined,
      });
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="queue-intervention">
      <summary><Trans text={"Intervene"} /></summary>
      <form onSubmit={submit} className="queue-intervention-panel">
        <label><Trans text={"Action"} /><select value={action} onChange={(event) => {
            const next = event.target.value;
            setAction(next);
            if (next !== "transfer") setDepartment(tokenItem.department);
            if (next === "resume" || next === "hold" || next === "priority" || next === "recover_no_show") setDoctorId("");
          }}>
            {!held && tokenItem.status === "waiting" && <option value="hold">{t("Hold token")}</option>}
            {held && <option value="resume">{t("Resume token")}</option>}
            {tokenItem.status === "waiting" && <option value="reassign">{t("Reassign doctor")}</option>}
            {tokenItem.status === "waiting" && <option value="transfer">{t("Transfer department")}</option>}
            {tokenItem.status === "waiting" && <option value="priority">{t("Priority override")}</option>}
            {tokenItem.status === "skipped" && tokenItem.arrivalStatus === "no_show" && <option value="recover_no_show">{t("Recover no-show")}</option>}
          </select>
        </label>

        {action === "transfer" && (
          <label><Trans text={"Department"} /><select value={department} onChange={(event) => { setDepartment(event.target.value); setDoctorId(""); }}>
              {CLINICAL_DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
        )}

        {requiresDoctor && (
          <label><Trans text={"Doctor"} /><select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
              <option value="">{t("Select doctor")}</option>
              {availableDoctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{t("Dr. ")}{doctor.name}</option>)}
            </select>
          </label>
        )}

        {action === "priority" && (
          <label><Trans text={"Priority"} /><select value={urgency} onChange={(event) => setUrgency(event.target.value)}>
              <option value="normal">{t("Normal")}</option>
              <option value="emergency">{t("Emergency")}</option>
            </select>
          </label>
        )}

        <label><Trans text={"Reason"} /><textarea rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("Required for audit trail")} />
        </label>
        <button type="submit" className="primary compact" disabled={busy}>{t(busy ? "Applying..." : "Apply")}</button>
      </form>
    </details>
  );
}

function ReceptionDashboardPage() {
  const { t } = useLanguage();
  const liveQueue = useLiveQueue("staff");
  const navigate = useNavigate();
  const currentStaff = getLoggedInStaff();

  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState([]);
  const [isSearchingPatients, setIsSearchingPatients] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedPatientReservations, setSelectedPatientReservations] = useState([]);
  const [checkingInReservationId, setCheckingInReservationId] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [queueDepartmentFilter, setQueueDepartmentFilter] = useState("All Departments");

  const [walkInForm, setWalkInForm] = useState({
    name: "",
    phone: "",
    email: "",
    dateOfBirth: "",
    gender: "",
  });

  const [tokenForm, setTokenForm] = useState({
    department: "General OPD",
    doctorId: "",
    urgency: "normal",
  });

  const [frontDeskMessage, setFrontDeskMessage] = useState("");
  const [frontDeskError, setFrontDeskError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isIssuingToken, setIsIssuingToken] = useState(false);
  const [lastIssuedToken, setLastIssuedToken] = useState(null);
  const [receptionAppointment, setReceptionAppointment] = useState({ department:"General OPD", doctorId:"", appointmentDate:"", startTime:"", reason:"" });
  const [receptionAppointmentDoctors, setReceptionAppointmentDoctors] = useState([]);
  const [receptionAppointmentDates, setReceptionAppointmentDates] = useState([]);
  const [receptionAppointmentSlots, setReceptionAppointmentSlots] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [isBookingReceptionAppointment, setIsBookingReceptionAppointment] = useState(false);
  const [receptionPrescriptions, setReceptionPrescriptions] = useState([]);
  const [receptionClinicContext, setReceptionClinicContext] = useState(null);
  const [prescriptionDeskLoading, setPrescriptionDeskLoading] = useState(false);
  const [receptionSection, setReceptionSection] = useState("overview");
  const [pendingPrintConfirmation, setPendingPrintConfirmation] = useState(null);
  const [receptionRescheduleTarget, setReceptionRescheduleTarget] = useState(null);
  const [receptionOperationsStatus, setReceptionOperationsStatus] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState(emptyPaymentDraft(0));
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [billingSummary, setBillingSummary] = useState(null);

  const loadPrescriptionDesk = async () => {
    setPrescriptionDeskLoading(true);
    try {
      const [{ data }, clinicResult] = await Promise.all([
        api.get("/reception/prescriptions?limit=40"),
        receptionClinicContext ? Promise.resolve({ data: { tenant: receptionClinicContext } }) : api.get("/tenant/current"),
      ]);
      setReceptionPrescriptions(data.consultations || []);
      if (clinicResult?.data?.tenant) setReceptionClinicContext(clinicResult.data.tenant);
    } catch {
      setReceptionPrescriptions([]);
    } finally {
      setPrescriptionDeskLoading(false);
    }
  };

  const printFromReceptionDesk = (consultation) => {
    const tokenItem = consultation.token || {};
    const patient = consultation.patient || { name: tokenItem.patientName, patientId: tokenItem.patientId };
    printPrescription(consultation, tokenItem, patient, receptionClinicContext || {});
    setPendingPrintConfirmation(consultation);
  };

  const confirmPrescriptionPrinted = async () => {
    if (!pendingPrintConfirmation) return;
    try {
      const { data } = await api.post(`/reception/prescriptions/${pendingPrintConfirmation._id}/printed`);
      setReceptionPrescriptions((current) => current.map((item) => String(item._id) === String(pendingPrintConfirmation._id) ? { ...item, printDesk: { ...(item.printDesk || {}), printedAt: data.printedAt || new Date().toISOString() } } : item));
      setFrontDeskMessage("Prescription confirmed as printed."); setPendingPrintConfirmation(null);
    } catch (error) { setFrontDeskError(error.response?.data?.message || "Unable to confirm print status."); }
  };

  const applyQueueIntervention = async (tokenItem, payload) => {
    setFrontDeskError("");
    setFrontDeskMessage("");
    try {
      const { data } = await api.post(`/reception/tokens/${tokenItem._id}/intervention`, payload);
      setFrontDeskMessage(data.message || "Queue intervention applied.");
    } catch (error) {
      setFrontDeskError(error.response?.data?.message || "Unable to apply queue intervention.");
      throw error;
    }
  };

  const loadReceptionOperationsStatus = async () => {
    try { const {data}=await api.get("/reception/operations-status"); setReceptionOperationsStatus(data?.status||null); }
    catch { setReceptionOperationsStatus(null); }
  };

  const loadReceptionAppointmentDoctors = async (department="General OPD") => {
    try { const {data}=await api.get("/reception/appointment-doctors",{params:{department}}); setReceptionAppointmentDoctors(data.doctors||[]); }
    catch { setReceptionAppointmentDoctors([]); }
  };
  const loadTodayAppointments = async () => {
    try { const {data}=await api.get("/reception/appointments/today"); setTodayAppointments(data.appointments||[]); }
    catch { setTodayAppointments([]); }
  };

  const loadReceptionBillingSummary = async () => {
    try { const { data } = await api.get("/reception/billing-summary"); setBillingSummary(data); }
    catch { setBillingSummary(null); }
  };
  const loadReceptionDates = async (doctorId) => {
    setReceptionAppointmentDates([]); setReceptionAppointmentSlots([]);
    if(!doctorId)return;
    try { const {data}=await api.get(`/reception/appointment-doctors/${doctorId}/dates`); setReceptionAppointmentDates(data.dates||[]); }
    catch(error){setFrontDeskError(error.response?.data?.message||"Unable to load dates.");}
  };
  const loadReceptionSlots = async (doctorId,date) => {
    setReceptionAppointmentSlots([]); if(!doctorId||!date)return;
    try { const {data}=await api.get(`/reception/appointment-doctors/${doctorId}/slots`,{params:{date}}); setReceptionAppointmentSlots(data.slots||[]); }
    catch(error){setFrontDeskError(error.response?.data?.message||"Unable to load slots.");}
  };
  const bookReceptionAppointment = async (event) => {
    event.preventDefault();
    if(!receptionRescheduleTarget && !selectedPatient?._id){setFrontDeskError("Select a patient before booking an appointment.");return;}
    setIsBookingReceptionAppointment(true);setFrontDeskError("");setFrontDeskMessage("");
    try{
      const {data}=receptionRescheduleTarget
        ? await api.patch(`/reception/appointments/${receptionRescheduleTarget._id}/reschedule`,receptionAppointment)
        : await api.post("/reception/appointments",{patientMongoId:selectedPatient._id,...receptionAppointment});
      setFrontDeskMessage(receptionRescheduleTarget ? (data.message || "Appointment rescheduled.") : `Appointment booked for ${data.appointment.patientName} with Dr. ${data.appointment.doctorName} on ${data.appointment.appointmentDate} at ${data.appointment.startTime}.`);
      setReceptionRescheduleTarget(null);
      setReceptionAppointment(prev=>({...prev,appointmentDate:"",startTime:"",reason:""}));setReceptionAppointmentSlots([]);
      await loadTodayAppointments();
    loadReceptionBillingSummary();
    }catch(error){setFrontDeskError(error.response?.data?.message||"Unable to book appointment.");}
    finally{setIsBookingReceptionAppointment(false);}
  };
  const checkInAppointment = async (appointment, payment) => {
    setFrontDeskError("");setFrontDeskMessage("");
    const {data}=await api.post(`/reception/appointments/${appointment._id}/check-in`, { payment });
    setLastIssuedToken(data.token || null);
    setFrontDeskMessage(`Payment confirmed. Appointment converted to live ${data.token.department} token #${data.token.tokenNumber}. Receipt ${data.token.billing?.receiptNumber || "generated"}.`);
    await loadTodayAppointments();
  };

  const prepareReceptionReschedule = async (appointment) => {
    setReceptionRescheduleTarget(appointment); setFrontDeskError(""); setFrontDeskMessage("Choose a new doctor/date/time below.");
    setReceptionAppointment({ department: appointment.department, doctorId: String(appointment.doctor || ""), appointmentDate: "", startTime: "", reason: appointment.reason || "" });
    await loadReceptionAppointmentDoctors(appointment.department); await loadReceptionDates(String(appointment.doctor || ""));
  };
  const cancelReceptionAppointment = async (appointment) => {
    const reason = window.prompt(localizeUi("Cancellation reason"), "Patient requested cancellation"); if (reason === null) return;
    try { const {data}=await api.patch(`/reception/appointments/${appointment._id}/cancel`,{reason}); setFrontDeskMessage(data.message||"Appointment cancelled."); await loadTodayAppointments(); }
    catch(error){setFrontDeskError(error.response?.data?.message||"Unable to cancel appointment.");}
  };

  const markReceptionAppointmentMissed = async (appointment) => {
    if (!window.confirm(localizeUi(`Mark ${appointment.patientName}'s ${appointment.startTime} appointment as missed?`))) return;
    try { const {data}=await api.patch(`/reception/appointments/${appointment._id}/missed`); setFrontDeskMessage(data.message||"Appointment marked missed."); await loadTodayAppointments(); }
    catch(error){setFrontDeskError(error.response?.data?.message||"Unable to mark appointment missed.");}
  };

  const loadSelectedPatientReservations = async (patientId) => {
    if (!patientId) {
      setSelectedPatientReservations([]);
      return;
    }
    try {
      const { data } = await api.get(`/reception/patients/${patientId}/reservations`);
      setSelectedPatientReservations(data.reservations || []);
    } catch {
      setSelectedPatientReservations([]);
    }
  };

  const checkInQueueReservationAtReception = async (reservation, payment) => {
    setCheckingInReservationId(reservation._id);
    try {
      const { data } = await api.post(`/reception/reservations/${reservation._id}/check-in`, { payment });
      setLastIssuedToken(data.token || null);
      setFrontDeskMessage(data.message || `FCFS token #${data.token?.tokenNumber} issued.`);
      await loadSelectedPatientReservations(selectedPatient?._id);
    } finally { setCheckingInReservationId(""); }
  };

  const loadReceptionDoctors = async () => {
    try {
      const response = await api.get("/reception/doctors");
      setDoctors(response.data || []);
    } catch {
      setDoctors([]);
    }
  };

  const searchPatients = async (query = patientSearch) => {
    setIsSearchingPatients(true);
    setFrontDeskError("");
    try {
      const { data } = await api.get("/reception/patients", {
        params: { search: String(query || "").trim() },
      });
      setPatientResults(data || []);
    } catch (error) {
      setFrontDeskError(
        error.response?.data?.message || "Unable to search patient registry."
      );
    } finally {
      setIsSearchingPatients(false);
    }
  };

  useEffect(() => {
    searchPatients("");
    loadReceptionAppointmentDoctors("General OPD");
    loadTodayAppointments();
    loadReceptionDoctors();
    loadPrescriptionDesk();
    loadReceptionOperationsStatus();
    loadReceptionBillingSummary();
  }, []);

  useEffect(() => {
    const refreshReceptionState = (update = null) => {
      const appointmentChanged = !update || hasOperationalDomain(update, "appointments");
      const staffChanged = !update || hasOperationalDomain(update, "staff");

      if (appointmentChanged) {
        loadTodayAppointments();
        if (receptionAppointment.doctorId && receptionAppointment.appointmentDate) {
          loadReceptionSlots(
            receptionAppointment.doctorId,
            receptionAppointment.appointmentDate
          );
        }
      }

      if (!update || hasOperationalDomain(update, "queue") || hasOperationalDomain(update, "prescriptions")) {
        loadPrescriptionDesk();
      }
      if (!update || hasOperationalDomain(update, "settings") || hasOperationalDomain(update, "queue")) {
        loadReceptionOperationsStatus();
      }

      if (staffChanged) {
        loadReceptionDoctors();
        loadReceptionAppointmentDoctors(receptionAppointment.department);
        if (receptionAppointment.doctorId) {
          loadReceptionDates(receptionAppointment.doctorId);
        }
      }
    };

    const handleOperationsUpdate = (update) => refreshReceptionState(update);
    const handleReconnect = () => refreshReceptionState(null);

    socket.on("operations:updated", handleOperationsUpdate);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("operations:updated", handleOperationsUpdate);
      socket.off("connect", handleReconnect);
    };
  }, [
    receptionAppointment.department,
    receptionAppointment.doctorId,
    receptionAppointment.appointmentDate,
  ]);

  const handleRegisterWalkIn = async (event) => {
    event.preventDefault();
    setFrontDeskError("");
    setFrontDeskMessage("");
    setLastIssuedToken(null);
    setIsRegistering(true);

    try {
      const { data } = await api.post("/reception/patients", {
        ...walkInForm,
        phone: walkInForm.phone.replace(/\D/g, ""),
        dateOfBirth: walkInForm.dateOfBirth || null,
      });

      setSelectedPatient(data);
      setWalkInForm({
        name: "",
        phone: "",
        email: "",
        dateOfBirth: "",
        gender: "",
      });
      setFrontDeskMessage(
        `${data.name} registered successfully (${data.patientId}). You can issue the OPD token now.`
      );
      await searchPatients("");
    } catch (error) {
      setFrontDeskError(
        error.response?.data?.message || "Unable to register walk-in patient."
      );
    } finally {
      setIsRegistering(false);
    }
  };

  const openReceptionPayment = async (kind, target = null) => {
    setFrontDeskError(""); setFrontDeskMessage("");
    try {
      let amount = Number(target?.billing?.quotedAmount || 0);
      let feeType = target?.billing?.feeType || (kind === "walkin" ? "walk_in" : kind);
      const title = kind === "walkin" ? "Walk-in Consultation Payment" : kind === "reservation" ? "Online Reservation Check-in Payment" : "Appointment Check-in Payment";
      if (kind === "walkin") {
        if (!selectedPatient?._id || !tokenForm.doctorId) throw new Error("Select patient and doctor first.");
        const { data } = await api.get("/reception/fee-quote", { params: { doctorId: tokenForm.doctorId, patientId: selectedPatient._id, visitType: "walk_in", urgency: tokenForm.urgency } });
        amount = Number(data?.quote?.amount || 0); feeType = data?.quote?.feeType || "walk_in";
      } else if (target?.billing?.quotedAmount === undefined) {
        const doctorId = String(target?.doctor?._id || target?.doctor || "");
        const patientId = String(target?.patient?._id || target?.patient || selectedPatient?._id || "");
        if (doctorId) {
          const { data } = await api.get("/reception/fee-quote", { params: { doctorId, patientId, visitType: kind === "reservation" ? "reservation" : "appointment", urgency: target?.urgency || "normal" } });
          amount = Number(data?.quote?.amount || 0); feeType = data?.quote?.feeType || kind;
        }
      }
      setPaymentDraft(emptyPaymentDraft(amount));
      setPaymentModal({ kind, target, amount, feeType, title });
    } catch (error) { setFrontDeskError(error.response?.data?.message || error.message || "Unable to calculate consultation fee."); }
  };

  const confirmReceptionPayment = async () => {
    if (!paymentModal) return;
    setPaymentBusy(true); setFrontDeskError("");
    const payment = { ...paymentDraft, paidAmount: Number(paymentDraft.paidAmount || 0) };
    try {
      if (paymentModal.kind === "walkin") {
        const { data } = await api.post("/reception/tokens", { patientMongoId: selectedPatient._id, department: tokenForm.department, doctorId: tokenForm.doctorId, urgency: tokenForm.urgency, payment });
        setLastIssuedToken(data);
        const assignedDoctor = doctors.find((doctor) => String(doctor._id) === String(data.assignedDoctor));
        setFrontDeskMessage(`${data.department} token #${data.tokenNumber} issued after payment confirmation. Receipt ${data.billing?.receiptNumber || "generated"}. Dr. ${assignedDoctor?.name || "selected doctor"}.`);
      } else if (paymentModal.kind === "reservation") {
        await checkInQueueReservationAtReception(paymentModal.target, payment);
      } else if (paymentModal.kind === "appointment") {
        await checkInAppointment(paymentModal.target, payment);
      }
      setPaymentModal(null);
      await loadReceptionBillingSummary();
    } catch (error) { setFrontDeskError(error.response?.data?.message || "Unable to confirm payment and check in."); }
    finally { setPaymentBusy(false); }
  };

  const handleIssueToken = async (event) => {
    event.preventDefault();
    if (!selectedPatient?._id) { setFrontDeskError("Search/register and select a patient before issuing a token."); return; }
    if (!tokenForm.doctorId) { setFrontDeskError("Select a doctor before issuing a token."); return; }
    await openReceptionPayment("walkin");
  };

  const updateArrivalStatus = async (tokenId, arrivalStatus) => {
    setFrontDeskError("");
    setFrontDeskMessage("");
    try {
      const { data } = await api.patch(`/reception/tokens/${tokenId}/arrival`, {
        arrivalStatus,
      });

      const label =
        arrivalStatus === "arrived"
          ? "marked as arrived"
          : arrivalStatus === "no_show"
            ? "marked as no-show"
            : "marked as not checked in";

      setFrontDeskMessage(`Token #${data.tokenNumber} ${label}.`);
    } catch (error) {
      setFrontDeskError(
        error.response?.data?.message || "Unable to update patient arrival."
      );
    }
  };

  const updateAssignedDoctor = async (tokenId, doctorId) => {
    if (!doctorId) return;
    setFrontDeskError("");
    setFrontDeskMessage("");

    try {
      const { data } = await api.patch(`/reception/tokens/${tokenId}/doctor`, {
        doctorId,
      });
      setFrontDeskMessage(
        `Token #${data.token.tokenNumber} assigned to Dr. ${data.doctor.name}.`
      );
    } catch (error) {
      setFrontDeskError(
        error.response?.data?.message || "Unable to assign doctor."
      );
    }
  };

  const printLastToken = () => {
    if (!lastIssuedToken) return;
    const printWindow = window.open("", "_blank", "width=480,height=700");
    if (!printWindow) {
      setFrontDeskError("Pop-up blocked. Allow pop-ups to print the token slip.");
      return;
    }

    const escapeSlipText = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const assignedDoctor = doctors.find(
      (doctor) => String(doctor._id) === String(lastIssuedToken.assignedDoctor)
    );
    const safeName = escapeSlipText(lastIssuedToken.patientName || "Patient");
    const safePatientId = escapeSlipText(selectedPatient?.patientId || "-");
    const safeDepartment = escapeSlipText(lastIssuedToken.department || "OPD");
    const safeDoctor = escapeSlipText(assignedDoctor?.name || "Assigned specialist");
    const safeUrgency = lastIssuedToken.urgency === "emergency" ? "EMERGENCY" : "NORMAL OPD";
    const issuedAt = escapeSlipText(new Date().toLocaleString());
    const safeReceipt = escapeSlipText(lastIssuedToken.billing?.receiptNumber || "-");
    const safePaymentMethod = escapeSlipText(String(lastIssuedToken.billing?.method || "-").toUpperCase());
    const safePaidAmount = escapeSlipText(formatInr(lastIssuedToken.billing?.paidAmount || 0));

    printWindow.document.write(`
      <html>
        <head>
          <title>OPD Token #${lastIssuedToken.tokenNumber}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            @page{size:80mm auto;margin:5mm}
            *{box-sizing:border-box}
            body{font-family:Arial,sans-serif;margin:0;color:#0f172a;background:#fff}
            .slip{width:100%;max-width:76mm;margin:0 auto;border:1.5px dashed #64748b;border-radius:12px;padding:18px;text-align:center}
            .brand{font-size:15px;font-weight:800;letter-spacing:.08em;margin:0 0 4px}
            .subtitle{font-size:10px;color:#64748b;margin:0 0 14px}
            .department{font-size:13px;font-weight:700;margin:0}
            .token{font-size:54px;line-height:1;font-weight:900;margin:12px 0 10px;letter-spacing:-.04em}
            .priority{display:inline-block;margin:0 0 14px;padding:5px 9px;border:1px solid #cbd5e1;border-radius:999px;font-size:10px;font-weight:800}
            .priority.urgent{color:#991b1b;border-color:#fecaca;background:#fef2f2}
            .details{margin:0;text-align:left;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:10px 0}
            .row{display:flex;justify-content:space-between;gap:12px;margin:5px 0;font-size:10px}
            .row span{color:#64748b}.row b{text-align:right;max-width:62%;overflow-wrap:anywhere}
            .notice{font-size:10px;line-height:1.45;margin:12px 0 0;color:#334155}
            .foot{font-size:9px;color:#94a3b8;margin:10px 0 0}
            @media print{body{padding:0}.slip{border-color:#64748b}}
          </style>
        </head>
        <body>
          <div class="slip">
            <p class="brand">OPDfy</p>
            <p class="subtitle">Patient Queue Token Slip</p>
            <p class="department">${safeDepartment}</p>
            <div class="token">#${lastIssuedToken.tokenNumber}</div>
            <div class="priority ${safeUrgency === "EMERGENCY" ? "urgent" : ""}">${safeUrgency}</div>
            <div class="details">
              <div class="row"><span>Patient</span><b>${safeName}</b></div>
              <div class="row"><span>Patient ID</span><b>${safePatientId}</b></div>
              <div class="row"><span>Doctor</span><b>Dr. ${safeDoctor}</b></div>
              <div class="row"><span>Issued</span><b>${issuedAt}</b></div>
              <div class="row"><span>Receipt</span><b>${safeReceipt}</b></div>
              <div class="row"><span>Payment</span><b>${safePaymentMethod} · ${safePaidAmount}</b></div>
            </div>
            <p class="notice">Please keep this slip and watch the Waiting Lounge display for your token number. Proceed to the consultation room when called.</p>
            <p class="foot">This slip is a queue reference, not a medical prescription.</p>
          </div>
          <script>window.onload=()=>{window.print();window.close();}</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const activeQueue = liveQueue.filter(
    (item) => item.status === "waiting" || item.status === "called"
  );
  const filteredQueue =
    queueDepartmentFilter === "All Departments"
      ? liveQueue
      : liveQueue.filter((item) => item.department === queueDepartmentFilter);

  const waitingCount = activeQueue.filter((item) => item.status === "waiting" && !item.queueControl?.isOnHold).length;
  const arrivedCount = activeQueue.filter(
    (item) => item.arrivalStatus === "arrived"
  ).length;
  const emergencyCount = activeQueue.filter(
    (item) => item.urgency === "emergency"
  ).length;
  const notCheckedInCount = activeQueue.filter(
    (item) => !item.arrivalStatus || item.arrivalStatus === "not_checked_in"
  ).length;

  const doctorsForSelectedDepartment = doctors.filter(
    (doctor) => doctor.department === tokenForm.department
  );

  const heldCount = liveQueue.filter((item) => item.queueControl?.isOnHold).length;
  const noShowCount = liveQueue.filter((item) => item.arrivalStatus === "no_show" || item.status === "skipped").length;
  const unprintedPrescriptionCount = receptionPrescriptions.filter((item) => !item.printDesk?.printedAt).length;
  const bookedTodayCount = todayAppointments.filter((item) => item.status === "booked").length;
  const checkedInAppointments = todayAppointments.filter((item) => item.status === "checked_in").length;
  const availableDoctors = doctors.filter((doctor) => !doctor.doctorSchedule?.isOnBreak).length;

  const queueByDepartment = CLINICAL_DEPARTMENTS.map((departmentOption) => {
    const department = departmentOption.value;
    const waiting = activeQueue.filter((item) => item.department === department && item.status === "waiting" && !item.queueControl?.isOnHold).length;
    const arrived = activeQueue.filter((item) => item.department === department && item.arrivalStatus === "arrived").length;
    const emergency = activeQueue.filter((item) => item.department === department && item.urgency === "emergency").length;
    return { department, waiting, arrived, emergency };
  }).filter((item) => item.waiting || item.arrived || item.emergency);

  const doctorCapacity = doctors.map((doctor) => {
    const doctorId = String(doctor._id);
    const assigned = activeQueue.filter((item) => String(item.assignedDoctor?._id || item.assignedDoctor || "") === doctorId);
    const waiting = assigned.filter((item) => item.status === "waiting" && !item.queueControl?.isOnHold).length;
    const current = assigned.find((item) => item.status === "called");
    return { ...doctor, waiting, current, onBreak: Boolean(doctor.doctorSchedule?.isOnBreak) };
  }).sort((a, b) => b.waiting - a.waiting);

  const receptionAlerts = [
    emergencyCount > 0 ? `${emergencyCount} emergency patient${emergencyCount > 1 ? "s" : ""} require front-desk attention.` : null,
    heldCount > 0 ? `${heldCount} token${heldCount > 1 ? "s are" : " is"} currently on hold.` : null,
    noShowCount > 0 ? `${noShowCount} no-show / skipped token${noShowCount > 1 ? "s" : ""} can be reviewed.` : null,
    unprintedPrescriptionCount > 0 ? `${unprintedPrescriptionCount} completed prescription${unprintedPrescriptionCount > 1 ? "s are" : " is"} ready to print.` : null,
    bookedTodayCount > 0 ? `${bookedTodayCount} booked appointment${bookedTodayCount > 1 ? "s" : ""} still await check-in.` : null,
  ].filter(Boolean);

  return (
    <main className="page premium-page reception-page">
      <ReceptionReferrals />
      {paymentModal && <div className="payment-modal-backdrop" role="presentation"><section className="payment-modal card" role="dialog" aria-modal="true"><div className="payment-modal-head"><div><p className="eyebrow"><Trans text={"Reception Billing"} /></p><h2>{t(paymentModal.title)}</h2><small>{paymentModal.target?.patientName || selectedPatient?.name || t("Patient")}</small></div><button type="button" className="ghost compact" onClick={()=>setPaymentModal(null)}><X size={16}/></button></div><ReceptionPaymentBox amount={paymentModal.amount} feeType={paymentModal.feeType} draft={paymentDraft} onChange={setPaymentDraft}/><div className="payment-modal-actions"><button type="button" className="ghost" onClick={()=>setPaymentModal(null)}><Trans text={"Cancel"} /></button><button type="button" className="primary" disabled={paymentBusy} onClick={confirmReceptionPayment}><CheckCircle size={16}/>{t(paymentBusy?"Processing...":paymentModal.amount>0?"Confirm Payment & Check In":"Confirm Free Visit & Check In")}</button></div></section></div>}
      <div className="head reception-command-head">
        <div>
          <p className="eyebrow"><Trans text={"Hospital Front Desk"} /></p>
          <h1><Trans text={"Reception Command Desk"} /></h1>
          <p className="page-subtitle">
            <Trans text={"Signed in as "} /><strong>{currentStaff?.name || "Reception Staff"}</strong><Trans text={". Manage arrivals, patient registration, queue interventions, appointments and prescription handover from one workspace."} /></p>
        </div>
        <button type="button" className="ghost" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
          <LogOut size={15} /> <Trans text={"End Front-Desk Shift"} /></button>
      </div>

      <nav className="admin-section-tabs reception-section-tabs" aria-label={t("Reception workspace sections")}>
        <button type="button" className={receptionSection === "overview" ? "active" : ""} onClick={() => setReceptionSection("overview")}>
          <Activity size={16} />
          <span><Trans text={"Overview"} /><small><Trans text={"Live front-desk command center"} /></small></span>
        </button>
        <button type="button" className={receptionSection === "patients" ? "active" : ""} onClick={() => setReceptionSection("patients")}>
          <Users size={16} />
          <span><Trans text={"Patient Desk"} /><small><Trans text={"Registry, walk-ins & tokens"} /></small></span>
        </button>
        <button type="button" className={receptionSection === "operations" ? "active" : ""} onClick={() => setReceptionSection("operations")}>
          <ShieldCheck size={16} />
          <span><Trans text={"Operations"} /><small><Trans text={"Queue, appointments & print desk"} /></small></span>
        </button>
      </nav>

      {receptionSection === "overview" && (
        <section className="reception-command-overview">
          <div className="reception-operations-livebar">
            <span className={`operations-state ${receptionOperationsStatus?.effectiveQueueState === "closed" ? "closed" : "open"}`}><i />{t(receptionOperationsStatus?.effectiveQueueState === "closed" ? "New arrivals closed" : "Accepting arrivals")}</span>
            <span><Clock3 size={14}/>{receptionOperationsStatus?.openTime || "--:--"}–{receptionOperationsStatus?.closeTime || "--:--"}</span>
            <span>{t(receptionOperationsStatus?.isCheckInOpen === false ? "Check-in cutoff reached" : "Check-in open")}</span>
          </div>
          <section className="metricgrid reception-metrics reception-command-metrics">
            <div className="metric"><Users /><b>{waitingCount}</b><span><Trans text={"Waiting Now"} /></span></div>
            <div className="metric"><UserCheck /><b>{arrivedCount}</b><span><Trans text={"Checked In"} /></span></div>
            <div className="metric"><Stethoscope /><b>{availableDoctors}/{doctors.length}</b><span><Trans text={"Doctors Available"} /></span></div>
            <div className="metric"><Calendar /><b>{bookedTodayCount}</b><span><Trans text={"Appointments Awaiting"} /></span></div>
            <div className="metric"><Printer /><b>{unprintedPrescriptionCount}</b><span><Trans text={"Ready to Print"} /></span></div>
          </section>

          <div className="reception-command-grid">
            <section className="card reception-command-card reception-pressure-card">
              <div className="reception-section-head"><div><p className="eyebrow"><Trans text={"Live Queue Pressure"} /></p><h2><Activity size={18}/> <Trans text={"Department Load"} /></h2></div></div>
              <div className="reception-pressure-list">
                {queueByDepartment.map((item) => {
                  const pressure = Math.min(100, item.waiting * 14 + item.emergency * 24);
                  return <div className="reception-pressure-row" key={item.department}>
                    <div><b>{t(item.department)}</b><small>{item.arrived} <Trans text={"arrived · "} />{item.emergency} <Trans text={"emergency"} /></small></div>
                    <div className="reception-pressure-meter"><span style={{ width: `${pressure}%` }} /></div>
                    <strong>{item.waiting} <Trans text={"waiting"} /></strong>
                  </div>;
                })}
                {!queueByDepartment.length && <p className="muted"><Trans text={"No active queue pressure right now."} /></p>}
              </div>
            </section>

            <section className="card reception-command-card">
              <div className="reception-section-head"><div><p className="eyebrow"><Trans text={"Doctor Capacity"} /></p><h2><Stethoscope size={18}/> <Trans text={"Availability & Load"} /></h2></div></div>
              <div className="reception-doctor-capacity-list">
                {doctorCapacity.slice(0, 6).map((doctor) => <article key={doctor._id}>
                  <span className={`reception-doctor-dot ${doctor.onBreak ? "break" : doctor.current ? "busy" : "available"}`} />
                  <div><b><Trans text={"Dr. "} />{doctor.name}</b><small>{t(doctor.department)} · {doctor.onBreak ? t("On break") : doctor.current ? `Serving #${doctor.current.tokenNumber}` : "Available"}</small></div>
                  <strong>{doctor.waiting} <Trans text={"waiting"} /></strong>
                </article>)}
                {!doctorCapacity.length && <p className="muted"><Trans text={"No doctor accounts available."} /></p>}
              </div>
            </section>

            <section className="card reception-command-card">
              <div className="reception-section-head"><div><p className="eyebrow"><Trans text={"Front-Desk Alerts"} /></p><h2><ShieldAlert size={18}/> <Trans text={"Attention Needed"} /></h2></div></div>
              <div className="reception-smart-alerts">
                {receptionAlerts.map((message, index) => <div key={`${message}-${index}`}><AlertTriangle size={15}/><span>{t(message)}</span></div>)}
                {!receptionAlerts.length && <div className="reception-all-clear"><CheckCircle size={16}/><span><Trans text={"Front desk is clear. No urgent operational alerts."} /></span></div>}
              </div>
            </section>

            <section className="card reception-command-card reception-quick-actions">
              <div className="reception-section-head"><div><p className="eyebrow"><Trans text={"Quick Actions"} /></p><h2><Sparkles size={18}/> <Trans text={"Front-Desk Shortcuts"} /></h2></div></div>
              <div className="reception-action-grid">
                <button type="button" onClick={() => setReceptionSection("patients")}><Users size={17}/><span><Trans text={"Find / Register Patient"} /></span></button>
                <button type="button" onClick={() => setReceptionSection("patients")}><Ticket size={17}/><span><Trans text={"Issue / Check-in Token"} /></span></button>
                <button type="button" onClick={() => navigate("/reception/scan")}><QrCode size={17}/><span><Trans text={"Open QR Scanner"} /></span></button>
                <button type="button" onClick={() => setReceptionSection("operations")}><Activity size={17}/><span><Trans text={"Manage Live Queue"} /></span></button>
                <button type="button" onClick={() => setReceptionSection("operations")}><Printer size={17}/><span><Trans text={"Prescription Print Desk"} /></span></button>
                <button type="button" onClick={() => setReceptionSection("operations")}><Calendar size={17}/><span><Trans text={"Appointments"} /></span></button>
              </div>
            </section>
          </div>

          <section className="card reception-shift-summary">
            <div><p className="eyebrow"><Trans text={"Shift Snapshot"} /></p><h2><Trans text={"Today at a glance"} /></h2></div>
            <div className="reception-shift-stats">
              <span><b>{notCheckedInCount}</b> <Trans text={"not checked in"} /></span>
              <span><b>{heldCount}</b> <Trans text={"on hold"} /></span>
              <span><b>{noShowCount}</b> <Trans text={"no-show / skipped"} /></span>
              <span><b>{emergencyCount}</b> <Trans text={"emergency"} /></span>
              <span><b>{checkedInAppointments}</b> <Trans text={"appointments checked in"} /></span>
              <span><b>{formatInr(billingSummary?.collected || 0)}</b> <Trans text={"collected today"} /></span>
              <span><b>{billingSummary?.pendingCount || 0}</b> <Trans text={"payments pending"} /></span>
            </div>
          </section>
        </section>
      )}

      {(frontDeskMessage || frontDeskError) && (
        <div className={frontDeskError ? "reception-alert error" : "reception-alert success"}>
          {t(frontDeskError) || t(frontDeskMessage)}
        </div>
      )}

      {receptionSection === "patients" && (
      <div className="reception-workspace-grid">
        <section className="card reception-registry-card">
          <div className="reception-section-head">
            <div>
              <p className="eyebrow"><Trans text={"Patient Registry"} /></p>
              <h2><Users size={18} /> <Trans text={"Find Existing Patient"} /></h2>
            </div>
          </div>

          <form
            className="reception-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              searchPatients();
            }}
          >
            <input
              value={patientSearch}
              onChange={(event) => setPatientSearch(event.target.value)}
              placeholder={t("Name, Patient ID, phone or email")}
            />
            <button className="primary" type="submit" disabled={isSearchingPatients}>
              {isSearchingPatients ? "Searching..." : t("Search")}
            </button>
          </form>

          <div className="reception-patient-results">
            {patientResults.map((patient) => (
              <button
                type="button"
                key={patient._id}
                className={`reception-patient-result ${
                  selectedPatient?._id === patient._id ? "selected" : ""
                }`}
                onClick={() => {
                  setSelectedPatient(patient);
                  loadSelectedPatientReservations(patient._id);
                  setLastIssuedToken(null);
                  setFrontDeskMessage(`${patient.name || "Patient"} selected for front-desk service.`);
                  setFrontDeskError("");
                }}
              >
                <div>
                  <strong>{patient.name || "Incomplete Patient Profile"}</strong>
                  <small>{patient.patientId}</small>
                </div>
                <span>
                  {patient.phone || patient.email || "No contact"}
                  <small>{patient.email && patient.phone ? patient.email : ""}</small>
                </span>
              </button>
            ))}
            {!isSearchingPatients && patientResults.length === 0 && (
              <p className="muted"><Trans text={"No matching patient found. Register a new walk-in below."} /></p>
            )}
          </div>

          <div className="reception-divider" />

          <p className="eyebrow"><Trans text={"New Walk-In"} /></p>
          <h2><UserRound size={18} /> <Trans text={"Register Patient"} /></h2>

          <form onSubmit={handleRegisterWalkIn}>
            <div className="patient-profile-grid">
              <label>
                <Trans text={"Full Name"} /><input
                  required
                  value={walkInForm.name}
                  onChange={(event) =>
                    setWalkInForm({ ...walkInForm, name: event.target.value })
                  }
                  placeholder={t("Patient full name")}
                />
              </label>

              <label>
                <Trans text={"Mobile Number"} /><input
                  inputMode="numeric"
                  value={walkInForm.phone}
                  onChange={(event) =>
                    setWalkInForm({
                      ...walkInForm,
                      phone: event.target.value.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  placeholder={t("Leave blank if patient has no phone")}
                />
              </label>

              <label>
                <Trans text={"Email (optional)"} /><input
                  type="email"
                  value={walkInForm.email}
                  onChange={(event) =>
                    setWalkInForm({ ...walkInForm, email: event.target.value })
                  }
                  placeholder={t("patient@example.com")}
                />
              </label>

              <label>
                <Trans text={"Date of Birth"} /><input
                  type="date"
                  value={walkInForm.dateOfBirth}
                  onChange={(event) =>
                    setWalkInForm({ ...walkInForm, dateOfBirth: event.target.value })
                  }
                />
              </label>

              <label>
                <Trans text={"Gender"} /><select
                  value={walkInForm.gender}
                  onChange={(event) =>
                    setWalkInForm({ ...walkInForm, gender: event.target.value })
                  }
                >
                  <option value="">{t("Not specified")}</option>
                  <option value="Male">{t("Male")}</option>
                  <option value="Female">{t("Female")}</option>
                  <option value="Other">{t("Other")}</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              className="primary"
              style={{ marginTop: "12px" }}
              disabled={isRegistering}
            >
              {t(isRegistering ? "Registering..." : "Register Walk-In Patient")}
            </button>
          </form>
        </section>

        <section className="card reception-token-card">
          <p className="eyebrow"><Trans text={"Token Desk"} /></p>
          <h2><Ticket size={18} /> <Trans text={"Issue OPD Queue Token"} /></h2>

          {selectedPatient ? (
            <div className="reception-selected-patient">
              <div>
                <small><Trans text={"SELECTED PATIENT"} /></small>
                <strong>{selectedPatient.name || t("Patient")}</strong>
                <span>{selectedPatient.patientId}</span>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setSelectedPatient(null);
                  setSelectedPatientReservations([]);
                  setLastIssuedToken(null);
                }}
              >
                <Trans text={"Change"} /></button>
            </div>
          ) : (
            <div className="reception-empty-selection">
              <Users size={28} />
              <strong><Trans text={"No patient selected"} /></strong>
              <span><Trans text={"Search an existing patient or register a walk-in first."} /></span>
            </div>
          )}

          {selectedPatientReservations.length > 0 && (
            <div className="queue-reservation-notice reception-reservation-checkin">
              <QrCode size={20} />
              <div style={{ flex: 1 }}>
                <strong><Trans text={"Online Reservation Found"} /></strong>
                {selectedPatientReservations.map((reservation) => (
                  <div key={reservation._id} className="reception-reservation-row">
                    <span>
                      <b>{t(reservation.department)}</b> <Trans text={"· Dr. "} />{reservation.doctorName} · {reservation.urgency === "emergency" ? "🚨 Emergency" : t("Normal")}
                    </span>
                    <button
                      type="button"
                      className="primary"
                      disabled={checkingInReservationId === reservation._id}
                      onClick={() => openReceptionPayment("reservation", reservation)}
                    >
                      {checkingInReservationId === reservation._id ? "Checking In..." : `Collect ${formatInr(reservation.billing?.quotedAmount || 0)} & Check In`}
                    </button>
                  </div>
                ))}
                <small><Trans text={"FCFS token number is generated now, using actual arrival/check-in time."} /></small>
              </div>
            </div>
          )}

          <form onSubmit={handleIssueToken}>
            <label>
              <Trans text={"OPD Department"} /><select
                value={tokenForm.department}
                onChange={(event) =>
                  setTokenForm({
                    ...tokenForm,
                    department: event.target.value,
                    doctorId: "",
                  })
                }
              >
                {CLINICAL_DEPARTMENTS.map((departmentOption) => (
                  <option key={departmentOption.value} value={departmentOption.value}>
                    {t(departmentOption.label)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <Trans text={"Queue Priority"} /><select
                value={tokenForm.urgency}
                onChange={(event) =>
                  setTokenForm({ ...tokenForm, urgency: event.target.value })
                }
              >
                <option value="normal">{t("Normal OPD")}</option>
                <option value="emergency">{t("Emergency Flag")}</option>
              </select>
            </label>

            <label>
              <Trans text={"Assign Patient to Doctor"} /><select
                value={tokenForm.doctorId}
                onChange={(event) =>
                  setTokenForm({ ...tokenForm, doctorId: event.target.value })
                }
              >
                <option value="">{t("Select ")}{t(tokenForm.department)} {t("specialist")}</option>
                {doctorsForSelectedDepartment.map((doctor) => (
                  <option key={doctor._id} value={doctor._id}>
                    {t("Dr. ")}{doctor.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="reception-doctor-availability">
              {doctorsForSelectedDepartment.length ? (
                <span>
                  {doctorsForSelectedDepartment.length} <Trans text={"specialist"} />{doctorsForSelectedDepartment.length > 1 ? "s" : ""} <Trans text={"available. Reception must choose exactly one."} /></span>
              ) : (
                <span className="danger-text"><Trans text={"No registered doctor in this department."} /></span>
              )}
            </div>

            <button
              type="submit"
              className="primary wide"
              disabled={
                !selectedPatient ||
                !tokenForm.doctorId ||
                isIssuingToken ||
                selectedPatientReservations.length > 0 ||
                doctorsForSelectedDepartment.length === 0
              }
            >
              {t(isIssuingToken ? "Preparing..." : "Collect Fee & Issue Walk-In Token")}
            </button>
          </form>

          {lastIssuedToken && (
            <div className="reception-token-slip">
              <span><Trans text={"TOKEN ISSUED"} /></span>
              <strong>#{lastIssuedToken.tokenNumber}</strong>
              <b>{t(lastIssuedToken.department)}</b>
              <small>
                <Trans text={"Dr. "} />{doctors.find((doctor) => String(doctor._id) === String(lastIssuedToken.assignedDoctor))?.name || "Assigned specialist"}
              </small>
              <small>
                {lastIssuedToken.patientName} ·{" "}
                {lastIssuedToken.urgency === "emergency" ? "🚨 Emergency" : t("Normal OPD")}
              </small>
              <small className="token-payment-line"><b>{formatInr(lastIssuedToken.billing?.paidAmount || 0)}</b> · {String(lastIssuedToken.billing?.method || "waived").toUpperCase()} · {lastIssuedToken.billing?.receiptNumber || "Receipt generated"}</small>
              <button type="button" className="ghost" onClick={printLastToken}>
                <FileText size={15} /> <Trans text={"Print Token Slip"} /></button>
            </div>
          )}
        </section>
      </div>
      )}


      {receptionSection === "operations" && (
        <>
      <details className="card reception-prescription-desk">
        <summary className="reception-prescription-summary">
          <div>
            <p className="eyebrow"><Trans text={"Prescription Handover"} /></p>
            <h2><Printer size={18} /> <Trans text={"Reception Prescription Print Desk"} /></h2>
            <small><Trans text={"Completed prescriptions ready for clinic-branded physical printing"} /></small>
          </div>
          <span className="feedback-dropdown-arrow">⌄</span>
        </summary>
        <div className="reception-prescription-content">
          <div className="reception-prescription-toolbar">
            <span>{receptionPrescriptions.filter((item) => !item.printDesk?.printedAt).length} <Trans text={"unprinted"} /></span>
            <button type="button" className="ghost compact" onClick={loadPrescriptionDesk}><RefreshCw size={14} className={prescriptionDeskLoading ? "spin" : ""} /> <Trans text={"Refresh"} /></button>
          </div>
          {pendingPrintConfirmation && <div className="print-confirmation-panel"><div><CheckCircle size={18}/><span><b><Trans text={"Was the prescription printed successfully?"} /></b><small>{pendingPrintConfirmation.patient?.name || pendingPrintConfirmation.token?.patientName || t("Patient")} <Trans text={"· confirm only after the printer completes."} /></small></span></div><div><button type="button" className="primary compact" onClick={confirmPrescriptionPrinted}><Trans text={"Yes, Mark Printed"} /></button><button type="button" className="ghost compact" onClick={()=>setPendingPrintConfirmation(null)}><Trans text={"No / Print Failed"} /></button></div></div>}
          {prescriptionDeskLoading && !receptionPrescriptions.length ? <p className="muted"><Trans text={"Loading completed prescriptions..."} /></p> : (
            <div className="reception-prescription-list">
              {receptionPrescriptions.map((consultation) => (
                <article key={consultation._id} className={`reception-prescription-row ${consultation.printDesk?.printedAt ? "printed" : ""}`}>
                  <div>
                    <b>{consultation.patient?.name || consultation.token?.patientName || t("Patient")}</b>
                    <small>{consultation.patient?.patientId || consultation.token?.patientId || t("Patient")} · {t(consultation.department)} <Trans text={"· Dr. "} />{consultation.doctor?.name || "Medical Officer"}</small>
                  </div>
                  <div className="reception-prescription-meta">
                    <span>{new Date(consultation.createdAt).toLocaleString("en-IN")}</span>
                    <em>{t(consultation.printDesk?.printedAt ? "Printed" : "Ready to print")}</em>
                  </div>
                  <button type="button" className={consultation.printDesk?.printedAt ? "ghost compact" : "primary compact"} onClick={() => printFromReceptionDesk(consultation)}>
                    <Printer size={14} /> {t(consultation.printDesk?.printedAt ? "Print Again" : "Print")}
                  </button>
                </article>
              ))}
              {!receptionPrescriptions.length && <p className="muted"><Trans text={"No completed prescriptions are waiting at the print desk."} /></p>}
            </div>
          )}
        </div>
      </details>

      <section className="card reception-appointment-card">
        <div className="reception-section-head">
          <div>
            <p className="eyebrow"><Trans text={"Scheduled Visits"} /></p>
            <h2><Calendar size={18}/> <Trans text={"Book / Check In Appointment"} /></h2>
          </div>
          <Link to="/reception/scan" className="primary reception-qr-launch">
            <QrCode size={16} /> <Trans text={"Open QR Scanner"} /></Link>
        </div>
        <p className="muted"><Trans text={"Select a registry patient, then book against the doctor's actual working schedule. Today's booked patients can be checked in and converted to a live queue token."} /></p>
        <form className="appointment-form" onSubmit={bookReceptionAppointment}>
          <label><Trans text={"Department"} /><select value={receptionAppointment.department} onChange={async e=>{const department=e.target.value;setReceptionAppointment({department,doctorId:"",appointmentDate:"",startTime:"",reason:""});setReceptionAppointmentDates([]);setReceptionAppointmentSlots([]);await loadReceptionAppointmentDoctors(department);}}>{CLINICAL_DEPARTMENTS.map(d=><option key={d.value} value={d.value}>{t(d.label)}</option>)}</select></label>
          <label><Trans text={"Doctor"} /><select value={receptionAppointment.doctorId} onChange={async e=>{const doctorId=e.target.value;setReceptionAppointment(prev=>({...prev,doctorId,appointmentDate:"",startTime:""}));await loadReceptionDates(doctorId);}}><option value="">{t("Select doctor")}</option>{receptionAppointmentDoctors.map(d=><option key={d._id} value={d._id}>{t("Dr. ")}{d.name}</option>)}</select></label>
          <label><Trans text={"Available Date"} /><select disabled={!receptionAppointment.doctorId} value={receptionAppointment.appointmentDate} onChange={async e=>{const appointmentDate=e.target.value;setReceptionAppointment(prev=>({...prev,appointmentDate,startTime:""}));await loadReceptionSlots(receptionAppointment.doctorId,appointmentDate);}}><option value="">{t("Select date")}</option>{receptionAppointmentDates.map(d=><option key={d.date} value={d.date}>{d.weekday} · {d.date}</option>)}</select></label>
          <label><Trans text={"Time Slot"} /><select disabled={!receptionAppointment.appointmentDate} value={receptionAppointment.startTime} onChange={e=>setReceptionAppointment(prev=>({...prev,startTime:e.target.value}))}><option value="">{t("Select slot")}</option>{receptionAppointmentSlots.map(s=><option key={s.startTime} value={s.startTime}>{t(s.label)}</option>)}</select></label>
          <label className="appointment-reason"><Trans text={"Reason / call note"} /><input value={receptionAppointment.reason} onChange={e=>setReceptionAppointment(prev=>({...prev,reason:e.target.value}))} placeholder={t("Optional reason")}/></label>
          <button className="primary" disabled={isBookingReceptionAppointment||(!receptionRescheduleTarget&&!selectedPatient)||!receptionAppointment.startTime}><Calendar size={16}/>{t(isBookingReceptionAppointment?(receptionRescheduleTarget?"Rescheduling...":"Booking..."):(receptionRescheduleTarget?"Confirm Reschedule":"Book for Selected Patient"))}</button>
        </form>
        <div className="appointment-list">
          <h3><Trans text={"Today's Scheduled Appointments"} /></h3>
          {todayAppointments.map(a=><div className="appointment-row" key={a._id}><div><strong>{a.startTime} · {a.patientName}</strong><small>{t(a.department)} <Trans text={"· Dr. "} />{a.doctorName}</small>{a.cancellationReason&&<small><Trans text={"Reason: "} />{a.cancellationReason}</small>}</div><span className={`appointment-status ${a.status}`}>{a.status.replace("_"," ")}</span>{a.status==="booked"&&<button type="button" className="small" onClick={()=>openReceptionPayment("appointment", a)}><Trans text={"Collect "} />{formatInr(a.billing?.quotedAmount || 0)} <Trans text={"& Check In"} /></button>}{["booked","missed"].includes(a.status)&&<button type="button" className="small" onClick={()=>prepareReceptionReschedule(a)}><Trans text={"Reschedule"} /></button>}{a.status==="booked"&&<button type="button" className="small appointment-cancel-button" onClick={()=>cancelReceptionAppointment(a)}><Trans text={"Cancel"} /></button>}{a.status==="booked"&&<button type="button" className="small" onClick={()=>markReceptionAppointmentMissed(a)}><Trans text={"Mark Missed"} /></button>}</div>)}
          {!todayAppointments.length&&<p className="muted"><Trans text={"No appointments scheduled for today."} /></p>}
        </div>
      </section>

      <section className="card reception-live-queue-card">
        <div className="reception-queue-header">
          <div>
            <p className="eyebrow"><Trans text={"Live Operations"} /></p>
            <h2><Activity size={18} /> <Trans text={"Today's Front-Desk Queue"} /></h2>
          </div>

          <select
            value={queueDepartmentFilter}
            onChange={(event) => setQueueDepartmentFilter(event.target.value)}
          >
            <option value="All Departments">{t("All Departments")}</option>
            {CLINICAL_DEPARTMENTS.map((departmentOption) => (
              <option key={departmentOption.value} value={departmentOption.value}>
                {departmentOption.value}
              </option>
            ))}
          </select>
        </div>

        <div className="reception-queue-table-wrap">
          <table className="reception-queue-table">
            <thead>
              <tr>
                <th><Trans text={"Token"} /></th>
                <th><Trans text={"Patient"} /></th>
                <th><Trans text={"Department"} /></th>
                <th><Trans text={"Assigned Doctor"} /></th>
                <th><Trans text={"Priority"} /></th>
                <th><Trans text={"Queue Status"} /></th>
                <th><Trans text={"Arrival"} /></th>
                <th><Trans text={"Front-Desk Action"} /></th>
              </tr>
            </thead>
            <tbody>
              {filteredQueue
                .slice()
                .sort((a, b) => {
                  if (a.department !== b.department) {
                    return String(a.department).localeCompare(String(b.department));
                  }
                  return Number(a.tokenNumber) - Number(b.tokenNumber);
                })
                .map((tokenItem) => {
                  const arrival = tokenItem.arrivalStatus || "not_checked_in";
                  return (
                    <tr
                      key={tokenItem._id}
                      className={tokenItem.urgency === "emergency" ? "reception-emergency-row" : ""}
                    >
                      <td><strong>#{tokenItem.tokenNumber}</strong></td>
                      <td>
                        <b>{tokenItem.patientName}</b>
                        <small>{tokenItem.phone || tokenItem.patientId || t("Walk-in")}</small>
                      </td>
                      <td>{t(tokenItem.department)}</td>
                      <td>
                        <span>
                          <Trans text={"Dr. "} />{doctors.find(
                            (doctor) =>
                              String(doctor._id) ===
                              String(tokenItem.assignedDoctor?._id || tokenItem.assignedDoctor || "")
                          )?.name || "Assigned specialist"}
                        </span>
                      </td>
                      <td>
                        <span className={tokenItem.urgency === "emergency" ? "doctor-emergency-pill" : "doctor-normal-pill"}>
                          {tokenItem.urgency === "emergency" ? t("🚨 EMERGENCY") : "NORMAL"}
                        </span>
                      </td>
                      <td>{tokenItem.queueControl?.isOnHold ? "On Hold" : t(formatQueueStatus(tokenItem.status))}</td>
                      <td>
                        <span className={`arrival-chip ${arrival}`}>
                          {arrival === "arrived"
                            ? "Arrived"
                            : arrival === "no_show"
                              ? t("No-show")
                              : "Not checked in"}
                        </span>
                      </td>
                      <td>
                        <div className="reception-row-actions">
                          {tokenItem.status === "waiting" && !tokenItem.queueControl?.isOnHold && arrival !== "arrived" && (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => updateArrivalStatus(tokenItem._id, "arrived")}
                            >
                              <Trans text={"Mark Arrived"} /></button>
                          )}
                          {tokenItem.status === "waiting" && !tokenItem.queueControl?.isOnHold && arrival !== "no_show" && (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => updateArrivalStatus(tokenItem._id, "no_show")}
                            >
                              <Trans text={"No-show"} /></button>
                          )}
                          {tokenItem.status === "skipped" && arrival === "no_show" && (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => updateArrivalStatus(tokenItem._id, "arrived")}
                            >
                              <Trans text={"Restore to Queue"} /></button>
                          )}
                          {(tokenItem.status === "called" || tokenItem.status === "completed") && (
                            <span className="muted"><Trans text={"Doctor controlled"} /></span>
                          )}
                          {tokenItem.status !== "completed" && (
                            <ReceptionQueueIntervention tokenItem={tokenItem} doctors={doctors} onApply={applyQueueIntervention} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {!filteredQueue.length && (
            <p className="muted reception-empty-queue"><Trans text={"No active queue records found."} /></p>
          )}
        </div>
      </section>
        </>
      )}
    </main>
  );
}

/* =========================================================
   HOSPITAL ADMIN CONTROL CENTER
========================================================= */

function AdminDashboardPage() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  const [hospitalStats, setHospitalStats] = useState(null);
  const [adminSection, setAdminSection] = useState("overview");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsRange, setAnalyticsRange] = useState(7);
  const [analyticsDepartment, setAnalyticsDepartment] = useState("");
  const [analyticsDoctorId, setAnalyticsDoctorId] = useState("");
  const [analyticsCustomMode, setAnalyticsCustomMode] = useState(false);
  const [analyticsCustomStart, setAnalyticsCustomStart] = useState("");
  const [analyticsCustomEnd, setAnalyticsCustomEnd] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [revenue, setRevenue] = useState(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueRange, setRevenueRange] = useState({ from: new Date().toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) });
  const [hoveredTrendDay, setHoveredTrendDay] = useState(null);
  const [staffAccountsList, setStaffAccountsList] = useState([]);
  const [doctorScheduleDrafts, setDoctorScheduleDrafts] = useState({});
  const [doctorBillingDrafts, setDoctorBillingDrafts] = useState({});
  const [savingDoctorBilling, setSavingDoctorBilling] = useState("");
  const [savingDoctorSchedule, setSavingDoctorSchedule] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [feedbackDoctorId, setFeedbackDoctorId] = useState("");
  const [adminDoctorFeedback, setAdminDoctorFeedback] = useState(null);
  const [adminFeedbackLoading, setAdminFeedbackLoading] = useState(false);
  const [adminFeedbackError, setAdminFeedbackError] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditModules, setAuditModules] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditRetentionDays, setAuditRetentionDays] = useState(90);
  const [auditFilters, setAuditFilters] = useState({ role: "", module: "" });
  const [commandActivity, setCommandActivity] = useState([]);
  const [systemHealth, setSystemHealth] = useState({ loading: true, ok: false, database: "checking" });

  const [newStaffForm, setNewStaffForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "doctor",
    department: "General OPD",
  });

  const fetchAnalytics = async (range = analyticsRange, overrides = {}) => {
    setAnalyticsLoading(true);
    try {
      const params = new URLSearchParams();
      const department = overrides.department ?? analyticsDepartment;
      const doctorId = overrides.doctorId ?? analyticsDoctorId;
      const customMode = overrides.customMode ?? analyticsCustomMode;
      const customStart = overrides.customStart ?? analyticsCustomStart;
      const customEnd = overrides.customEnd ?? analyticsCustomEnd;

      if (customMode && customStart && customEnd) {
        params.set("startDate", customStart);
        params.set("endDate", customEnd);
      } else {
        params.set("range", String(range));
      }
      if (department) params.set("department", department);
      if (doctorId) params.set("doctorId", doctorId);

      const { data } = await api.get(`/admin/analytics?${params.toString()}`);
      setAnalytics(data);
    } catch (error) {
      setAnalytics(null);
      if (error.response?.data?.message) alert(localizeUi(error.response.data.message));
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const fetchRevenue = async (range = revenueRange) => {
    setRevenueLoading(true);
    try { const { data } = await api.get("/admin/revenue", { params: range }); setRevenue(data); }
    catch { setRevenue(null); }
    finally { setRevenueLoading(false); }
  };

  const refundPayment = async (row) => {
    const reason = window.prompt(localizeUi(`Refund reason for receipt ${row.billing?.receiptNumber || ""}?`), "Payment reversed by clinic");
    if (!reason?.trim()) return;
    try { await api.patch(`/admin/payments/${row._id}/refund`, { reason: reason.trim() }); await fetchRevenue(); }
    catch (error) { alert(localizeUi(error.response?.data?.message || "Unable to mark refund.")); }
  };

  const exportRevenueCsv = async () => {
    try {
      const response = await api.get("/admin/export", { params: { type: "payments", fromDate: revenueRange.from, toDate: revenueRange.to }, responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = `payments-${revenueRange.from}-to-${revenueRange.to}.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { alert(localizeUi(error.response?.data?.message || "Unable to export payment CSV.")); }
  };

  const fetchCommandActivity = async () => {
    try {
      const { data } = await api.get("/admin/activity-logs?limit=10");
      setCommandActivity(data.logs || []);
    } catch {
      setCommandActivity([]);
    }
  };

  const fetchSystemHealth = async () => {
    try {
      const apiBase = String(api.defaults.baseURL || "http://localhost:5000/api").replace(/\/api\/?$/, "");
      const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
      const data = await response.json();
      setSystemHealth({ loading: false, ...data, ok: Boolean(response.ok && data?.ok) });
    } catch {
      setSystemHealth({ loading: false, ok: false, database: "unreachable" });
    }
  };

  const loadAuditLogs = async (filters = auditFilters) => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (filters.role) params.set("role", filters.role);
      if (filters.module) params.set("module", filters.module);
      const { data } = await api.get(`/admin/activity-logs?${params.toString()}`);
      setAuditLogs(data.logs || []);
      setAuditModules(data.modules || []);
      setAuditRetentionDays(data.retentionDays || 90);
      setAuditLoaded(true);
    } catch (error) {
      setAuditError(error.response?.data?.message || "Unable to load activity logs.");
    } finally {
      setAuditLoading(false);
    }
  };

  const fetchAdminData = () => {
    api
      .get("/tokens/stats")
      .then((response) => setHospitalStats(response.data))
      .catch(() => {});

    api
      .get("/admin/users")
      .then((response) => {
        const users = response.data || [];
        setStaffAccountsList(users);

        setDoctorScheduleDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };

          users
            .filter((staffItem) => staffItem.role === "doctor")
            .forEach((doctor) => {
              if (!nextDrafts[doctor._id]) {
                nextDrafts[doctor._id] = normalizeDoctorSchedule(
                  doctor.doctorSchedule
                );
              }
            });

          return nextDrafts;
        });
        setDoctorBillingDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };
          users.filter((staffItem) => staffItem.role === "doctor").forEach((doctor) => {
            if (!nextDrafts[doctor._id]) nextDrafts[doctor._id] = normalizeDoctorBillingProfile(doctor.billingProfile);
          });
          return nextDrafts;
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchAdminData();
    fetchCommandActivity();
    fetchRevenue();
    fetchSystemHealth();
    const healthTimer = window.setInterval(fetchSystemHealth, 30000);
    return () => window.clearInterval(healthTimer);
  }, []);

  useEffect(() => {
    if (analyticsCustomMode && (!analyticsCustomStart || !analyticsCustomEnd)) return;
    fetchAnalytics(analyticsRange);
  }, [analyticsRange, analyticsDepartment, analyticsDoctorId, analyticsCustomMode]);

  const handleCreateStaffAccount = async (event) => {
    event.preventDefault();

    try {
      await api.post("/admin/users", newStaffForm);
      setNewStaffForm({
        name: "",
        email: "",
        password: "",
        role: "doctor",
        department: "General OPD",
      });
      fetchAdminData();
    } catch (error) {
      alert(
        localizeUi(error.response?.data?.message ||
          "Could not provision staff account.")
      );
    }
  };

  const updateDoctorBillingDraft = (doctorId, field, value) => {
    setDoctorBillingDrafts((current) => ({ ...current, [doctorId]: { ...normalizeDoctorBillingProfile(current[doctorId]), [field]: value } }));
  };

  const saveDoctorBilling = async (doctor) => {
    const draft = normalizeDoctorBillingProfile(doctorBillingDrafts[doctor._id] || doctor.billingProfile);
    setSavingDoctorBilling(doctor._id); setScheduleMessage("");
    try {
      const payload = { ...draft };
      ["consultationFee","followUpFee","walkInFee","reservationFee","appointmentFee","emergencyFee"].forEach((field)=>{ payload[field] = draft[field] === "" ? null : Number(draft[field]); });
      payload.freeFollowUpDays = Number(draft.freeFollowUpDays || 0);
      const { data } = await api.patch(`/admin/users/${doctor._id}/billing-profile`, payload);
      setDoctorBillingDrafts((current)=>({...current,[doctor._id]:normalizeDoctorBillingProfile(data?.doctor?.billingProfile || payload)}));
      setStaffAccountsList((current)=>current.map((item)=>String(item._id)===String(doctor._id)?{...item,billingProfile:data?.doctor?.billingProfile || payload}:item));
      setScheduleMessage(data?.message || `Fee profile saved for Dr. ${doctor.name}.`);
    } catch (error) { alert(localizeUi(error.response?.data?.message || "Unable to save doctor fees.")); }
    finally { setSavingDoctorBilling(""); }
  };

  const handleResetQueue = async () => {
    if (
      confirm(
        localizeUi("Are you sure you want to reset and archive today's queue data?")
      )
    ) {
      await api.post("/tokens/reset");
      fetchAdminData();
    }
  };

  const handleDeleteStaffAccount = async (staffItem) => {
    if (!["doctor", "receptionist"].includes(staffItem.role)) return;

    const description =
      staffItem.role === "doctor"
        ? `Dr. ${staffItem.name} (${staffItem.department})`
        : `${staffItem.name} (Receptionist)`;

    const confirmed = confirm(
      localizeUi(`Delete ${description}? This removes the staff login account. Patient history will remain preserved.`)
    );

    if (!confirmed) return;

    try {
      await api.delete(`/admin/users/${staffItem._id}`);

      setDoctorScheduleDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[staffItem._id];
        return nextDrafts;
      });

      fetchAdminData();
    } catch (error) {
      alert(
        localizeUi(error.response?.data?.message ||
          "Unable to delete staff account.")
      );
    }
  };

  const updateScheduleDraft = (doctorId, field, value) => {
    setDoctorScheduleDrafts((currentDrafts) => ({
      ...currentDrafts,
      [doctorId]: {
        ...normalizeDoctorSchedule(currentDrafts[doctorId]),
        [field]: value,
      },
    }));
  };

  const toggleWorkingDay = (doctorId, day) => {
    setDoctorScheduleDrafts((currentDrafts) => {
      const current = normalizeDoctorSchedule(currentDrafts[doctorId]);
      const workingDays = current.workingDays.includes(day)
        ? current.workingDays.filter((workingDay) => workingDay !== day)
        : WEEK_DAYS.filter(
            (weekDay) =>
              current.workingDays.includes(weekDay) || weekDay === day
          );

      return {
        ...currentDrafts,
        [doctorId]: {
          ...current,
          workingDays,
        },
      };
    });
  };

  const addUnavailableDate = (doctorId) => {
    setDoctorScheduleDrafts((currentDrafts) => {
      const current = normalizeDoctorSchedule(currentDrafts[doctorId]);
      const date = current.newUnavailableDate;

      if (!date || current.unavailableDates.includes(date)) {
        return currentDrafts;
      }

      return {
        ...currentDrafts,
        [doctorId]: {
          ...current,
          unavailableDates: [...current.unavailableDates, date].sort(),
          newUnavailableDate: "",
        },
      };
    });
  };

  const removeUnavailableDate = (doctorId, dateToRemove) => {
    setDoctorScheduleDrafts((currentDrafts) => {
      const current = normalizeDoctorSchedule(currentDrafts[doctorId]);

      return {
        ...currentDrafts,
        [doctorId]: {
          ...current,
          unavailableDates: current.unavailableDates.filter(
            (date) => date !== dateToRemove
          ),
        },
      };
    });
  };

  const saveDoctorSchedule = async (doctor) => {
    const schedule = normalizeDoctorSchedule(
      doctorScheduleDrafts[doctor._id] || doctor.doctorSchedule
    );

    if (!schedule.workingDays.length) {
      alert(localizeUi("Select at least one working day."));
      return;
    }

    setSavingDoctorSchedule(doctor._id);
    setScheduleMessage("");

    try {
      const { data } = await api.patch(
        `/admin/users/${doctor._id}/schedule`,
        {
          workingDays: schedule.workingDays,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          isOnBreak: schedule.isOnBreak,
          roomNumber: schedule.roomNumber,
          unavailableDates: schedule.unavailableDates,
        }
      );

      const savedSchedule = normalizeDoctorSchedule(
        data.doctor?.doctorSchedule
      );

      setDoctorScheduleDrafts((currentDrafts) => ({
        ...currentDrafts,
        [doctor._id]: savedSchedule,
      }));

      setStaffAccountsList((currentStaff) =>
        currentStaff.map((staffItem) =>
          staffItem._id === doctor._id
            ? {
                ...staffItem,
                doctorSchedule: data.doctor?.doctorSchedule,
              }
            : staffItem
        )
      );

      setScheduleMessage(
        data.message || `Schedule updated for Dr. ${doctor.name}.`
      );
    } catch (error) {
      alert(
        localizeUi(error.response?.data?.message ||
          "Unable to save doctor schedule.")
      );
    } finally {
      setSavingDoctorSchedule("");
    }
  };

  const loadAdminDoctorFeedback = async () => {
    if (!feedbackDoctorId) {
      setAdminFeedbackError("Select a doctor first.");
      setAdminDoctorFeedback(null);
      return;
    }

    setAdminFeedbackLoading(true);
    setAdminFeedbackError("");
    try {
      const { data } = await api.get(`/feedback/admin/doctor/${feedbackDoctorId}`);
      setAdminDoctorFeedback(data);
    } catch (error) {
      setAdminDoctorFeedback(null);
      setAdminFeedbackError(error.response?.data?.message || "Unable to load doctor feedback.");
    } finally {
      setAdminFeedbackLoading(false);
    }
  };

  useEffect(() => {
    const handleOperationsUpdate = (update) => {
      const queueChanged = hasOperationalDomain(update, "queue");
      const appointmentChanged = hasOperationalDomain(update, "appointments");
      const staffChanged = hasOperationalDomain(update, "staff");
      const feedbackChanged = hasOperationalDomain(update, "feedback");

      if (queueChanged || staffChanged) {
        fetchAdminData();
      }

      if (queueChanged || appointmentChanged || staffChanged || feedbackChanged) {
        fetchAnalytics(analyticsRange);
        fetchCommandActivity();
      }

      if (feedbackChanged && feedbackDoctorId) {
        loadAdminDoctorFeedback();
      }
    };

    const handleReconnect = () => {
      fetchAdminData();
      fetchAnalytics(analyticsRange);
      fetchCommandActivity();
      fetchSystemHealth();
      if (feedbackDoctorId) {
        loadAdminDoctorFeedback();
      }
    };

    socket.on("operations:updated", handleOperationsUpdate);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("operations:updated", handleOperationsUpdate);
      socket.off("connect", handleReconnect);
    };
  }, [analyticsRange, analyticsDepartment, analyticsDoctorId, analyticsCustomMode, analyticsCustomStart, analyticsCustomEnd, feedbackDoctorId]);

  const doctors = staffAccountsList.filter(
    (staffItem) => staffItem.role === "doctor"
  );
  const analyticsDoctors = analyticsDepartment
    ? doctors.filter((doctor) => doctor.department === analyticsDepartment)
    : doctors;
  const analyticsScopeLabel = analytics?.filters?.scopeLabel || "Whole Clinic";
  const analyticsPeriodLabel = analytics
    ? `${analytics.period?.startDate || ""} → ${analytics.period?.endDate || ""}`
    : "";

  const selectAnalyticsPreset = (days) => {
    setAnalyticsCustomMode(false);
    setAnalyticsRange(days);
  };

  const applyCustomAnalyticsRange = () => {
    if (!analyticsCustomStart || !analyticsCustomEnd) {
      alert(localizeUi("Choose both custom start and end dates."));
      return;
    }
    setAnalyticsCustomMode(true);
    fetchAnalytics(analyticsRange, {
      customMode: true,
      customStart: analyticsCustomStart,
      customEnd: analyticsCustomEnd,
    });
  };

  const resetAnalyticsScope = () => {
    setAnalyticsDepartment("");
    setAnalyticsDoctorId("");
    setAnalyticsCustomMode(false);
    setAnalyticsCustomStart("");
    setAnalyticsCustomEnd("");
    setAnalyticsRange(7);
  };

  const commandAlerts = analytics ? [
    analytics.overview.emergencyWaiting > 0 && { level: "critical", text: `${analytics.overview.emergencyWaiting} emergency patient${analytics.overview.emergencyWaiting > 1 ? "s" : ""} currently waiting` },
    analytics.overview.slaBreachCount > 0 && { level: "warning", text: `${analytics.overview.slaBreachCount} waiting token${analytics.overview.slaBreachCount > 1 ? "s" : ""} crossed the 30-minute SLA` },
    analytics.overview.overloadedDoctors > 0 && { level: "warning", text: `${analytics.overview.overloadedDoctors} doctor queue${analytics.overview.overloadedDoctors > 1 ? "s are" : " is"} under high load` },
    analytics.overview.noShowRate >= 10 && { level: "notice", text: `No-show rate is ${analytics.overview.noShowRate}% for this period` },
    analytics.overview.completionRate < 60 && { level: "notice", text: `Completion rate is ${analytics.overview.completionRate}% — review queue pressure` },
  ].filter(Boolean) : [];

  const queuePressureLabel = (row) => {
    if ((row.waiting || 0) >= 8 || (row.averageWaitMinutes || 0) >= 35) return "High";
    if ((row.waiting || 0) >= 4 || (row.averageWaitMinutes || 0) >= 20) return "Moderate";
    return "Normal";
  };

  const maxHourlyPatients = Math.max(1, ...(analytics?.hourlyTrend || []).map((item) => item.patients || 0));

  return (
    <main className="page premium-page">
      <div className="head">
        <div>
          <p className="eyebrow"><Trans text={"Hospital Operations"} /></p>
          <h1><Trans text={"Admin Control Center"} /></h1>
          <p className="page-subtitle">
            <Trans text={"Manage hospital departments, physician availability, staff access, and daily OPD operations."} /></p>
        </div>

        <button
          type="button"
          className="ghost"
          onClick={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        >
          <LogOut size={15} /> <Trans text={"Staff Logout"} /></button>
      </div>

      <nav className="admin-section-tabs" aria-label={t("Admin workspace sections")}>
        <button
          type="button"
          className={adminSection === "overview" ? "active" : ""}
          onClick={() => setAdminSection("overview")}
        >
          <Activity size={16} /> <Trans text={"Overview"} /><small><Trans text={"Live command center"} /></small>
        </button>
        <button
          type="button"
          className={adminSection === "analytics" ? "active" : ""}
          onClick={() => setAdminSection("analytics")}
        >
          <BarChart3 size={16} /> <Trans text={"Analytics"} /><small><Trans text={"Department & doctor drill-down"} /></small>
        </button>
        <button
          type="button"
          className={adminSection === "revenue" ? "active" : ""}
          onClick={() => { setAdminSection("revenue"); fetchRevenue(); }}
        >
          <IndianRupee size={16} /> <Trans text={"Revenue"} /><small><Trans text={"Collections & receipts"} /></small>
        </button>
        <button
          type="button"
          className={adminSection === "operations" ? "active" : ""}
          onClick={() => setAdminSection("operations")}
        >
          <ShieldCheck size={16} /> <Trans text={"Operations"} /><small><Trans text={"Staff, schedules & audit"} /></small>
        </button>
      </nav>

      {adminSection === "overview" && (
        <>
      <section className="metricgrid">
        <div className="metric">
          <Users />
          <b>{hospitalStats?.total ?? 0}</b>
          <span><Trans text={"Today's Arrivals"} /></span>
        </div>
        <div className="metric">
          <Clock3 />
          <b>{hospitalStats?.waiting ?? 0}</b>
          <span><Trans text={"Waiting"} /></span>
        </div>
        <div className="metric">
          <CheckCircle />
          <b>{hospitalStats?.completed ?? 0}</b>
          <span><Trans text={"Completed Today"} /></span>
        </div>
        <div className="metric">
          <BarChart3 />
          <b>{hospitalStats?.averageMinutes ?? 7} <Trans text={"min"} /></b>
          <span><Trans text={"Service Pace"} /></span>
        </div>
      </section>

        </>
      )}

      {adminSection === "analytics" && (
        <>
      <section className="analytics-scope-toolbar" aria-label={t("Analytics scope and date filters")}>
        <div className="analytics-scope-heading">
          <div>
            <p className="eyebrow"><Trans text={"Analytics Drill-down"} /></p>
            <h2><Trans text={"Explore clinic, department & doctor performance"} /></h2>
            <p><Trans text={"Filter the existing command center without losing the overall clinic view. Historical analytics supports up to one year."} /></p>
          </div>
          <div className="analytics-current-scope">
            <span><Trans text={"Current scope"} /></span>
            <b>{analyticsScopeLabel}</b>
            <small>{analyticsPeriodLabel}</small>
          </div>
        </div>

        <div className="analytics-scope-controls">
          <label>
            <Trans text={"Department"} /><select
              value={analyticsDepartment}
              onChange={(event) => {
                setAnalyticsDepartment(event.target.value);
                setAnalyticsDoctorId("");
              }}
            >
              <option value="">{t("Whole Clinic")}</option>
              {CLINICAL_DEPARTMENTS.map((departmentOption) => (
                <option key={departmentOption.value} value={departmentOption.value}>
                  {t(departmentOption.label)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <Trans text={"Doctor"} /><select
              value={analyticsDoctorId}
              onChange={(event) => setAnalyticsDoctorId(event.target.value)}
            >
              <option value="">{t("All doctors in scope")}</option>
              {analyticsDoctors.map((doctor) => (
                <option key={doctor._id} value={doctor._id}>
                  {t("Dr. ")}{doctor.name} · {t(doctor.department)}
                </option>
              ))}
            </select>
          </label>

          <div className="analytics-preset-group" aria-label={t("Analytics date presets")}>
            {[1, 7, 30, 90, 180, 365].map((days) => (
              <button
                key={days}
                type="button"
                className={!analyticsCustomMode && analyticsRange === days ? "active" : ""}
                onClick={() => selectAnalyticsPreset(days)}
              >
                {days === 1 ? "Today" : days === 365 ? "1 Year" : days === 180 ? "6 Months" : `${days} Days`}
              </button>
            ))}
          </div>
        </div>

        <div className="analytics-custom-range">
          <span><Trans text={"Custom range"} /></span>
          <input type="date" value={analyticsCustomStart} onChange={(event) => setAnalyticsCustomStart(event.target.value)} />
          <span><Trans text={"to"} /></span>
          <input type="date" value={analyticsCustomEnd} onChange={(event) => setAnalyticsCustomEnd(event.target.value)} />
          <button type="button" className="primary" onClick={applyCustomAnalyticsRange}><Trans text={"Apply Custom"} /></button>
          <button type="button" className="ghost" onClick={resetAnalyticsScope}><Trans text={"Reset"} /></button>
        </div>
      </section>
        </>
      )}

      {adminSection === "overview" && analytics && (
        <section className="admin-command-center" aria-label={t("Hospital command center")}>
          <div className="command-center-hero">
            <div>
              <p className="eyebrow"><Trans text={"Live Hospital Command Center"} /></p>
              <h2><Trans text={"Operations at a glance"} /></h2>
              <p><Trans text={"Queue pressure, doctor capacity, patient experience, safety alerts, and service health for "} /><b>{analyticsScopeLabel}</b> · {analyticsPeriodLabel}.</p>
            </div>
            <div className="command-center-health">
              <span className={`command-health-dot ${systemHealth.ok ? "healthy" : "down"}`} />
              <div><b>{t(systemHealth.loading ? "Checking services" : systemHealth.ok ? "Systems operational" : "Attention required")}</b><small><Trans text={"API "} />{t(systemHealth.ok ? "online" : "unreachable")} <Trans text={"· Database "} />{t(systemHealth.database || "checking")} <Trans text={"· Realtime "} />{t(socket.connected ? "connected" : "reconnecting")}</small></div>
              <button type="button" className="ghost small" onClick={fetchSystemHealth}><RefreshCw size={14} /> <Trans text={"Check"} /></button>
            </div>
          </div>

          <div className="command-quick-actions">
            <button type="button" onClick={() => setAdminSection("operations")}><UserRound size={16} /><span><Trans text={"Add Staff"} /></span></button>
            <button type="button" onClick={() => navigate("/admin/displays")}><Monitor size={16} /><span><Trans text={"TV Displays"} /></span></button>
            <button type="button" onClick={() => navigate("/admin/settings")}><Palette size={16} /><span><Trans text={"Clinic Settings"} /></span></button>
            <button type="button" onClick={() => navigate("/admin/privacy")}><ShieldCheck size={16} /><span><Trans text={"Privacy Reviews"} /></span></button>
            <button type="button" onClick={() => setAdminSection("operations")}><Activity size={16} /><span><Trans text={"Activity Logs"} /></span></button>
            <button type="button" onClick={() => setAdminSection("analytics")}><BarChart3 size={16} /><span><Trans text={"Deep Analytics"} /></span></button>
            <button type="button" onClick={() => { fetchAdminData(); fetchAnalytics(analyticsRange); fetchCommandActivity(); }}><RefreshCw size={16} /><span><Trans text={"Refresh Center"} /></span></button>
          </div>

          <div className={`command-alert-strip ${commandAlerts.length ? "has-alerts" : "clear"}`}>
            <div className="command-alert-title"><Bell size={17} /><b><Trans text={"Smart Alerts"} /></b><span>{commandAlerts.length || "Clear"}</span></div>
            <div className="command-alert-items">
              {commandAlerts.length ? commandAlerts.slice(0, 4).map((alertItem, index) => (
                <span className={`command-alert ${alertItem.level}`} key={`${alertItem.text}-${index}`}><AlertTriangle size={14} />{alertItem.text}</span>
              )) : <span className="command-alert clear"><CheckCircle size={14} /><Trans text={"No operational threshold needs attention right now."} /></span>}
            </div>
          </div>

          <div className="command-kpi-grid">
            <article><span><Trans text={"Live Queue"} /></span><b>{analytics.overview.waitingPatients + analytics.overview.calledPatients}</b><small>{analytics.overview.waitingPatients} <Trans text={"waiting · "} />{analytics.overview.calledPatients} <Trans text={"called"} /></small></article>
            <article><span><Trans text={"SLA Breaches"} /></span><b>{analytics.overview.slaBreachCount}</b><small><Trans text={"Waiting over 30 minutes"} /></small></article>
            <article><span><Trans text={"Emergency Waiting"} /></span><b>{analytics.overview.emergencyWaiting}</b><small>{analytics.overview.emergencyPatients} <Trans text={"emergency cases in period"} /></small></article>
            <article><span><Trans text={"Patient Rating"} /></span><b>{analytics.overview.averageRating ? `${analytics.overview.averageRating}/5` : "—"}</b><small>{analytics.overview.feedbackCount} <Trans text={"feedback responses"} /></small></article>
            <article><span><Trans text={"Reservation Check-in"} /></span><b>{analytics.reservationStats?.checkInRate ?? 0}%</b><small>{analytics.reservationStats?.checkedIn ?? 0}/{analytics.reservationStats?.total ?? 0} <Trans text={"online reservations"} /></small></article>
            <article><span><Trans text={"Peak Hour"} /></span><b>{analytics.insights.peakHour}</b><small>{analytics.insights.peakHourPatients} <Trans text={"arrivals"} /></small></article>
          </div>

          <div className="command-main-grid">
            <article className="command-panel command-heatmap">
              <div className="command-panel-head"><div><b><Trans text={"Live Queue Heatmap"} /></b><small><Trans text={"Department pressure from waiting load + average wait"} /></small></div><Activity size={18} /></div>
              <div className="queue-heatmap-grid">
                {analytics.departments.map((row) => {
                  const pressure = queuePressureLabel(row);
                  return (
                    <div className={`heatmap-cell pressure-${pressure.toLowerCase()}`} key={row.department}>
                      <div><b>{t(row.department)}</b><span>{pressure}</span></div>
                      <strong>{row.waiting}</strong>
                      <small><Trans text={"waiting · "} />{row.averageWaitMinutes}<Trans text={"m avg wait"} /></small>
                      <i style={{ width: `${Math.min(100, Math.max(8, (row.waiting / Math.max(1, analytics.overview.waitingPatients)) * 100))}%` }} />
                    </div>
                  );
                })}
                {!analytics.departments.length && <div className="command-empty"><Trans text={"No department queue activity yet."} /></div>}
              </div>
            </article>

            <article className="command-panel command-doctors">
              <div className="command-panel-head"><div><b><Trans text={"Doctor Capacity Monitor"} /></b><small><Trans text={"Available, busy, break and queue load"} /></small></div><Stethoscope size={18} /></div>
              <div className="doctor-capacity-list">
                {analytics.doctorPerformance.slice(0, 7).map((doctor) => (
                  <div className="doctor-capacity-row" key={doctor.doctorId}>
                    <span className={`doctor-status-dot status-${doctor.status}`} />
                    <div><b><Trans text={"Dr. "} />{doctor.doctorName}</b><small>{t(doctor.department)}</small></div>
                    <span className={`doctor-status-label status-${doctor.status}`}>{t(doctor.status)}</span>
                    <strong>{doctor.waiting}<small> <Trans text={"waiting"} /></small></strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="command-panel command-hourly">
              <div className="command-panel-head"><div><b><Trans text={"Peak Hour Analysis"} /></b><small><Trans text={"Arrival intensity across the selected analytics period"} /></small></div><Clock3 size={18} /></div>
              <div className="hourly-chart">
                {(analytics.hourlyTrend || []).map((hour) => (
                  <div className="hourly-bar-wrap" key={hour.hour} title={`${hour.label}: ${hour.patients} patients`}>
                    <span className="hourly-bar" style={{ height: `${Math.max(hour.patients ? 10 : 2, (hour.patients / maxHourlyPatients) * 100)}%` }} />
                    <small>{hour.hour % 2 === 0 ? String(hour.hour).padStart(2, "0") : ""}</small>
                  </div>
                ))}
              </div>
              <div className="peak-hour-summary"><b>{analytics.insights.peakHour}</b><span><Trans text={"Peak window · "} />{analytics.insights.peakHourPatients} <Trans text={"arrivals"} /></span></div>
            </article>

            <article className="command-panel command-emergency">
              <div className="command-panel-head"><div><b><Trans text={"Emergency Monitor"} /></b><small><Trans text={"Priority cases and immediate pressure"} /></small></div><ShieldAlert size={18} /></div>
              <div className="emergency-command-metric"><strong>{analytics.overview.emergencyWaiting}</strong><span><Trans text={"waiting now"} /></span></div>
              <div className="command-stat-pair"><span><b>{analytics.overview.emergencyPatients}</b><Trans text={"Total flagged"} /></span><span><b>{analytics.overview.slaBreachCount}</b><Trans text={"SLA breaches"} /></span></div>
              <p className={analytics.overview.emergencyWaiting ? "danger-text" : "success"}>{t(analytics.overview.emergencyWaiting ? "Priority attention recommended at reception/doctor queue." : "No emergency patient is currently waiting.")}</p>
            </article>

            <article className="command-panel command-trends">
              <div className="command-panel-head"><div><b><Trans text={"Service Trend"} /></b><small><Trans text={"Completion and no-show movement"} /></small></div><BarChart3 size={18} /></div>
              <div className="trend-rate-list">
                {analytics.dailyTrend.slice(-7).map((day) => {
                  const completion = day.patients ? Math.round((day.completed / day.patients) * 100) : 0;
                  const noShow = day.patients ? Math.round((day.noShows / day.patients) * 100) : 0;
                  return <div key={day.date}><span>{day.date.slice(5)}</span><i><em style={{ width: `${completion}%` }} /></i><b>{completion}%</b><small>{noShow}<Trans text={"% no-show"} /></small></div>;
                })}
              </div>
            </article>

            <article className="command-panel command-source">
              <div className="command-panel-head"><div><b><Trans text={"Patient Source & Conversion"} /></b><small><Trans text={"Appointments, walk-ins and online reservations"} /></small></div><Users size={18} /></div>
              <div className="command-donut-wrap">
                <div className="command-donut" style={{ "--appointment-share": `${analytics.overview.totalPatients ? (analytics.overview.appointmentPatients / analytics.overview.totalPatients) * 100 : 0}%` }}><span><b>{analytics.overview.totalPatients}</b><Trans text={"Total"} /></span></div>
                <div className="command-donut-legend"><span><i className="legend-appointment" /><Trans text={"Appointments "} /><b>{analytics.overview.appointmentPatients}</b></span><span><i className="legend-walkin" /><Trans text={"Walk-in / check-in "} /><b>{analytics.overview.walkInPatients}</b></span><span><i className="legend-reservation" /><Trans text={"Reservations checked in "} /><b>{analytics.reservationStats?.checkedIn ?? 0}</b></span></div>
              </div>
            </article>

            <article className="command-panel command-leaderboard">
              <div className="command-panel-head"><div><b><Trans text={"Doctor Leaderboard"} /></b><small><Trans text={"Throughput with consultation efficiency"} /></small></div><BarChart3 size={18} /></div>
              <div className="doctor-leaderboard">
                {analytics.doctorPerformance.slice(0, 5).map((doctor, index) => (
                  <div key={doctor.doctorId}><span className="leader-rank">#{index + 1}</span><div><b><Trans text={"Dr. "} />{doctor.doctorName}</b><small>{t(doctor.department)}</small></div><strong>{doctor.completed}<small> <Trans text={"completed"} /></small></strong><span>{doctor.averageConsultationMinutes}<Trans text={"m avg"} /></span></div>
                ))}
              </div>
            </article>

            <article className="command-panel command-activity">
              <div className="command-panel-head"><div><b><Trans text={"Recent Activity"} /></b><small><Trans text={"Latest operational staff actions"} /></small></div><Activity size={18} /></div>
              <div className="command-activity-list">
                {commandActivity.slice(0, 6).map((item) => (
                  <div key={item._id}><span className={`activity-role-dot role-${item.actorRole}`} /><div><b>{item.summary}</b><small>{item.actorName} · {t(item.module)}</small></div><time>{new Date(item.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</time></div>
                ))}
                {!commandActivity.length && <div className="command-empty"><Trans text={"Operational activity will appear here as staff use the system."} /></div>}
              </div>
            </article>
          </div>

          <div className="command-bottom-grid">
            <article className="command-summary-card"><span>{analyticsScopeLabel} <Trans text={"Summary"} /></span><div><b>{analytics.overview.totalPatients}</b><small><Trans text={"patients"} /></small></div><div><b>{analytics.overview.completedPatients}</b><small><Trans text={"completed"} /></small></div><div><b>{analytics.overview.averageWaitMinutes}<Trans text={"m"} /></b><small><Trans text={"avg wait"} /></small></div><div><b>{analytics.overview.averageConsultationMinutes}<Trans text={"m"} /></b><small><Trans text={"avg consult"} /></small></div><div><b>{analytics.overview.noShowRate}%</b><small><Trans text={"no-show"} /></small></div></article>
            <article className="command-summary-card"><span><Trans text={"Patient Satisfaction"} /></span><div className="satisfaction-score"><b>{analytics.overview.averageRating || "—"}</b><small><Trans text={"/ 5 rating"} /></small></div><div><b>{analytics.overview.feedbackCount}</b><small><Trans text={"responses"} /></small></div><div><b>{analytics.overview.completionRate}%</b><small><Trans text={"completion"} /></small></div></article>
            <article className="command-summary-card"><span><Trans text={"Capacity Health"} /></span><div><b>{analytics.overview.activeDoctors}</b><small><Trans text={"doctors"} /></small></div><div><b>{analytics.overview.overloadedDoctors}</b><small><Trans text={"overloaded"} /></small></div><div><b>{analytics.overview.waitingPatients}</b><small><Trans text={"waiting"} /></small></div><div><b>{analytics.insights.busiestDepartment}</b><small><Trans text={"busiest dept."} /></small></div></article>
          </div>
        </section>
      )}

      {adminSection === "analytics" && (
        <>
      <section className="card analytics-dashboard">
        <div className="analytics-heading">
          <div>
            <p className="eyebrow"><Trans text={"Operational Intelligence"} /></p>
            <h2><BarChart3 size={20} /> <Trans text={"Admin Analytics Dashboard"} /></h2>
            <p className="muted">
              <Trans text={"Live OPD performance calculated from real queue, appointment, and consultation records."} /></p>
          </div>
          <div className="analytics-range-picker">
            <span className="analytics-scope-chip"><Activity size={14} /> {analyticsScopeLabel}</span>
            <button type="button" className="ghost" onClick={() => fetchAnalytics(analyticsRange)}>
              <RefreshCw size={14} className={analyticsLoading ? "spin" : ""} /> <Trans text={"Refresh"} /></button>
          </div>
        </div>

        {analytics && (
          <div className="analytics-command-strip">
            <div><span><Trans text={"Live load"} /></span><b>{analytics.overview.waitingPatients + analytics.overview.calledPatients}</b><small><Trans text={"waiting + in consultation"} /></small></div>
            <div><span><Trans text={"Active doctors"} /></span><b>{analytics.overview.activeDoctors}</b><small><Trans text={"clinic roster"} /></small></div>
            <div><span><Trans text={"Service health"} /></span><b>{t(analytics.overview.completionRate >= 80 ? "Strong" : analytics.overview.completionRate >= 60 ? "Stable" : "Needs attention")}</b><small>{analytics.overview.completionRate}<Trans text={"% completion"} /></small></div>
            <div><span><Trans text={"Period"} /></span><b>{analyticsCustomMode ? "Custom" : analyticsRange === 1 ? "Today" : analyticsRange === 365 ? t("1 year") : `${analyticsRange} days`}</b><small>{analytics.period?.startDate} → {analytics.period?.endDate}</small></div>
          </div>
        )}

        {analyticsLoading && !analytics ? (
          <div className="analytics-empty"><Trans text={"Calculating hospital analytics..."} /></div>
        ) : !analytics ? (
          <div className="analytics-empty"><Trans text={"Analytics are temporarily unavailable."} /></div>
        ) : (
          <>
            <div className="analytics-kpi-grid">
              <article><span><Trans text={"Patients"} /></span><b>{analytics.overview.totalPatients}</b><small>{analytics.overview.completedPatients} <Trans text={"completed"} /></small></article>
              <article><span><Trans text={"Avg Wait"} /></span><b>{analytics.overview.averageWaitMinutes} <Trans text={"min"} /></b><small><Trans text={"Arrival → doctor call"} /></small></article>
              <article><span><Trans text={"Avg Consultation"} /></span><b>{analytics.overview.averageConsultationMinutes} <Trans text={"min"} /></b><small><Trans text={"Call → completion"} /></small></article>
              <article><span><Trans text={"Completion Rate"} /></span><b>{analytics.overview.completionRate}%</b><small>{analytics.overview.waitingPatients} <Trans text={"currently waiting"} /></small></article>
              <article><span><Trans text={"No-show Rate"} /></span><b>{analytics.overview.noShowRate}%</b><small>{analytics.overview.noShowCount} <Trans text={"no-shows"} /></small></article>
              <article><span><Trans text={"Emergency Cases"} /></span><b>{analytics.overview.emergencyPatients}</b><small><Trans text={"Priority-marked tokens"} /></small></article>
              <article><span><Trans text={"Skipped"} /></span><b>{analytics.overview.skippedPatients ?? 0}</b><small>{analytics.overview.skipRate ?? 0}<Trans text={"% of arrivals"} /></small></article>
            </div>

            <div className="analytics-insight-strip">
              <span><b><Trans text={"Busiest department:"} /></b> {analytics.insights.busiestDepartment} ({analytics.insights.busiestDepartmentPatients})</span>
              <span><b><Trans text={"Peak day:"} /></b> {analytics.insights.peakDay} ({analytics.insights.peakDayPatients} <Trans text={"patients)"} /></span>
              <span><b><Trans text={"Patient source:"} /></b> {analytics.overview.onlinePatients ?? 0} <Trans text={"online · "} />{analytics.overview.walkInPatients} <Trans text={"walk-in · "} />{analytics.overview.appointmentPatients} <Trans text={"appointment"} /></span>
            </div>

            <div className="analytics-two-column">
              <article className="analytics-panel">
                <div className="analytics-panel-title">
                  <div><b><Trans text={"Patient Volume Trend"} /></b><small><Trans text={"Daily arrivals and completed consultations"} /></small></div>
                </div>
                <div className="trend-chart interactive-trend-chart">
                  {analytics.dailyTrend.map((day) => {
                    const maxPatients = Math.max(1, ...analytics.dailyTrend.map((item) => item.patients));
                    const isHovered = hoveredTrendDay === day.date;
                    return (
                      <div
                        className={`trend-column ${isHovered ? "is-hovered" : ""}`}
                        key={day.date}
                        tabIndex={0}
                        onMouseEnter={() => setHoveredTrendDay(day.date)}
                        onMouseLeave={() => setHoveredTrendDay(null)}
                        onFocus={() => setHoveredTrendDay(day.date)}
                        onBlur={() => setHoveredTrendDay(null)}
                        aria-label={`${day.date}: ${day.patients} patients, ${day.completed} completed, ${day.skipped ?? 0} skipped, ${day.noShows ?? 0} no-shows`}
                      >
                        {isHovered && (
                          <div className="trend-tooltip" role="tooltip">
                            <b>{day.date}</b>
                            <span><i className="tooltip-dot patient-dot" /> {day.patients} <Trans text={"arrivals"} /></span>
                            <span><i className="tooltip-dot completed-dot" /> {day.completed} <Trans text={"completed"} /></span>
                            <span>{day.online ?? 0} <Trans text={"online · "} />{day.walkIns ?? 0} <Trans text={"walk-in · "} />{day.appointments ?? 0} <Trans text={"appointment"} /></span>
                            <span>{day.skipped ?? 0} <Trans text={"skipped · "} />{day.noShows ?? 0} <Trans text={"no-show"} /></span>
                          </div>
                        )}
                        <div className="trend-bars">
                          <span className="trend-bar patients" style={{ height: `${Math.max(day.patients ? 8 : 0, (day.patients / maxPatients) * 100)}%` }} />
                          <span className="trend-bar completed" style={{ height: `${Math.max(day.completed ? 8 : 0, (day.completed / maxPatients) * 100)}%` }} />
                        </div>
                        <b>{day.patients}</b>
                        <small>{day.date.slice(5)}</small>
                      </div>
                    );
                  })}
                </div>
                <div className="chart-legend"><span><Trans text={"Patient arrivals"} /></span><span><Trans text={"Completed"} /></span></div>
              </article>

              <article className="analytics-panel">
                <div className="analytics-panel-title">
                  <div><b><Trans text={"Patient Source Mix"} /></b><small><Trans text={"Online reservation, walk-in and scheduled appointment arrivals"} /></small></div>
                </div>
                <div className="source-split source-split-three interactive-source-split">
                  <div>
                    <strong>{analytics.overview.onlinePatients ?? 0}</strong>
                    <span><Trans text={"Online"} /></span>
                  </div>
                  <div>
                    <strong>{analytics.overview.walkInPatients}</strong>
                    <span><Trans text={"Walk-ins"} /></span>
                  </div>
                  <div>
                    <strong>{analytics.overview.appointmentPatients}</strong>
                    <span><Trans text={"Appointments"} /></span>
                  </div>
                </div>
                <div className="appointment-status-grid">
                  <span><b>{analytics.appointmentStatus.booked}</b> <Trans text={"Booked"} /></span>
                  <span><b>{analytics.appointmentStatus.checkedIn}</b> <Trans text={"Checked in"} /></span>
                  <span><b>{analytics.appointmentStatus.completed}</b> <Trans text={"Completed"} /></span>
                  <span><b>{analytics.appointmentStatus.skipped ?? 0}</b> <Trans text={"Skipped"} /></span>
                  <span><b>{analytics.appointmentStatus.cancelled}</b> <Trans text={"Cancelled"} /></span>
                </div>
              </article>
            </div>

            <div className="analytics-two-column">
              <article className="analytics-panel">
                <div className="analytics-panel-title">
                  <div><b><Trans text={"Department Traffic"} /></b><small><Trans text={"Volume, waiting pressure and service time"} /></small></div>
                </div>
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead><tr><th><Trans text={"Department"} /></th><th><Trans text={"Patients"} /></th><th><Trans text={"Online"} /></th><th><Trans text={"Walk-in"} /></th><th><Trans text={"Appt."} /></th><th><Trans text={"Completed"} /></th><th><Trans text={"Completion"} /></th><th><Trans text={"Skipped"} /></th><th><Trans text={"No-show"} /></th><th><Trans text={"Avg wait"} /></th><th><Trans text={"Avg consult"} /></th></tr></thead>
                    <tbody>
                      {analytics.departments.map((row) => (
                        <tr key={row.department}>
                          <td><b>{t(row.department)}</b><span className="analytics-mini-meter"><i style={{ width: `${Math.min(100, (row.patients / Math.max(1, analytics.overview.totalPatients)) * 100)}%` }} /></span></td>
                          <td>{row.patients}</td>
                          <td>{row.online ?? 0}</td>
                          <td>{row.walkIns ?? 0}</td>
                          <td>{row.appointments ?? 0}</td>
                          <td>{row.completed}</td>
                          <td>{row.completionRate ?? 0}%</td>
                          <td>{row.skipped ?? 0}</td>
                          <td>{row.noShows ?? 0}</td>
                          <td>{row.averageWaitMinutes}<Trans text={"m"} /></td>
                          <td>{row.averageConsultationMinutes}<Trans text={"m"} /></td>
                        </tr>
                      ))}
                      {!analytics.departments.length && <tr><td colSpan="11"><Trans text={"No queue activity in this period."} /></td></tr>}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="analytics-panel">
                <div className="analytics-panel-title">
                  <div><b><Trans text={"Doctor Workload"} /></b><small><Trans text={"Assigned patients and completed consultations"} /></small></div>
                </div>
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead><tr><th><Trans text={"Doctor"} /></th><th><Trans text={"Dept."} /></th><th><Trans text={"Patients"} /></th><th><Trans text={"Online"} /></th><th><Trans text={"Walk-in"} /></th><th><Trans text={"Appt."} /></th><th><Trans text={"Completed"} /></th><th><Trans text={"Completion"} /></th><th><Trans text={"Skipped"} /></th><th><Trans text={"No-show"} /></th><th><Trans text={"Avg wait"} /></th><th><Trans text={"Avg consult"} /></th></tr></thead>
                    <tbody>
                      {analytics.doctorPerformance.map((row) => (
                        <tr key={row.doctorId}>
                          <td><b><Trans text={"Dr. "} />{row.doctorName}</b>{row.isOnBreak && <small className="analytics-break"><Trans text={"On break"} /></small>}<span className="analytics-mini-meter"><i style={{ width: `${Math.min(100, (row.completed / Math.max(1, row.patients)) * 100)}%` }} /></span></td>
                          <td>{t(row.department)}</td>
                          <td>{row.patients}</td>
                          <td>{row.online ?? 0}</td>
                          <td>{row.walkIns ?? 0}</td>
                          <td>{row.appointments ?? 0}</td>
                          <td>{row.completed}</td>
                          <td>{row.completionRate ?? 0}%</td>
                          <td>{row.skipped ?? 0}</td>
                          <td>{row.noShows ?? 0}</td>
                          <td>{row.averageWaitMinutes ?? 0}<Trans text={"m"} /></td>
                          <td>{row.averageConsultationMinutes}<Trans text={"m"} /></td>
                        </tr>
                      ))}
                      {!analytics.doctorPerformance.length && <tr><td colSpan="12"><Trans text={"No doctor activity in this period."} /></td></tr>}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        )}
      </section>
        </>
      )}

      {adminSection === "revenue" && (
        <section className="admin-revenue-workspace">
          <div className="revenue-workspace-head"><div><p className="eyebrow"><Trans text={"OPD Revenue"} /></p><h2><IndianRupee size={20}/> <Trans text={"Collections & Payment Analytics"} /></h2><p className="muted"><Trans text={"Revenue is based on payment-confirmed queue visits. Emergency priority is never linked to payment."} /></p></div><div className="revenue-toolbar"><label><Trans text={"From"} /><input type="date" value={revenueRange.from} onChange={(e)=>setRevenueRange((c)=>({...c,from:e.target.value}))}/></label><label><Trans text={"To"} /><input type="date" value={revenueRange.to} onChange={(e)=>setRevenueRange((c)=>({...c,to:e.target.value}))}/></label><button type="button" className="ghost" onClick={()=>fetchRevenue()}><RefreshCw size={15} className={revenueLoading?"spin":""}/><Trans text={"Load"} /></button><button type="button" className="ghost" onClick={exportRevenueCsv}><Download size={15}/><Trans text={"CSV"} /></button></div></div>
          <div className="revenue-kpi-grid">
            <article><span><Trans text={"Today's / Loaded Collection"} /></span><strong>{formatInr(revenue?.summary?.collected || 0)}</strong><small>{revenue?.summary?.paidPatients || 0} <Trans text={"paid visits"} /></small></article>
            <article><span><Trans text={"Net Collection"} /></span><strong>{formatInr(revenue?.summary?.net || 0)}</strong><small><Trans text={"After marked refunds"} /></small></article>
            <article><span><Trans text={"UPI"} /></span><strong>{formatInr(revenue?.summary?.methods?.upi || 0)}</strong><small><Trans text={"Digital collection"} /></small></article>
            <article><span><Trans text={"Cash"} /></span><strong>{formatInr(revenue?.summary?.methods?.cash || 0)}</strong><small><Trans text={"Front-desk cash"} /></small></article>
            <article><span><Trans text={"Card"} /></span><strong>{formatInr(revenue?.summary?.methods?.card || 0)}</strong><small><Trans text={"Card collection"} /></small></article>
            <article><span><Trans text={"Pending Collection"} /></span><strong>{formatInr(revenue?.summary?.pendingAmount || 0)}</strong><small>{revenue?.summary?.pendingCount || 0} <Trans text={"booked/reserved visits"} /></small></article>
            <article><span><Trans text={"Refunded"} /></span><strong>{formatInr(revenue?.summary?.refunded || 0)}</strong><small><Trans text={"Marked payment reversals"} /></small></article>
          </div>
          <div className="revenue-grid-two">
            <article className="card"><div className="command-panel-head"><div><b><Trans text={"Doctor-wise Revenue"} /></b><small><Trans text={"Payment-confirmed OPD visits"} /></small></div><Stethoscope size={18}/></div><div className="revenue-list">{(revenue?.byDoctor||[]).map((row)=><div key={row.doctorId}><span><b><Trans text={"Dr. "} />{row.doctorName}</b><small>{t(row.department)} · {row.patients} <Trans text={"patients"} /></small></span><strong>{formatInr(row.revenue)}</strong></div>)}{!revenue?.byDoctor?.length&&<p className="muted"><Trans text={"No paid visits yet."} /></p>}</div></article>
            <article className="card"><div className="command-panel-head"><div><b><Trans text={"Department Revenue"} /></b><small><Trans text={"Collection by clinical department"} /></small></div><BarChart3 size={18}/></div><div className="revenue-list">{(revenue?.byDepartment||[]).map((row)=><div key={row.department}><span><b>{t(row.department)}</b><small>{row.patients} <Trans text={"paid patients"} /></small></span><strong>{formatInr(row.revenue)}</strong></div>)}{!revenue?.byDepartment?.length&&<p className="muted"><Trans text={"No paid visits yet."} /></p>}</div></article>
          </div>
          <article className="card revenue-receipts-card"><div className="command-panel-head"><div><b><Trans text={"Recent Receipts"} /></b><small><Trans text={"Latest payment-confirmed OPD visits"} /></small></div><FileText size={18}/></div><div className="tablewrap"><table><thead><tr><th><Trans text={"Receipt"} /></th><th><Trans text={"Patient"} /></th><th><Trans text={"Doctor"} /></th><th><Trans text={"Department"} /></th><th><Trans text={"Method"} /></th><th><Trans text={"Amount"} /></th><th><Trans text={"Status"} /></th><th><Trans text={"Action"} /></th></tr></thead><tbody>{(revenue?.payments||[]).slice(0,50).map((row)=><tr key={row._id}><td>{row.billing?.receiptNumber||"—"}</td><td>{row.patientName}</td><td>{row.assignedDoctor?.name?`Dr. ${row.assignedDoctor.name}`:"—"}</td><td>{t(row.department)}</td><td>{t(row.billing?.method)||"—"}</td><td>{formatInr(row.billing?.paidAmount||0)}</td><td><span className={`appointment-status ${row.billing?.status||"pending"}`}>{t(row.billing?.status)||t("pending")}</span></td><td>{row.billing?.status==="paid"?<button type="button" className="small" onClick={()=>refundPayment(row)}><Trans text={"Mark Refund"} /></button>:"—"}</td></tr>)}</tbody></table></div></article>
        </section>
      )}

      {adminSection === "operations" && (
        <>
      <details
        id="admin-audit-logs"
        className="card patient-feedback-dropdown admin-audit-dropdown"
        onToggle={(event) => {
          if (event.currentTarget.open && !auditLoaded && !auditLoading) loadAuditLogs();
        }}
      >
        <summary className="patient-feedback-dropdown-header admin-audit-summary">
          <div className="card-title">
            <Activity size={19} />
            <div>
              <h2><Trans text={"Activity & Audit Logs"} /></h2>
              <small><Trans text={"Operational staff actions · compact 90-day history"} /></small>
            </div>
          </div>
          <span className="feedback-dropdown-arrow" aria-hidden="true">⌄</span>
        </summary>

        <div className="patient-feedback-dropdown-content admin-audit-content">
          <div className="admin-audit-toolbar">
            <label>
              <Trans text={"Role"} /><select
                value={auditFilters.role}
                onChange={(event) => {
                  const next = { ...auditFilters, role: event.target.value };
                  setAuditFilters(next);
                  loadAuditLogs(next);
                }}
              >
                <option value="">{t("All staff roles")}</option>
                <option value="admin">{t("Administrator")}</option>
                <option value="doctor">{t("Doctor")}</option>
                <option value="receptionist">{t("Receptionist")}</option>
              </select>
            </label>
            <label>
              <Trans text={"Module"} /><select
                value={auditFilters.module}
                onChange={(event) => {
                  const next = { ...auditFilters, module: event.target.value };
                  setAuditFilters(next);
                  loadAuditLogs(next);
                }}
              >
                <option value="">{t("All modules")}</option>
                {auditModules.map((moduleName) => (
                  <option value={moduleName} key={moduleName}>{formatActivityModule(moduleName, language)}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" onClick={() => loadAuditLogs()}>
              <RefreshCw size={15} /> <Trans text={"Refresh"} /></button>
          </div>

          <div className="admin-audit-note">
            <Trans text={"Stores operational metadata only — no diagnosis, prescription, medical-history or form contents. Logs auto-delete after "} />{auditRetentionDays} <Trans text={"days to keep MongoDB storage lean."} /></div>

          {auditError && <div className="login-error" role="alert">{t(auditError)}</div>}
          {auditLoading && <div className="analytics-empty"><Trans text={"Loading activity logs..."} /></div>}

          {!auditLoading && !auditError && (
            <div className="admin-audit-list">
              {auditLogs.map((logItem) => (
                <article className="admin-audit-row" key={logItem._id}>
                  <div className="admin-audit-actor">
                    <strong>{logItem.actorName}</strong>
                    <span className={`audit-role audit-role-${logItem.actorRole}`}>{t(logItem.actorRole)}</span>
                  </div>
                  <div className="admin-audit-action">
                    <b>{formatActivitySummary(logItem, language)}</b>
                    <small>{t(logItem.module)} · {logItem.action}</small>
                  </div>
                  <time dateTime={logItem.createdAt}>
                    {new Date(logItem.createdAt).toLocaleDateString("en-IN")}
                    <small>{new Date(logItem.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
                  </time>
                </article>
              ))}
              {!auditLogs.length && (
                <div className="analytics-empty"><Trans text={"No matching staff activity has been recorded yet."} /></div>
              )}
            </div>
          )}
        </div>
      </details>

      <div id="admin-staff-management" className="cols admincols" style={{ marginTop: "24px" }}>
        <section className="card">
          <h2>
            <UserRound size={18} /> <Trans text={"Provision Clinical Staff Account"} /></h2>

          <form onSubmit={handleCreateStaffAccount}>
            <label>
              <Trans text={"Staff Full Name"} /><input
                required
                placeholder={t("e.g. Dr. Rajesh Sharma")}
                value={newStaffForm.name}
                onChange={(e) =>
                  setNewStaffForm({
                    ...newStaffForm,
                    name: e.target.value,
                  })
                }
              />
            </label>

            <label>
              <Trans text={"Official Hospital Email"} /><input
                required
                type="email"
                placeholder={t("rsharma@hospital.org")}
                value={newStaffForm.email}
                onChange={(e) =>
                  setNewStaffForm({
                    ...newStaffForm,
                    email: e.target.value,
                  })
                }
              />
            </label>

            <label>
              <Trans text={"Initial Access Password"} /><input
                required
                type="password"
                placeholder="••••••••"
                value={newStaffForm.password}
                onChange={(e) =>
                  setNewStaffForm({
                    ...newStaffForm,
                    password: e.target.value,
                  })
                }
              />
            </label>

            <div className="patient-profile-grid">
              <label>
                <Trans text={"Assigned Role"} /><select
                  value={newStaffForm.role}
                  onChange={(e) =>
                    setNewStaffForm({
                      ...newStaffForm,
                      role: e.target.value,
                    })
                  }
                >
                  <option value="doctor">{t("Attending Doctor")}</option>
                  <option value="receptionist">
                    {t("Reception / Front Desk")}</option>
                  <option value="admin">{t("Administrator")}</option>
                </select>
              </label>

              <label>
                {newStaffForm.role === "doctor"
                  ? t("Department Specialty")
                  : "Operational Assignment"}
                <select
                  value={newStaffForm.department}
                  disabled={newStaffForm.role !== "doctor"}
                  onChange={(e) =>
                    setNewStaffForm({
                      ...newStaffForm,
                      department: e.target.value,
                    })
                  }
                >
                  {CLINICAL_DEPARTMENTS.map((departmentOption) => (
                    <option
                      key={departmentOption.value}
                      value={departmentOption.value}
                    >
                      {t(departmentOption.label)}
                    </option>
                  ))}
                </select>

                {newStaffForm.role !== "doctor" && (
                  <small>
                    <Trans text={"Non-doctor staff receive hospital-wide operational access appropriate to their role."} /></small>
                )}
              </label>
            </div>

            <button
              type="submit"
              className="primary"
              style={{ marginTop: "12px" }}
            >
              <Trans text={"Create Staff Account"} /></button>
          </form>
        </section>

        <section className="card">
          <h2>
            <ShieldCheck size={18} /> <Trans text={"Staff Roster ("} />{staffAccountsList.length})
          </h2>

          <div className="list">
            {staffAccountsList.map((staffItem) => (
              <div className="row" key={staffItem._id}>
                <b>{staffItem.name}</b>
                <span>
                  {staffItem.email}
                  <small>
                    {staffItem.role.toUpperCase()} · {t(staffItem.department)}
                  </small>
                </span>

                {["doctor", "receptionist"].includes(
                  staffItem.role
                ) && (
                  <button
                    type="button"
                    className="danger"
                    style={{
                      marginLeft: "auto",
                      whiteSpace: "nowrap",
                    }}
                    onClick={() =>
                      handleDeleteStaffAccount(staffItem)
                    }
                  >
                    {staffItem.role === "doctor"
                      ? "Delete Doctor"
                      : "Delete Receptionist"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              className="danger wide"
              onClick={handleResetQueue}
            >
              <AlertTriangle size={16} /> <Trans text={"Reset & Archive Daily Queue"} /></button>
          </div>
        </section>
      </div>

      <section className="card admin-feedback-dashboard">
        <div className="analytics-heading">
          <div>
            <p className="eyebrow"><Trans text={"Patient Experience Intelligence"} /></p>
            <h2><Trans text={"Doctor Feedback Dashboard"} /></h2>
            <p className="muted">
              <Trans text={"Select a doctor and press OK to review every patient feedback entry with patient name, date, and time."} /></p>
          </div>
        </div>

        <div className="admin-feedback-selector">
          <label>
            <Trans text={"Select Doctor"} /><select
              value={feedbackDoctorId}
              onChange={(event) => {
                setFeedbackDoctorId(event.target.value);
                setAdminDoctorFeedback(null);
                setAdminFeedbackError("");
              }}
            >
              <option value="">{t("Choose doctor...")}</option>
              {doctors.map((doctor) => (
                <option key={doctor._id} value={doctor._id}>
                  {t("Dr. ")}{doctor.name} · {t(doctor.department)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={loadAdminDoctorFeedback}>
            <Trans text={"OK · View Feedback"} /></button>
        </div>

        {adminFeedbackError && <div className="login-error" role="alert">{t(adminFeedbackError)}</div>}
        {adminFeedbackLoading && <div className="analytics-empty"><Trans text={"Loading doctor feedback..."} /></div>}

        {!adminFeedbackLoading && adminDoctorFeedback && (
          <>
            <div className="admin-feedback-summary">
              <div>
                <span><Trans text={"Doctor"} /></span>
                <strong><Trans text={"Dr. "} />{adminDoctorFeedback.doctor?.name}</strong>
                <small>{t(adminDoctorFeedback.doctor?.department)}</small>
              </div>
              <div>
                <span><Trans text={"Average Rating"} /></span>
                <strong>{adminDoctorFeedback.summary?.averageRating || "—"} / 5 ★</strong>
              </div>
              <div>
                <span><Trans text={"Total Feedback"} /></span>
                <strong>{adminDoctorFeedback.summary?.total || 0}</strong>
              </div>
            </div>

            <div className="feedback-record-list admin-feedback-record-list">
              {(adminDoctorFeedback.feedback || []).map((item) => (
                <article className="feedback-record" key={item._id}>
                  <div className="feedback-record-head">
                    <div>
                      <strong>{item.patient?.name || t("Patient")}</strong>
                      <span>{item.patient?.patientId || "Registered patient"} · {t(item.department)}</span>
                    </div>
                    <b>{item.rating}/5 ★</b>
                  </div>
                  <p>{item.comment || "Patient submitted a rating without a written comment."}</p>
                  <small>
                    <Trans text={"Submitted: "} />{new Date(item.createdAt).toLocaleDateString("en-IN")} ·{" "}
                    {new Date(item.createdAt).toLocaleTimeString("en-IN")}
                  </small>
                </article>
              ))}
              {!adminDoctorFeedback.feedback?.length && (
                <div className="analytics-empty"><Trans text={"No feedback has been submitted for this doctor yet."} /></div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card admin-doctor-schedule-section">
        <div className="admin-schedule-heading">
          <div>
            <p className="eyebrow"><Trans text={"Physician Availability"} /></p>
            <h2>
              <Calendar size={19} /> <Trans text={"Doctor Schedule & Room Management"} /></h2>
            <p className="muted">
              <Trans text={"Configure recurring working days, OPD hours, temporary break status, consultation room, and leave/unavailable dates."} /></p>
          </div>
          <span className="schedule-doctor-count">
            {doctors.length} <Trans text={"doctors"} /></span>
        </div>

        {scheduleMessage && (
          <div className="schedule-success-message">
            <CheckCircle size={16} />
            {t(scheduleMessage)}
          </div>
        )}

        <div className="doctor-schedule-grid">
          {doctors.map((doctor) => {
            const schedule = normalizeDoctorSchedule(
              doctorScheduleDrafts[doctor._id] ||
                doctor.doctorSchedule
            );

            return (
              <article
                className="doctor-schedule-card"
                key={doctor._id}
              >
                <div className="doctor-schedule-card-head">
                  <div>
                    <span className="doctor-schedule-department">
                      {t(doctor.department)}
                    </span>
                    <h3><Trans text={"Dr. "} />{doctor.name}</h3>
                    <small>{doctor.email}</small>
                  </div>

                  <span
                    className={`doctor-availability-badge ${
                      schedule.isOnBreak ? "break" : "available"
                    }`}
                  >
                    {t(schedule.isOnBreak ? "ON BREAK" : "AVAILABLE")}
                  </span>
                </div>

                <div className="schedule-form-block">
                  <span className="schedule-field-title">
                    <Trans text={"Working Days"} /></span>

                  <div className="working-days-picker">
                    {WEEK_DAYS.map((day) => {
                      const active =
                        schedule.workingDays.includes(day);

                      return (
                        <button
                          key={day}
                          type="button"
                          className={`working-day-chip ${
                            active ? "active" : ""
                          }`}
                          onClick={() =>
                            toggleWorkingDay(doctor._id, day)
                          }
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="schedule-time-grid">
                  <label>
                    <Trans text={"Start Time"} /><input
                      type="time"
                      value={schedule.startTime}
                      onChange={(e) =>
                        updateScheduleDraft(
                          doctor._id,
                          "startTime",
                          e.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <Trans text={"End Time"} /><input
                      type="time"
                      value={schedule.endTime}
                      onChange={(e) =>
                        updateScheduleDraft(
                          doctor._id,
                          "endTime",
                          e.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <Trans text={"Room Number"} /><input
                      type="text"
                      placeholder={t("e.g. OPD-204")}
                      value={schedule.roomNumber}
                      onChange={(e) =>
                        updateScheduleDraft(
                          doctor._id,
                          "roomNumber",
                          e.target.value
                        )
                      }
                    />
                  </label>
                </div>

                <label className="doctor-break-switch">
                  <input
                    type="checkbox"
                    checked={schedule.isOnBreak}
                    onChange={(e) =>
                      updateScheduleDraft(
                        doctor._id,
                        "isOnBreak",
                        e.target.checked
                      )
                    }
                  />
                  <span>
                    <b><Trans text={"Doctor is currently on break"} /></b>
                    <small>
                      <Trans text={"Use this for a temporary OPD pause. Existing patient tokens remain preserved."} /></small>
                  </span>
                </label>

                <div className="schedule-form-block">
                  <span className="schedule-field-title">
                    <Trans text={"Leave / Unavailable Dates"} /></span>

                  <div className="schedule-date-add">
                    <input
                      type="date"
                      value={schedule.newUnavailableDate}
                      onChange={(e) =>
                        updateScheduleDraft(
                          doctor._id,
                          "newUnavailableDate",
                          e.target.value
                        )
                      }
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        addUnavailableDate(doctor._id)
                      }
                    >
                      <Trans text={"Add Date"} /></button>
                  </div>

                  <div className="unavailable-date-list">
                    {schedule.unavailableDates.map((date) => (
                      <span
                        className="unavailable-date-chip"
                        key={date}
                      >
                        {date}
                        <button
                          type="button"
                          aria-label={`Remove ${date}`}
                          onClick={() =>
                            removeUnavailableDate(
                              doctor._id,
                              date
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {!schedule.unavailableDates.length && (
                      <small className="muted">
                        <Trans text={"No leave dates configured."} /></small>
                    )}
                  </div>
                </div>

                <div className="doctor-fee-editor">
                  <div className="doctor-fee-editor-head"><span><IndianRupee size={16}/> <Trans text={"Doctor Fee Profile"} /></span><small><Trans text={"Blank optional fields fall back to consultation / department / clinic fee."} /></small></div>
                  {(() => { const fee = normalizeDoctorBillingProfile(doctorBillingDrafts[doctor._id] || doctor.billingProfile); return <>
                    <label className="doctor-break-switch"><input type="checkbox" checked={fee.enabled} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"enabled",e.target.checked)}/><span><b><Trans text={"Fee collection enabled for this doctor"} /></b><small><Trans text={"Turn off only when this doctor's OPD is intentionally free."} /></small></span></label>
                    <div className="doctor-fee-grid">
                      <label><Trans text={"Consultation ₹"} /><input type="number" min="0" value={fee.consultationFee} placeholder={t("Fallback")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"consultationFee",e.target.value)}/></label>
                      <label><Trans text={"Walk-in ₹"} /><input type="number" min="0" value={fee.walkInFee} placeholder={t("Consultation fee")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"walkInFee",e.target.value)}/></label>
                      <label><Trans text={"Online reservation ₹"} /><input type="number" min="0" value={fee.reservationFee} placeholder={t("Consultation fee")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"reservationFee",e.target.value)}/></label>
                      <label><Trans text={"Appointment ₹"} /><input type="number" min="0" value={fee.appointmentFee} placeholder={t("Consultation fee")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"appointmentFee",e.target.value)}/></label>
                      <label><Trans text={"Follow-up ₹"} /><input type="number" min="0" value={fee.followUpFee} placeholder={t("0 = free")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"followUpFee",e.target.value)}/></label>
                      <label><Trans text={"Emergency visit ₹"} /><input type="number" min="0" value={fee.emergencyFee} placeholder={t("Consultation fee")} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"emergencyFee",e.target.value)}/></label>
                      <label><Trans text={"Free follow-up days"} /><input type="number" min="0" max="365" value={fee.freeFollowUpDays} onChange={(e)=>updateDoctorBillingDraft(doctor._id,"freeFollowUpDays",e.target.value)}/></label>
                    </div>
                    <button type="button" className="ghost wide" disabled={savingDoctorBilling===doctor._id} onClick={()=>saveDoctorBilling(doctor)}><IndianRupee size={15}/>{t(savingDoctorBilling===doctor._id?"Saving Fees...":"Save Doctor Fees")}</button>
                  </>; })()}
                </div>

                <button
                  type="button"
                  className="primary wide save-doctor-schedule"
                  disabled={
                    savingDoctorSchedule === doctor._id
                  }
                  onClick={() =>
                    saveDoctorSchedule(doctor)
                  }
                >
                  {savingDoctorSchedule === doctor._id
                    ? "Saving Schedule..."
                    : "Save Doctor Schedule"}
                </button>
              </article>
            );
          })}

          {!doctors.length && (
            <div className="schedule-empty-state">
              <Stethoscope size={28} />
              <b><Trans text={"No doctors registered yet"} /></b>
              <span>
                <Trans text={"Create a doctor account above to configure its OPD schedule."} /></span>
            </div>
          )}
        </div>
      </section>
        </>
      )}
    </main>
  );
}

/* =========================================================
   APPLICATION ROOT ROUTER
========================================================= */

export default function App() {
  const { t } = useLanguage();
  return (
    <AppLayout>
      <Routes>
        <Route path="/faqs" element={<PublicInfoPage kind="faqs" />} />
        <Route path="/privacy" element={<PublicInfoPage kind="privacy" />} />
        <Route path="/terms" element={<PublicInfoPage kind="terms" />} />
        <Route path="/support" element={<PublicInfoPage kind="support" />} />
        {/* PATIENT PORTAL ROUTES */}
        <Route path="/" element={<Navigate to="/patient-login" replace />} />
        <Route path="/patient-login" element={<PatientLoginPage />} />
        <Route path="/patient/clinics" element={<PatientClinicMarketplacePage />} />
        <Route path="/patient/profile" element={<PatientProfilePage />} />
        <Route path="/patient/privacy" element={<PatientPrivacyCenter />} />
        <Route path="/patient/ehr" element={<PatientClinicalSummary />} />
        <Route path="/patient/consents" element={<PatientClinicRequiredRoute><ClinicalConsentCenter /></PatientClinicRequiredRoute>} />
        <Route path="/patient" element={<PatientClinicRequiredRoute><PatientDashboard /></PatientClinicRequiredRoute>} />
        <Route path="/patient/lounge" element={<PatientClinicRequiredRoute><PatientWaitingLoungePage /></PatientClinicRequiredRoute>} />
        <Route path="/qr-checkin" element={<PatientSelfCheckInPage />} />
        <Route path="/token" element={<KioskTokenGenerationPage />} />

        {/* SAAS CLINIC ONBOARDING */}
        <Route path="/clinic/register" element={<ClinicRegistrationPage />} />
        <Route path="/clinic/pending" element={<ClinicApprovalWaitingPage />} />

        {/* SAAS PLATFORM OWNER ROUTES */}
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route path="/platform/privacy" element={<PlatformProtectedRoute><PlatformPrivacyRequests /></PlatformProtectedRoute>} />
        <Route path="/platform/privacy/governance" element={<PlatformProtectedRoute><PrivacyPhase3Governance /></PlatformProtectedRoute>} />
        <Route path="/platform/privacy/operations" element={<PlatformProtectedRoute><PrivacyPhase4Operations /></PlatformProtectedRoute>} />
        <Route path="/platform/branding" element={<PlatformProtectedRoute><PlatformBrandingPage /></PlatformProtectedRoute>} />
        <Route
          path="/platform"
          element={
            <PlatformProtectedRoute>
              <PlatformDashboardPage />
            </PlatformProtectedRoute>
          }
        />

        {/* STAFF & DOCTOR PORTAL ROUTES */}
        <Route path="/login" element={<StaffLoginPage />} />
        <Route
          path="/doctor"
          element={
            <StaffProtectedRoute allowedRoles={["doctor"]}>
              <DoctorDashboardPage />
            </StaffProtectedRoute>
          }
        />
        <Route path="/doctor/consents" element={<StaffProtectedRoute allowedRoles={["doctor"]}><ClinicalConsentCenter /></StaffProtectedRoute>} />
        <Route
          path="/reception"
          element={
            <StaffProtectedRoute allowedRoles={["receptionist"]}>
              <ReceptionDashboardPage />
            </StaffProtectedRoute>
          }
        />
        <Route path="/reception/consents" element={<StaffProtectedRoute allowedRoles={["receptionist"]}><ClinicalConsentCenter /></StaffProtectedRoute>} />
        <Route
          path="/reception/scan"
          element={
            <StaffProtectedRoute allowedRoles={["receptionist"]}>
              <ReceptionQrScannerPage />
            </StaffProtectedRoute>
          }
        />
        <Route path="/admin/privacy" element={<StaffProtectedRoute allowedRoles={["admin"]}><ClinicPrivacyReview /></StaffProtectedRoute>} />
        <Route path="/admin/privacy/identity" element={<StaffProtectedRoute allowedRoles={["admin"]}><ClinicIdentityReviews /></StaffProtectedRoute>} />
        <Route path="/admin/privacy/reviews" element={<StaffProtectedRoute allowedRoles={["admin"]}><PrivacyPhase3Clinic /></StaffProtectedRoute>} />
        <Route
          path="/admin"
          element={
            <StaffProtectedRoute allowedRoles={["admin"]}>
              <AdminDashboardPage />
            </StaffProtectedRoute>
          }
        />
        <Route path="/admin/consents" element={<StaffProtectedRoute allowedRoles={["admin"]}><ClinicalConsentCenter /></StaffProtectedRoute>} />
        <Route
          path="/admin/displays"
          element={
            <StaffProtectedRoute allowedRoles={["admin"]}>
              <AdminWaitingLoungeDisplaysPage />
            </StaffProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <StaffProtectedRoute allowedRoles={["admin"]}>
              <AdminClinicSettingsPage />
            </StaffProtectedRoute>
          }
        />

        {/* SECURE PHYSICAL TV DISPLAY — no generic public lounge route */}
        <Route path="/display/:accessKey" element={<SecureWaitingLoungeDisplayPage />} />
        <Route path="/tv" element={<Navigate to="/patient-login" replace />} />

        {/* CATCH ALL */}
        <Route path="*" element={<Navigate to="/patient-login" replace />} />
      </Routes>
    </AppLayout>
  );
}
