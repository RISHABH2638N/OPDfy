import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "./api";
import { useLanguage, Trans } from "./LanguageContext";
import "./privacy-center.css";

export default function ClinicPrivacyReview() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [basis, setBasis] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => { const { data } = await api.get("/privacy-clinic/requests"); setRequests(data.requests || []); };
  useEffect(() => { load().catch(e => setError(e.response?.data?.message || "Unable to load requests.")); }, []);
  const open = async id => {
    setError(""); setMessage("");
    try { const { data } = await api.get(`/privacy-clinic/requests/${id}/closure`); setSelected(data); setBasis(""); setEvidence(""); }
    catch (e) { setError(e.response?.data?.message || "Unable to open request."); }
  };
  const approve = async event => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const id = selected.request.id;
      const { data } = await api.post(`/privacy-clinic/requests/${id}/closure-review`, { legalBasis: basis, evidenceReference: evidence });
      setMessage(data.message); await open(id); await load();
    } catch (e) { setError(e.response?.data?.message || "Unable to record review."); }
    finally { setBusy(false); }
  };
  return <main className="page premium-page privacy-center">
    <div className="head"><div><p className="eyebrow"><Trans text="CLINIC · PRIVACY" /></p><h1><Trans text="Clinical Record Retention Review" /></h1><p className="page-subtitle"><Trans text="Review only patients linked to your clinic. Account closure does not erase clinic-owned medical or financial records." /></p></div><button className="ghost" onClick={() => navigate("/admin")}><ArrowLeft size={16}/> <Trans text="Back to admin" /></button></div>
    <section className="card"><div className="card-title"><ShieldCheck/><h2><Trans text="Pending erasure requests" /></h2></div>
      <button type="button" className="primary" onClick={()=>navigate("/admin/privacy/identity")}><ShieldCheck size={16}/> <Trans text="Patient identity reviews" /></button>
      <button type="button" className="ghost" onClick={()=>navigate("/admin/privacy/reviews")}><Trans text="Guardian & correction reviews" /></button>
      <p className="muted"><Trans text="Verify the patient's identity and your clinic's applicable retention obligations before recording approval. Do not enter medical details in the review notes." /></p>
      <div className="privacy-actions"><button className="ghost" onClick={() => load().catch(() => setError("Unable to refresh."))}><RefreshCw size={16}/> <Trans text="Refresh" /></button></div>
      {requests.length === 0 && <p className="muted"><Trans text="No linked requests awaiting review." /></p>}
      <div className="privacy-history">{requests.map(item => <article className="privacy-request" key={item.id}><strong>{item.patient?.name || t("Patient")}</strong><p>{item.patient?.email || t("Account unavailable")}</p><small>{item.id} · {new Date(item.createdAt).toLocaleString()}</small><button className="ghost" onClick={() => open(item.id)}><Trans text="Review clinic retention" /></button></article>)}</div>
      {selected && <div className="privacy-review-detail"><h3><Trans text="Clinic review" /></h3><p><Trans text="Request:" /> {selected.request.id}</p><p><Trans text="Memberships:" /> {selected.clinic?.memberships || 0}. <Trans text="Open follow-ups:" /> {selected.clinic?.openFollowUps || 0}.</p><p><Trans text="Active visit obligations:" /> {Object.values(selected.clinic?.active || {}).reduce((a,b)=>a+b,0)}.</p>
        {selected.approval ? <p className="success"><Trans text="Retention review recorded on" /> {new Date(selected.approval.reviewedAt).toLocaleString()}.</p> : <form className="privacy-form" onSubmit={approve}>
          <label><Trans text="Approved legal/medical retention basis" /><textarea rows={4} maxLength={1200} value={basis} onChange={e => setBasis(e.target.value)} required placeholder={t("Document the applicable retention obligation and review decision (minimum 20 characters).")}/></label>
          <label><Trans text="Clinic review evidence/reference" /><input maxLength={240} value={evidence} onChange={e => setEvidence(e.target.value)} required placeholder={t("Approved policy or case reference")}/></label>
          <button className="primary" disabled={busy || basis.trim().length < 20 || evidence.trim().length < 5}><ShieldCheck size={16}/> <Trans text="Record clinic retention approval" /></button>
        </form>}</div>}
      {error && <p className="login-error" role="alert">{t(error)}</p>}{message && <p className="success" role="status">{t(message)}</p>}
    </section>
  </main>;
}
