import React, { useEffect, useState } from "react";
import { ShieldCheck, Download, RefreshCw } from "lucide-react";
import { patientPlatformApi } from "./api";
import { useLanguage } from "./LanguageContext";

const messageOf = async error => {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || "Request failed."; } catch { return "Request failed."; }
  }
  return data?.message || "Request failed. Please try again.";
};

export function PrivacyConsentControls() {
  const { language, t } = useLanguage();
  const hi = language === "hi";
  const [data, setData] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => { const { data } = await patientPlatformApi.get("/privacy/consents"); setData(data); };
  useEffect(() => { load().catch(() => setError("Unable to load consent preferences.")); }, []);
  const save = async decision => {
    if (!data) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await patientPlatformApi.post("/privacy/consents", {
        purpose: "external_ai", decision, noticeVersion: data.notice.version,
        language: hi ? "hi" : "en", acknowledged: true,
      });
      setMessage(response.data.message);
      setAcknowledged(false);
      await load();
    } catch (error) { setError(await messageOf(error)); }
    finally { setBusy(false); }
  };
  return <section className="card privacy-section">
    <div className="card-title"><ShieldCheck/><h2>{hi ? "वैकल्पिक AI सहमति" : "Optional external AI consent"}</h2></div>
    <p className="muted">{hi ? "यह सहमति सामान्य बुकिंग, कतार और चिकित्सा सेवाओं से अलग है।" : "This is separate from ordinary booking, queue and clinical services."}</p>
    {data && <>
      <p className="privacy-notice">{hi ? data.notice.hi : data.notice.en}</p>
      <p className="muted">{hi ? "स्थिति: " : "Status: "}<strong>{data.active ? (hi ? "सक्रिय" : "Granted") : (hi ? "अनुमति नहीं" : "Not granted")}</strong>
        {data.current?.recordedAt && <> · {new Date(data.current.recordedAt).toLocaleString()}</>}</p>
      {!data.active && <>
        {data.eligible === false && <p className="muted">{hi ? "बाहरी AI केवल सत्यापित वयस्क प्रोफ़ाइल के लिए उपलब्ध है। अभिभावक सहमति का समर्थन अभी उपलब्ध नहीं है। सामान्य क्लिनिक सेवाएँ जारी रहेंगी।" : "External AI is available only to adult profiles with a valid date of birth. Guardian consent support is not yet available. Ordinary clinic services remain available."}</p>}
        <label className="privacy-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>
          <span>{hi ? "मैंने सूचना पढ़ ली है और वैकल्पिक बाहरी AI प्रोसेसिंग की अनुमति देता/देती हूँ।" : "I have read the notice and affirmatively agree to optional external AI processing."}</span></label>
        <button type="button" className="primary" disabled={!acknowledged || busy || data.eligible === false} onClick={() => save("granted")}>{hi ? "सहमति दें" : "Grant optional consent"}</button>
      </>}
      {data.active && <button type="button" className="ghost" disabled={busy} onClick={() => save("withdrawn")}>{hi ? "सहमति वापस लें" : "Withdraw consent"}</button>}
    </>}
    {busy && <p className="muted"><RefreshCw size={15} className="animate-spin"/> {t("Saving...")}</p>}
    {error && <p className="login-error" role="alert">{t(error)}</p>}
    {message && <p className="success" role="status">{t(message)}</p>}
  </section>;
}

