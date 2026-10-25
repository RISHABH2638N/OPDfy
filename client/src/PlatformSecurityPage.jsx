import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { platformApi, savePlatformAuth } from "./api";
import { useLanguage } from "./LanguageContext";
export default function PlatformSecurityPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState(null), [pending, setPending] = useState(null);
  const [password, setPassword] = useState(""), [code, setCode] = useState("");
  const [codes, setCodes] = useState([]), [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const load = async signal => {
    try { const { data } = await platformApi.get("/platform/auth/mfa/status", { signal }); setStatus(data); }
    catch (e) { if (e.code !== "ERR_CANCELED") setError(e.userMessage || e.response?.data?.message || t("Unable to load security settings.")); }
  };
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, []);
  async function action(kind) {
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await platformApi.post(`/platform/auth/mfa/${kind}`, { password, code });
      if (kind === "enroll") setPending(data);
      else {
        if (data.token) savePlatformAuth(data);
        setPending(null); setCodes(data.recoveryCodes || []); setSaved(false);
        setPassword(""); setCode(""); await load();
        setMessage(kind === "disable" ? "MFA disabled. Enroll again before continuing if required by your operator." : "Security settings saved. Store your recovery codes safely.");
      }
    } catch (e) { setError(e.userMessage || e.response?.data?.message || "Unable to update security settings."); }
    finally { setBusy(false); }
  }
  return <main className="page premium-page"><section className="card">
    <h1>{t("Platform account security")}</h1>
    <p>{t("Protect the platform owner account with an authenticator app. Recovery codes are shown once and each works only once.")}</p>
    {error && <div className="login-error" role="alert">{t(error)}</div>}
    {message && <p role="status">{t(message)}</p>}
    {!status ? <button className="ghost" onClick={() => load()}>{t("Retry")}</button> : <>
      <p>{t(status.enabled ? "Authenticator protection is enabled." : "Authenticator protection is not enabled.")}</p>
      {status.enrollmentRequired && <p role="status">{t("Complete MFA enrollment before using the platform console.")}</p>}
      {!status.configured && <p role="alert">{t("Your operator must configure secure MFA storage before enrollment.")}</p>}
      {codes.length ? <section aria-labelledby="recovery-codes-title">
        <h2 id="recovery-codes-title">{t("Recovery codes")}</h2>
        <p>{t("Store these offline in a safe place. They will not be shown again. Never share them with anyone.")}</p>
        <ul>{codes.map(value => <li key={value}><code>{value}</code></li>)}</ul>
        <label><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />{t("I have stored my recovery codes safely")}</label>
        <button className="primary" disabled={!saved} onClick={() => { setCodes([]); setMessage(""); }}>{t("Hide recovery codes")}</button>
      </section> : <form onSubmit={e => { e.preventDefault(); action(status.enabled ? "recovery-codes" : pending ? "enable" : "enroll"); }}>
        {pending && <section aria-labelledby="authenticator-setup-title">
          <h2 id="authenticator-setup-title">{t("Add OPDfy to your authenticator")}</h2>
          <QRCodeSVG value={pending.otpauthUri} size={190} aria-label={t("Authenticator enrollment QR code")} />
          <p>{t("Or enter this setup key in your authenticator app")}: <code className="mfa-setup-key">{pending.secret}</code></p>
          <p>{t("Then enter its current six-digit code to activate protection. Setup expires after ten minutes.")}</p>
        </section>}
        <label>{t("Current platform password")}<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        {(pending || status.enabled) && <label>{t(status.enabled ? "Authenticator or recovery code" : "Authenticator code")}
          <input type="text" required autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={24} value={code} onChange={e => setCode(e.target.value.trim())} disabled={busy} /></label>}
        <button className="primary" type="submit" disabled={busy || !status.configured}>{t(busy ? "Please wait..." : status.enabled ? "Replace recovery codes" : pending ? "Enable authenticator protection" : "Start authenticator enrollment")}</button>
        {status.enabled && <button type="button" className="ghost" disabled={busy || !password || !code} onClick={() => {
          if (window.confirm(t("Disable authenticator protection? Existing platform sessions will be signed out."))) action("disable");
        }}>{t("Disable authenticator protection")}</button>}
        {pending && <button type="button" className="ghost" disabled={busy} onClick={() => { setPending(null); setPassword(""); setCode(""); }}>{t("Cancel setup")}</button>}
      </form>}
      {!status.enrollmentRequired && <p><Link to="/platform">{t("Back to platform console")}</Link></p>}
    </>}
  </section></main>;
}
