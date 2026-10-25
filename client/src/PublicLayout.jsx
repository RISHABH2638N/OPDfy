import React, {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {HeartPulse,User,ArrowRight,Plus,ShieldAlert,LogIn,Menu,X,ChevronRight,ShieldCheck} from 'lucide-react';
import {useLanguage,Trans,DashboardTranslator,LanguageSwitcher} from './LanguageContext';
import {ThemeToggle} from './ThemeContext';
import {PublicFooter} from './PublicPages';
import {getPatientToken} from './publicSession';
export default function PublicLayout({children}) {
 const {t}=useLanguage(), location=useLocation();
 const topbarRef=useRef(null),publicMenuToggleRef=useRef(null),publicMenuCloseRef=useRef(null),publicMenuPanelRef=useRef(null);
 const [isPublicMenuOpen,setIsPublicMenuOpen]=useState(false);
 const [hasPatientSession,setHasPatientSession]=useState(false);
 const [platformBranding,setPlatformBranding]=useState({productName:'OPDfy',logoUrl:''});
 const [platformLogoShape,setPlatformLogoShape]=useState('wide');
 const isCurrentPage=path=>location.pathname===path;
 useEffect(()=>{setHasPatientSession(Boolean(getPatientToken()));setIsPublicMenuOpen(false);},[location.pathname,location.search]);
 useEffect(()=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  const api=import.meta.env.VITE_API_URL||'/api';
  fetch(api.replace(/\/$/,'')+'/platform/branding/public',{signal:controller.signal,credentials:'include'})
   .then(r=>{if(!r.ok)throw Error('Branding unavailable');return r.json();})
   .then(data=>{if(!controller.signal.aborted)setPlatformBranding(data.branding||{productName:'OPDfy',logoUrl:''});}).catch(()=>{}).finally(()=>clearTimeout(timer));
  const update=e=>{if(e.detail?.branding)setPlatformBranding(e.detail.branding);};
  window.addEventListener('opdfy:branding-updated',update);
  return()=>{controller.abort();clearTimeout(timer);window.removeEventListener('opdfy:branding-updated',update);};
 },[]);
  useEffect(() => {
    const logoUrl = String(platformBranding.logoUrl || "");
    if (!logoUrl) {
      setPlatformLogoShape("wide");
      return undefined;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
      setPlatformLogoShape(ratio <= 1.3 ? "square" : "wide");
    };
    image.onerror = () => { if (active) setPlatformLogoShape("wide"); };
    image.src = logoUrl;
    return () => { active = false; };
  }, [platformBranding.logoUrl]);

  useEffect(() => {
    document.body.classList.toggle("public-nav-open", isPublicMenuOpen);
    if (!isPublicMenuOpen) return () => document.body.classList.remove("public-nav-open");

    const focusTimer = window.setTimeout(() => publicMenuCloseRef.current?.focus(), 0);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsPublicMenuOpen(false);
        window.setTimeout(() => publicMenuToggleRef.current?.focus(), 0);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(publicMenuPanelRef.current?.querySelectorAll("a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const closeAtDesktopWidth = () => {
      if (window.innerWidth > 1120 && location.pathname !== "/") setIsPublicMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeAtDesktopWidth);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeAtDesktopWidth);
      document.body.classList.remove("public-nav-open");
    };
  }, [isPublicMenuOpen, location.pathname]);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return undefined;
    const shell = topbar.closest(".app-shell");
    if (!shell) return undefined;

    const syncTopbarHeight = () => {
      const height = Math.ceil(topbar.getBoundingClientRect().height);
      if (height > 0) shell.style.setProperty("--active-topbar-height", `${height}px`);
    };

    syncTopbarHeight();
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(syncTopbarHeight)
      : null;
    observer?.observe(topbar);
    window.addEventListener("resize", syncTopbarHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncTopbarHeight);
      shell.style.removeProperty("--active-topbar-height");
    };
  }, [location.pathname]);
  return (
    <div className={`app-shell public-mode ${location.pathname === "/" ? "landing-mode" : ""}`}>
      <DashboardTranslator />
      <a href="#main-content" className="skip-link"><Trans text={"Skip to content"} /></a>
      <header ref={topbarRef} className="premium-header">
        <div className="header-inner">
          <Link to="/" className={`premium-brand ${platformBranding.logoUrl ? `uses-platform-logo platform-logo-${platformLogoShape}` : ""}`}>
            <span aria-hidden="true" className={`brand-mark ${platformBranding.logoUrl ? "has-clinic-logo" : ""}`}>
              {platformBranding.logoUrl ? <img src={platformBranding.logoUrl} alt="" width="38" height="38" decoding="async" /> : <HeartPulse size={20} strokeWidth={2.5} />}
            </span>
            <span>
              <strong>{platformBranding.productName || "OPDfy"}</strong>
              <small><Trans text={"Precision Queue & EHR"} /></small>
            </span>
          </Link>

          <nav className="premium-nav public-patient-nav" aria-label={t("Primary navigation")}>
            {location.pathname === "/" ? <>
              <a href="#workflow">{t("How it works")}</a>
              <a href="#features">{t("Features")}</a>
              <a href="#pricing">{t("Pricing")}</a>
              <a href="#questions">{t("FAQs")}</a>
            </> : <Link className="patient-portal-link" to={hasPatientSession ? "/patient/clinics" : "/patient-login"} aria-current={isCurrentPage("/patient-login") || isCurrentPage("/patient/clinics") ? "page" : undefined}>
              <User size={15} /> <Trans text={"Patient Portal"} /></Link>}
          </nav>

          <div className="header-actions public-desktop-actions">
            {location.pathname === "/" ? <>
              <Link to={hasPatientSession ? "/patient/clinics" : "/patient-login"} className="patient-portal-link"><User size={16} /><Trans text={"Patient Portal"} /></Link>
              <Link to="/clinic/register" className="clinic-register-link"><Trans text={"Register Clinic"} /><ArrowRight size={16}/></Link>
            </> : <>
              <LanguageSwitcher />
              <ThemeToggle />
              <Link to="/clinic/register" className="clinic-register-link"><Plus size={15} /> <Trans text={"Register Clinic"} /></Link>
              <Link to="/platform/login" className="platform-admin-link"><ShieldAlert size={15} /> <Trans text={"Platform Admin"} /></Link>
              <Link to="/login" className="staff-login-link"><LogIn size={15} /> <Trans text={"Staff Sign In"} /></Link>
            </>}
          </div>

          <button
            ref={publicMenuToggleRef}
            type="button"
            className="public-menu-toggle"
            onClick={() => setIsPublicMenuOpen(true)}
            aria-label={t("Open navigation menu")}
            aria-expanded={isPublicMenuOpen}
            aria-controls="public-mobile-navigation"
          >
            <Menu size={21} />
          </button>
        </div>
      </header>
      <div className="premium-header-spacer" aria-hidden="true" />

      {isPublicMenuOpen && (
        <>
          <button
            type="button"
            className="public-menu-backdrop"
            onClick={() => setIsPublicMenuOpen(false)}
            aria-label={t("Close navigation menu")}
          />
          <aside ref={publicMenuPanelRef} id="public-mobile-navigation" className="public-menu-panel" role="dialog" aria-modal="true" aria-labelledby="public-menu-title">
            <div className="public-menu-head">
              <div>
                <span><Trans text="OPDfy access" /></span>
                <strong id="public-menu-title"><Trans text="Menu & preferences" /></strong>
              </div>
              <button ref={publicMenuCloseRef} type="button" className="public-menu-close" onClick={() => setIsPublicMenuOpen(false)} aria-label={t("Close navigation menu")}>
                <X size={21} />
              </button>
            </div>

            <section className="public-menu-preferences" aria-label={t("Interface preferences")}>
              <span className="public-menu-section-label"><Trans text="Interface preferences" /></span>
              <LanguageSwitcher />
              <ThemeToggle />
            </section>

            <nav className="public-menu-links" aria-label={t("Account and clinic access")}>
              <span className="public-menu-section-label"><Trans text="Account and clinic access" /></span>
              {location.pathname === "/" && <>
                <a className="public-menu-link" href="#workflow" onClick={() => setIsPublicMenuOpen(false)}>{t("How it works")}</a>
                <a className="public-menu-link" href="#features" onClick={() => setIsPublicMenuOpen(false)}>{t("Features")}</a>
                <a className="public-menu-link" href="#pricing" onClick={() => setIsPublicMenuOpen(false)}>{t("Pricing")}</a>
                <Link to={hasPatientSession ? "/patient/clinics" : "/patient-login"} className="public-menu-link" onClick={() => setIsPublicMenuOpen(false)}><User size={18}/><span><strong>{t("Patient Portal")}</strong></span><ChevronRight size={17}/></Link>
              </>}
              <Link to="/clinic/register" className="public-menu-link register" onClick={() => setIsPublicMenuOpen(false)}>
                <Plus size={18} /><span><strong><Trans text="Register Clinic" /></strong><small><Trans text="Create a new clinic workspace" /></small></span><ChevronRight size={17} />
              </Link>
              <Link to="/platform/login" className="public-menu-link" onClick={() => setIsPublicMenuOpen(false)}>
                <ShieldAlert size={18} /><span><strong><Trans text="Platform Admin" /></strong><small><Trans text="Open platform administration" /></small></span><ChevronRight size={17} />
              </Link>
              <Link to="/login" className="public-menu-link staff" onClick={() => setIsPublicMenuOpen(false)}>
                <LogIn size={18} /><span><strong><Trans text="Staff Sign In" /></strong><small><Trans text="Access your clinic workstation" /></small></span><ChevronRight size={17} />
              </Link>
            </nav>

            <div className="public-menu-foot">
              <ShieldCheck size={17} />
              <span><strong><Trans text="Secure access" /></strong><small><Trans text="Protected clinic and patient workspaces" /></small></span>
            </div>
          </aside>
        </>
      )}

      <div id="main-content" tabIndex={-1} className="app-content">{children}</div>
      {location.pathname !== "/" && <PublicFooter />}
    </div>
  );
}
