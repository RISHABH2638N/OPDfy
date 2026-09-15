import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { LanguageProvider } from "./LanguageContext.jsx";
import { ThemeProvider } from "./ThemeContext.jsx";
import "./styles.css";
import "./theme-premium.css";
import "./queue-intervention-fix.css";
import "./dark-mode.css";
import "./dark-contrast.css";
import "./patient-workspace-ui.css";
import "./legal-verification.css";
import "./clinical-consent.css";
import "./responsive-professional.css";
import "./platform-branding.css";
import "./public-responsive-navigation.css";
try {
for (const key of ["opd_token", "opd_user", "opd_patient_token", "opd_patient_user", "opd_platform_token", "opd_platform_user", "opd_clinic_onboarding_token"]) {
  localStorage.removeItem(key);
}
} catch { /* Storage may be unavailable in private browser contexts. */ }
createRoot(document.getElementById("root")).render(
  <ThemeProvider><LanguageProvider><BrowserRouter><App /></BrowserRouter></LanguageProvider></ThemeProvider>,
);
