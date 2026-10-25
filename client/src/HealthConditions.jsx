import React, { useEffect, useState } from "react";
import { Activity, CheckCircle, Download, RefreshCw, X } from "lucide-react";
import { api } from "./api";
import { useLanguage } from "./LanguageContext";
import "./health-conditions.css";

const statusLabel = { pending: "Patient-reported / Pending review", confirmed: "Doctor confirmed", not_confirmed: "Not confirmed" };

export default function HealthConditions({ tokenId }) {
  const { t, language } = useLanguage();
  const doctor = Boolean(tokenId);
  const endpoint = doctor ? `/tokens/${tokenId}/conditions` : "/patients/me/conditions";
  const [data, setData] = useState(null);
  const [codes, setCodes] = useState([]);
  const [declaration, setDeclaration] = useState("undisclosed");
  const [consent, setConsent] = useState(false);
  const [verified, setVerified] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState(0);
  function applyData(next) {
    setData(next); setCodes(next.profile.entries.map(item => item.code));
    setDeclaration(next.profile.declaration); setConsent(next.profile.analyticsConsent);
    setVerified(Object.fromEntries(next.profile.entries.map(item => [item.code, item.verifiedCode || item.code])));
  }
  useEffect(() => {
    let active = true;
    setData(null); setError(""); setSuccess("");
    api.get(endpoint).then(({ data: next }) => { if (active) applyData(next); })
      .catch(e => { if (active) setError(e.response?.data?.message || "Unable to load health conditions."); });
    return () => { active = false; };
  }, [endpoint, attempt]);
  async function save(review) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const payload = { revision: data.profile.revision, ...(doctor ? review : { codes, declaration, analyticsConsent: consent }) };
      const response = doctor ? await api.patch(endpoint, payload) : await api.put(endpoint, payload);
      applyData(response.data); setSuccess(doctor ? "Condition review saved." : "Health conditions saved.");
    } catch (e) {
      if (e.response?.status === 409) {
        try { const response = await api.get(endpoint); applyData(response.data); } catch { setData(null); }
      }
      setError(e.response?.data?.message || "Unable to save health conditions.");
    } finally { setBusy(false); }
  }
  const label = code => t(data?.catalog.find(item => item.code === code)?.label || code);
  const changed = data && (declaration !== data.profile.declaration || [...codes].sort().join() !== data.profile.entries.map(item => item.code).sort().join());
  return <section className="card health-conditions-panel" aria-busy={busy || (!data && !error)}>
    <div className="card-title"><Activity size={20} aria-hidden="true"/><h2>{t(doctor ? "Review Health Conditions" : "Health Conditions")}</h2></div>
    <p className="muted">{t(doctor ? "Review the patient's selection during this consultation. Confirm only conditions supported by your clinical assessment."
      : "Select conditions you already know about. These are patient-reported until a doctor at this clinic reviews them.")}</p>
    {!data && !error && <p role="status">{t("Loading health conditions...")}</p>}
    {data && <>
      {!doctor && <div className="condition-editor">
        <label>{t("Your health declaration")}<select value={declaration} disabled={busy} onChange={e => { setDeclaration(e.target.value); setCodes([]); setSuccess(""); }}>
          <option value="undisclosed">{t("Prefer not to say")}</option><option value="none">{t("No known conditions")}</option><option value="conditions">{t("I have known health conditions")}</option>
        </select></label>
        {declaration === "conditions" && <label>{t("Add a condition (select one or more)")}<select value="" disabled={busy} onChange={e => { if (e.target.value) { setCodes(current => [...current, e.target.value]); setSuccess(""); } }}>
          <option value="">{t("Select a health condition")}</option>{data.catalog.filter(item => !codes.includes(item.code)).map(item => <option key={item.code} value={item.code}>{t(item.label)}</option>)}
        </select></label>}
        <div className="condition-selected" aria-live="polite">{codes.map(code => <div className="condition-selection" key={code}>
          <span><strong>{label(code)}</strong><small>{t(changed ? statusLabel.pending : statusLabel[data.profile.entries.find(item => item.code === code)?.status] || statusLabel.pending)}</small></span>
          <button type="button" className="ghost" disabled={busy} onClick={() => setCodes(current => current.filter(item => item !== code))} aria-label={t("Remove {condition}", { condition: label(code) })}><X size={16} aria-hidden="true"/></button>
        </div>)}</div>
        <p className="condition-note">{t("Changes need a new doctor review. Removing a selection keeps your consultation records.")}</p>
        <label className="condition-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)}/><span>{t("Allow this clinic to use my doctor-confirmed conditions in aggregate condition reports.")}<small>{t("Optional. Your care is unaffected. Reports hide names, contacts and IDs; small counts are withheld. This does not permit AI model training. You can withdraw here anytime.")}</small></span></label>
        <button type="button" className="primary" disabled={busy || (declaration === "conditions" && !codes.length)} onClick={() => save()}><CheckCircle size={16} aria-hidden="true"/>{t(busy ? "Saving..." : "Save Health Conditions")}</button>
      </div>}
      <div className="condition-reviews">
        <h3>{t(doctor ? "Patient-reported conditions" : "Saved review status")}</h3>
        {!data.profile.entries.length && <p className="muted">{t(data.profile.declaration === "none" ? "Patient reports no known conditions." : "No conditions shared. This does not mean the patient has no disease.")}</p>}
        {data.profile.entries.map(entry => <article className="condition-review" key={entry.code}>
          <div className="condition-review-heading"><strong>{label(entry.code)}</strong><span className={`condition-status condition-${entry.status}`}>{t(statusLabel[entry.status])}</span></div>
          {entry.status === "confirmed" && entry.verifiedCode !== entry.code && <p>{t("Confirmed as")}: {label(entry.verifiedCode)}</p>}
          {entry.reviewedAt && <small className="muted">{t("Reviewed")}: {new Date(entry.reviewedAt).toLocaleString(language === "hi" ? "hi-IN" : "en-IN")}</small>}
          {doctor && <div className="condition-review-actions">
            <label>{t("Clinical condition")}<select value={verified[entry.code]} disabled={busy} onChange={e => setVerified(current => ({ ...current, [entry.code]: e.target.value }))}>
              {data.catalog.map(item => <option key={item.code} value={item.code}>{t(item.label)}</option>)}
            </select></label>
            <button type="button" className="primary" disabled={busy} onClick={() => save({ code: entry.code, verifiedCode: verified[entry.code], decision: "confirmed" })}>{t(verified[entry.code] === entry.code ? "Confirm" : "Edit & Confirm")}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => save({ code: entry.code, decision: "not_confirmed" })}>{t("Not confirmed")}</button>
          </div>}
        </article>)}
      </div>
    </>}
    {error && <div className="login-error" role="alert">{t(error)}{!data && <button type="button" className="ghost" onClick={() => setAttempt(current => current + 1)}>{t("Retry")}</button>}</div>}
    {success && <p className="success" role="status">{t(success)}</p>}
  </section>;
}

