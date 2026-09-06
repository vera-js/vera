/**
 * **Same-frame toggle storms against native slotting — the regime every other slots suite
 * settles out of existence.** The mutation-parity fuzz settles between steps; this one runs 6–8
 * synchronous ops (branch to the slot template, branch away, append a slottable, re-slot one)
 * with NO settling until the storm ends, then reads both sides through `assignedNodes`.
 *
 * Run 17 found the machinery's one wrong assumption exactly here: `drain()` discarded the whole
 * observer queue after the module's own moves, and observer delivery being asynchronous, a USER
 * mutation from earlier in the same task was still sitting in that queue — an append eaten by a
 * restore's drain, a same-batch add+rename evicting a sibling, a rename-while-parked never
 * processed. Seven deterministic divergences, one root cause. The fix re-feeds taken records
 * through the handler (every arm is ownership/position-discriminating, so our own records no-op),
 * plus the `inAnyRun` guard the re-feed exposed: a mount's fill moves captured nodes into the
 * DETACHED instance fragment, which the user-took removal arm misread as theft until position
 * between anchors — true in fragment and host alike — became the test.
 *
 * Controls: a healthy share of storms must end with the slot shown AND nontrivially assigned, or
 * the run compared fallbacks with fallbacks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame',
  'cancelAnimationFrame', 'MutationObserver']) globalThis[k] = dom.window[k];

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

const SEEDS = extendSeeds([171717, 292929, 434343, 565656, 787878, 909090]);
let seed = 0;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];

test('same-frame storms end where native slotting ends', async () => {
  const mismatches = [];
  let compared = 0;
  let nontrivial = 0;
  for (const start of SEEDS) {
    seed = start;
    for (let run = 0; run < 30; run++) {
      const light = doc.createElement('div');
      doc.body.append(light);
      const refs = [];
      const strings = Object.assign(['<div><slot name="o" &ref=', '>F</slot></div>'], { raw: ['<div><slot name="o" &ref=', '>F</slot></div>'] });
      const withSlot = { _$litType$: 1, strings, values: [(n) => { refs[0] = n; }] };
      const away = html`<p>away</p>`;
      const shadow = doc.createElement('div');
      doc.body.append(shadow);
      shadow.attachShadow({ mode: 'open' });
      const lightNodes = [];
      const shadowNodes = [];
      let shown = false;
      const script = Array.from({ length: 8 }, () => pick(['slot', 'away', 'add', 'reslot', 'reslot']));
      for (const op of script) {
        if (op === 'slot') {
          renderInto(withSlot, light);
          shadow.shadowRoot.innerHTML = '<div><slot name="o">F</slot></div>';
          shown = true;
        } else if (op === 'away') {
          renderInto(away, light);
          shadow.shadowRoot.innerHTML = '<p>away</p>';
          shown = false;
        } else if (op === 'add') {
          const a = doc.createElement('u');
          a.setAttribute('slot', 'o');
          a.textContent = `x${lightNodes.length}`;
          const b = a.cloneNode(true);
          light.append(a);
          shadow.append(b);
          lightNodes.push(a);
          shadowNodes.push(b);
        } else if (lightNodes.length) {
          const i = Math.floor(random() * lightNodes.length);
          const name = pick(['o', 'z', '']);
          lightNodes[i].setAttribute('slot', name);
          shadowNodes[i].setAttribute('slot', name);
        }
      }
      await settle();
      if (shown && refs[0]) {
        compared++;
        const native = shadow.shadowRoot.querySelector('slot[name=o]').assignedNodes({ flatten: true }).map((n) => n.textContent).join('+');
        const ours = refs[0].assignedNodes({ flatten: true }).map((n) => n.textContent).join('+');
        if (native !== ours) mismatches.push({ seed: start, run, script: script.join(','), native, ours });
        if (native !== 'F' && native !== '') nontrivial++;
      }
      light.remove();
      shadow.remove();
    }
  }
  assert.ok(compared > SEEDS.length * 8, `CONTROL: only ${compared} storms ended shown`);
  assert.ok(nontrivial > compared * 0.25, `CONTROL: only ${nontrivial}/${compared} nontrivial — mostly fallback-vs-fallback`);
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} storm(s) diverged from native slotting`);
});
