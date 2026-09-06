/**
 * **Same-frame toggle storms on an ADOPTED (hydrated) seam — the twin of `slots-storm-fuzz`.**
 *
 * `slots-storm-fuzz` runs the storm on a client-rendered host; this runs it on a host whose seam
 * was ADOPTED from server markup, which reaches a different rank/sentinel path. Run 18 fixed the
 * settled adopted re-slot (adopted nodes were unranked); run 19 found the storm residual behind
 * it — a genuine tail-append processed mid-storm read as "front" against a transiently-misplaced
 * sentinel and took a negative rank, sorting before the adopted nodes. The fix sources the
 * append signal from the MutationRecord (`nextSibling === null`) instead of the live sentinel,
 * which is immune to the module's own churn. This is the regression net for that whole class.
 *
 * Oracle is a NATIVE shadow host given the same script; membership through `assignedNodes()` on
 * both sides. Controls: a healthy share of storms must end shown AND nontrivially assigned.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const serverHtml = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots');
  wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-card-ssr.js', 'file://' + process.cwd() + '/'), { children: '<u slot="header">H0</u>' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text',
  'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);

const { html, wire } = await load('core');
const { renderInto, renderer } = await load('renderer/hydrate');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const SHELL = '<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>';
const card = () => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;
const away = () => html`<p>away</p>`;

const SEEDS = extendSeeds([181818, 242424, 363636, 484848, 606060, 727272]);
let seed = 0;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];

test('adopted-seam storms end where native slotting ends', async () => {
  const mismatches = [];
  let compared = 0;
  let nontrivial = 0;
  for (const start of SEEDS) {
    seed = start;
    for (let run = 0; run < 30; run++) {
      const wrap = doc.createElement('div');
      wrap.innerHTML = serverHtml;
      const host = wrap.firstElementChild;
      doc.getElementById('root').appendChild(host);
      renderInto(card(), host);

      const shadow = doc.createElement('div');
      const su = doc.createElement('u');
      su.setAttribute('slot', 'header');
      su.textContent = 'H0';
      shadow.append(su);
      doc.body.append(shadow);
      shadow.attachShadow({ mode: 'open' });
      shadow.shadowRoot.innerHTML = SHELL;

      const lightNodes = [host.querySelector('u')];
      const shadowNodes = [su];
      let shown = true;
      const script = Array.from({ length: 7 }, () => pick(['slot', 'away', 'add', 'reslot', 'reslot']));
      for (const op of script) {
        if (op === 'slot') { renderInto(card(), host); shadow.shadowRoot.innerHTML = SHELL; shown = true; }
        else if (op === 'away') { renderInto(away(), host); shadow.shadowRoot.innerHTML = '<p>away</p>'; shown = false; }
        else if (op === 'add') {
          const a = doc.createElement('u');
          a.setAttribute('slot', 'header');
          a.textContent = `x${lightNodes.length}`;
          const b = a.cloneNode(true);
          host.append(a);
          shadow.append(b);
          lightNodes.push(a);
          shadowNodes.push(b);
        } else {
          const i = Math.floor(random() * lightNodes.length);
          const name = pick(['header', 'z', '']);
          lightNodes[i]?.setAttribute('slot', name);
          shadowNodes[i]?.setAttribute('slot', name);
        }
      }
      await settle();
      if (shown) {
        compared++;
        const native = shadow.shadowRoot.querySelector('slot[name=header]').assignedNodes().map((n) => n.textContent).join('+');
        const ours = slotted(host, 'header').map((n) => n.textContent).join('+');
        if (native !== ours) mismatches.push({ seed: start, run, script: script.join(','), native, ours });
        if (native !== '') nontrivial++;
      }
      host.remove();
      shadow.remove();
    }
  }
  assert.ok(compared > SEEDS.length * 8, `CONTROL: only ${compared} storms ended shown`);
  assert.ok(nontrivial > compared * 0.25, `CONTROL: only ${nontrivial}/${compared} nontrivial`);
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} adopted-seam storm(s) diverged from native`);
});