export function ConditionInsights({ range }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null), [catalog, setCatalog] = useState([]);
  const [condition, setCondition] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const { fromDate, toDate } = range;
  useEffect(() => {
    let active = true; setData(null); setBusy(true); setError("");
    api.get("/admin/condition-insights", { params: { fromDate, toDate } }).then(({ data: next }) => {
      if (active) { setData(next); setCatalog(next.rows.map(({ code, label }) => ({ code, label }))); }
    }).catch(e => { if (active) setError(e.response?.data?.message || "Unable to load condition insights."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [fromDate, toDate, attempt]);
  async function download() {
    setDownloading(true); setError("");
    try {
      const { data: blob } = await api.get("/admin/export", { params: { type: "conditions", fromDate, toDate, condition }, responseType: "blob" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `confirmed-conditions-${fromDate}-to-${toDate}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Unable to download condition report. Check your dates and try again."); }
    finally { setDownloading(false); }
  }
  return <section className="health-conditions-panel condition-insights">
    <h3>{t("Confirmed Condition Insights")}</h3>
    <p className="muted">{t("Distinct consenting patients by doctor-confirmed condition. Dates filter the latest review date (UTC), not appointment dates. Patients with multiple conditions appear in each applicable group.")}</p>
    <label>{t("Condition filter")}<select value={condition} onChange={e => setCondition(e.target.value)}><option value="">{t("All conditions")}</option>{catalog.map(item => <option key={item.code} value={item.code}>{t(item.label)}</option>)}</select></label>
    {busy && <p role="status">{t("Loading condition insights...")}</p>}
    {data && <div className="condition-stats">{data.rows.filter(item => !condition || item.code === condition).map(item => <article key={item.code}><span>{t(item.label)}</span><strong>{item.suppressed ? t("Not reported (0–4)") : item.count}</strong></article>)}</div>}
    <p className="condition-note">{t("Groups below 5, including zero, have no published count. This is a clinic sample, not disease prevalence. No location or individual patient data is exported.")}</p>
    <div className="operations-actions"><button type="button" className="ghost" onClick={() => setAttempt(current => current + 1)} disabled={busy}><RefreshCw size={15}/>{t("Refresh")}</button><button type="button" className="primary" disabled={!data || busy || downloading} onClick={download}><Download size={15}/>{t(downloading ? "Downloading..." : "Download Conditions CSV (Excel compatible)")}</button></div>
    {error && <p className="login-error" role="alert">{t(error)}</p>}
  </section>;
}
