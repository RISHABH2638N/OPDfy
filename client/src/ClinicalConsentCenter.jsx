import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Clock3, FileCheck2, RefreshCw, Search, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, getStoredPatient, getStoredUser } from "./api";
import { useLanguage } from "./LanguageContext";

const copy = {
  en: {
    title: "Treatment Consent Center", patientSub: "Review requests from your clinic and record your decision in clear language.", staffSub: "Issue and review auditable treatment-consent requests without blocking emergency care.",
    disclaimer: "This is an electronic acknowledgement record, not a digital signature or a substitute for an approved procedure-specific hospital form. Emergency care must not be delayed by this screen.",
    newRequest: "New consent request", patient: "Patient", findPatient: "Find patient", searchPlaceholder: "Name, Patient ID, email or phone", choosePatient: "Choose a patient", category: "Consent category", language: "Notice language", validUntil: "Valid until",
    consentTitle: "Consent title", explanation: "What is proposed and why", benefits: "Expected benefits", risks: "Material risks", alternatives: "Reasonable alternatives", refusal: "Likely consequences of refusal", send: "Send to patient", sending: "Sending…", requests: "Consent requests", refresh: "Refresh",
    empty: "No consent requests in this clinic yet.", requestedBy: "Requested by", doctor: "Doctor", expires: "Expires", pending: "Pending patient decision", patient_acknowledged: "Guardian review required", active: "Acknowledged", declined: "Declined", withdrawn: "Withdrawn", cancelled: "Cancelled", expired: "Expired",
    review: "Review guardian authority", cancel: "Cancel request", reviewTitle: "Guardian authority review", reviewNote: "Witness / authority review note", questions: "Patient or guardian had an opportunity to ask questions", authority: "Guardian authority was checked using the clinic's approved process", activate: "Complete review & activate",
    acknowledge: "Review & acknowledge", decline: "Decline", withdraw: "Withdraw acknowledgement", decisionTitle: "Record your decision", self: "I am the patient", guardian: "I am the parent / lawful guardian", typedName: "Type full name", relationship: "Relationship to patient", declareAuthority: "I declare that I am authorized to act for this patient. Clinic verification is still required.", understood: "I read and understood the information shown above.", voluntary: "My decision is voluntary and I understand I can ask the clinic questions.", questionsOpportunity: "I had an opportunity to ask questions and discuss alternatives.", confirm: "Acknowledge", confirmDecline: "Record decline", close: "Close", history: "Decision history", status: "Status",
    noPatient: "No matching patient found.", created: "Consent request sent to the patient.", saved: "Decision recorded.", identityBlocked: "This older clinic profile needs identity verification before treatment acknowledgement can be recorded. Submit an identity review request or contact clinic reception.", openPrivacy: "Open Privacy & Account Safety",
    staffWorkflow: "STAFF WORKFLOW", auditableWorklist: "AUDITABLE WORKLIST", myClinicRecords: "MY CLINIC RECORDS", loading: "Loading…", clinicStaff: "Clinic staff", version: "Version",
  },
  hi: {
    title: "उपचार सहमति केंद्र", patientSub: "अपने क्लिनिक के अनुरोध पढ़ें और स्पष्ट भाषा में अपना निर्णय दर्ज करें।", staffSub: "आपातकालीन देखभाल को रोके बिना ऑडिट योग्य उपचार-सहमति अनुरोध भेजें और समीक्षा करें।",
    disclaimer: "यह इलेक्ट्रॉनिक स्वीकृति रिकॉर्ड है, डिजिटल हस्ताक्षर या अस्पताल के स्वीकृत प्रक्रिया-विशिष्ट फॉर्म का विकल्प नहीं। इस स्क्रीन के कारण आपातकालीन इलाज में देरी नहीं होनी चाहिए।",
    newRequest: "नया सहमति अनुरोध", patient: "रोगी", findPatient: "रोगी खोजें", searchPlaceholder: "नाम, रोगी ID, ईमेल या फोन", choosePatient: "रोगी चुनें", category: "सहमति श्रेणी", language: "सूचना की भाषा", validUntil: "मान्य अवधि",
    consentTitle: "सहमति का शीर्षक", explanation: "क्या और क्यों प्रस्तावित है", benefits: "अपेक्षित लाभ", risks: "महत्वपूर्ण जोखिम", alternatives: "उचित विकल्प", refusal: "मना करने के संभावित परिणाम", send: "रोगी को भेजें", sending: "भेज रहे हैं…", requests: "सहमति अनुरोध", refresh: "रीफ्रेश",
    empty: "इस क्लिनिक में अभी कोई सहमति अनुरोध नहीं है।", requestedBy: "अनुरोधकर्ता", doctor: "डॉक्टर", expires: "समाप्ति", pending: "रोगी के निर्णय की प्रतीक्षा", patient_acknowledged: "अभिभावक समीक्षा आवश्यक", active: "स्वीकृत", declined: "अस्वीकृत", withdrawn: "वापस लिया गया", cancelled: "रद्द", expired: "समाप्त",
    review: "अभिभावक अधिकार की समीक्षा", cancel: "अनुरोध रद्द करें", reviewTitle: "अभिभावक अधिकार समीक्षा", reviewNote: "गवाह / अधिकार समीक्षा टिप्पणी", questions: "रोगी या अभिभावक को प्रश्न पूछने का अवसर मिला", authority: "क्लिनिक की स्वीकृत प्रक्रिया से अभिभावक अधिकार जाँचा गया", activate: "समीक्षा पूरी कर सक्रिय करें",
    acknowledge: "पढ़ें और स्वीकार करें", decline: "मना करें", withdraw: "सहमति वापस लें", decisionTitle: "अपना निर्णय दर्ज करें", self: "मैं रोगी हूँ", guardian: "मैं माता-पिता / कानूनी अभिभावक हूँ", typedName: "पूरा नाम लिखें", relationship: "रोगी से संबंध", declareAuthority: "मैं घोषित करता/करती हूँ कि मुझे इस रोगी की ओर से निर्णय लेने का अधिकार है। क्लिनिक सत्यापन अभी भी आवश्यक है।", understood: "मैंने ऊपर दी गई जानकारी पढ़ी और समझी है।", voluntary: "मेरा निर्णय स्वेच्छा से है और मैं क्लिनिक से प्रश्न पूछ सकता/सकती हूँ।", questionsOpportunity: "मुझे प्रश्न पूछने और विकल्पों पर चर्चा करने का अवसर मिला।", confirm: "स्वीकार करें", confirmDecline: "अस्वीकृति दर्ज करें", close: "बंद करें", history: "निर्णय इतिहास", status: "स्थिति",
    noPatient: "कोई मेल खाता रोगी नहीं मिला।", created: "सहमति अनुरोध रोगी को भेज दिया गया।", saved: "निर्णय दर्ज हो गया।", identityBlocked: "इस पुराने क्लिनिक प्रोफ़ाइल की पहचान जाँच पूरी होने के बाद ही उपचार सहमति दर्ज की जा सकती है। पहचान समीक्षा का अनुरोध दें या क्लिनिक रिसेप्शन से संपर्क करें।", openPrivacy: "गोपनीयता और खाता सुरक्षा खोलें",
    staffWorkflow: "स्टाफ प्रक्रिया", auditableWorklist: "ऑडिट योग्य कार्यसूची", myClinicRecords: "मेरे क्लिनिक रिकॉर्ड", loading: "लोड हो रहा है…", clinicStaff: "क्लिनिक स्टाफ", version: "संस्करण",
  },
};

