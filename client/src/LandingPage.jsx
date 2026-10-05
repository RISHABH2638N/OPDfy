import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity, ArrowRight, BarChart3, CalendarCheck2, Check, ChevronDown, ChevronRight,
  ClipboardCheck, FileText, HeartPulse, LayoutDashboard, LockKeyhole, Monitor,
  Pause, Play, Plus, QrCode, Search, ShieldCheck, Stethoscope, Ticket, Users, X,
} from "lucide-react";
import { useLanguage } from "./LanguageContext.jsx";
import { getPatientToken } from "./api.js";

const clinicFeatures = [
  [Ticket, "Automated Queue Management", "One doctor-wise queue for appointments and walk-ins. Call, hold, skip and complete each visit with connected updates."],
  [FileText, "Instant Digital Prescriptions", "Document consultations, generate prescriptions and keep follow-up plans connected to the visit."],
  [ClipboardCheck, "Paperless Patient Profiles", "Find visit history and doctor-reviewed health conditions in the patient workspace, with the right access controls."],
];
const workflow = [
  [CalendarCheck2, "Book or walk in", "Patients book ahead, or reception registers their arrival."],
  [QrCode, "Confirm arrival", "Reception checks the booking, payment and arrival."],
  [Stethoscope, "Consult & prescribe", "Doctors manage their queue and document the visit."],
  [HeartPulse, "Continue care", "Prescriptions, visit history and follow-ups stay connected."],
];
// Doctor-count tiers share the Clinic Edition workflow; lists highlight use cases.
const pricingPlans = [
  {
    name: "Starter", Icon: Stethoscope, doctors: "1–2 doctors", monthly: 1299, yearlyMonthly: 1099,
    description: "For solo practitioners & small clinics", benefit: "Keep everyday visits organised.",
    features: ["Appointments & walk-in check-in", "Doctor-wise live token queues", "Digital prescriptions & follow-ups", "Patient portal & notifications", "Clinic analytics & payment records"],
  },
  {
    name: "Growth", Icon: Users, doctors: "3–5 doctors", monthly: 1899, yearlyMonthly: 1599,
    description: "For multi-doctor clinic teams", benefit: "Coordinate a growing care team.",
    features: ["Appointments, queues & prescriptions", "Connected reception & doctor workflows", "Staff and schedule management", "Doctor workload & personal analytics", "Clinic insights & data exports"],
  },
  {
    name: "Enterprise", Icon: LayoutDashboard, doctors: "6–8 doctors", monthly: 3499, yearlyMonthly: 3099,
    description: "For larger outpatient teams & polyclinics", benefit: "Bring every department into one view.",
    features: ["Connected clinic & patient portals", "Doctor and department configuration", "Doctor-wise queues & waiting-room display", "Consolidated clinic & payment insights", "Clinic reports & data exports"],
  },
];
const formatPrice = value => `₹${value.toLocaleString("en-IN")}`;
const faq = [
  ["How is patient information protected?", "Clinic records are scoped to the clinic and authorized roles. Patients sign in to access their own records. Read the Privacy Policy for consent, retention and optional AI details; no system can promise zero security risk."],
  ["Will my reception team need extensive training?", "Reception, doctors and patients each have a focused workspace. During the pilot, we review your current process and agree on onboarding and staff guidance."],
  ["Can we move our existing records into OPDfy?", "Discuss your record format during the demo. Migration scope, data quality, permissions and any additional work must be reviewed before an import is agreed."],
  ["Does OPDfy guarantee a consultation time?", "No. Queue position updates live, but waiting time is an estimate. Consultation duration, priority cases and clinic operations can change the wait."],
  ["How does the 14-day pilot work?", "Discuss your workflow, configure the pilot, then use OPDfy during daily operations for 14 days. Review the experience before choosing a plan. A one-time setup fee of ₹1,999 applies when you continue after the pilot. Tax treatment and subscription terms are confirmed during the demo."],
  ["Are online payments included?", "OPDfy records payments collected at the clinic counter, including the selected payment method. This does not mean an integrated online payment gateway is included."],
];

