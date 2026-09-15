import React, { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { platformApi } from "./api";
import { useLanguage, Trans } from "./LanguageContext";

export default function PrivacyClosureAdminPanel({ requestId, onComplete }) {
  const { t } = useLanguage();
  const [review, setReview] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => {
    const { data } = await platformApi.get(`/privacy/admin/requests/${requestId}/closure`);
    setReview(data);
  };
  useEffect(() => { load().catch(e => setError(e.response?.data?.message || "Unable to load retention review.")); }, [requestId]);
  const execute = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await platformApi.post(`/privacy/admin/requests/${requestId}/closure/execute`, { password, confirmation });
      setPassword(""); setConfirmation(""); setMessage(data.message);
      await load(); if (onComplete) await onComplete();
    } catch (e) { setError(e.response?.data?.message || "Account closure could not be completed."); }
    finally { setBusy(false); }
  };
  const clinics = review?.inventory?.clinics || [];
  const approved = clinics.every(c => review.approvals.some(a => String(a.tenantId) === String(c.tenantId)));
  const ready = review?.executionEnabled && review?.request?.status !== "fulfilled" && approved && !review?.inventory?.hasActiveVisits;
  return <section className="privacy-review-detail">
    <div className="privacy-actions" style={{justifyContent:"space-between"}}><strong><Trans text="Account closure review" /></strong><button type="button" className="ghost" onClick={() => load().catch(() => setError("Unable to refresh review."))}><RefreshCw size={15}/> <Trans text="Refresh" /></button></div>
    {review && <>
      <p className="muted"><Trans text="This operation closes only the global login and erases its reusable profile. It does not delete, cancel, merge, or unlink clinic-owned clinical and financial records." /></p>
      <p><Trans text="Account:" /> {t(review.inventory.account.status)}. <Trans text="Policy:" /> {review.policyVersion || t("Not configured")}. <Trans text="Execution:" /> {t(review.executionEnabled ? "Configured" : "Disabled pending policy approval")}.</p>
      {clinics.map(c => <div className="privacy-request" key={c.tenantId}>
        <strong>{c.name}</strong><p><Trans text="Memberships:" /> {c.memberships}; <Trans text="Open follow-ups:" /> {c.openFollowUps}.</p>
        <p><Trans text="Active obligations:" /> {Object.values(c.active).reduce((a,b)=>a+b,0)}. <Trans text="Retention review:" /> {t(review.approvals.some(a => String(a.tenantId) === String(c.tenantId)) ? "Recorded" : "Pending clinic approval")}.</p>
      </div>)}
      {!review.executionEnabled && <p className="muted"><Trans text="The production erasure gate is disabled until an approved retention policy is configured. No automatic record deletion is available." /></p>}
      {ready && <form className="privacy-form" onSubmit={execute}>
        <label><Trans text="Fresh platform password" /><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required/></label>
        <label><Trans text="Type CLOSE GLOBAL ACCOUNT" /><input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" required/></label>
        <button type="submit" className="danger" disabled={busy || !password || confirmation !== "CLOSE GLOBAL ACCOUNT"}><ShieldCheck size={16}/> <Trans text="Execute reviewed account closure" /></button>
      </form>}
    </>}
    {error && <p className="login-error" role="alert">{t(error)}</p>}
    {message && <p className="success" role="status">{t(message)}</p>}
  </section>;
}
