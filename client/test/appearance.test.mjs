import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css = postcss.parse(read('src/dark-contrast.css'));
const luminance = rgb => rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);
test('generated opaque text palette clears 4.5:1 against generated opaque surfaces',()=>{
  const foreground=[], background=[];
  css.walkDecls(d=>{
    if (!['color','background','background-color','background-image'].includes(d.prop)) return;
    for (const m of d.value.matchAll(/rgba\((\d+),(\d+),(\d+),1\)/g)) {
      (d.prop==='color'?foreground:background).push(luminance(m.slice(1).map(Number)));
    }
  });
  assert.ok(foreground.length>500); assert.ok(background.length>200);
  const ratio=(Math.min(...foreground)+.05)/(Math.max(...background)+.05);
  assert.ok(ratio>=4.5,`Palette minimum contrast ${ratio}`);
});
test('dark rules are screen scoped and contain no application behaviour or layout changes',()=>{
  let darkRules=0;
  css.walkRules(rule=>{
    if (!rule.selector.includes('data-theme="dark"')) return;
    darkRules++;
    let p=rule.parent, screen=false;
    while(p) { if(p.type==='atrule'&&p.name==='media'&&p.params==='screen') screen=true; p=p.parent; }
    assert.ok(screen,rule.selector);
    rule.walkDecls(d=> assert.ok(d.prop.startsWith('--')||['color','background','background-color','background-image','-webkit-text-fill-color','caret-color','border-color','outline-color','opacity','-webkit-box-shadow'].includes(d.prop),d.prop));
  });
  assert.ok(darkRules>500);
});
test('public login header exposes both existing preference components',()=>{
  const app=read('src/App.jsx');
  assert.match(app,/<div className="header-actions">\s*<LanguageSwitcher \/>\s*<ThemeToggle \/>/);
  assert.match(read('src/main.jsx'),/import "\.\/dark-contrast.css"/);
  assert.match(read('src/appearance-controls.css'),/\.public-mode \.theme-toggle span \{ display: inline;/);
});