export function PrivacyDataExport({ onCreated }) {
  const { language, t } = useLanguage();
  const hi = language === "hi";
  const [stage, setStage] = useState("ready");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const send = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await patientPlatformApi.post("/privacy/verification", { type: "access" });
      setStage("verify"); setMessage(hi ? "पंजीकृत ईमेल पर कोड भेजा गया है।" : "A code has been sent to your registered email.");
    } catch (error) { setError(await messageOf(error)); }
    finally { setBusy(false); }
  };
  const download = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    let grant = "";
    try {
      const prepared = await patientPlatformApi.post("/privacy/exports/prepare", { otp });
      grant = prepared.data.token;
      setOtp("");
      const response = await patientPlatformApi.post("/privacy/exports/download", { token: grant }, { responseType: "blob" });
      grant = "";
      const blob = new Blob([response.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "opd-personal-data.json";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStage("ready");
      setMessage(hi ? "डेटा फ़ाइल तैयार कर दी गई है। इसे सुरक्षित रखें।" : "Your data file has been prepared. Keep it secure.");
      if (onCreated) await onCreated();
    } catch (error) {
      setError(await messageOf(error));
      if (grant) setError(hi ? "डाउनलोड सफल नहीं हुआ। सुरक्षा के लिए नया सत्यापन कोड लेकर फिर प्रयास करें।" : "The download could not be completed. Request a fresh verification code before retrying.");
      setOtp(""); setStage("ready");
    } finally { grant = ""; setBusy(false); }
  };
  return <section className="card privacy-section">
    <div className="card-title"><Download/><h2>{hi ? "मेरा डेटा डाउनलोड करें" : "Download my personal data"}</h2></div>
    <p className="muted">{hi ? "ताज़े ईमेल सत्यापन के बाद आपके वैश्विक प्रोफ़ाइल और सत्यापित क्लिनिक रिकॉर्ड की JSON कॉपी तैयार होगी। पुराने असत्यापित रिकॉर्ड और बड़े निर्यात के लिए सहायता से संपर्क करें।" : "After fresh email verification, download a JSON copy of your global profile and positively verified clinic records. Historical identity disputes and larger exports require assisted review."}</p>
    <p className="muted">{hi ? "फ़ाइल में संवेदनशील चिकित्सा जानकारी हो सकती है। इसे केवल अपने सुरक्षित उपकरण पर सहेजें।" : "The file may contain sensitive medical information. Save it only on a device you trust."}</p>
    {stage === "ready" ? <button type="button" className="ghost" onClick={send} disabled={busy}><Download size={16}/> {hi ? "डाउनलोड के लिए कोड भेजें" : "Send export verification code"}</button>
      : <form className="privacy-form" onSubmit={download}>
        <label>{hi ? "छह अंकों का ईमेल कोड" : "Six-digit email code"}<input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required/></label>
        <div className="privacy-actions"><button type="button" className="ghost" disabled={busy} onClick={() => { setStage("ready"); setOtp(""); }}>{t("Cancel")}</button><button className="primary" disabled={busy || otp.length !== 6}><Download size={16}/> {hi ? "सत्यापित करें और डाउनलोड करें" : "Verify & download"}</button></div>
      </form>}
    {error && <p className="login-error" role="alert">{t(error)}</p>}
    {message && <p className="success" role="status">{t(message)}</p>}
  </section>;
}

export function PrivacyClosureStatus({ requestId }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const load = async () => {
    try { const { data } = await patientPlatformApi.get(`/privacy/closure/${requestId}`); setData(data); setError(""); }
    catch (error) { setError(await messageOf(error)); }
  };
  return <div className="privacy-closure-status">
    <button type="button" className="ghost" onClick={() => { if (!open) load(); setOpen(!open); }}>{t(open ? "Hide retention review" : "View retention review")}</button>
    {open && <div className="privacy-review-detail">
      {error && <p className="login-error">{t(error)}</p>}
      {data && <>
        <p>{t("Account:")} {t(data.inventory.account.status)}. {t("Active visit obligations:")} {t(data.inventory.hasActiveVisits ? "Present" : "None found in this review")}.</p>
        <p className="muted">{t("Clinic-owned records are not automatically erased or cancelled. The responsible clinics must review applicable retention obligations.")}</p>
        {data.inventory.clinics.map(c => <div className="privacy-request" key={c.tenantId}>
          <strong>{c.name}</strong><p>{t("Linked records:")} {c.memberships}. {t("Open follow-ups:")} {c.openFollowUps}.</p>
          <p className="muted">{c.unavailable ? t("Historical clinic record unavailable — documented manual review required.") : `${t("Retention review:")} ${t(data.approvals.some(a => String(a.tenantId) === String(c.tenantId)) ? "Recorded" : "Pending")}`}</p>
        </div>)}
      </>}
    </div>}
  </div>;
}
