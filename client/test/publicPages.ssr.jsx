// Render-only checks; bundle with esbuild and execute with Node, no live API.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import assert from 'node:assert/strict';
import { LanguageProvider } from '../src/LanguageContext.jsx';
import PublicInfoPage, { PublicFooter, ClinicPolicyAcceptance, PatientPolicyNotice } from '../src/PublicPages.jsx';
import { SUPPORT_EMAIL, publicContent, publicNavigation } from '../src/publicContent.js';
for (const language of ['en','hi']) {
  globalThis.localStorage={getItem:()=>language};
  const render=child=>renderToStaticMarkup(<LanguageProvider><MemoryRouter>{child}</MemoryRouter></LanguageProvider>);
  for(const kind of Object.keys(publicContent)) {
    const html=render(<PublicInfoPage kind={kind}/>);
    assert.ok(html.includes(publicContent[kind].title[language==='hi'?1:0]));
    assert.ok(html.includes(`mailto:${SUPPORT_EMAIL}`));
    assert.equal((html.match(/class="info-section"/g)||[]).length,publicContent[kind].sections.length);
  }
  const footer=render(<PublicFooter/>);
  for(const [href] of publicNavigation) assert.ok(footer.includes(`href="${href}"`));
  const consent=render(<ClinicPolicyAcceptance checked={false} onChange={()=>{}}/>);
  assert.match(consent,/type="checkbox"/); assert.match(consent,/required=""/); assert.doesNotMatch(consent,/checked=""/);
  assert.match(consent,/target="_blank"/);
  const notice=render(<PatientPolicyNotice/>); assert.match(notice,/href="\/privacy"/); assert.match(notice,/href="\/terms"/);
}
console.log('Public pages, footer, notice and unchecked consent rendered in Hindi and English.');
