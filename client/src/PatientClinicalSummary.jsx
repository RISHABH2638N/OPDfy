import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api, getPatientToken, getSelectedClinicSlug } from './api';
import { useLanguage } from './LanguageContext';
import ClinicalEhrSummary from './ClinicalEhrSummary';

export default function PatientClinicalSummary() {
  const { t } = useLanguage();
  const [patient, setPatient] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const clinicSlug = getSelectedClinicSlug();
  useEffect(() => {
    if (!getPatientToken() || !clinicSlug) return;
    let active = true;
    setPatient(null); setError('');
    api.get('/patients/me').then(({data}) => {
      if (active) {
        if (!data.patient) setError('Unable to load patient profile.');
        else setPatient(data.patient);
      }
    }).catch(e => { if (active) setError(e.response?.data?.message || 'Unable to load patient profile.'); });
    return () => { active = false; };
  }, [clinicSlug, attempt]);
  if (!getPatientToken()) return <Navigate to="/patient-login" replace />;
  return <main className="page premium-page patient-ehr-page">
    <div className="head"><div><p className="eyebrow">{t('Patient Medical Portal')}</p><h1>{t('Clinical EHR Summary')}</h1>{patient && <p className="muted">{patient.name} · {clinicSlug}</p>}</div><Link className="ghost" to={clinicSlug?'/patient':'/patient/clinics'}><ArrowLeft size={16}/>{t(clinicSlug?'My Dashboard':'Find a Clinic')}</Link></div>
    {!clinicSlug ? <section className="card"><p>{t('Choose your clinic')}</p><Link className="primary" to="/patient/clinics">{t('Find a Clinic')}</Link></section>
      : error ? <section className="card"><p className="login-error" role="alert">{t(error)}</p><button type="button" className="ghost" onClick={()=>setAttempt(value=>value+1)}>{t('Retry')}</button></section>
      : patient ? <ClinicalEhrSummary activePatient={patient}/>
      : <p role="status"><RefreshCw className="animate-spin" size={18}/>{t('Loading Your Health Profile...')}</p>}
  </main>;
}
