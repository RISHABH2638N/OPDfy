import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, HeartPulse, Image as ImageIcon, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { platformApi } from "./api";
import { Trans, useLanguage } from "./LanguageContext";

const MAX_LOGO_BYTES = 300 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export default function PlatformBrandingPage() {
  const { t } = useLanguage();
  const fileInputRef = useRef(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [savedLogoUrl, setSavedLogoUrl] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [logoShape, setLogoShape] = useState("wide");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadBranding = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await platformApi.get("/platform/branding");
      const currentLogo = String(data?.branding?.logoUrl || "");
      setLogoUrl(currentLogo);
      setSavedLogoUrl(currentLogo);
      setUpdatedAt(data?.branding?.updatedAt || null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load platform branding.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBranding(); }, []);

  const chooseLogo = (event) => {
    const file = event.target.files?.[0];
    setMessage("");
    setError("");
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError("Choose a PNG, JPG or WebP logo.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Keep the platform logo under 300 KB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(String(reader.result || ""));
    reader.onerror = () => setError("Unable to read this logo file.");
    reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const { data } = await platformApi.put("/platform/branding", { logoUrl });
      const branding = data?.branding || { productName: "OPDfy", logoUrl };
      setLogoUrl(String(branding.logoUrl || ""));
      setSavedLogoUrl(String(branding.logoUrl || ""));
      setUpdatedAt(branding.updatedAt || null);
      setMessage(data?.message || "Platform branding saved.");
      window.dispatchEvent(new CustomEvent("opdfy:branding-updated", { detail: { branding } }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save platform branding.");
    } finally {
      setSaving(false);
    }
  };

  const removeLogo = () => {
    setLogoUrl("");
    setMessage("");
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasUnsavedChanges = logoUrl !== savedLogoUrl;
  const inspectLogoShape = (event) => {
    const image = event.currentTarget;
    const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
    setLogoShape(ratio <= 1.3 ? "square" : "wide");
  };

  return (
    <main className="platform-branding-page">
      <section className="platform-branding-hero">
        <div className="platform-branding-hero-icon"><ImageIcon size={24} /></div>
        <div>
          <p className="eyebrow"><Trans text="Brand management" /></p>
          <h1><Trans text="Website & App Logo" /></h1>
          <p><Trans text="Upload the official OPDfy logo shown on public home and sign-in headers." /></p>
        </div>
        <span className="platform-branding-status"><CheckCircle size={16} /> <Trans text={savedLogoUrl ? "Custom logo active" : "Default icon active"} /></span>
      </section>

      <section className="platform-branding-card" aria-busy={loading || saving}>
        <div className="platform-branding-card-head">
          <div><h2><Trans text="Primary platform logo" /></h2><p><Trans text="Upload a square icon or a wide wordmark. The layout adapts automatically on desktop and mobile." /></p></div>
          <button type="button" className="ghost compact" onClick={loadBranding} disabled={loading || saving}><RefreshCw size={15} /> <Trans text="Refresh" /></button>
        </div>

        {loading ? <div className="platform-branding-loading"><RefreshCw size={20} className="spin" /> <Trans text="Loading branding..." /></div> : (
          <div className="platform-branding-editor">
            <div className={`platform-branding-preview ${logoUrl ? "has-logo" : ""}`}>
              {logoUrl ? <><img src={logoUrl} alt={t("OPDfy logo preview")} onLoad={inspectLogoShape} /><span className="platform-logo-ratio-badge"><Trans text={logoShape === "square" ? "Square logo · icon layout" : "Wide logo · wordmark layout"} /></span></> : <div className="platform-branding-fallback"><HeartPulse size={34} /><strong>OPDfy</strong></div>}
            </div>

            <div className="platform-branding-controls">
              <div className="platform-branding-guidance">
                <strong><Trans text="Recommended logo file" /></strong>
                <span><Trans text="PNG, JPG or WebP · maximum 300 KB · 1:1 or 16:9 supported" /></span>
                {updatedAt && <small><Trans text="Last updated" />: {new Date(updatedAt).toLocaleString()}</small>}
              </div>
              <div className="platform-branding-actions">
                <label className="platform-logo-upload"><Upload size={16} /> <Trans text={logoUrl ? "Choose another logo" : "Choose logo"} /><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} /></label>
                {logoUrl && <button type="button" className="ghost danger-outline" onClick={removeLogo}><Trash2 size={16} /> <Trans text="Remove logo" /></button>}
              </div>
              <p className="platform-branding-safety"><Trans text="Only the platform logo changes. Clinic logos, patient records and operational settings remain untouched." /></p>
            </div>
          </div>
        )}

        {error && <div className="platform-branding-feedback error" role="alert">{t(error)}</div>}
        {message && <div className="platform-branding-feedback success" role="status"><CheckCircle size={16} /> {t(message)}</div>}

        <div className="platform-branding-savebar">
          <span>{hasUnsavedChanges ? t("Unsaved logo change") : t("Branding is up to date")}</span>
          <button type="button" className="primary" disabled={loading || saving || !hasUnsavedChanges} onClick={saveBranding}><Save size={16} /> {t(saving ? "Saving..." : "Save & publish logo")}</button>
        </div>
      </section>
    </main>
  );
}
