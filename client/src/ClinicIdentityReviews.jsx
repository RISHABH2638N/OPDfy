import React, { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, ShieldCheck, UserCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useLanguage } from "./LanguageContext";
import "./privacy-center.css";

const words = {
  en: {
    eyebrow: "CLINIC · PATIENT SAFETY", title: "Patient Identity Reviews",
    sub: "Resolve verified patient requests before trusted profile synchronization or treatment acknowledgement.",
    back: "Back to privacy reviews", refresh: "Refresh", pending: "Pending identity requests",
    empty: "No identity-review requests are waiting for this clinic.", review: "Review identity",
    account: "Authenticated account", clinic: "Clinic record", requested: "Requested",
    warning: "Compare the patient with your clinic's approved offline evidence. Email similarity alone is not identity proof. Do not enter identity-document numbers or medical details in these notes.",
    decision: "Decision", choose: "Choose...", verify: "Identity verified", reject: "Reject claim",
    evidence: "Evidence or case reference", evidenceHint: "Internal verification/case reference (minimum 5 characters)",
    note: "Documented review note", noteHint: "Describe verification steps without sensitive document numbers (minimum 20 characters)",
    confirm: "I completed the clinic's approved identity-check process.", save: "Save documented decision", cancel: "Cancel",
  },
  hi: {
    eyebrow: "क्लिनिक · रोगी सुरक्षा", title: "रोगी पहचान समीक्षा",
    sub: "विश्वसनीय प्रोफ़ाइल सिंक या उपचार सहमति से पहले सत्यापित रोगी अनुरोधों की समीक्षा करें।",
    back: "गोपनीयता समीक्षा पर वापस", refresh: "रीफ्रेश", pending: "लंबित पहचान अनुरोध",
    empty: "इस क्लिनिक के लिए कोई पहचान-समीक्षा अनुरोध लंबित नहीं है।", review: "पहचान की समीक्षा करें",
    account: "सत्यापित लॉगिन खाता", clinic: "क्लिनिक रिकॉर्ड", requested: "अनुरोध समय",
    warning: "रोगी की पहचान क्लिनिक की स्वीकृत ऑफलाइन प्रक्रिया से जाँचें। केवल समान ईमेल पहचान का प्रमाण नहीं है। टिप्पणी में पहचान दस्तावेज़ संख्या या मेडिकल विवरण न लिखें।",
    decision: "निर्णय", choose: "चुनें...", verify: "पहचान सत्यापित", reject: "दावा अस्वीकार करें",
    evidence: "साक्ष्य या केस संदर्भ", evidenceHint: "आंतरिक सत्यापन/केस संदर्भ (कम से कम 5 अक्षर)",
    note: "दर्ज समीक्षा टिप्पणी", noteHint: "संवेदनशील दस्तावेज़ संख्या लिखे बिना जाँच के चरण बताएँ (कम से कम 20 अक्षर)",
    confirm: "मैंने क्लिनिक की स्वीकृत पहचान-जाँच प्रक्रिया पूरी की है।", save: "दर्ज निर्णय सुरक्षित करें", cancel: "रद्द करें",
  },
};

export default function ClinicIdentityReviews() {
  const { language } = useLanguage();
  const c = words[language] || words.en;
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ decision: "", evidenceReference: "", reviewNote: "", confirmed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const { data } = await api.get("/privacy-clinic/identity-reviews");
    setRequests(data.requests || []);
  };
  useEffect(() => { load().catch((e) => setError(e.response?.data?.message || "Unable to load identity reviews.")); }, []);
  const open = (request) => {
    setSelected(request); setError(""); setMessage("");
    setDraft({ decision: "", evidenceReference: "", reviewNote: "", confirmed: false });
  };
  const submit = async (event) => {
    event.preventDefault(); if (!selected || !draft.confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await api.post(`/privacy-clinic/identity-reviews/${selected.id}/review`, {
        decision: draft.decision, evidenceReference: draft.evidenceReference, reviewNote: draft.reviewNote,
      });
      setMessage(data.message); setSelected(null); await load();
    } catch (e) { setError(e.response?.data?.message || "Unable to record identity review."); }
    finally { setBusy(false); }
  };

  return <main className="page premium-page privacy-center">
    <div className="head"><div><p className="eyebrow">{c.eyebrow}</p><h1>{c.title}</h1><p className="page-subtitle">{c.sub}</p></div><button type="button" className="ghost" onClick={() => navigate("/admin/privacy")}><ArrowLeft size={16}/>{c.back}</button></div>
    <section className="card">
      <div className="card-title"><UserCheck/><h2>{c.pending}</h2></div><p className="muted">{c.warning}</p>
      <div className="privacy-actions"><button type="button" className="ghost" onClick={() => load().catch(() => setError("Unable to refresh."))}><RefreshCw size={15}/>{c.refresh}</button></div>
      {!requests.length && <p className="patient-request-empty">{c.empty}</p>}
      <div className="privacy-history">{requests.map((item) => <article className="privacy-request" key={item.id}>
        <div><strong>{item.patient?.name || "Patient"}</strong><span className="privacy-status" data-status={item.status}>{item.status}</span></div>
        <p><b>{c.clinic}:</b> {item.patient?.patientId || "—"} · {item.patient?.email || item.patient?.phone || "—"}</p>
        <p><b>{c.account}:</b> {item.account?.name || "—"} · {item.account?.email || "—"}</p>
        <p className="muted">{item.details}</p><small>{c.requested}: {new Date(item.createdAt).toLocaleString(language === "hi" ? "hi-IN" : "en-IN")}</small>
        <button type="button" className="ghost" onClick={() => open(item)}><ShieldCheck size={15}/>{c.review}</button>
      </article>)}</div>
      {selected && <form className="privacy-form privacy-review-detail" onSubmit={submit}>
        <h3>{selected.patient?.name} · {selected.patient?.patientId}</h3><p className="muted">{c.warning}</p>
        <label>{c.decision}<select required value={draft.decision} onChange={(e) => setDraft({...draft, decision: e.target.value})}><option value="">{c.choose}</option><option value="verified">{c.verify}</option><option value="rejected">{c.reject}</option></select></label>
        <label>{c.evidence}<input required minLength={5} maxLength={240} placeholder={c.evidenceHint} value={draft.evidenceReference} onChange={(e) => setDraft({...draft, evidenceReference: e.target.value})}/></label>
        <label>{c.note}<textarea required minLength={20} maxLength={1200} rows={4} placeholder={c.noteHint} value={draft.reviewNote} onChange={(e) => setDraft({...draft, reviewNote: e.target.value})}/></label>
        <label className="privacy-check"><input type="checkbox" checked={draft.confirmed} onChange={(e) => setDraft({...draft, confirmed: e.target.checked})}/><span>{c.confirm}</span></label>
        <div className="privacy-actions"><button type="button" className="ghost" onClick={() => setSelected(null)}>{c.cancel}</button><button className="primary" disabled={busy || !draft.confirmed || !draft.decision || draft.evidenceReference.trim().length < 5 || draft.reviewNote.trim().length < 20}>{busy?<RefreshCw className="animate-spin" size={15}/>:<ShieldCheck size={15}/>} {c.save}</button></div>
      </form>}
      {error && <p className="login-error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    </section>
  </main>;
}
