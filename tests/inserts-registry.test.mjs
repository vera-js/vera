/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts (dist/development), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="app"></div>');
globalThis.document = dom.window.document;
const app = dom.window.document.getElementById('app');

// core: registers defaultRenderer into its inserts instance at import
const core = await import(new URL('../packages/core/dist/development/vera.js', import.meta.url).href);
const { html, inserts, setRenderer, defaultRenderer } = core;
const renderVia = (map, template, el) => map.get('render').forEach((cb) => cb(template, el));

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

// 1. core's real html tag renders through the default, automatically
renderVia(inserts, html`<div>hello world</div>`, app);
check('core html`` renders via default', app.innerHTML === '<div>hello world</div>');

// 2-3. escaping: text + attribute breakout
renderVia(inserts, html`<div>${'<img src=x onerror=alert(1)>'}</div>`, app);
check('escapes text values', app.innerHTML.includes('&lt;img') && !app.querySelector('img'));
renderVia(inserts, html`<div title="${'" onmouseover="steal()'}">x</div>`, app);
check('escapes attribute values', !app.querySelector('div[onmouseover]'));

// 4. re-render replaces
renderVia(inserts, html`<p>once</p>`, app);
renderVia(inserts, html`<p>twice</p>`, app);
check('re-render replaces', app.querySelectorAll('p').length === 1 && app.textContent === 'twice');

// 5. string template raw + onclick
renderVia(inserts, '<button onclick="window.n=1">go</button>', app);
check('string raw, onclick intact', app.querySelector('button')?.getAttribute('onclick') === 'window.n=1');

// 6-7. lists, nullish
renderVia(inserts, html`<ul>${['a','b'].map((x) => html`<li>${x}</li>`)}</ul>`, app);
check('nested + arrays flatten', app.querySelectorAll('li').length === 2);
renderVia(inserts, html`<i>${null}${undefined}${false}${true}${0}</i>`, app);
check('nullish/false empty, true/0 kept', app.querySelector('i').textContent === 'true0');

// 8. functions: empty + warn once
let warns = 0; const ow = console.warn; console.warn = () => warns++;
renderVia(inserts, html`<b>${() => 2}</b>`, app);
renderVia(inserts, html`<b>${() => 3}</b>`, app);
console.warn = ow;
check('functions empty + warn once', warns === 1 && app.querySelector('b').textContent === '');

// 9. swap out, then RESTORE via the exported defaultRenderer
let called = 0;
setRenderer(() => called++);
renderVia(inserts, html`<span>x</span>`, app);
check('setRenderer replaces default', inserts.get('render').length === 1 && called === 1);
setRenderer(defaultRenderer);
renderVia(inserts, html`<span>back</span>`, app);
check('defaultRenderer restorable', app.textContent === 'back' && inserts.get('render').length === 1);

// 10. registry-only copies (module-standalone bundles): NO default renderer
const REG = new URL('../packages/inserts/dist/development/vera-inserts.js', import.meta.url).href;
const A = await import(REG + '?copy=a');
const B = await import(REG + '?copy=b');
check('standalone registry ships no renderer', !A.inserts.get('render'));

// 11-12. finding-B fixes still hold across copies
A.setRenderer(() => {});
B.connectInserts(A.inserts);
B.setRenderer(() => {});
check('cross-copy replace at 50', A.inserts.get('render').length === 1);
const seen = [];
B.insert('render', () => seen.push(75), 75);
A.insert('render', () => seen.push(10), 10);
A.inserts.get('render').forEach((cb) => cb('', app));
check('cross-copy ordering 10<50<75', seen[0] === 10 && seen[1] === 75 && A.inserts.get('render').length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
