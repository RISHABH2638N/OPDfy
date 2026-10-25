import assert from 'node:assert/strict';
import fs from 'node:fs';
// Text-free layout/color baseline for the intentionally revised patient screen.
// Keeps identity, timestamps and credentials out of the stored fixture.
export async function patientLayout(page) {
 return page.evaluate(() => {
  const main=document.querySelector('main.patient-workspace'),origin=main.getBoundingClientRect();
  const selectors=['.head','.patient-command-tabs','#patient-overview','.patient-snapshot-grid','#patient-booking','.patient-booking-identity','.booking-doctor-rating','.patient-fee-quote','#patient-appointments','.patient-ai-widget-launcher'];
  return {viewport:{width:innerWidth,height:innerHeight},panels:selectors.map(selector=>{
   const el=main.querySelector(selector);if(!el)return {selector,present:false};
   const box=el.getBoundingClientRect(),style=getComputedStyle(el);
   return {selector,present:true,visible:box.width>0&&box.height>0,box:{x:Math.round(box.x-origin.x),y:Math.round(box.y-origin.y),width:Math.round(box.width),height:Math.round(box.height)},color:style.color,background:style.backgroundColor,fontSize:style.fontSize};
  })};
 });
}
export function assertPatientLayout(actual,expected){
 assert.deepEqual(actual.viewport,expected.viewport);
 assert.equal(actual.panels.length,expected.panels.length);
 for(let i=0;i<actual.panels.length;i++){
  const a=actual.panels[i],b=expected.panels[i];
  for(const key of ['selector','present','visible','color','background','fontSize'])assert.equal(a[key],b[key],`${a.selector}: ${key}`);
  if(a.box)for(const key of ['x','y','width','height'])assert.ok(Math.abs(a.box[key]-b.box[key])<=2,`${a.selector}: ${key} ${a.box[key]} differs from ${b.box[key]}`);
 }
}
export async function verifyPatientLayout(page,baseline,target){
 const actual=await patientLayout(page);fs.writeFileSync(target,JSON.stringify(actual,null,2)+'\n');
 if(process.env.QA_UPDATE_PATIENT_LAYOUT==='1'){fs.writeFileSync(baseline,JSON.stringify(actual,null,2)+'\n');return;}
 assert.ok(fs.existsSync(baseline),'Patient layout baseline must be explicitly reviewed before updating.');
 assertPatientLayout(actual,JSON.parse(fs.readFileSync(baseline,'utf8')));
}
