import PrivacyClosureAdminPanel from "./PrivacyClosureAdminPanel";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Archive, CheckCircle2, Clock3, FileSearch, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { platformApi } from "./api";
import { useLanguage } from "./LanguageContext.jsx";
import "./privacy-center.css";

const labels = {
  access: "Data access", correction: "Correction", erasure: "Erasure / closure",
  withdrawal: "Consent withdrawal", grievance: "Grievance", identity_review: "Identity review", nomination: "Nomination",
};
const statuses = ["pending", "in_review", "fulfilled", "rejected"];
const requestTypes = Object.keys(labels);

export default function PlatformPrivacyRequests() {
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const { data } = await platformApi.get("/privacy/admin/requests", { params: status ? { status } : {} });
      setRequests(data.requests || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load().catch(() => setError("Unable to load privacy requests.")); }, [status]);

  const update = async item => {
    const draft = drafts[item.id] || {};
    setError(""); setMessage(""); setBusy(item.id);
    try {
      const { data } = await platformApi.patch(`/privacy/admin/requests/${item.id}`, draft);
      setMessage(t("Request {id} updated.", { id: data.request.id }));
      await load();
    } catch (e) { setError(e.response?.data?.message || "Unable to update request."); }
    finally { setBusy(""); }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return requests.filter(item => {
      if (type && item.type !== type) return false;
      if (!needle) return true;
      return [item.id, item.type, item.status, item.patient?.name, item.patient?.email, item.clinicSlug, item.details]
        .some(value => String(value || "").toLowerCase().includes(needle));
    });
  }, [requests, query, type]);
  const count = value => requests.filter(item => item.status === value).length;
  const date = value => new Date(value).toLocaleString(language === "hi" ? "hi-IN" : "en-IN");
  const clearFilters = () => { setStatus(""); setType(""); setQuery(""); };

  const workspaces = [
    { title: "Retention registry", note: "Retention drafts, approvals and evidence", icon: <Archive/>, to: "/platform/privacy/governance?tab=retention" },
    { title: "Incident register", note: "Privacy incidents, severity and response", icon: <ShieldAlert/>, to: "/platform/privacy/governance?tab=incidents" },
    { title: "Global corrections", note: "Review verified global-profile corrections", icon: <FileSearch/>, to: "/platform/privacy/governance?tab=corrections" },
    { title: "Operational readiness & notification evidence", note: "Readiness reviews, notifications, backups and drills", icon: <Activity/>, to: "/platform/privacy/operations" },
  ];

  return <main className="page premium-page privacy-center platform-privacy-workspace">
    <div className="head privacy-workspace-head">
      <div><p className="eyebrow">{t("PLATFORM · PRIVACY")}</p><h1>{t("Privacy Request Review")}</h1>
        <p className="page-subtitle">{t("Verified patient requests. Coordinate clinical-record decisions with the responsible clinic.")}</p></div>
      <button className="ghost" onClick={() => load().catch(() => setError("Unable to refresh requests."))} disabled={loading}><RefreshCw size={16}/> {t("Refresh")}</button>
    </div>

    <section className="privacy-workspace-links" aria-label={t("Privacy administration workspaces")}>
      {workspaces.map(item => <button type="button" key={item.title} onClick={() => navigate(item.to)}>
        <span className="privacy-workspace-icon">{item.icon}</span><span><strong>{t(item.title)}</strong><small>{t(item.note)}</small></span>
      </button>)}
    </section>

    <section className="privacy-summary-grid" aria-label={t("Request summary")}>
      <div><ShieldCheck/><span>{t("Loaded requests")}</span><strong>{requests.length}</strong></div>
      <div><Clock3/><span>{t("Pending")}</span><strong>{count("pending")}</strong></div>
      <div><FileSearch/><span>{t("In review")}</span><strong>{count("in_review")}</strong></div>
      <div><CheckCircle2/><span>{t("Completed")}</span><strong>{count("fulfilled") + count("rejected")}</strong></div>
    </section>

    <section className="card privacy-review-queue">
      <div className="privacy-section-heading"><div className="card-title"><ShieldCheck/><div><h2>{t("Review queue")}</h2><p>{t("Filter, find and review verified patient privacy requests.")}</p></div></div></div>
      <div className="privacy-guidance"><ShieldAlert size={18}/><p>{t("Updating a case does not delete records, revoke consent, or close an account automatically. Confirm the actual outcome and lawful retention basis before marking a request fulfilled.")}</p></div>

      <div className="privacy-filter-bar">
        <label className="privacy-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Search request ID, patient, clinic or details")}/></label>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label={t("Filter request status")}>
          <option value="">{t("All statuses")}</option>{statuses.map(value => <option key={value} value={value}>{t(value.replace("_", " "))}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} aria-label={t("Filter request type")}>
          <option value="">{t("All request types")}</option>{requestTypes.map(value => <option key={value} value={value}>{t(labels[value])}</option>)}
        </select>
        {(status || type || query) && <button type="button" className="ghost" onClick={clearFilters}>{t("Clear filters")}</button>}
      </div>

      {error && <p className="login-error" role="alert">{t(error)}</p>}
      {message && <p className="success" role="status">{message}</p>}
      {loading ? <div className="privacy-empty-state"><RefreshCw className="spin"/><strong>{t("Loading privacy requests…")}</strong></div> : <div className="privacy-history privacy-request-list">
        {visible.map(item => <article className="privacy-request privacy-review-card" key={item.id}>
          <div className="privacy-review-card-head"><div><span className="privacy-type-label">{t(labels[item.type] || item.type)}</span><strong>{item.patient?.name || t("Patient")}</strong></div><span className={`privacy-status status-${item.status}`}>{t(item.status.replace("_", " "))}</span></div>
          <div className="privacy-request-meta"><span>{date(item.createdAt)}</span><span>{item.id}</span>{item.clinicSlug && <span>{t("Clinic")}: {item.clinicSlug}</span>}</div>
          <p className="privacy-email">{item.patient?.email || t("Account unavailable")}</p>
          <div className="privacy-request-details"><span>{t("Patient request")}</span><p>{item.details}</p></div>
          {item.resolution && <div className="privacy-resolution"><span>{t("Review note")}</span><p>{item.resolution}</p></div>}
          {["pending", "in_review"].includes(item.status) && <div className="privacy-form privacy-review-form">
            <label>{t("Decision")}<select value={drafts[item.id]?.status || ""} onChange={e => setDrafts(prev => ({ ...prev, [item.id]: { ...prev[item.id], status: e.target.value } }))} aria-label={t("Review decision")}>
              <option value="">{t("Choose decision")}</option><option value="in_review">{t("In review")}</option>{!["erasure", "identity_review"].includes(item.type) && <option value="fulfilled">{t("Fulfilled")}</option>}<option value="rejected">{t("Rejected")}</option>
            </select></label>
            <label>{t("Documented review outcome")}<textarea rows={3} maxLength={2000} value={drafts[item.id]?.resolution || ""} onChange={e => setDrafts(prev => ({ ...prev, [item.id]: { ...prev[item.id], resolution: e.target.value } }))} placeholder={t("Document the actual review outcome; do not include unnecessary clinical details.")}/></label>
            <div className="privacy-actions"><button className="primary" disabled={busy === item.id || !drafts[item.id]?.status || (drafts[item.id]?.resolution || "").trim().length < 10} onClick={() => update(item)}>{busy === item.id ? t("Saving…") : t("Save review")}</button></div>
          </div>}
          {item.type === "erasure" && <PrivacyClosureAdminPanel requestId={item.id} onComplete={load}/>} 
        </article>)}
        {!visible.length && <div className="privacy-empty-state"><FileSearch/><strong>{t("No requests match these filters.")}</strong><span>{t("Clear the filters or refresh the request queue.")}</span></div>}
      </div>}
    </section>
  </main>;
}
