import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Mail, Search, ArrowUpRight } from 'lucide-react';
import { useLanguage } from './LanguageContext';
import { POLICY_VERSION, SUPPORT_EMAIL, publicNavigation, publicContent } from './publicContent.js';
import './public-pages.css';

export function PublicFooter() {
  const { language } = useLanguage();
  const hi = language === 'hi';
  return <footer className="info-footer">
    <div><strong>OPDfy</strong><span>{hi ? 'आपके क्लिनिक से बेहतर जुड़ाव।' : 'Connected to your clinic.'}</span></div>
    <nav aria-label={hi ? 'मदद और नीतियाँ' : 'Help and policies'}>
      {publicNavigation.map(([path,en,hindi]) => <Link key={path} to={path}>{hi ? hindi : en}</Link>)}
    </nav>
  </footer>;
}

export function PatientPolicyNotice() {
  const { language } = useLanguage();
  return <p className="info-policy-notice">{language === 'hi' ? 'आगे बढ़ने पर आप ' : 'By continuing, you agree to the '}
    <Link to="/terms" target="_blank" rel="noopener noreferrer">{language === 'hi' ? 'नियम और शर्तें' : 'Terms & Conditions'}</Link>
    {language === 'hi' ? ' स्वीकार करते हैं। जानकारी के उपयोग के लिए ' : '. Read the '}
    <Link to="/privacy" target="_blank" rel="noopener noreferrer">{language === 'hi' ? 'गोपनीयता नीति' : 'Privacy Policy'}</Link>
    {language === 'hi' ? ' पढ़ें। ये लिंक नए टैब में खुलते हैं।' : ' for how information is used. Links open in a new tab.'}
  </p>;
}

export function ClinicPolicyAcceptance({ checked, onChange }) {
  const { language } = useLanguage();
  const hi = language === 'hi';
  return <div className="info-consent">
    <label><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} required />
      <span>{hi ? 'मुझे इस क्लिनिक की ओर से पंजीकरण करने का अधिकार है। मैं नियम और शर्तें स्वीकार करता/करती हूँ और मैंने गोपनीयता नीति पढ़ी है।' : 'I am authorized to register this clinic. I agree to the Terms & Conditions and acknowledge that I have read the Privacy Policy.'}</span>
    </label>
    <p><Link to="/terms" target="_blank" rel="noopener noreferrer">{hi ? 'नियम और शर्तें पढ़ें' : 'Read Terms & Conditions'}</Link>{' · '}
      <Link to="/privacy" target="_blank" rel="noopener noreferrer">{hi ? 'गोपनीयता नीति पढ़ें' : 'Read Privacy Policy'}</Link>
      <small>{hi ? 'लिंक नए टैब में खुलते हैं।' : 'Links open in a new tab.'}</small>
    </p>
  </div>;
}

export default function PublicInfoPage({ kind }) {
  const { language } = useLanguage();
  const hi = language === 'hi';
  const page = publicContent[kind];
  const [query, setQuery] = useState('');
  const title = publicNavigation.find(([path])=>path === `/${kind}`)?.[hi ? 2 : 1] || 'OPDfy';
  useEffect(()=>{ setQuery(''); window.scrollTo(0,0); },[kind]);
  useEffect(()=>{ const previous=document.title; document.title=`${title} · OPDfy`; return ()=>{document.title=previous;}; },[title]);
  const sections = page.sections.filter(row=>kind!=='faqs'||row.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <main className="public-info" id="public-info">
    <header className="info-hero">
      <span className="info-kicker"><BookOpen size={17} aria-hidden="true" />{title}</span>
      <h1>{page.title[hi ? 1 : 0]}</h1>
      <p>{page.intro[hi ? 1 : 0]}</p>
      {['privacy','terms'].includes(kind) && <small>{hi ? 'अंतिम अपडेट: 9 सितंबर 2026 · संस्करण ' : 'Last updated: 9 September 2026 · Version '}{POLICY_VERSION}</small>}
    </header>
    <nav className="info-tabs" aria-label={hi ? 'जानकारी पेज' : 'Information pages'}>
      {publicNavigation.map(([path,en,hindi])=><Link key={path} to={path} aria-current={path===`/${kind}`?'page':undefined}>{hi?hindi:en}</Link>)}
    </nav>
    {kind==='faqs' && <label className="info-search"><Search size={18} aria-hidden="true" /><span className="info-sr-only">{hi?'प्रश्न खोजें':'Search questions'}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={hi?'टोकन, पासवर्ड, रेफ़रल…':'Tokens, passwords, referrals…'} /></label>}
    <div className="info-sections">
      {sections.map(row=>kind==='faqs' ? <details className="info-section" key={row[0]} open={query.trim()?true:undefined}><summary>{row[hi?1:0]}</summary><p>{row[hi?3:2]}</p></details> : <section className="info-section" key={row[0]}><h2>{row[hi?1:0]}</h2><p>{row[hi?3:2]}</p></section>)}
      {!sections.length && <p role="status">{hi?'कोई प्रश्न नहीं मिला। दूसरे शब्द खोजें या सहायता से संपर्क करें।':'No questions matched. Try another search or contact support.'}</p>}
    </div>
    <aside className="info-contact">
      <Mail size={26} aria-hidden="true" />
      <div><h2>{hi?'सवाल या सहायता चाहिए?':'Questions or need a hand?'}</h2><p>{hi?'OPDfy सहायता से संपर्क करें।':'Contact OPDfy support.'}</p><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}<ArrowUpRight size={16} aria-hidden="true" /></a></div>
    </aside>
  </main>;
}
