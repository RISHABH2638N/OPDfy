import { PrivacyConsentControls, PrivacyDataExport, PrivacyClosureStatus } from "./PrivacyPhase2Controls";
import { PrivacyGuardianControls, PrivacyCorrectionControls } from "./PrivacyPhase3Patient";
import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowLeft, Mail, Send, RefreshCw } from "lucide-react";
import { patientPlatformApi, getPatientToken } from "./api";
import { useLanguage } from "./LanguageContext";
import "./privacy-center.css";
import PatientIdentityReview from "./PatientIdentityReview";

const TYPES = [
  ["access", "Access my personal data", "मेरी व्यक्तिगत जानकारी देखें"],
  ["correction", "Request a correction", "जानकारी में सुधार का अनुरोध"],
  ["erasure", "Request account closure / erasure", "खाता बंद करने या डेटा हटाने का अनुरोध"],
  ["withdrawal", "Withdraw optional consent", "वैकल्पिक सहमति वापस लें"],
  ["grievance", "Raise a privacy grievance", "गोपनीयता शिकायत दर्ज करें"],
  ["identity_review", "Review an existing clinic identity", "पुराने क्लिनिक रिकॉर्ड की पहचान जाँचें"],
  ["nomination", "Request nomination assistance", "नामांकन संबंधी सहायता माँगें"],
];