// Illustrative UI only: no patient records, customer counts or measured ROI claims.
function DashboardPreview({ compact = false, step = 0 }) {
  const { t } = useLanguage();
  return <div className={`op-preview ${compact ? "op-preview-compact" : ""}`}>
    <div className="op-preview-chrome"><span className="op-preview-brand"><HeartPulse size={18} aria-hidden="true" />OPDfy</span><span className="op-preview-label">{t("Illustrative dashboard")}</span></div>
    <div className="op-preview-body">
      <div className="op-preview-rail" aria-hidden="true">{[LayoutDashboard, Ticket, CalendarCheck2, FileText, BarChart3].map((Icon, i) => <span className={i === step ? "active" : ""} key={i}><Icon size={18} /></span>)}</div>
      <div className="op-preview-main">
        <div className="op-preview-heading"><div><small>{t("YOUR CLINIC, CONNECTED")}</small><strong>{t("Clinic overview")}</strong></div><span className="op-status"><i />{t("Queue preview")}</span></div>
        <div className="op-preview-stats">
          <div><span className="op-preview-stat-icon"><Ticket size={17} aria-hidden="true" /></span><small>{t("Live Queue Stream")}</small><strong>A014 <span>{t("Active")}</span></strong></div>
          <div><span className="op-preview-stat-icon blue"><Users size={17} aria-hidden="true" /></span><small>{t("Today's Patient Check-ins")}</small><strong>{t("In one view")}</strong></div>
        </div>
        <div className="op-preview-queue"><div className="op-preview-card-title"><b>{t("Doctor-wise queue")}</b><span>{t("Sample tokens")}</span></div>
          <div className="op-preview-queue-row"><span className="op-token active">A014</span><div><b>{t("Consultation in progress")}</b><small>{t("Active")}</small></div><Activity size={17} aria-hidden="true" /></div>
          <div className="op-preview-queue-row"><span className="op-token">A015</span><div><b>{t("Ready for the next turn")}</b><small>{t("Next")}</small></div><ChevronRight size={16} aria-hidden="true" /></div>
        </div>
        <div className="op-preview-chart"><div className="op-preview-card-title"><b>{t("Revenue & clinic activity")}</b><span>{t("Trend preview")}</span></div>
          <svg viewBox="0 0 380 96" role="img" aria-label={t("Illustrative trend without real clinic metrics")}><g stroke="currentColor" className="op-chart-grid"><path d="M0 20H380M0 48H380M0 76H380" /></g><path d="M0 75 C25 74 30 52 57 58 S95 78 121 48 S161 55 192 34 S233 56 255 32 S294 43 318 22 S352 30 380 12" fill="none" stroke="var(--op-teal)" strokeWidth="3" /><path d="M0 86 C35 86 37 71 64 74 S105 84 132 65 S173 71 202 52 S237 70 270 52 S315 59 344 37 S363 49 380 33" fill="none" stroke="#818cf8" strokeWidth="2" strokeDasharray="4 4" /></svg>
          <div className="op-chart-legend"><span><i />{t("Recorded revenue")}</span><span><i />{t("Patient activity")}</span></div>
        </div>
      </div>
    </div>
    <div className="op-preview-disclaimer">{t("Illustrative preview. Not live patient data or performance results.")}</div>
  </div>;
}

