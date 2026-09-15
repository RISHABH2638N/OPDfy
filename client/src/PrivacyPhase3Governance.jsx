import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { platformApi } from "./api";
import { useLanguage } from "./LanguageContext.jsx";
import "./privacy-center.css";

const messageOf = error => error.response?.data?.message || "Request failed.";
const tabs = [["retention", "Retention registry"], ["incidents", "Incident register"], ["corrections", "Global corrections"]];
const policyFields = [
  ["category", "Data category"], ["version", "Policy version"], ["legalBasis", "Legal basis"],
  ["retentionRule", "Retention rule"], ["trigger", "Retention trigger"],
  ["backupRule", "Backup retention rule"], ["evidenceReference", "Evidence reference"],
];

export default function PrivacyPhase3Governance() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language, t } = useLanguage();
  const requestedTab = searchParams.get("tab");
  const initialTab = ["retention", "incidents", "corrections"].includes(requestedTab) ? requestedTab : "retention";
  const [approvalId, setApprovalId] = useState(null);
  const [approvalPassword, setApprovalPassword] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [policy, setPolicy] = useState({ scope: "platform", tenantId: "", category: "", version: "", legalBasis: "", retentionRule: "", trigger: "", backupRule: "", evidenceReference: "" });
  const [incident, setIncident] = useState({ title: "", description: "", category: "suspected_data_breach", severity: "medium", responseHours: 12, tenantIds: [], detectedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), estimatedAffectedCount: "" });

  const localDate = value => new Date(value).toLocaleString(language === "hi" ? "hi-IN" : "en-IN");
  const load = async () => {
    const { data } = await platformApi.get(`/privacy/admin/${tab}`);
    setRows(data.policies || data.incidents || data.requests || []);
  };

  useEffect(() => { setSelected(null); load().catch(error => setError(messageOf(error))); }, [tab]);
  useEffect(() => { platformApi.get("/platform/clinics").then(({ data }) => setClinics(data.clinics || [])).catch(error => setError(messageOf(error))); }, []);

  const create = async (event, type) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const payload = type === "retention"
        ? { ...policy, tenantId: policy.scope === "clinic" ? policy.tenantId : null }
        : { ...incident, detectedAt: new Date(incident.detectedAt).toISOString(), estimatedAffectedCount: incident.estimatedAffectedCount === "" ? null : Number(incident.estimatedAffectedCount) };
      await platformApi.post(`/privacy/admin/${type}`, payload);
      setMessage("Draft/case created."); await load();
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  };

  const approve = async event => {
    event.preventDefault(); if (!approvalId || !approvalPassword) return;
    setBusy(true); setError("");
    try {
      await platformApi.post(`/privacy/admin/retention/${approvalId}/approve`, { password: approvalPassword });
      setMessage("Policy approval recorded. Automatic deletion remains disabled."); setApprovalId(null); await load();
    } catch (error) { setError(messageOf(error)); } finally { setApprovalPassword(""); setBusy(false); }
  };

  const open = async item => {
    setError("");
    try {
      if (tab === "incidents") {
        const { data } = await platformApi.get(`/privacy/admin/incidents/${item._id}`); setSelected(data.incident);
      } else if (tab === "corrections") {
        const { data } = await platformApi.get(`/privacy/admin/corrections/${item.id}`); setSelected(data.request);
      } else setSelected(item);
      setDraft({});
    } catch (error) { setError(messageOf(error)); }
  };

  const update = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (tab === "incidents") await platformApi.post(`/privacy/admin/incidents/${selected._id}/events`, draft);
      else await platformApi.post(`/privacy/admin/corrections/${selected.id}/resolve`, draft);
      setMessage("Review/action recorded."); setSelected(null); setDraft({}); await load();
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  };
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));

  return <main className="page premium-page privacy-center platform-governance-workspace">
    <div className="head">
      <div><p className="eyebrow">{t("PLATFORM · GOVERNANCE")}</p><h1>{t("Privacy governance")}</h1><p className="page-subtitle">{t("Retention policy approvals, incident evidence and global-profile corrections.")}</p></div>
      <button className="ghost" onClick={() => navigate("/platform/privacy")}><ArrowLeft size={16}/> {t("Privacy requests")}</button>
    </div>
    <section className="card governance-console">
      <div className="privacy-actions privacy-governance-tabs" style={{ justifyContent: "flex-start" }}>
        {tabs.map(([value, label]) => <button type="button" key={value} className={tab === value ? "primary" : "ghost"} onClick={() => setTab(value)}>{t(label)}</button>)}
        <button className="ghost" onClick={() => load().catch(error => setError(messageOf(error)))}><RefreshCw size={15}/> {t("Refresh")}</button>
      </div>
      <button type="button" className="ghost privacy-operations-link" onClick={() => navigate("/platform/privacy/operations")}>{t("Operational readiness & notification evidence")}</button>
      <p className="muted governance-disclaimer">{t("This register does not establish legal compliance, send statutory notices, approve medical edits or activate deletion jobs. Legal counsel and the responsible clinics must review the actual obligations.")}</p>

      {tab === "retention" && <form className="privacy-form governance-form" onSubmit={event => create(event, "retention")}>
        <h3>{t("New retention policy draft")}</h3>
        <label>{t("Scope")}<select value={policy.scope} onChange={event => setPolicy({ ...policy, scope: event.target.value })}><option value="platform">{t("Platform")}</option><option value="clinic">{t("Clinic")}</option></select></label>
        {policy.scope === "clinic" && <label>{t("Clinic ID")}<input required value={policy.tenantId} onChange={event => setPolicy({ ...policy, tenantId: event.target.value })}/></label>}
        {policyFields.map(([key, label]) => <label key={key}>{t(label)}<textarea required rows={key === "legalBasis" || key === "retentionRule" ? 3 : 1} maxLength={key === "legalBasis" || key === "retentionRule" ? 2000 : 1000} value={policy[key]} onChange={event => setPolicy({ ...policy, [key]: event.target.value })}/></label>)}
        <button className="primary" disabled={busy}>{t("Create draft")}</button>
      </form>}

      {tab === "incidents" && <form className="privacy-form governance-form" onSubmit={event => create(event, "incidents")}>
        <h3>{t("Open incident case")}</h3>
        <label>{t("Title")}<input required minLength={5} maxLength={180} value={incident.title} onChange={event => setIncident({ ...incident, title: event.target.value })}/></label>
        <label>{t("Category")}<select value={incident.category} onChange={event => setIncident({ ...incident, category: event.target.value })}>{["suspected_data_breach", "confirmed_data_breach", "security_event", "privacy_complaint"].map(value => <option key={value} value={value}>{t(value.replaceAll("_", " "))}</option>)}</select></label>
        <label>{t("Severity")}<select value={incident.severity} onChange={event => setIncident({ ...incident, severity: event.target.value, responseHours: { low: 24, medium: 12, high: 6, critical: 6 }[event.target.value] })}>{["low", "medium", "high", "critical"].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t("Response countdown (hours)")}<input type="number" min="1" max="168" required value={incident.responseHours} onChange={event => setIncident({ ...incident, responseHours: Number(event.target.value) })}/></label>
        <fieldset className="incident-clinic-picker"><legend>{t("Affected clinics")}</legend>{clinics.map(clinic => <label key={clinic._id}><input type="checkbox" checked={incident.tenantIds.includes(clinic._id)} onChange={event => setIncident({ ...incident, tenantIds: event.target.checked ? [...incident.tenantIds, clinic._id] : incident.tenantIds.filter(id => id !== clinic._id) })}/>{clinic.name}</label>)}</fieldset>
        <label>{t("Detected at")}<input type="datetime-local" required value={incident.detectedAt} onChange={event => setIncident({ ...incident, detectedAt: event.target.value })}/></label>
        <label>{t("Estimated affected people (optional)")}<input type="number" min="0" max="1000000000" value={incident.estimatedAffectedCount} onChange={event => setIncident({ ...incident, estimatedAffectedCount: event.target.value })}/></label>
        <label>{t("Initial facts")}<textarea required minLength={20} maxLength={2000} rows={3} value={incident.description} onChange={event => setIncident({ ...incident, description: event.target.value })} placeholder={t("Avoid unnecessary patient identifiers or medical details.")}/></label>
        <button className="primary" disabled={busy}>{t("Open incident and alert security contact")}</button>
      </form>}

      <div className="privacy-history governance-records">{rows.map(item => <article className="privacy-request" key={item._id || item.id}>
        <strong>{item.title || item.category || item.field}</strong>
        <p>{t(item.status)}{item.severity ? ` · ${t(item.severity)} ${t("severity")}` : ""} · {item.version || item.id || item._id}</p>
        {item.responseDueAt && <small>{t("Response due")}: {localDate(item.responseDueAt)} · {item.confirmedAffectedCount || 0} {t("confirmed affected patient(s)")}</small>}
        {item.retentionRule && <p>{item.retentionRule}</p>}
        {tab === "retention" && item.status === "draft"
          ? <button className="ghost" disabled={busy} onClick={() => { setApprovalId(item._id); setApprovalPassword(""); }}>{t("Approve with password")}</button>
          : tab !== "retention" && <button className="ghost" onClick={() => open(item)}>{t("Review")}</button>}
      </article>)}</div>

      {approvalId && tab === "retention" && <form className="privacy-form governance-form" onSubmit={approve}>
        <h3>{t("Approve retention policy")}</h3><p className="muted">{t("Confirm the legal review and enter your platform password. Approval does not activate automatic deletion.")}</p>
        <label>{t("Platform password")}<input type="password" autoComplete="current-password" required value={approvalPassword} onChange={event => setApprovalPassword(event.target.value)}/></label>
        <div className="privacy-actions"><button type="button" className="ghost" onClick={() => { setApprovalId(null); setApprovalPassword(""); }}>{t("Cancel")}</button><button className="primary" disabled={busy || !approvalPassword}>{t("Record approval")}</button></div>
      </form>}

      {selected && <form className="privacy-form governance-form" onSubmit={update}>
        <h3>{tab === "incidents" ? selected.title : t("Global correction review")}</h3>
        {tab === "incidents" ? <>
          <label>{t("Action")}<select required value={draft.kind || ""} onChange={event => change("kind", event.target.value)}><option value="">{t("Select...")}</option>{["triage", "containment", "notification_review", "reopened"].map(value => <option key={value} value={value}>{t(value.replaceAll("_", " "))}</option>)}</select></label>
          {draft.kind === "notification_review" && <label>{t("Legal notification decision")}<select required value={draft.notificationDecision || ""} onChange={event => change("notificationDecision", event.target.value)}><option value="">{t("Select...")}</option><option value="required">{t("Notification required")}</option><option value="not_required">{t("Not required after documented review")}</option></select></label>}
          <p className="muted">{t("Actual patient sending, CERT-In package and independent closure approval are available in Operational readiness.")}</p>
        </> : <>
          <p>{selected.correction?.field}</p><p>{t("Requested value")}: {selected.correction?.proposedValue}</p><p>{selected.correction?.reason}</p>
          <label>{t("Decision")}<select required value={draft.decision || ""} onChange={event => change("decision", event.target.value)}><option value="">{t("Select...")}</option><option value="corrected">{t("Correction completed in authorized profile")}</option><option value="no_change">{t("No change required")}</option><option value="rejected">{t("Reject")}</option></select></label>
        </>}
        <label>{t("Evidence reference")}<input required={tab === "corrections" || ["notification_recorded", "closed"].includes(draft.kind)} maxLength={240} value={draft.evidenceReference || ""} onChange={event => change("evidenceReference", event.target.value)}/></label>
        <label>{t("Documented note")}<textarea required minLength={20} maxLength={2000} rows={3} value={(draft.note ?? draft.resolution) || ""} onChange={event => change(tab === "incidents" ? "note" : "resolution", event.target.value)}/></label>
        <div className="privacy-actions"><button type="button" className="ghost" onClick={() => setSelected(null)}>{t("Cancel")}</button><button className="primary" disabled={busy}>{t("Record action")}</button></div>
      </form>}
      {error && <p className="login-error" role="alert">{t(error)}</p>}{message && <p className="success" role="status">{t(message)}</p>}
    </section>
  </main>;
}
