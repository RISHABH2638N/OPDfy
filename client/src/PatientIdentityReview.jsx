import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api, getSelectedClinicSlug, getPatientToken } from './api';
import { useLanguage } from './LanguageContext';

export default function PatientIdentityReview({onRequest}) {
  const {language}=useLanguage(),hi=language==='hi';
  const clinicSlug=getSelectedClinicSlug();
  const [state,setState]=useState('loading');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!getPatientToken()||!clinicSlug)return;
    let active=true;setState('loading');
    api.get('/patients/me').then(({data})=>{if(active)setState(data.identityReviewRequired?'required':'clear');}).catch(()=>{if(active)setState('error');});
    return()=>{active=false;};
  },[clinicSlug,attempt]);
  return <section className="card patient-identity-card">
    <div className="card-title"><ShieldCheck size={21}/><h2>{hi?'क्लिनिक रिकॉर्ड की पहचान':'Clinic record identity'}</h2></div>
    {!clinicSlug?<p className="muted">{hi?'पुराने रिकॉर्ड की पहचान की स्थिति देखने के लिए क्लिनिक चुनें।':'Choose a clinic to check the identity status of its existing records.'} <Link to="/patient/clinics">{hi?'क्लिनिक चुनें':'Choose clinic'}</Link></p>
      :state==='loading'?<p role="status">{hi?'पहचान की स्थिति जाँची जा रही है…':'Checking identity status…'}</p>
      :state==='error'?<><p role="alert">{hi?'पहचान की स्थिति लोड नहीं हो पाई।':'Unable to load identity status.'}</p><button className="ghost" type="button" onClick={()=>setAttempt(n=>n+1)}>{hi?'फिर प्रयास करें':'Retry'}</button></>
      :state==='required'?<><p className="patient-identity-warning"><ShieldAlert size={18}/>{hi?'पहचान की समीक्षा आवश्यक है':'Identity review required'}</p><p className="muted">{hi?'इस पुराने क्लिनिक प्रोफ़ाइल की स्वास्थ्य जानकारी सिंक करने से पहले पहचान सत्यापन ज़रूरी है। आपके मौजूदा रिकॉर्ड सुरक्षित रखे गए हैं। रिसेप्शन से संपर्क करें या समीक्षा का अनुरोध दें।':'This older clinic profile needs identity verification before its health summary can be synchronized. Your existing clinic records are preserved. Contact reception or submit an identity review request.'}</p><button className="ghost" type="button" onClick={()=>onRequest(clinicSlug)}>{hi?'पहचान की समीक्षा का अनुरोध दें':'Request identity review'}</button></>
      :<p className="muted">{hi?'चुने हुए क्लिनिक प्रोफ़ाइल के लिए अभी पहचान समीक्षा की आवश्यकता नहीं बताई गई है।':'No identity review is currently required for the selected clinic profile.'}</p>}
    <small className="muted">{hi?'पहचान समीक्षा और वैकल्पिक AI सहमति अलग प्रक्रियाएँ हैं। यहाँ आप दोनों संभाल सकते हैं।':'Identity review and optional AI consent are separate controls, managed together here.'}</small>
  </section>;
}