const categoryLabels = {
  general_treatment: ["General consultation / treatment", "सामान्य परामर्श / उपचार"],
  procedure: ["Procedure-specific consent", "प्रक्रिया-विशिष्ट सहमति"],
  record_sharing: ["Record sharing", "रिकॉर्ड साझा करना"],
  teleconsultation: ["Teleconsultation", "टेली-परामर्श"],
  other: ["Other", "अन्य"],
};

const futureLocal = (days = 7) => {
  const value = new Date(Date.now() + days * 86400000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

function statusOf(consent) { return consent.effectiveStatus || consent.status || "pending"; }
function fmt(value) { return value ? new Date(value).toLocaleString() : "—"; }

export default function ClinicalConsentCenter() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const c = copy[language] || copy.en;
  const staff = getStoredUser();
  const patientAccount = getStoredPatient();
  const isStaff = Boolean(staff);
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [identityReviewRequired, setIdentityReviewRequired] = useState(false);
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [decisionConsent, setDecisionConsent] = useState(null);
  const [reviewConsent, setReviewConsent] = useState(null);
  const [request, setRequest] = useState({ category: "general_treatment", language: language === "hi" ? "hi" : "en", validUntil: futureLocal(), title: "", explanation: "", expectedBenefits: "", materialRisks: "", alternatives: "", refusalConsequences: "" });
  const [decision, setDecision] = useState({ action: "acknowledged", actorType: "self", typedName: patientAccount?.name || "", guardianRelationship: "", authorityDeclared: false, understood: false, voluntary: false, questionsOpportunity: false });
  const [review, setReview] = useState({ guardianAuthorityChecked: false, questionsAnswered: false, note: "" });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const { data } = await api.get(isStaff ? "/clinical-consents" : "/patients/me/clinical-consents");
      setConsents(data?.consents || []);
      if (!isStaff) {
        const { data: profileData } = await api.get("/patients/me");
        setIdentityReviewRequired(Boolean(profileData?.identityReviewRequired));
      }
    } catch (e) { setError(e.response?.data?.message || "Unable to load consent requests."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const findPatients = async () => {
    try { const { data } = await api.get("/clinical-consents/patients", { params: { q: query } }); setPatients(data?.patients || []); }
    catch (e) { setError(e.response?.data?.message || "Unable to find patients."); }
  };

  const createRequest = async (event) => {
    event.preventDefault(); if (!selectedPatient) return setError(c.choosePatient);
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await api.post("/clinical-consents", { ...request, validUntil: new Date(request.validUntil).toISOString(), patientId: selectedPatient._id });
      setMessage(data?.message || c.created); setRequest((current) => ({ ...current, title: "", explanation: "", expectedBenefits: "", materialRisks: "", alternatives: "", refusalConsequences: "", validUntil: futureLocal() })); await load();
    } catch (e) { setError(e.response?.data?.message || "Unable to create consent request."); }
    finally { setBusy(false); }
  };

  const submitDecision = async () => {
    if (!decisionConsent) return;
    const typedName = decision.typedName.trim();
    if (decision.action === "acknowledged" && identityReviewRequired) {
      setDecisionError(c.identityBlocked);
      return;
    }
    setBusy(true); setError(""); setDecisionError(""); setMessage("");
    try {
      const { data } = await api.post(`/patients/me/clinical-consents/${decisionConsent._id}/decision`, { ...decision, typedName, decision: decision.action, language });
      setMessage(data?.message || c.saved); setDecisionConsent(null); await load();
    } catch (e) { setDecisionError(e.response?.data?.message || "Unable to record your decision."); }
    finally { setBusy(false); }
  };

  const withdraw = async (consent) => {
    const reason = window.prompt(language === "hi" ? "कारण (वैकल्पिक; लिखने पर कम से कम 5 अक्षर)" : "Reason (optional; minimum 5 characters if provided)", "");
    if (reason === null) return;
    try { const { data } = await api.post(`/patients/me/clinical-consents/${consent._id}/withdraw`, { reason }); setMessage(data?.message || c.saved); await load(); }
    catch (e) { setError(e.response?.data?.message || "Unable to withdraw consent."); }
  };

  const cancelRequest = async (consent) => {
    const reason = window.prompt(language === "hi" ? "रद्द करने का कारण" : "Cancellation reason", "Request no longer required.");
    if (!reason) return;
    try { const { data } = await api.patch(`/clinical-consents/${consent._id}/cancel`, { reason }); setMessage(data?.message || c.saved); await load(); }
    catch (e) { setError(e.response?.data?.message || "Unable to cancel request."); }
  };

  const submitReview = async () => {
    if (!reviewConsent) return;
    setBusy(true); setError("");
    try { const { data } = await api.patch(`/clinical-consents/${reviewConsent._id}/review`, review); setMessage(data?.message || c.saved); setReviewConsent(null); await load(); }
    catch (e) { setError(e.response?.data?.message || "Unable to complete guardian review."); }
    finally { setBusy(false); }
  };

  const sorted = useMemo(() => [...consents].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [consents]);

  return <main className="page clinical-consent-page">
    <section className="dashboard-banner consent-banner"><div><span className="dashboard-kicker"><FileCheck2 size={15}/>{c.title}</span><h1>{c.title}</h1><p>{isStaff ? c.staffSub : c.patientSub}</p></div><ShieldCheck size={34}/></section>
    <div className="consent-disclaimer"><AlertTriangle size={18}/><span>{c.disclaimer}</span></div>
    {error && <div className="login-error" role="alert">{error}</div>}{message && <div className="clinic-settings-success"><CheckCircle size={17}/>{message}</div>}

    {isStaff && <form className="card consent-create" onSubmit={createRequest}>
      <div className="consent-section-head"><div><small>{c.staffWorkflow}</small><h2>{c.newRequest}</h2></div></div>
      <div className="consent-patient-search"><label>{c.findPatient}<div><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={c.searchPlaceholder}/><button type="button" className="ghost" onClick={findPatients}><Search size={15}/>{c.findPatient}</button></div></label></div>
      {patients.length > 0 && <div className="consent-patient-results">{patients.map((p)=><button type="button" key={p._id} className={selectedPatient?._id===p._id?"selected":""} onClick={()=>setSelectedPatient(p)}><UserCheck size={15}/><span><b>{p.name}</b><small>{p.patientId}</small></span></button>)}</div>}
      {selectedPatient && <div className="selected-consent-patient"><CheckCircle size={16}/><span>{c.patient}: <b>{selectedPatient.name}</b> · {selectedPatient.patientId}</span></div>}
      <div className="consent-form-grid">
        <label>{c.category}<select value={request.category} onChange={(e)=>setRequest(x=>({...x,category:e.target.value}))}>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label[language==="hi"?1:0]}</option>)}</select></label>
        <label>{c.language}<select value={request.language} onChange={(e)=>setRequest(x=>({...x,language:e.target.value}))}><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
        <label>{c.validUntil}<input type="datetime-local" required value={request.validUntil} onChange={(e)=>setRequest(x=>({...x,validUntil:e.target.value}))}/></label>
        <label className="wide">{c.consentTitle}<input required minLength="4" maxLength="120" value={request.title} onChange={(e)=>setRequest(x=>({...x,title:e.target.value}))}/></label>
        <label className="wide">{c.explanation}<textarea required minLength="20" maxLength="2000" rows="4" value={request.explanation} onChange={(e)=>setRequest(x=>({...x,explanation:e.target.value}))}/></label>
        <label>{c.benefits}<textarea maxLength="1600" rows="3" value={request.expectedBenefits} onChange={(e)=>setRequest(x=>({...x,expectedBenefits:e.target.value}))}/></label>
        <label>{c.risks}<textarea required={request.category==="procedure"} minLength={request.category==="procedure"?10:0} maxLength="2000" rows="3" value={request.materialRisks} onChange={(e)=>setRequest(x=>({...x,materialRisks:e.target.value}))}/></label>
        <label>{c.alternatives}<textarea maxLength="1600" rows="3" value={request.alternatives} onChange={(e)=>setRequest(x=>({...x,alternatives:e.target.value}))}/></label>
        <label>{c.refusal}<textarea maxLength="1600" rows="3" value={request.refusalConsequences} onChange={(e)=>setRequest(x=>({...x,refusalConsequences:e.target.value}))}/></label>
      </div>
      <button className="primary consent-send" disabled={busy||!selectedPatient}>{busy?<RefreshCw className="animate-spin" size={16}/>:<FileCheck2 size={16}/>} {busy?c.sending:c.send}</button>
    </form>}

    <section className="consent-list-section"><div className="consent-section-head"><div><small>{isStaff?c.auditableWorklist:c.myClinicRecords}</small><h2>{c.requests}</h2></div><button type="button" className="ghost" onClick={load}><RefreshCw size={15}/>{c.refresh}</button></div>
      {loading?<div className="card consent-empty"><RefreshCw className="animate-spin"/>{c.loading}</div>:sorted.length===0?<div className="card consent-empty"><FileCheck2 size={26}/>{c.empty}</div>:<div className="consent-grid">{sorted.map((item)=>{const status=statusOf(item);return <article className="card consent-card" key={item._id}>
        <div className="consent-card-head"><span className={`consent-status status-${status}`}>{status==="active"?<CheckCircle size={13}/>:status==="expired"?<Clock3 size={13}/>:<FileCheck2 size={13}/>} {c[status]||status}</span><small>{categoryLabels[item.category]?.[language==="hi"?1:0]||item.category}</small></div>
        <h3>{item.title}</h3><p className="consent-explanation">{item.explanation}</p>
        <details><summary>{language==="hi"?"लाभ, जोखिम और विकल्प देखें":"View benefits, risks and alternatives"}</summary><div className="consent-details">{item.expectedBenefits&&<p><b>{c.benefits}:</b> {item.expectedBenefits}</p>}{item.materialRisks&&<p><b>{c.risks}:</b> {item.materialRisks}</p>}{item.alternatives&&<p><b>{c.alternatives}:</b> {item.alternatives}</p>}{item.refusalConsequences&&<p><b>{c.refusal}:</b> {item.refusalConsequences}</p>}</div></details>
        <div className="consent-meta">{item.patient&&<span><UserCheck size={13}/>{item.patient.name} · {item.patient.patientId}</span>}<span>{c.requestedBy}: <b>{item.requestedBy?.name||c.clinicStaff}</b></span>{item.doctor&&<span>{c.doctor}: <b>Dr. {item.doctor.name}</b></span>}<span>{c.expires}: <b>{fmt(item.validUntil)}</b></span><span>{c.version}: {item.noticeVersion}</span></div>
        {!isStaff&&status==="pending"&&<div className="consent-actions"><button className="primary" onClick={()=>{setDecisionError("");setDecision({...decision,action:"acknowledged",actorType:"self",typedName:patientAccount?.name||"",understood:false,voluntary:false,questionsOpportunity:false});setDecisionConsent(item);}}>{c.acknowledge}</button><button className="ghost danger-soft" onClick={()=>{setDecisionError("");setDecision({...decision,action:"declined",actorType:"self",typedName:patientAccount?.name||""});setDecisionConsent(item);}}>{c.decline}</button></div>}
        {!isStaff&&["active","patient_acknowledged"].includes(status)&&<button className="ghost danger-soft" onClick={()=>withdraw(item)}>{c.withdraw}</button>}
        {isStaff&&status==="patient_acknowledged"&&<button className="primary" onClick={()=>{setReview({guardianAuthorityChecked:false,questionsAnswered:false,note:""});setReviewConsent(item);}}>{c.review}</button>}
        {isStaff&&["pending","patient_acknowledged"].includes(status)&&<button className="ghost danger-soft" onClick={()=>cancelRequest(item)}>{c.cancel}</button>}
      </article>;})}</div>}
    </section>

    {decisionConsent&&<div className="consent-modal-backdrop" onMouseDown={()=>setDecisionConsent(null)}><section className="card consent-modal" onMouseDown={(e)=>e.stopPropagation()}><button className="consent-modal-close" onClick={()=>setDecisionConsent(null)} aria-label={c.close}>×</button><span className="dashboard-kicker"><FileCheck2 size={14}/>{c.decisionTitle}</span><h2>{decisionConsent.title}</h2><p>{decisionConsent.explanation}</p>{decisionError&&<div className="login-error consent-decision-error" role="alert"><span>{decisionError}</span>{identityReviewRequired&&decision.action==="acknowledged"&&<button type="button" className="ghost" onClick={()=>{setDecisionConsent(null);navigate("/patient/privacy");}}>{c.openPrivacy}</button>}</div>}<div className="consent-actor"><label><input type="radio" checked={decision.actorType==="self"} onChange={()=>{setDecisionError("");setDecision(x=>({...x,actorType:"self",typedName:patientAccount?.name||""}));}}/>{c.self}</label><label><input type="radio" checked={decision.actorType==="guardian"} onChange={()=>{setDecisionError("");setDecision(x=>({...x,actorType:"guardian",typedName:""}));}}/>{c.guardian}</label></div><label>{c.typedName}<input value={decision.typedName} onChange={(e)=>{setDecisionError("");setDecision(x=>({...x,typedName:e.target.value}));}}/></label>{decision.actorType==="guardian"&&<><label>{c.relationship}<input value={decision.guardianRelationship} onChange={(e)=>setDecision(x=>({...x,guardianRelationship:e.target.value}))}/></label><label className="consent-check"><input type="checkbox" checked={decision.authorityDeclared} onChange={(e)=>setDecision(x=>({...x,authorityDeclared:e.target.checked}))}/><span>{c.declareAuthority}</span></label></>}{decision.action==="acknowledged"&&<div className="consent-declarations"><label className="consent-check"><input type="checkbox" checked={decision.understood} onChange={(e)=>setDecision(x=>({...x,understood:e.target.checked}))}/><span>{c.understood}</span></label><label className="consent-check"><input type="checkbox" checked={decision.voluntary} onChange={(e)=>setDecision(x=>({...x,voluntary:e.target.checked}))}/><span>{c.voluntary}</span></label><label className="consent-check"><input type="checkbox" checked={decision.questionsOpportunity} onChange={(e)=>setDecision(x=>({...x,questionsOpportunity:e.target.checked}))}/><span>{c.questionsOpportunity}</span></label></div>}<button type="button" className={decision.action==="declined"?"danger wide":"primary wide"} disabled={busy||decision.typedName.trim().length<2||(decision.actorType==="guardian"&&(!decision.guardianRelationship.trim()||!decision.authorityDeclared))||(decision.action==="acknowledged"&&(!decision.understood||!decision.voluntary||!decision.questionsOpportunity))} onClick={submitDecision}>{decision.action==="declined"?c.confirmDecline:c.confirm}</button></section></div>}

    {reviewConsent&&<div className="consent-modal-backdrop" onMouseDown={()=>setReviewConsent(null)}><section className="card consent-modal" onMouseDown={(e)=>e.stopPropagation()}><button className="consent-modal-close" onClick={()=>setReviewConsent(null)} aria-label={c.close}>×</button><h2>{c.reviewTitle}</h2><p>{reviewConsent.patientDecision?.typedName} · {reviewConsent.patientDecision?.guardianRelationship}</p><label className="consent-check"><input type="checkbox" checked={review.guardianAuthorityChecked} onChange={(e)=>setReview(x=>({...x,guardianAuthorityChecked:e.target.checked}))}/><span>{c.authority}</span></label><label className="consent-check"><input type="checkbox" checked={review.questionsAnswered} onChange={(e)=>setReview(x=>({...x,questionsAnswered:e.target.checked}))}/><span>{c.questions}</span></label><label>{c.reviewNote}<textarea rows="4" minLength="10" maxLength="1000" value={review.note} onChange={(e)=>setReview(x=>({...x,note:e.target.value}))}/></label><button className="primary wide" disabled={busy||!review.guardianAuthorityChecked||!review.questionsAnswered||review.note.trim().length<10} onClick={submitReview}>{c.activate}</button></section></div>}
  </main>;
}