function GuidedDemo({ open, onClose }) {
  const { t } = useLanguage();
  const dialog = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const step = Math.min(Math.floor(seconds / 30), workflow.length - 1);
  useEffect(() => {
    if (!open) return;
    setSeconds(0); setPlaying(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.showModal();
    return () => { dialog.current?.close(); document.body.style.overflow = previous; };
  }, [open]);
  useEffect(() => {
    if (!open || !playing || seconds >= 120) return;
    const timer = window.setTimeout(() => setSeconds(value => value + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [open, playing, seconds]);
  return <dialog ref={dialog} className="op-demo" aria-labelledby="op-demo-title" onClose={onClose} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="op-demo-content">
      <header className="op-demo-header"><div><span className="op-kicker">{t("2-MINUTE GUIDED PREVIEW")}</span><h2 id="op-demo-title">{t("A connected clinic day")}</h2></div><button className="op-icon-button" type="button" onClick={onClose} aria-label={t("Close demo")}><X size={21} aria-hidden="true" /></button></header>
      <DashboardPreview compact step={step} />
      <div className="op-demo-steps" aria-label={t("Demo chapters")}>{workflow.map(([, title], index) => <button type="button" key={title} aria-pressed={index === step} onClick={() => setSeconds(index * 30)}><span>0{index + 1}</span>{t(title)}</button>)}</div>
      <div className="op-demo-caption" aria-live="polite"><h3>{t(workflow[step][1])}</h3><p>{t(workflow[step][2])}</p></div>
      <div className="op-demo-controls"><button className="op-button op-button-outline" type="button" onClick={() => { if (seconds >= 120) { setSeconds(0); setPlaying(true); } else setPlaying(value => !value); }}>{playing && seconds < 120 ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{t(seconds >= 120 ? "Replay demo" : playing ? "Pause demo" : "Resume demo")}</button><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} / 2:00</span><Link className="op-button op-button-primary" to="/support" onClick={onClose}>{t("Discuss your pilot")}<ArrowRight size={17} aria-hidden="true" /></Link></div>
    </div>
  </dialog>;
}

// Preserve the secure patient flow; a token alone never identifies a patient.
export function queueDestination(query) {
  const value = query.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) return null;
  return /^[a-z]?\d{1,6}$/.test(value) ? "/patient" : `/patient/clinics?q=${encodeURIComponent(value)}`;
}

export default function LandingPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);
  const [queueQuery, setQueueQuery] = useState("");
  const [queueError, setQueueError] = useState("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const yearlyBilling = billingCycle === "yearly";
  useEffect(() => {
    const previous = document.title;
    document.title = "OPDfy · Paperless clinic management & live queues";
    return () => { document.title = previous; };
  }, []);
  const openQueue = event => {
    event.preventDefault();
    const destination = queueDestination(queueQuery);
    if (!destination) {
      setQueueError("Enter a clinic code or token number. For a clinic name, use Find your clinic."); return;
    }
    setQueueError("");
    navigate(getPatientToken() ? destination : `/patient-login?returnTo=${encodeURIComponent(destination)}`);
  };
  return <main className="opdfy-landing" id="landing-content">
    <section className="op-hero op:py-16 op:lg:py-24" aria-labelledby="landing-title"><div className="op-container op:grid op:items-center op:gap-12 op:lg:grid-cols-2">
      <div className="op-hero-copy"><span className="op-pilot-badge"><Plus size={15} strokeWidth={3} aria-hidden="true" />{t("14-Day Free Pilot")}<span className="op-badge-divider" />{t("Built for your clinic")}</span>
        <h1 id="landing-title">{t("Run a Paperless Clinic.")}<span>{t("Make Waiting More Predictable.")}</span></h1>
        <p className="op-hero-description">{t("Connect registration, digital prescriptions and live queue updates. Keep your team focused on care, not coordination.")}</p>
        <div className="op-actions"><Link className="op-button op-button-primary" to="/support">{t("Start 14-Day Free Pilot")}<ArrowRight size={18} aria-hidden="true" /></Link><button className="op-button op-button-ghost" type="button" onClick={() => setDemoOpen(true)}><span className="op-play-icon"><Play size={14} fill="currentColor" aria-hidden="true" /></span>{t("Watch 2-Min Demo")}</button></div>
        <p className="op-microcopy"><Check size={15} aria-hidden="true" />{t("Explore the workflow before choosing a subscription.")}</p>
        <div className="op-hero-benefits"><span><Check size={16} aria-hidden="true" />{t("Less paperwork")}</span><span><Check size={16} aria-hidden="true" />{t("Live queue clarity")}</span><span><Check size={16} aria-hidden="true" />{t("Connected follow-ups")}</span></div>
      </div>
      <div className="op-hero-visual"><div className="op-preview-frame"><DashboardPreview /></div><div className="op-connected-note"><span><ShieldCheck size={19} aria-hidden="true" /></span><div><strong>{t("The right view for every role")}</strong><small>{t("Reception · Doctor · Patient · Admin")}</small></div><Check size={17} aria-hidden="true" /></div></div>
    </div></section>

    <section className="op-trust" aria-label={t("Product capabilities")}><div className="op-container op:flex op:flex-wrap op:items-center op:justify-between op:gap-6"><p>{t("Purpose-built for independent clinics")}</p><div className="op:flex op:flex-wrap op:gap-6"><span><LockKeyhole size={18} aria-hidden="true" />{t("Role-based access")}</span><span><ShieldCheck size={18} aria-hidden="true" />{t("Clinic-scoped records")}</span><span><Monitor size={18} aria-hidden="true" />{t("Across your devices")}</span></div></div></section>

    <section className="op-section op:py-16 op:lg:py-24" id="platform" aria-labelledby="op-platform-title"><div className="op-container"><div className="op-section-heading"><span className="op-kicker">{t("LESS ADMIN. MORE ATTENTION TO CARE.")}</span><h2 id="op-platform-title">{t("Your clinic runs better when")}<br className="op-hide-mobile" /> {t("everyone is connected.")}</h2><p>{t("A focused workspace for your team. A clearer experience for your patients.")}</p></div>
      <div className="op-persona-grid" id="features"><div className="op-clinic-features"><span className="op-persona-label"><Stethoscope size={17} aria-hidden="true" />{t("FOR CLINICS")}</span>{clinicFeatures.map(([Icon, title, detail]) => <article className="op-feature-row" key={title}><span className="op-feature-icon"><Icon size={23} aria-hidden="true" /></span><div><h3>{t(title)}</h3><p>{t(detail)}</p></div></article>)}<Link className="op-text-link" to="/clinic/register">{t("Create your clinic workspace")}<ArrowRight size={17} aria-hidden="true" /></Link></div>
        <aside className="op-patient-card" aria-labelledby="op-patient-title"><span className="op-patient-icon"><HeartPulse size={28} aria-hidden="true" /></span><span className="op-kicker">{t("FOR PATIENTS")}</span><h3 id="op-patient-title">{t("Are you a patient?")}</h3><p>{t("See your token, queue position and upcoming visits in your patient portal.")}</p>
          <form onSubmit={openQueue}><label htmlFor="op-queue-code">{t("Token number or clinic code")}</label><div className="op-queue-input"><Search size={18} aria-hidden="true" /><input id="op-queue-code" type="text" maxLength={80} required autoComplete="off" placeholder={t("Enter Token or Clinic Code")} value={queueQuery} onChange={event => { setQueueQuery(event.target.value); setQueueError(""); }} aria-describedby={`op-queue-help${queueError ? " op-queue-error" : ""}`} aria-invalid={Boolean(queueError)} /><button type="submit" aria-label={t("Check My Queue Status")}><ArrowRight size={21} aria-hidden="true" /></button></div>{queueError && <p className="op-form-error" id="op-queue-error" role="alert">{t(queueError)}</p>}<small id="op-queue-help">{t("Sign in to view your own queue. Token numbers are clinic-specific.")}</small></form>
          <Link className="op-button op-button-patient" to="/patient-login">{t("Open patient portal")}<ArrowRight size={17} aria-hidden="true" /></Link><Link className="op-patient-find" to="/patient/clinics">{t("Find your clinic")}<ChevronRight size={15} aria-hidden="true" /></Link>
        </aside>
      </div>
    </div></section>

    <section className="op-section op-section-soft op:py-16 op:lg:py-24" id="workflow" aria-labelledby="op-workflow-title"><div className="op-container"><div className="op-section-heading op-centered"><span className="op-kicker">{t("ONE VISIT. ONE CONNECTED WORKFLOW.")}</span><h2 id="op-workflow-title">{t("From the first booking")}<br />{t("to the next follow-up.")}</h2><p>{t("Keep each step visible, without moving between disconnected tools.")}</p></div><div className="op-workflow op:grid op:gap-6 op:md:grid-cols-2 op:xl:grid-cols-4">{workflow.map(([Icon, title, detail], index) => <article key={title}><span className="op-workflow-number">0{index + 1}</span><span className="op-feature-icon"><Icon size={24} aria-hidden="true" /></span><h3>{t(title)}</h3><p>{t(detail)}</p></article>)}</div>
      <div className="op-insights-strip"><span><BarChart3 size={22} aria-hidden="true" /></span><div><h3>{t("Understand the day. Plan the next one.")}</h3><p>{t("Review patient volume, waiting time, doctor workload and recorded payments using your clinic's real data.")}</p></div><span className="op-insights-tag">{t("Clinic analytics & exports")}</span></div>
    </div></section>

    <section className="op-section op:py-16 op:lg:py-24" id="pricing" aria-labelledby="op-pricing-title"><div className="op-container"><div className="op-section-heading op-centered"><span className="op-kicker">{t("A PLAN THAT FITS YOUR CLINIC")}</span><h2 id="op-pricing-title">{t("Clear pricing.")} {t("A practical place to start.")}</h2><p>{t("Begin with a 14-day pilot. Choose your plan after trying the clinic workflow.")}</p></div>
      <div className="op-billing-selector">
        <div className="op-billing-toggle" role="group" aria-label={t("Billing cycle")} aria-describedby="op-billing-caption">
          <button type="button" aria-pressed={!yearlyBilling} onClick={() => setBillingCycle("monthly")}>{t("Monthly")}</button>
          <button type="button" aria-pressed={yearlyBilling} onClick={() => setBillingCycle("yearly")}>{t("Yearly")}<span>{t("Save more")}</span></button>
        </div>
        <p className="op-billing-caption" id="op-billing-caption" role="status">{t(yearlyBilling ? "Yearly billing selected. Pay once for 12 months." : "Monthly billing selected. Pay month by month.")}</p>
      </div>
      <div className="op-pricing-grid op:grid op:gap-6 op:lg:grid-cols-3">
        {pricingPlans.map(({ name, Icon, doctors, monthly, yearlyMonthly, description, benefit, features }) => <article className={`op-price-card${name === "Growth" ? " op-price-featured" : ""}`} key={name} aria-labelledby={`op-plan-${name.toLowerCase()}`}>
          {name === "Growth" && <span className="op-plan-badge">{t("Recommended for growing teams")}</span>}
          <div className="op-plan-heading"><span className="op-plan-icon"><Icon size={22} aria-hidden="true" /></span><span className="op-doctor-count">{t(doctors)}</span></div>
          <h3 id={`op-plan-${name.toLowerCase()}`}>{t(name)}</h3><p>{t(description)}</p>
          <div className="op-price">
            <div className="op-price-comparison">{yearlyBilling ? <><span>{t("Monthly rate")}</span><s aria-label={t("Monthly rate: {price}", { price: formatPrice(monthly) })}>{formatPrice(monthly)}</s></> : <span>{t("Monthly subscription")}</span>}</div>
            <div className="op-price-amount"><strong>{formatPrice(yearlyBilling ? yearlyMonthly : monthly)}</strong><span>{t("/ month")}</span></div>
            <p className="op-price-billing">{yearlyBilling ? <><strong>{formatPrice(yearlyMonthly * 12)}</strong> {t("billed yearly")}</> : t("Billed monthly")}</p>
            <span className="op-plan-saving">{yearlyBilling ? t("Save {amount} per year", { amount: formatPrice((monthly - yearlyMonthly) * 12) }) : t("Annual savings available")}</span>
          </div>
          <p className="op-plan-benefit">{t(benefit)}</p>
          <ul role="list">{features.map(item => <li key={item}><Check size={17} aria-hidden="true" />{t(item)}</li>)}</ul>
          <Link className={`op-button ${name === "Growth" ? "op-button-primary" : "op-button-outline"}`} to="/support" aria-label={t("Start a 14-day pilot for {plan}", { plan: t(name) })}>{t("Start your 14-day pilot")}<ArrowRight size={17} aria-hidden="true" /></Link>
        </article>)}
      </div>
      <div className="op-pricing-inclusions"><ShieldCheck size={20} aria-hidden="true" /><p><strong>{t("One connected product, on every plan.")}</strong>{t("All plans include the core Clinic Edition workflow. Benefits above highlight how each clinic size uses it; they are not feature restrictions.")}</p></div>
      <div className="op-pricing-onboarding">
        <div><span className="op-pricing-detail-icon"><ClipboardCheck size={22} aria-hidden="true" /></span><div><h3>{t("One-time setup")}</h3><p>{t("Clinic configuration and staff onboarding, when you continue after the pilot.")}</p></div><strong className="op-setup-price">₹1,999</strong></div>
        <div><span className="op-pricing-detail-icon"><CalendarCheck2 size={22} aria-hidden="true" /></span><div><h3>{t("14-Day Free Pilot")}</h3><p>{t("Try reception, doctor queues and the patient experience before choosing a subscription.")}</p></div></div>
      </div>
      <p className="op-pricing-note">{t("The ₹1,999 setup fee is additional to the subscription and applies once. Annual totals cover 12 months and are paid upfront. Tax treatment and subscription terms will be confirmed during the demo.")}</p>
    </div></section>

    <section className="op-section op-section-soft op:py-16 op:lg:py-24" id="questions" aria-labelledby="op-faq-title"><div className="op-container op-faq-grid"><div className="op-section-heading"><span className="op-kicker">{t("QUESTIONS, ANSWERED")}</span><h2 id="op-faq-title">{t("A clear start,")}<br />{t("without the guesswork.")}</h2><p>{t("A few practical answers before you bring OPDfy into your clinic.")}</p><Link className="op-text-link" to="/faqs">{t("See all FAQs")}<ArrowRight size={17} aria-hidden="true" /></Link></div><div className="op-faq-list">{faq.map(([question, answer]) => <details key={question}><summary>{t(question)}<ChevronDown size={18} aria-hidden="true" /></summary><p>{t(answer)}</p></details>)}</div></div></section>

    <section className="op-final-cta"><div className="op-container"><span className="op-pilot-badge"><Plus size={15} aria-hidden="true" />{t("14-Day Free Pilot")}</span><h2>{t("Your next OPD day,")}<br />{t("better connected.")}</h2><p>{t("See how OPDfy fits your reception, doctor queues and patient experience.")}</p><div className="op-actions"><Link className="op-button op-button-primary" to="/support">{t("Book a Demo")}<ArrowRight size={18} aria-hidden="true" /></Link><Link className="op-button op-button-outline" to="/clinic/register">{t("Register Clinic")}<ArrowRight size={17} aria-hidden="true" /></Link></div></div></section>
    <footer className="op-footer"><div className="op-container op-footer-grid"><div className="op-footer-brand"><span><HeartPulse size={23} aria-hidden="true" /><strong>OPDfy</strong></span><p>{t("Your Smart Simplified Queue")}</p><small>{t("Appointments, care and clinic operations. Connected.")}</small></div><nav aria-label={t("Product links")}><b>{t("Product")}</b><a href="#features">{t("Features")}</a><a href="#workflow">{t("How it works")}</a><a href="#pricing">{t("Pricing")}</a><Link to="/faqs">{t("FAQs")}</Link></nav><nav aria-label={t("Access links")}><b>{t("Access")}</b><Link to="/patient-login">{t("Patient Portal")}</Link><Link to="/login">{t("Staff Sign In")}</Link><Link to="/clinic/register">{t("Register Clinic")}</Link><Link to="/platform/login">{t("Platform Admin")}</Link></nav><nav aria-label={t("Help and policies")}><b>{t("Help & legal")}</b><Link to="/support">{t("Contact / Support")}</Link><Link to="/privacy">{t("Privacy Policy")}</Link><Link to="/terms">{t("Terms & Conditions")}</Link></nav></div><div className="op-container op-footer-bottom"><span>© {new Date().getFullYear()} OPDfy</span><span>{t("Clinic Edition · Built for outpatient care")}</span></div></footer>
    <GuidedDemo open={demoOpen} onClose={() => setDemoOpen(false)} />
  </main>;
}
