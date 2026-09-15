import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { platformApi } from "./api";
import "./privacy-center.css";
import IncidentResponsePanel from "./IncidentResponsePanel";
import BackupRecoveryPanel from "./BackupRecoveryPanel";
import { useLanguage } from "./LanguageContext.jsx";

const CHECKS = [
  ["backup_restore", "Backup restore"], ["database_integrity", "Database integrity"],
  ["access_review", "Access review"], ["dependency_review", "Dependency review"],
  ["incident_drill", "Incident response drill"], ["clinical_regression", "Clinical regression"],
  ["privacy_rights", "Privacy rights"], ["legal_signoff", "Legal sign-off"],
  ["vendor_review", "Vendor review"], ["monitoring", "Monitoring"],
];
const messageOf = error => error.response?.data?.message || "Request failed. Please try again.";
const toIso = value => value ? new Date(value).toISOString() : null;
const initialReview = { key: "backup_restore", status: "passed", note: "", evidenceReference: "", expiresAt: "", password: "" };
const initialNotice = { audience: "board", status: "required", dueAt: "", deliveredAt: "", evidenceReference: "", legalBasis: "", note: "", password: "" };

export default function PrivacyPhase4Operations() {
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const [tab, setTab] = useState("readiness");
  const [snapshot, setSnapshot] = useState(null);
  const [checks, setChecks] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [notices, setNotices] = useState(null);
  const [review, setReview] = useState(initialReview);
  const [notice, setNotice] = useState(initialNotice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const asLocal = date => date ? new Date(date).toLocaleString(language === "hi" ? "hi-IN" : "en-IN") : t("Not recorded");

  const load = async () => {
    const [{ data: overview }, { data: history }, { data: cases }] = await Promise.all([
      platformApi.get("/privacy/admin/operations/readiness"),
      platformApi.get("/privacy/admin/operations/readiness/checks"),
      platformApi.get("/privacy/admin/incidents"),
    ]);
    setSnapshot(overview); setChecks(history.records || []); setIncidents(cases.incidents || []);
  };
  useEffect(() => { load().catch(requestError => setError(messageOf(requestError))); }, []);

  const submitReview = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await platformApi.post("/privacy/admin/operations/readiness/checks", { ...review, expiresAt: toIso(review.expiresAt) });
      setReview(initialReview); setMessage("Review evidence recorded. This does not certify production compliance."); await load();
    } catch (requestError) { setError(messageOf(requestError)); } finally { setReview(value => ({ ...value, password: "" })); setBusy(false); }
  };

  const openIncident = async item => {
    setBusy(true); setError(""); setNotices(null); setNotice(initialNotice);
    try {
      const { data } = await platformApi.get(`/privacy/admin/operations/incidents/${item._id}/notifications`);
      setSelected(item); setNotices(data); setTab("notifications");
    } catch (requestError) { setError(messageOf(requestError)); } finally { setBusy(false); }
  };

  const submitNotice = async event => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await platformApi.post(`/privacy/admin/operations/incidents/${selected._id}/notifications`, { ...notice, dueAt: toIso(notice.dueAt), deliveredAt: toIso(notice.deliveredAt) });
      setNotice(initialNotice); setMessage("Audience-specific legal assessment recorded. No notification was sent by this form.");
      await openIncident(selected); await load();
    } catch (requestError) { setError(messageOf(requestError)); } finally { setNotice(value => ({ ...value, password: "" })); setBusy(false); }
  };
  const changeReview = (key, value) => setReview(current => ({ ...current, [key]: value }));
  const changeNotice = (key, value) => setNotice(current => ({ ...current, [key]: value }));

  return <main className="page premium-page privacy-center platform-operations-workspace">
    <div className="head"><div><p className="eyebrow">{t("PLATFORM · OPERATIONS")}</p><h1>{t("Operational readiness & notification evidence")}</h1><p className="page-subtitle">{t("Evidence, restore exercises, maintenance health and incident notification tracking.")}</p></div>
      <button type="button" className="ghost" onClick={() => navigate("/platform/privacy/governance")}><ArrowLeft size={16}/> {t("Governance")}</button></div>

    <section className="card operations-overview-card">
      <div className="card-title"><ShieldCheck/><h2>{t("Release readiness")}</h2></div>
      <p className="muted">{t("Readiness is evidence-based, not a legal certification. Every required review must be current. Actual production tests and legal approval remain separate obligations.")}</p>
      {snapshot && <><p><strong>{t(snapshot.readiness.ready ? "Evidence checks current" : "Review required")}</strong> · {snapshot.openIncidentCount} {t("open incident(s)")} · {snapshot.overdueNotificationCount} {t("overdue notification assessment(s)")}</p>
        <p className="muted">{t("Automatic erasure: disabled. Production certification: not established.")}</p>
        <div className="privacy-history">{(snapshot.maintenance || []).map(job => <div className="privacy-request" key={job.key}><strong>{t(job.key.replaceAll("_", " "))}</strong><span className="privacy-status">{t(job.stale ? "Stale / unverified" : job.lastOutcome)}</span><small>{t("Last success")}: {asLocal(job.lastSuccessAt)}</small>{job.failureCode && <p className="muted">{t("Diagnostic")}: {job.failureCode}</p>}</div>)}</div>
      </>}
      <div className="privacy-actions operations-tabs" style={{ justifyContent: "flex-start" }}>
        <button type="button" className={tab === "readiness" ? "primary" : "ghost"} onClick={() => setTab("readiness")}>{t("Review checks")}</button>
        <button type="button" className={tab === "notifications" ? "primary" : "ghost"} onClick={() => setTab("notifications")}>{t("Incident notifications")}</button>
        <button type="button" className={tab === "backups" ? "primary" : "ghost"} onClick={() => setTab("backups")}>{t("Backup & recovery")}</button>
        <button type="button" className="ghost" onClick={() => load().catch(requestError => setError(messageOf(requestError)))}><RefreshCw size={15}/> {t("Refresh")}</button>
      </div>
    </section>

    {error && <p className="login-error" role="alert">{t(error)}</p>}{message && <p className="success" role="status">{t(message)}</p>}
    {tab === "backups" && <BackupRecoveryPanel/>}

    {tab === "readiness" && <section className="card operations-section-card">
      <h2>{t("Evidence checklist")}</h2>
      <div className="privacy-history">{(snapshot?.readiness.checks || []).map(item => <article className="privacy-request" key={item.key}>
        <strong>{t(CHECKS.find(check => check[0] === item.key)?.[1] || item.key)}</strong>
        <span className="privacy-status">{t(item.ready ? "Current" : item.status === "passed" ? "Expired" : item.status)}</span>
        <small>{t("Reviewed")}: {asLocal(item.reviewedAt)} · {t("Expires")}: {asLocal(item.expiresAt)}</small>
        {checks.find(check => check.key === item.key)?.events?.length > 0 && <p className="muted">{t("Latest evidence")}: {checks.find(check => check.key === item.key).events.at(-1).evidenceReference}</p>}
      </article>)}</div>
      <form className="privacy-form governance-form" onSubmit={submitReview}><h3>{t("Record an actual review")}</h3>
        <label>{t("Check")}<select value={review.key} onChange={event => changeReview("key", event.target.value)}>{CHECKS.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
        <label>{t("Result")}<select value={review.status} onChange={event => changeReview("status", event.target.value)}><option value="passed">{t("Passed")}</option><option value="failed">{t("Failed")}</option><option value="waived">{t("Waived (not ready)")}</option></select></label>
        <label>{t("Evidence reference")}<input required minLength={5} maxLength={240} value={review.evidenceReference} onChange={event => changeReview("evidenceReference", event.target.value)} placeholder={t("Internal report or approved evidence reference")}/></label>
        <label>{t("Review note")}<textarea required minLength={20} maxLength={2000} rows={3} value={review.note} onChange={event => changeReview("note", event.target.value)} placeholder={t("Describe the work actually completed. Do not enter credentials or patient details.")}/></label>
        {review.status === "passed" && <label>{t("Review expires")}<input required type="datetime-local" value={review.expiresAt} onChange={event => changeReview("expiresAt", event.target.value)}/></label>}
        <label>{t("Fresh platform password")}<input required type="password" autoComplete="current-password" value={review.password} onChange={event => changeReview("password", event.target.value)}/></label>
        <button className="primary" disabled={busy}>{t("Save evidence review")}</button>
      </form>
    </section>}

    {tab === "notifications" && <section className="card operations-section-card">
      <div className="card-title"><AlertTriangle/><h2>{t("Notification assessments")}</h2></div>
      <p className="muted">{t("The responsible legal reviewer determines applicable duties and deadlines. This register does not send notices, calculate universal legal deadlines, or replace statutory reporting.")}</p>
      <div className="privacy-history">{incidents.map(item => <article className="privacy-request" key={item._id}><strong>{item.title}</strong><p>{t(item.category.replaceAll("_", " "))} · {t(item.status)}</p><button type="button" className="ghost" onClick={() => openIncident(item)}>{t("Review audiences")}</button></article>)}</div>
      {selected && <><h3>{selected.title}</h3><p className="muted">{t("Incident reference")}: {selected._id}. {t("Board and affected-individual decisions are tracked independently.")}</p>
        {notices && <div className="privacy-history">{["board", "affected_individuals", "other_authority"].map(audience => { const item = notices.records.find(record => record.audience === audience); return <article className="privacy-request" key={audience}><strong>{t(audience.replaceAll("_", " "))}</strong><span className="privacy-status">{t(item?.status || "Pending")}</span>{item && <><p>{t("Due")}: {asLocal(item.dueAt)} · {t("Delivered")}: {asLocal(item.deliveredAt)}</p><small>{t("Evidence")}: {item.evidenceReference}</small><p className="muted">{item.legalBasis}</p></>}</article>; })}</div>}
        <form className="privacy-form governance-form" onSubmit={submitNotice}><h3>{t("Record legal assessment or actual delivery")}</h3>
          <label>{t("Audience")}<select value={notice.audience} onChange={event => changeNotice("audience", event.target.value)}><option value="board">{t("Data Protection Board")}</option><option value="affected_individuals">{t("Affected individuals")}</option><option value="other_authority">{t("Other authority")}</option></select></label>
          <label>{t("Status")}<select value={notice.status} onChange={event => changeNotice("status", event.target.value)}><option value="required">{t("Required")}</option><option value="not_required">{t("Not required after legal review")}</option><option value="delivered">{t("Actually delivered")}</option><option value="failed">{t("Delivery failed")}</option></select></label>
          {["required", "failed"].includes(notice.status) && <label>{t("Legally assessed deadline")}<input required type="datetime-local" value={notice.dueAt} onChange={event => changeNotice("dueAt", event.target.value)}/></label>}
          {notice.status === "delivered" && <label>{t("Actual delivery time")}<input required type="datetime-local" value={notice.deliveredAt} onChange={event => changeNotice("deliveredAt", event.target.value)}/></label>}
          <label>{t("Legal basis / assessment")}<textarea required minLength={20} maxLength={2000} rows={3} value={notice.legalBasis} onChange={event => changeNotice("legalBasis", event.target.value)}/></label>
          <label>{t("Evidence reference")}<input required minLength={5} maxLength={240} value={notice.evidenceReference} onChange={event => changeNotice("evidenceReference", event.target.value)}/></label>
          <label>{t("Review note")}<textarea required minLength={20} maxLength={2000} rows={3} value={notice.note} onChange={event => changeNotice("note", event.target.value)}/></label>
          <label>{t("Fresh platform password")}<input required type="password" autoComplete="current-password" value={notice.password} onChange={event => changeNotice("password", event.target.value)}/></label>
          <button className="primary" disabled={busy}>{t("Record notification assessment")}</button>
        </form>
        <IncidentResponsePanel incidentId={selected._id} onChanged={load}/>
      </>}
    </section>}
  </main>;
}
