import React from 'react';
import {Link} from 'react-router-dom';
import {useLanguage} from './LanguageContext';
export default function NotFoundPage(){
 const {language}=useLanguage(),hi=language==='hi';
 return <main className="page public-info"><section className="card info-hero"><span className="info-kicker">404</span>
  <h1>{hi?'यह पेज नहीं मिला।':'Page not found.'}</h1>
  <p>{hi?'पता जाँचें या OPDfy के मुख्य पेज पर लौटें।':'Check the address or return to the OPDfy homepage.'}</p>
  <Link className="primary" to="/">{hi?'मुख्य पेज पर जाएँ':'Return to homepage'}</Link>
 </section></main>;
}
