import { useLanguage, Trans } from "./LanguageContext";
import React, { useEffect, useState } from "react";
import { onboardingApi } from "./api";

export default function StaffPasswordRecovery({ clinics, initial, onBack }) {
  const { t } = useLanguage();
  const [clinicSlug, setClinic] = useState(initial.clinicSlug || "");
  const [email, setEmail] = useState(initial.email || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function sendCode() {
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await onboardingApi.post("/auth/forgot-password", { clinicSlug, email }, { headers: { "X-Clinic-Slug": clinicSlug } });
      setSent(true); setOtp(""); setCooldown(60); setMessage(data.message);
    } catch (e) { setError(e.response?.data?.message || "Unable to request a code. Please try again."); }
    finally { setBusy(false); }
  }
  async function submit(e) {
    e.preventDefault();
    if (!sent) return sendCode();
    setError("");
    if (password !== confirm) return setError("Passwords do not match.");
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) return setError("Use at least 12 characters and at most 72 UTF-8 bytes.");
    setBusy(true);
    try {
      const { data } = await onboardingApi.post("/auth/reset-password", { clinicSlug, email, otp, password }, { headers: { "X-Clinic-Slug": clinicSlug } });
      setDone(true); setOtp(""); setPassword(""); setConfirm(""); setMessage(data.message);
    } catch (e) { setError(e.response?.data?.message || "Unable to reset password. Please try again."); }
    finally { setBusy(false); }
  }
  return <form className="loginbox" onSubmit={submit}>
    <p className="eyebrow"><Trans text={"Staff account recovery"} /></p><h1><Trans text={"Forgot password?"} /></h1>
    <p className="muted"><Trans text={"For clinic admins, doctors and receptionists. Use the email registered with your clinic."} /></p>
    {!done && <>
      <label><Trans text={"Clinic / Hospital"} /><select required disabled={busy || sent} value={clinicSlug} onChange={e => setClinic(e.target.value)}>
        <option value="">{t("Select clinic")}</option>{clinics.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select></label>
      <label><Trans text={"Registered staff email"} /><input type="email" autoComplete="username" required maxLength={254} disabled={busy || sent} value={email} onChange={e => setEmail(e.target.value)} /></label>
      {sent && <>
        <label><Trans text={"Email verification code"} /><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} /></label>
        <label><Trans text={"New password"} /><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label><Trans text={"Confirm new password"} /><input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        <small><Trans text={"Code expires in 10 minutes. You have up to 5 verification attempts. Use a password of at least 12 characters."} /></small>
      </>}
    </>}
    {message && <p className="success" role="status">{t(message)}</p>}
    {error && <div className="login-error" role="alert">{t(error)}</div>}
    {!done && <button className="primary" disabled={busy || !clinicSlug}>{busy ? "Please wait…" : sent ? "Reset password" : "Send verification code"}</button>}
    {sent && !done && <button type="button" className="ghost" disabled={busy || cooldown > 0} onClick={sendCode}>{cooldown ? `Resend code in ${cooldown}s` : "Resend code"}</button>}
    <button type="button" className="ghost" disabled={busy} onClick={onBack}><Trans text={"Back to staff sign in"} /></button>
  </form>;
}
