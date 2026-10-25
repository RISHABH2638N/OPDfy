// One explicit public URL inventory drives prerendering, metadata and crawl files.
export const publicPages = {
  '/': {title:'OPDfy | Clinic Management & Smart OPD Queue Software', description:'Connect clinic registration, appointments, live OPD queues, digital prescriptions and follow-ups with OPDfy Clinic Edition.'},
  '/faqs': {title:'OPDfy FAQs | Patient Visits & Clinic Workflows', description:'Answers about OPDfy bookings, clinic visits, queues, prescriptions, patient accounts and help for clinic teams.'},
  '/support': {title:'Contact & Support | OPDfy Clinic Edition', description:'Contact OPDfy support for product help, clinic onboarding and account assistance. Find guidance for sharing support requests safely.'},
  '/privacy': {title:'Privacy Policy | OPDfy Clinic Edition', description:'Read how OPDfy processes account and clinic information, supports privacy requests and explains patient and clinic responsibilities.'},
  '/terms': {title:'Terms & Conditions | OPDfy Clinic Edition', description:'Read the terms for using OPDfy Clinic Edition, including patient accounts, clinic responsibilities, subscriptions and service limitations.'},
};
export const isPublicPage = path => Object.hasOwn(publicPages,path);
export const isApplicationPath = path => /^\/(?:patient(?:-login)?|doctor|reception|admin|platform|clinic|display)(?:\/|$)/.test(path)||['/login','/qr-checkin','/token','/tv'].includes(path);
export const notFoundMetadata = {title:'Page Not Found | OPDfy',description:'This OPDfy page could not be found. Return to the homepage or contact support.'};
export function validateSiteOrigin(value, synthetic = false) {
  if (!value) throw Error('Set PUBLIC_SITE_ORIGIN to the verified canonical HTTPS origin before building. No production domain is assumed.');
  const url = new URL(value);
  if (url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port||(!synthetic&&(url.hostname==='localhost'||url.hostname.endsWith('.invalid')||url.hostname.endsWith('.test')))) throw Error('PUBLIC_SITE_ORIGIN must be a real HTTPS origin without a path, port, credentials, query or fragment.');
  return url.origin;
}
export function structuredData(path,origin) {
 const page=publicPages[path];if(!page||!origin)return null;
 return {'@context':'https://schema.org','@graph':[
  {'@type':'Organization','@id':origin+'/#organization',name:'OPDfy',url:origin+'/'},
  {'@type':'WebSite','@id':origin+'/#website',name:'OPDfy',url:origin+'/',publisher:{'@id':origin+'/#organization'}},
  {'@type':'WebPage','@id':origin+path+'#webpage',url:origin+path,name:page.title,description:page.description,isPartOf:{'@id':origin+'/#website'}},
  ...(path==='/'?[{'@type':'SoftwareApplication',name:'OPDfy Clinic Edition',applicationCategory:'BusinessApplication',operatingSystem:'Web browser',url:origin+'/',description:page.description,publisher:{'@id':origin+'/#organization'}}]:[]),
 ]};
}
export const jsonLd = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
