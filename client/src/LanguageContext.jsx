import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { setUiLanguage, translateUiText } from "./i18n.js";

const STORAGE_KEY = "opd_ui_language";
const LanguageContext = createContext({ language: "en", setLanguage: () => {}, t: (text) => text });

export function useLanguage() { return useContext(LanguageContext); }

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "hi" ? "hi" : "en"; }
    catch { return "en"; }
  });
  setUiLanguage(language);
  const setLanguage = (next) => setLanguageState(next === "hi" ? "hi" : "en");
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Storage may be unavailable. */ }
  }, [language]);
  const value = useMemo(() => ({
    language, setLanguage,
    t: (text, params) => translateUiText(text, language, params),
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// Static and structured UI copy is rendered by React. Never mutate text nodes:
// that can overwrite patient names or create stale text during React reconciliation.
export function Trans({ text, values, children }) {
  const { t } = useLanguage();
  return t(text ?? children, values);
}

// Kept as a compatibility component for the existing AppLayout call sites.
export function DashboardTranslator() { return null; }

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return <label className="language-switcher" data-no-translate>
    <Languages size={15} aria-hidden="true" />
    <span className="language-switcher-label">भाषा / Language</span>
    <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Choose dashboard language / डैशबोर्ड की भाषा चुनें">
      <option value="en">English</option><option value="hi">हिन्दी</option>
    </select>
  </label>;
}

export { translateUiText } from "./i18n.js";
