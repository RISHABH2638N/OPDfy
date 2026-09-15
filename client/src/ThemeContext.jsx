import { useLanguage, Trans } from "./LanguageContext";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "opd_color_theme";
const ThemeContext = createContext({ theme: "light", setTheme: () => {} });

function initialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch { return "light"; }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);
  const setTheme = (value) => setThemeState(value === "dark" ? "dark" : "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { t } = useLanguage();
  const { theme, setTheme } = useContext(ThemeContext);
  const dark = theme === "dark";
  return <button type="button" className="theme-toggle" onClick={() => setTheme(dark ? "light" : "dark")}
    aria-label={t(dark ? "Switch to light mode" : "Switch to dark mode")} title={t(dark ? "Light mode" : "Dark mode")}>
    {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    <span>{dark ? t("Light") : t("Dark")}</span>
  </button>;
}