export default function PatientPrivacyCenter() {
  const { language } = useLanguage();
  const hi = language === "hi";
  const navigate = useNavigate();
  const [type, setType] = useState("access");
  const [details, setDetails] = useState("");
  const [clinicSlug, setClinicSlug] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState("compose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState([]);
  const [email, setEmail] = useState("");
  const [panel, setPanel] = useState("safety");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    const [{ data: account }, { data: history }] = await Promise.all([
      patientPlatformApi.get("/patient-auth/me"),
      patientPlatformApi.get("/privacy/me"),
    ]);
    setEmail(account.patient?.email || "");
    setRequests(history.requests || []);
  };
  useEffect(() => {
    if (getPatientToken()) load().catch(() => setError("Unable to load privacy requests."));
  }, []);
  if (!getPatientToken()) return <Navigate to="/patient-login" replace />;

  const start = async (event) => {
    event.preventDefault();
    setError(""); setMessage("");
    if (details.trim().length < 10) { setError("Please describe your request in at least 10 characters."); return; }
    setBusy(true);
    try {
      await patientPlatformApi.post("/privacy/verification", { type });
      setStage("verify");
      setMessage(hi ? "आपके पंजीकृत ईमेल पर सत्यापन कोड भेजा गया है।" : "A verification code has been sent to your registered email.");
    } catch (e) { setError(e.response?.data?.message || "Unable to send verification code."); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const { data } = await patientPlatformApi.post("/privacy/requests", { type, details, clinicSlug, otp });
      setMessage(data.message); setStage("compose"); setOtp(""); setDetails("");
      await load();
    } catch (e) { setError(e.response?.data?.message || "Unable to submit privacy request."); }
    finally { setBusy(false); }
  };

  const statusLabel = value => ({
    pending: hi ? "लंबित" : "Pending",
    in_review: hi ? "समीक्षा में" : "In review",
    fulfilled: hi ? "पूरा हुआ" : "Fulfilled",
    rejected: hi ? "अस्वीकृत" : "Rejected",
  }[value] || String(value || "").replaceAll("_", " "));
  const visibleRequests = requests.filter(item => filter === "all" || item.status === filter);
  return <main className="page premium-page privacy-center patient-privacy-view">
    <div className="head">
      <div>
        <p className="eyebrow">OPDfy · PRIVACY</p>
        <h1>{hi ? "गोपनीयता और खाता सुरक्षा" : "Privacy & Account Safety"}</h1>
        <p className="page-subtitle">{hi ? "अपनी जानकारी और डेटा अधिकारों से जुड़े अनुरोध सुरक्षित रूप से दर्ज करें।" : "Submit and track requests about your personal data."}</p>
      </div>
      <button className="ghost" type="button" onClick={() => navigate("/patient/clinics")}><ArrowLeft size={16}/> {hi ? "क्लिनिक" : "Clinics"}</button>
    </div>
    <div className="patient-privacy-stats">
      <div><strong>{requests.length}</strong><span>{hi ? "कुल अनुरोध" : "Total requests"}</span></div>
      <div><strong>{requests.filter(item => ["pending", "in_review"].includes(item.status)).length}</strong><span>{hi ? "समीक्षा की प्रतीक्षा" : "Awaiting resolution"}</span></div>
      <div><strong>{requests.filter(item => ["fulfilled", "rejected"].includes(item.status)).length}</strong><span>{hi ? "निर्णय हो चुका है" : "Decisions received"}</span></div>
    </div>
    <nav className="patient-privacy-tabs" aria-label={hi ? "गोपनीयता अनुभाग" : "Privacy sections"}>
      {[["safety", "Consent & identity", "सहमति और पहचान"], ["data", "My data", "मेरा डेटा"], ["requests", "Privacy requests", "गोपनीयता अनुरोध"]].map(([value, en, hindi]) =>
        <button key={value} type="button" aria-pressed={panel === value} onClick={() => setPanel(value)}>{hi ? hindi : en}</button>)}
    </nav>
    <div hidden={panel !== "safety"}>
      <PatientIdentityReview onRequest={slug => {
        if (stage === "compose") { setType("identity_review"); setClinicSlug(slug); }
        setPanel("requests");
      }}/>
      <PrivacyConsentControls />
    </div>
    <div hidden={panel !== "data"}>
    <PrivacyDataExport onCreated={load} />
    <PrivacyGuardianControls />
    <PrivacyCorrectionControls onCreated={load} />
    </div>
    <div hidden={panel !== "requests"} className="patient-privacy-request-grid">
    <section className="card">
      <div className="card-title"><ShieldCheck/><h2>{hi ? "आपका अनुरोध" : "Your privacy request"}</h2></div>
      <p className="muted">{hi ? "खाता हटाने का अनुरोध तुरंत मेडिकल रिकॉर्ड नहीं हटाता। आवश्यक रिकॉर्ड की समीक्षा के बाद आपको परिणाम बताया जाएगा।" : "Requesting account closure does not immediately delete medical records. Your request will be reviewed, including any applicable record-retention obligations."}</p>
      {email && <p className="privacy-email"><Mail size={15}/> {email}</p>}
      <form onSubmit={stage === "verify" ? submit : start} className="privacy-form">
        <label>{hi ? "अनुरोध का प्रकार" : "Request type"}
          <select value={type} disabled={stage === "verify" || busy} onChange={e => { setType(e.target.value); setError(""); }}>
            {TYPES.map(([value, en, hindi]) => <option key={value} value={value}>{hi ? hindi : en}</option>)}
          </select>
        </label>
        <label>{hi ? "क्लिनिक स्लग (वैकल्पिक)" : "Clinic slug (optional)"}
          <input value={clinicSlug} disabled={stage === "verify" || busy} maxLength={80} onChange={e => setClinicSlug(e.target.value)} placeholder="e.g. my-clinic"/>
        </label>
        <label>{hi ? "अनुरोध का विवरण" : "Request details"}
          <textarea value={details} disabled={stage === "verify" || busy} maxLength={2000} rows={4} onChange={e => setDetails(e.target.value)} placeholder={hi ? "क्या सहायता चाहिए? मेडिकल विवरण लिखना आवश्यक नहीं है।" : "Describe what you need. Do not include unnecessary medical details."} required/>
        </label>
        {stage === "verify" && <label>{hi ? "ईमेल सत्यापन कोड" : "Email verification code"}
          <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required/>
        </label>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        <div className="privacy-actions">
          {stage === "verify" && <button type="button" className="ghost" onClick={() => { setStage("compose"); setOtp(""); setMessage(""); }} disabled={busy}>{hi ? "वापस" : "Back"}</button>}
          <button className="primary" disabled={busy}>{busy ? <RefreshCw className="animate-spin" size={16}/> : <Send size={16}/>} {stage === "verify" ? (hi ? "सत्यापित करके भेजें" : "Verify & Submit") : (hi ? "सत्यापन कोड भेजें" : "Send Verification Code")}</button>
        </div>
      </form>
    </section>
    <section className="card">
      <div className="card-title"><ShieldCheck/><h2>{hi ? "मेरे अनुरोध" : "My requests"}</h2></div>
      <label className="patient-request-filter">{hi ? "स्थिति के अनुसार देखें" : "Filter by status"}
        <select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">{hi ? "सभी अनुरोध" : "All requests"}</option>
          {["pending", "in_review", "fulfilled", "rejected"].map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
      </label>
      {visibleRequests.length === 0 ? <p className="patient-request-empty">{hi ? "इस सूची में कोई अनुरोध नहीं है।" : "No requests in this view."}</p> : <div className="privacy-history">
        {visibleRequests.map(item => <article className="privacy-request" key={item.id}>
          <div><strong>{TYPES.find(row => row[0] === item.type)?.[hi ? 2 : 1] || item.type}</strong><span className="privacy-status" data-status={item.status}>{statusLabel(item.status)}</span></div>
          <small>{new Date(item.createdAt).toLocaleString(hi ? "hi-IN" : "en-IN")} · {item.id}</small>
          <p>{item.details}</p>
          {item.resolution && <p className="muted">{item.resolution}</p>}
          {item.type === "erasure" && <PrivacyClosureStatus requestId={item.id} />}
        </article>)}
      </div>}
      <p className="muted">{hi ? "सहायता: " : "Support: "}<a href="mailto:rishabhmishra263800@gmail.com">rishabhmishra263800@gmail.com</a></p>
    </section>
    </div>
  </main>;
}
