import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {publicPages,notFoundMetadata,isApplicationPath,structuredData,jsonLd} from './seo';
export default function RouteMetadata(){
 const {pathname}=useLocation();
 useEffect(()=>{
  const page=publicPages[pathname],origin=import.meta.env.VITE_SITE_ORIGIN||'';
  const info=page||(isApplicationPath(pathname)?{title:'OPDfy · Clinic & Patient Portal',description:'Secure access to OPDfy clinic and patient workspaces.'}:notFoundMetadata);
  document.title=info.title;
  for(const el of document.head.querySelectorAll('[data-opdfy-seo]'))el.remove();
  // Remove legacy/generic descriptions so there is exactly one current value.
  for(const el of document.head.querySelectorAll('meta[name="description"],meta[name="robots"],link[rel="canonical"],script[type="application/ld+json"]'))el.remove();
  const meta=(name,content,property=false)=>{const el=document.createElement('meta');el.setAttribute(property?'property':'name',name);el.content=content;el.dataset.opdfySeo='';document.head.append(el);};
  meta('description',info.description);meta('robots',page?'index, follow':'noindex, nofollow');
  if(page){
   meta('og:title',page.title,true);meta('og:description',page.description,true);meta('og:type','website',true);meta('og:site_name','OPDfy',true);
   meta('twitter:card','summary_large_image');meta('twitter:title',page.title);meta('twitter:description',page.description);
   if(origin){
    const link=document.createElement('link');link.rel='canonical';link.href=origin+pathname;link.dataset.opdfySeo='';document.head.append(link);
    meta('og:url',origin+pathname,true);meta('og:image',origin+'/social/opdfy.png',true);meta('og:image:alt','OPDfy Clinic Edition — appointments, live queues and digital prescriptions',true);
    meta('twitter:image',origin+'/social/opdfy.png');
    const schema=document.createElement('script');schema.type='application/ld+json';schema.dataset.opdfySeo='';schema.textContent=jsonLd(structuredData(pathname,origin));document.head.append(schema);
   }
  }
 },[pathname]);
 return null;
}
