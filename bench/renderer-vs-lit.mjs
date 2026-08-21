/**
 * Head-to-head: @verajs/renderer against lit-html, driven synchronously with no framework
 * scheduling in the way — a pure renderer comparison on the js-framework-benchmark operations.
 *
 *   npm run build && node bench/renderer-vs-lit.mjs
 *
 * Runs under jsdom, so the numbers are directional (DOM ops only, no layout or paint). The absolute
 * values are ~50x a real browser's; the RATIOS are the signal. Fastest of 7 with 2 warmups
 * discarded, because noise here is one-sided.
 */
import { createRequire } from 'node:module';
import { writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);
const esbuild = require(process.cwd() + '/node_modules/esbuild/lib/main.js');

const ENTRY = `
import { render as vera, keyed } from '@verajs/renderer';
import { html as litHtml, render as lit, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
const h = (strings, ...values) => ({ _$litType$: 1, strings, values });

const mk = (n, o = 0) => Array.from({ length: n }, (_, i) => ({ id: i + o, label: 'row label ' + (i + o) }));

const veraT = (list, sel) => h\`<table><tbody>\${list.map((r) =>
  keyed(r.id, h\`<tr class="\${sel === r.id ? 'selected' : null}"><td>\${r.id}</td><td><a>\${r.label}</a></td><td><a>x</a></td></tr>\`))}</tbody></table>\`;
const litT = (list, sel) => litHtml\`<table><tbody>\${repeat(list, (r) => r.id, (r) =>
  litHtml\`<tr class=\${sel === r.id ? 'selected' : nothing}><td>\${r.id}</td><td><a>\${r.label}</a></td><td><a>x</a></td></tr>\`)}</tbody></table>\`;

globalThis.__go = () => {
  const out = {};
  /** Guard against silently measuring a no-op: verify the DOM after each operation shape. */
  {
    const c = document.createElement('div');
    document.body.appendChild(c);
    for (const [rf, tpl, tag] of [[vera, veraT, 'vera'], [lit, litT, 'lit']]) {
      rf(tpl(mk(50), -1), c);
      if (c.querySelectorAll('tr').length !== 50) throw new Error(tag + ': create is not real');
      rf(tpl(mk(50), 7), c);
      if (c.querySelectorAll('tr.selected').length !== 1) throw new Error(tag + ': select is not real');
      const d = mk(50); const t2 = d.slice(); const tmp = t2[1]; t2[1] = t2[48]; t2[48] = tmp;
      rf(tpl(t2, -1), c);
      if (c.querySelectorAll('tr')[1].firstElementChild.textContent !== '48') throw new Error(tag + ': swap is not real');
      rf(tpl([], -1), c);
      if (c.querySelectorAll('tr').length !== 0) throw new Error(tag + ': clear is not real');
      c.textContent = '';
    }
    c.remove();
  }
  const bench = (name, renderFn, tpl) => {
    /** Sub-ms ops need many reps: at this scale, process-level noise exceeds the op itself. */
    const time = (fn, reps = 51) => {
      const t = [];
      const warm = reps > 2 ? 2 : 1;
      for (let i = 0; i < reps + warm; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
      return Math.min(...t.slice(warm));
    };
    const fresh = () => { const c = document.createElement('div'); document.body.appendChild(c); return c; };
    const r = {};
    { const c = fresh(); r['create 1k'] = time(() => { renderFn(tpl([], -1), c); renderFn(tpl(mk(1000), -1), c); }, 9); c.remove(); }
    { const c = fresh(); r['create 10k'] = time(() => { renderFn(tpl([], -1), c); renderFn(tpl(mk(10000), -1), c); }, 1); c.remove(); }
    { const c = fresh(); const d = mk(1000);
      r['append 1k'] = time(() => { renderFn(tpl(d, -1), c); renderFn(tpl(d.concat(mk(1000, 1000)), -1), c); }, 9); c.remove(); }
    { const c = fresh(); const d = mk(1000); renderFn(tpl(d, -1), c); let flip = 0;
      r['update 10th'] = time(() => { const nd = d.map((x, i) => (i % 10 === 0 ? { ...x, label: x.label + ' !' + flip } : x)); flip++; renderFn(tpl(nd, -1), c); }); c.remove(); }
    { const c = fresh(); const d = mk(1000); renderFn(tpl(d, -1), c); let s = 0;
      r['select'] = time(() => { renderFn(tpl(d, s = (s + 7) % 1000), c); }); c.remove(); }
    { const c = fresh(); const d = mk(1000); renderFn(tpl(d, -1), c); let f = false;
      r['swap'] = time(() => { const nd = d.slice(); if (f) { const t = nd[1]; nd[1] = nd[998]; nd[998] = t; } f = !f; renderFn(tpl(nd, -1), c); }); c.remove(); }
    { const c = fresh(); const d = mk(1000); let i = 0;
      r['remove'] = time(() => { renderFn(tpl(d, -1), c); const nd = d.slice(); nd.splice(400 + (i++ % 500), 1); renderFn(tpl(nd, -1), c); }); c.remove(); }
    { const c = fresh(); const d = mk(1000);
      r['clear 1k'] = time(() => { renderFn(tpl(d, -1), c); renderFn(tpl([], -1), c); }, 9); c.remove(); }
    out[name] = r;
  };
  bench('vera', vera, veraT);
  bench('lit', lit, litT);
  return out;
};
`;

writeFileSync('bench/.rvl-entry.js', ENTRY);
let bundle;
try {
  const out = await esbuild.build({
    entryPoints: ['bench/.rvl-entry.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: process.cwd(),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  bundle = out.outputFiles[0].text;
} finally {
  unlinkSync('bench/.rvl-entry.js');
}

const dom = new JSDOM('<!doctype html><body></body>', {
  runScripts: 'outside-only',
  virtualConsole: new VirtualConsole(),
});
dom.window.eval(bundle);
const r = dom.window.__go();

console.log('\n  @verajs/renderer vs lit-html — synchronous, jsdom, fastest of 7\n');
console.log('  ' + 'op'.padEnd(13) + 'vera'.padStart(10) + 'lit'.padStart(10) + '    verdict');
let wins = 0;
let ops = 0;
for (const op of Object.keys(r.vera)) {
  const v = r.vera[op];
  const l = r.lit[op];
  ops++;
  if (v <= l) wins++;
  const verdict = v <= l ? (l / v).toFixed(2) + 'x faster' : (v / l).toFixed(2) + 'x SLOWER';
  console.log('  ' + op.padEnd(13) + v.toFixed(2).padStart(10) + l.toFixed(2).padStart(10) + '    ' + verdict);
}
console.log(`\n  faster or equal on ${wins} of ${ops}`);
