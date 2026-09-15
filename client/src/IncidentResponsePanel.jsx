import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BellRing, Download, FileLock2, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";
import { platformApi } from "./api";
import { useLanguage } from "./LanguageContext.jsx";

const messageOf = error => error.response?.data?.message || "Request failed. Please try again.";

export default function IncidentResponsePanel({ incidentId, onChanged }) {
  const { language, t } = useLanguage();
  const [data, setData] = useState(null); const [clinics, setClinics] = useState([]);
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [now, setNow] = useState(Date.now());
  const [lock, setLock] = useState({ reason: "Preserve authentication and data-access evidence for incident investigation.", password: "" });
  const [affected, setAffected] = useState({ tenantId: "", patientIds: "", evidenceReference: "" });
  const [template, setTemplate] = useState({ subjectEn: "", messageEn: "", subjectHi: "", messageHi: "", password: "" });
  const [send, setSend] = useState({ language: "en", password: "" });
  const [closure, setClosure] = useState({ note: "", evidenceReference: "", password: "" });
  const local = value => value ? new Date(value).toLocaleString(language === "hi" ? "hi-IN" : "en-IN") : t("Not recorded");
  const remaining = milliseconds => {
    if (milliseconds == null) return t("Not configured");
    const overdue = milliseconds < 0; let seconds = Math.floor(Math.abs(milliseconds) / 1000);
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    return `${overdue ? `${t("OVERDUE by")} ` : ""}${days ? `${days}${t("d")} ` : ""}${hours}${t("h")} ${minutes}${t("m")}`;
  };

  const load = async () => {
    const [{ data: response }, { data: clinicData }] = await Promise.all([
      platformApi.get(`/privacy/admin/operations/incidents/${incidentId}/response`), platformApi.get("/platform/clinics"),
    ]);
    setData(response); setClinics(clinicData.clinics || []);
    const noticeTemplate = response.incident.patientNoticeTemplate || {};
    setTemplate(value => ({ ...value, subjectEn: noticeTemplate.subjectEn || "", messageEn: noticeTemplate.messageEn || "", subjectHi: noticeTemplate.subjectHi || "", messageHi: noticeTemplate.messageHi || "" }));
    if (!affected.tenantId && response.incident.tenantIds?.[0]?._id) setAffected(value => ({ ...value, tenantId: response.incident.tenantIds[0]._id }));
  };
  useEffect(() => { load().catch(requestError => setError(messageOf(requestError))); }, [incidentId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const countdown = useMemo(() => data?.incident?.responseDueAt ? new Date(data.incident.responseDueAt).getTime() - now : null, [data, now]);
  const act = async (key, work, success) => {
    setBusy(key); setError(""); setMessage("");
    try { await work(); setMessage(success); await load(); await onChanged?.(); }
    catch (requestError) { setError(messageOf(requestError)); } finally { setBusy(""); }
  };
  if (!data) return <section className="card"><p>{t("Loading incident response workspace…")}</p>{error && <p className="login-error">{t(error)}</p>}</section>;

  const incident = data.incident;
  const affectedClinics = incident.tenantIds || [];
  const patientIds = affected.patientIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
  const downloadPackage = async () => {
    setBusy("download"); setError("");
    try {
      const response = await platformApi.get(`/privacy/admin/operations/incidents/${incidentId}/cert-in-package`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cert-in-incident-${incidentId}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(messageOf(requestError)); } finally { setBusy(""); }
  };

  return <section className="card incident-response-panel">
    <div className="card-title"><ShieldCheck/><h2>{t("Real incident response")}</h2></div>
    <p className="muted">{t("Suspicion is not automatically treated as a confirmed breach. Scope patients carefully, record the legal assessment, and use authorised approval before sending or closing.")}</p>
    <div className="incident-kpis">
      <div><span>{t("Severity")}</span><strong className={`severity-${incident.severity}`}>{t(incident.severity)}</strong></div>
      <div><span>{t("Affected clinics")}</span><strong>{affectedClinics.length}</strong></div>
      <div><span>{t("Confirmed patients")}</span><strong>{data.affectedPatientCount}</strong></div>
      <div><span>{t("Response countdown")}</span><strong className={countdown < 0 ? "countdown-overdue" : ""}>{remaining(countdown)}</strong></div>
    </div>
    <div className="privacy-history">
      <article className="privacy-request"><div><strong><BellRing size={16}/> {t("Operator alert")}</strong><span className="privacy-status">{t(incident.securityAlert?.status || "pending")}</span></div><p>{t("Last attempt")}: {local(incident.securityAlert?.lastAttemptAt)}</p><form className="incident-inline" onSubmit={event => { event.preventDefault(); act("alert", () => platformApi.post(`/privacy/admin/operations/incidents/${incidentId}/alert`, { password: event.currentTarget.password.value }), "Security contact alert processed."); }}><input name="password" required type="password" placeholder={t("Fresh platform password")}/><button className="ghost" disabled={!!busy}>{t("Retry alert")}</button></form></article>
      <article className="privacy-request"><div><strong><FileLock2 size={16}/> {t("Evidence preservation")}</strong><span className="privacy-status">{t(incident.evidenceLock?.locked ? "Locked" : "Not locked")}</span></div>{incident.evidenceLock?.locked ? <p>{t("Locked")} {local(incident.evidenceLock.lockedAt)} · SHA-256: <code>{incident.evidenceLock.manifestHash}</code></p> : <form className="privacy-form compact" onSubmit={event => { event.preventDefault(); act("lock", () => platformApi.post(`/privacy/admin/operations/incidents/${incidentId}/evidence-lock`, lock), "Immutable evidence snapshot preserved."); }}><label>{t("Preservation reason")}<textarea required minLength={20} value={lock.reason} onChange={event => setLock({ ...lock, reason: event.target.value })}/></label><label>{t("Fresh platform password")}<input required type="password" value={lock.password} onChange={event => setLock({ ...lock, password: event.target.value })}/></label><button className="primary" disabled={!!busy}>{t("Lock evidence snapshot")}</button></form>}</article>
    </div>

    <h3><Users size={17}/> {t("Affected clinics and patients")}</h3>
    <p>{affectedClinics.length ? affectedClinics.map(clinic => clinic.name).join(", ") : t("No affected clinic selected. Add clinics while creating/editing the incident before adding patients.")}</p>
    <form className="privacy-form" onSubmit={event => { event.preventDefault(); act("affected", () => platformApi.post(`/privacy/admin/operations/incidents/${incidentId}/affected-patients`, { tenantId: affected.tenantId, patientIds, evidenceReference: affected.evidenceReference }), "Confirmed affected-patient scope updated."); }}>
      <label>{t("Affected clinic")}<select required value={affected.tenantId} onChange={event => setAffected({ ...affected, tenantId: event.target.value })}><option value="">{t("Select clinic")}</option>{clinics.filter(clinic => affectedClinics.some(item => String(item._id) === String(clinic._id))).map(clinic => <option key={clinic._id} value={clinic._id}>{clinic.name}</option>)}</select></label>
      <label>{t("Clinic patient IDs")}<textarea required rows={3} value={affected.patientIds} onChange={event => setAffected({ ...affected, patientIds: event.target.value })} placeholder={t("Paste Mongo patient IDs separated by comma, space or new line")}/></label>
      <label>{t("Scoping evidence reference")}<input required minLength={5} value={affected.evidenceReference} onChange={event => setAffected({ ...affected, evidenceReference: event.target.value })}/></label>
      <button className="primary" disabled={!!busy || !patientIds.length}>{t("Add verified affected patients")}</button>
    </form>

    <h3>{t("Patient notification template")}</h3>
    <form className="privacy-form" onSubmit={event => { event.preventDefault(); act("template", () => platformApi.put(`/privacy/admin/operations/incidents/${incidentId}/patient-template`, template), "Bilingual patient notice template saved."); }}>
      <label>{t("English subject")}<input required minLength={10} value={template.subjectEn} onChange={event => setTemplate({ ...template, subjectEn: event.target.value })}/></label><label>{t("English notice")}<textarea required minLength={40} rows={4} value={template.messageEn} onChange={event => setTemplate({ ...template, messageEn: event.target.value })}/></label>
      <label>{t("Hindi subject")}<input required minLength={10} value={template.subjectHi} onChange={event => setTemplate({ ...template, subjectHi: event.target.value })}/></label><label>{t("Hindi notice")}<textarea required minLength={40} rows={4} value={template.messageHi} onChange={event => setTemplate({ ...template, messageHi: event.target.value })}/></label>
      <label>{t("Fresh platform password")}<input required type="password" value={template.password} onChange={event => setTemplate({ ...template, password: event.target.value })}/></label><button className="ghost" disabled={!!busy}>{t("Save reviewed template")}</button>
    </form>

    <div className="incident-delivery"><p><strong>{t("Delivery tracking")}:</strong> {data.delivery.inAppDelivered}/{data.delivery.total} {t("in-app")} · {data.delivery.emailSent}/{data.delivery.total} {t("email accepted")} · {data.delivery.failed} {t("failed")}</p>
      <form className="incident-inline" onSubmit={event => { event.preventDefault(); act("send", () => platformApi.post(`/privacy/admin/operations/incidents/${incidentId}/patient-notifications/send`, send), "Patient notification batch processed; delivery evidence updated."); }}><select value={send.language} onChange={event => setSend({ ...send, language: event.target.value })}><option value="en">English</option><option value="hi">हिन्दी</option></select><input required type="password" placeholder={t("Fresh platform password")} value={send.password} onChange={event => setSend({ ...send, password: event.target.value })}/><button className="primary" disabled={!!busy || !data.affectedPatientCount}><Send size={15}/> {t("Send to confirmed patients")}</button></form>
    </div>
    <div className="privacy-actions"><button className="ghost" type="button" disabled={!!busy} onClick={() => load().catch(requestError => setError(messageOf(requestError)))}><RefreshCw size={15}/> {t("Refresh")}</button><button className="ghost" type="button" disabled={!!busy} onClick={downloadPackage}><Download size={15}/> {t("CERT-In draft package")}</button></div>

    <h3>{t("Incident closure approval")}</h3><p className="muted">{t("First platform administrator requests closure; a different active platform administrator must independently approve it.")}</p>
    <form className="privacy-form" onSubmit={event => { event.preventDefault(); const endpoint = incident.closure?.requestedBy ? "closure-approve" : "closure-request"; const payload = incident.closure?.requestedBy ? closure : { note: closure.note, password: closure.password }; act("closure", () => platformApi.post(`/privacy/admin/operations/incidents/${incidentId}/${endpoint}`, payload), incident.closure?.requestedBy ? "Incident independently approved and closed." : "Closure request recorded; independent approval is pending."); }}>
      <label>{t(incident.closure?.requestedBy ? "Independent approval note" : "Closure request note")}<textarea required minLength={20} rows={3} value={closure.note} onChange={event => setClosure({ ...closure, note: event.target.value })}/></label>
      {incident.closure?.requestedBy && <label>{t("Closure evidence reference")}<input required minLength={5} value={closure.evidenceReference} onChange={event => setClosure({ ...closure, evidenceReference: event.target.value })}/></label>}
      <label>{t("Fresh platform password")}<input required type="password" value={closure.password} onChange={event => setClosure({ ...closure, password: event.target.value })}/></label><button className="primary" disabled={!!busy || incident.status === "closed"}>{t(incident.status === "closed" ? "Incident closed" : incident.closure?.requestedBy ? "Approve and close" : "Request closure")}</button>
    </form>
    {error && <p className="login-error" role="alert"><AlertTriangle size={15}/> {t(error)}</p>}{message && <p className="success" role="status">{t(message)}</p>}
  </section>;
}
