import React, {lazy, Suspense} from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { RouteRecoveryBoundary } from "./AppErrorBoundary.jsx";
import PublicWebsite from "./PublicWebsite.jsx";
import RouteMetadata from "./RouteMetadata.jsx";
import {isPublicPage,isApplicationPath} from "./seo.js";
const App = lazy(() => import("./App.jsx"));
function WebsiteRouter(){
 const {pathname}=useLocation();
 return <><RouteMetadata />{isPublicPage(pathname)||!isApplicationPath(pathname)?<PublicWebsite/>:<Suspense fallback={<main className="page"><p role="status">Loading workspace…</p></main>}><App/></Suspense>}</>;
}
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
import "./landing.css";
try {
for (const key of ["opd_token", "opd_user", "opd_patient_token", "opd_patient_user", "opd_platform_token", "opd_platform_user", "opd_clinic_onboarding_token"]) {
  localStorage.removeItem(key);
}
} catch { /* Storage may be unavailable in private browser contexts. */ }
const target=document.getElementById("root");
const prerendered=target.dataset.prerendered==='public';
const tree=<ThemeProvider deferPreferences={prerendered}><LanguageProvider deferPreferences={prerendered}><BrowserRouter><RouteRecoveryBoundary><WebsiteRouter/></RouteRecoveryBoundary></BrowserRouter></LanguageProvider></ThemeProvider>;
if(prerendered)hydrateRoot(target,tree,{onRecoverableError(){ console.error('Public page hydration could not be completed.'); }});
else createRoot(target).render(tree);
