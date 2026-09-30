import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, BarChart3, CalendarCheck2, Check, ChevronRight,
  ClipboardCheck, Clock3, HeartPulse, Monitor, QrCode, ShieldCheck,
  Stethoscope, Ticket, UserRoundCheck, Users,
} from "lucide-react";
import { useLanguage } from "./LanguageContext.jsx";

const features = [
  [Ticket, "Live OPD queue", "Keep token status clear for patients and the care team."],
  [CalendarCheck2, "Appointments & check-in", "Connect bookings, arrivals and walk-ins in one flow."],
  [Stethoscope, "Doctor workspace", "Make patient context, consultation and follow-up easy to find."],
  [BarChart3, "Clinic insights", "Understand patient flow and waiting time with real clinic data."],
  [Monitor, "Waiting room display", "Show the current queue without exposing patient details."],
  [ShieldCheck, "Private by design", "Give each role the right view of the clinic day."],
];

const steps = [
  [CalendarCheck2, "Book", "Choose a clinic and plan the visit."],
  [QrCode, "Arrive", "Check in with the front desk or QR."],
  [Ticket, "Follow", "Track the live queue and your turn."],
  [HeartPulse, "Continue care", "Keep consultation and follow-up connected."],
];

export default function LandingPage() {
  const { t } = useLanguage();
  useEffect(() => {
    const title = document.title;
    document.title = "OPDfy · A clearer clinic day";
    return () => { document.title = title; };
  }, []);

  return <main className="landing" id="landing-content">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-wrap landing-hero-grid">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow"><span className="landing-eyebrow-dot" />{t("THE CONNECTED CLINIC WORKSPACE")}</span>
          <h1 id="landing-title">{t("A better clinic day,")} <em>{t("for everyone.")}</em></h1>
          <p>{t("Bring appointments, check-in, live queues and consultations together. Give your team a calmer workflow and patients a clearer visit.")}</p>
          <div className="landing-actions">
            <Link className="landing-btn landing-btn-primary" to="/clinic/register">{t("Set up your clinic")}<ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="landing-btn landing-btn-secondary" to="/patient-login">{t("Find your clinic")}<ChevronRight size={18} aria-hidden="true" /></Link>
          </div>
          <div className="landing-hero-assurance">
            <span><Check size={16} aria-hidden="true" />{t("Built for outpatient care")}</span>
            <span><Check size={16} aria-hidden="true" />{t("Works across devices")}</span>
          </div>
        </div>

        <div className="landing-hero-visual" role="img" aria-label={t("Illustrative OPDfy clinic workspace preview")}>
          <div className="landing-workspace">
            <div className="landing-workspace-top">
              <div className="landing-workspace-brand"><span><HeartPulse size={17} /></span><strong>OPDfy</strong></div>
              <span className="landing-workspace-sample">{t("Product preview")}</span>
            </div>
            <div className="landing-workspace-body">
              <div className="landing-workspace-rail" aria-hidden="true"><span className="is-active"><Activity size={18}/></span><span><CalendarCheck2 size={18}/></span><span><Users size={18}/></span><span><BarChart3 size={18}/></span></div>
              <div className="landing-workspace-main">
                <div className="landing-workspace-heading"><div><small>{t("TODAY'S WORKSPACE")}</small><h2>{t("Everything in its place.")}</h2></div><span className="landing-live"><i/>{t("Live queue")}</span></div>
                <div className="landing-workspace-cards">
                  <div><span className="landing-mini-icon mint"><Ticket size={17}/></span><b>{t("Queue")}</b><small>{t("Your next turn, clear")}</small></div>
                  <div><span className="landing-mini-icon blue"><CalendarCheck2 size={17}/></span><b>{t("Appointments")}</b><small>{t("Arrivals in one view")}</small></div>
                  <div><span className="landing-mini-icon peach"><Stethoscope size={17}/></span><b>{t("Consultations")}</b><small>{t("Care stays connected")}</small></div>
                </div>
                <div className="landing-queue-preview">
                  <div className="landing-preview-title"><strong>{t("Patient journey")}</strong><span>{t("From arrival to care")}</span></div>
                  <div className="landing-preview-row"><span className="landing-preview-step"><QrCode size={16}/></span><div><b>{t("Checked in")}</b><small>{t("Reception confirms arrival")}</small></div><span className="landing-preview-done"><Check size={15}/></span></div>
                  <div className="landing-preview-row"><span className="landing-preview-step"><Ticket size={16}/></span><div><b>{t("In the queue")}</b><small>{t("The next turn is visible")}</small></div><span className="landing-preview-pulse" /></div>
                  <div className="landing-preview-row"><span className="landing-preview-step"><Stethoscope size={16}/></span><div><b>{t("With the doctor")}</b><small>{t("Visit details stay together")}</small></div><ChevronRight size={15} /></div>
                </div>
              </div>
            </div>
          </div>
          <div className="landing-floating-card"><span><Check size={17}/></span><div><strong>{t("One shared view")}</strong><small>{t("For every step of the visit")}</small></div></div>
        </div>
      </div>
    </section>

    <div className="landing-proof"><div className="landing-wrap">
      <span><ClipboardCheck size={19}/>{t("Less front-desk friction")}</span>
      <span><Clock3 size={19}/>{t("Clearer waiting experience")}</span>
      <span><Users size={19}/>{t("Teams stay in sync")}</span>
      <span><ShieldCheck size={19}/>{t("Role-based access")}</span>
    </div></div>

    <section className="landing-section" id="workflow" aria-labelledby="landing-workflow-title">
      <div className="landing-wrap">
        <div className="landing-heading centered"><span className="landing-eyebrow">{t("HOW OPDFY WORKS")}</span><h2 id="landing-workflow-title">{t("One visit. One connected journey.")}</h2><p>{t("A simple path for patients, with the right information available to the clinic at every step.")}</p></div>
        <div className="landing-steps">{steps.map(([Icon,title,detail],index)=><article key={title}><span className="landing-step-number">0{index+1}</span><span className="landing-step-icon"><Icon size={23}/></span><h3>{t(title)}</h3><p>{t(detail)}</p></article>)}</div>
      </div>
    </section>

    <section className="landing-section landing-section-soft" id="platform" aria-labelledby="landing-platform-title">
      <div className="landing-wrap landing-feature-split">
        <div className="landing-feature-copy"><span className="landing-eyebrow">{t("FOR THE WHOLE CLINIC")}</span><h2 id="landing-platform-title">{t("See what matters. Act with confidence.")}</h2><p>{t("Reception sees arrivals, doctors see their patients, and clinic admins see the bigger picture. Each workspace is built around the work that needs doing.")}</p><ul><li><Check size={17}/>{t("A live view of the queue")}</li><li><Check size={17}/>{t("Patient and appointment context")}</li><li><Check size={17}/>{t("Operational insights from real data")}</li></ul><Link className="landing-inline-link" to="/clinic/register">{t("Explore clinic setup")}<ArrowRight size={17}/></Link></div>
        <div className="landing-operations" role="img" aria-label={t("Illustrative clinic workflow overview")}>
          <div className="landing-operations-head"><div><small>{t("CLINIC WORKSPACE")}</small><strong>{t("Care in motion")}</strong></div><Activity size={20}/></div>
          <div className="landing-operations-grid"><div><span><UserRoundCheck size={20}/></span><b>{t("Front desk")}</b><small>{t("Arrivals & check-in")}</small></div><div><span><Ticket size={20}/></span><b>{t("Live queue")}</b><small>{t("Turn-by-turn clarity")}</small></div><div><span><Stethoscope size={20}/></span><b>{t("Doctors")}</b><small>{t("Focused consultations")}</small></div><div><span><BarChart3 size={20}/></span><b>{t("Admin")}</b><small>{t("A wider perspective")}</small></div></div>
          <div className="landing-operations-flow"><span>{t("Booked")}</span><i/><span>{t("Checked in")}</span><i/><span>{t("Consulted")}</span><i/><span>{t("Follow-up")}</span></div>
        </div>
      </div>
    </section>

    <section className="landing-section" id="features" aria-labelledby="landing-features-title"><div className="landing-wrap">
      <div className="landing-heading"><span className="landing-eyebrow">{t("BUILT FOR THE EVERYDAY")}</span><h2 id="landing-features-title">{t("The essentials, thoughtfully connected.")}</h2><p>{t("Practical tools that make the clinic day easier to run and the patient visit easier to follow.")}</p></div>
      <div className="landing-feature-grid">{features.map(([Icon,title,detail])=><article key={title}><span className="landing-feature-icon"><Icon size={22}/></span><h3>{t(title)}</h3><p>{t(detail)}</p><span className="landing-feature-rule" /></article>)}</div>
    </div></section>

    <section className="landing-section landing-patient-section" id="for-patients" aria-labelledby="landing-patient-title"><div className="landing-wrap landing-patient-grid">
      <div className="landing-patient-visual" role="img" aria-label={t("Illustrative patient queue view")}><div className="landing-phone"><div className="landing-phone-top"><HeartPulse size={19}/><b>OPDfy</b><span>•••</span></div><div className="landing-phone-body"><small>{t("YOUR VISIT")}</small><h3>{t("Know where you stand.")}</h3><div className="landing-phone-token"><Ticket size={25}/><strong>{t("Your token")}</strong><span>{t("Live status")}</span></div><div className="landing-phone-list"><div><span>{t("Current queue")}</span><b>{t("Updating live")}</b></div><div><span>{t("Next step")}</span><b>{t("We'll keep you posted")}</b></div></div></div></div></div>
      <div className="landing-feature-copy"><span className="landing-eyebrow">{t("A BETTER PATIENT EXPERIENCE")}</span><h2 id="landing-patient-title">{t("Less uncertainty in the waiting room.")}</h2><p>{t("Patients can book, check upcoming visits and follow their token from their own dashboard. When the queue moves, the information moves with it.")}</p><Link className="landing-inline-link" to="/patient-login">{t("Open patient portal")}<ArrowRight size={17}/></Link></div>
    </div></section>

    <section className="landing-section landing-faq" id="questions" aria-labelledby="landing-faq-title"><div className="landing-wrap landing-faq-grid"><div className="landing-heading"><span className="landing-eyebrow">{t("FREQUENTLY ASKED QUESTIONS")}</span><h2 id="landing-faq-title">{t("Good to know before you begin.")}</h2><p>{t("A few answers about how OPDfy fits into a clinic day.")}</p><Link className="landing-inline-link" to="/faqs">{t("See all FAQs")}<ArrowRight size={17}/></Link></div><div className="landing-faq-list">
      <details><summary>{t("Can patients book without calling reception?")}</summary><p>{t("Yes. Patients can choose a clinic and use their portal to book an appointment or an available token.")}</p></details>
      <details><summary>{t("Does the queue update in real time?")}</summary><p>{t("The queue updates across connected clinic and patient workspaces as staff manage each turn.")}</p></details>
      <details><summary>{t("Can my team use OPDfy on tablets?")}</summary><p>{t("Yes. The workspaces adapt to desktop, tablet and mobile screens.")}</p></details>
      <details><summary>{t("How do I set up my clinic?")}</summary><p>{t("Register your clinic workspace and follow the setup steps for staff, schedules and services.")}</p></details>
    </div></div></section>

    <section className="landing-final-cta"><div className="landing-wrap"><div><span className="landing-eyebrow">{t("READY FOR A CLEARER CLINIC DAY?")}</span><h2>{t("Bring your clinic together with OPDfy.")}</h2><p>{t("Start a clinic workspace or explore the patient experience.")}</p></div><div className="landing-actions"><Link className="landing-btn landing-btn-white" to="/clinic/register">{t("Register your clinic")}<ArrowRight size={17}/></Link><Link className="landing-btn landing-btn-dark-outline" to="/patient-login">{t("Patient portal")}<ChevronRight size={17}/></Link></div></div></section>
    <footer className="landing-footer"><div className="landing-wrap landing-footer-main"><div className="landing-footer-brand"><div><span><HeartPulse size={20}/></span><strong>OPDfy</strong></div><p>{t("A clearer way to connect the people and moments behind every clinic visit.")}</p></div><nav aria-label={t("Product links")}><b>{t("Product")}</b><a href="#workflow">{t("How it works")}</a><a href="#features">{t("Features")}</a><a href="#questions">{t("FAQs")}</a></nav><nav aria-label={t("Access links")}><b>{t("Access")}</b><Link to="/patient-login">{t("Patient Portal")}</Link><Link to="/login">{t("Staff Sign In")}</Link><Link to="/clinic/register">{t("Register Clinic")}</Link></nav><nav aria-label={t("Help and policies")}><b>{t("Help & legal")}</b><Link to="/support">{t("Contact / Support")}</Link><Link to="/privacy">{t("Privacy Policy")}</Link><Link to="/terms">{t("Terms & Conditions")}</Link></nav></div><div className="landing-wrap landing-footer-bottom"><span>© {new Date().getFullYear()} OPDfy</span><span>{t("Made for a more connected clinic day.")}</span></div></footer>
  </main>;
}
