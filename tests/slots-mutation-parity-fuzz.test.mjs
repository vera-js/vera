/**
 * **The slot read API against native shadow slotting, across mutation SEQUENCES.**
 *
 * `slots-api-parity-fuzz.test.mjs` generates structures and compares one reading of each. This one
 * generates a structure and then does things to it — add, prepend, add text, remove, re-slot —
 * comparing after every step, because the defects that survive a static comparison are the ones
 * where state goes stale rather than starts wrong. Four did:
 *
 * 1. `{ flatten: true }` answered from a snapshot, so it kept naming a node the user had removed.
 * 2. Content added to a slot nested in a DISPLACED fallback was lost outright — detached, while
 *    that slot's own `assignedNodes()` still named it.
 * 3. Re-slotting a node out of such a slot did nothing: it rests outside the host's subtree, so
 *    the attribute change was never observed.
 * 4. Re-slotting into a bucket that already held a later arrival gave arrival order, not light-tree
 *    order — the divergence that produced the rank mechanism in `slots.ts`.
 *
 * **Addressing is the trap this file exists to get right, and it took three attempts.** "The same
 * mutation on both hosts" cannot be expressed positionally: a shadow host keeps every distributed
 * child, while light slots physically move them into a slot's region or out to holding. So
 * `host.children` selects different targets on each side, and so does a `[data-*]` query — the two
 * hosts quietly receive different mutations and the divergence that follows reads exactly like a
 * framework defect. The only honest addressing is a parallel list of node references per host,
 * built from one spec. Both wrong versions reported 126 mismatches; the right one reports what is
 * actually there.
 *
 * `prepend` is included because it is the one MID-position expressible in both modes: in shadow
 * `firstChild` is the first user node, and in light it is the capture sentinel with the light region
 * before it, so the same call means the same thing in light-tree terms. It found defect 4's second
 * half — a prepend into an empty bucket — within one run of being added.
 *
 * Controls: most readings must differ from the step before (or the run is comparing a still life),
 * and the sibling file's corruption control covers the comparison itself.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

const SEEDS = extendSeeds([20260904, 77, 6161]);
let seed = 0;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];

const FALLBACKS = ['F', '<em>E</em>', 'F<!--c-->', '<slot name="i">D</slot>', '<em>E</em><slot name="i">D</slot>', ''];
const NAMES = ['a', 'b', ''];

/** One structure, two ways — markup for a shadow root, `strings`/`values` with a ref per slot. */
const build = (count) => {
  const parts = Array.from({ length: count }, () => ({ name: pick(NAMES), body: pick(FALLBACKS) }));
  const open = (part) => `<slot${part.name === '' ? '' : ` name="${part.name}"`}`;
  const markup = parts.map((part) => `<p>${open(part)}>${part.body}</slot></p>`).join('');
  const strings = [];
  const refs = [];
  let tail = '';
  for (const part of parts) {
    strings.push(`${tail}<p>${open(part)} &ref=`);
    tail = `>${part.body}</slot></p>`;
  }
  strings.push(tail);
  return {
    markup,
    template: { strings: Object.assign(strings, { raw: [...strings] }), values: parts.map((_, i) => (n) => { refs[i] = n; }) },
    refs,
  };
};

const read = (slot) => {
  const show = (nodes) =>
    nodes.map((n) => `${n.nodeType}:${n.nodeType === 1 ? `${n.localName}#${n.textContent}` : n.textContent}`).join('|');
  return [
    show(slot.assignedNodes()),
    show(slot.assignedNodes({ flatten: true })),
    show(slot.assignedElements({ flatten: true })),
  ].join(' /// ');
};

const makeUser = (host, specs) => {
  const nodes = [];
  for (const spec of specs) {
    const u = doc.createElement('u');
    if (spec.name !== null) u.setAttribute('slot', spec.name);
    u.textContent = spec.text;
    host.append(u);
    nodes.push(u);
  }
  return nodes;
};

/** By node REFERENCE — see the header on why nothing positional works here. */
const mutate = (host, nodes, plan) => {
  if (plan.op === 'add' || plan.op === 'prepend') {
    const u = doc.createElement('u');
    if (plan.name !== null) u.setAttribute('slot', plan.name);
    u.textContent = plan.text;
    if (plan.op === 'add') {
      host.append(u);
      nodes.push(u);
    } else {
      host.insertBefore(u, host.firstChild);
      nodes.unshift(u);
    }
    return;
  }
  if (plan.op === 'addText') {
    host.append(doc.createTextNode(plan.text));
    return;
  }
  if (nodes.length === 0) return;
  const index = plan.index % nodes.length;
  const target = nodes[index];
  if (plan.op === 'remove') {
    target.remove();
    nodes.splice(index, 1);
  } else if (plan.name === null) target.removeAttribute('slot');
  else target.setAttribute('slot', plan.name);
};

test('every read stays in step with native shadow slotting across mutation sequences', async () => {
  const mismatches = [];
  let compared = 0;
  let changed = 0;

  for (const start of SEEDS) {
    seed = start;
    for (let run = 0; run < 60; run++) {
      const specs = Array.from({ length: Math.floor(random() * 3) + 1 }, () => ({
        name: pick(['a', 'b', 'i', '', null]),
        text: String(Math.floor(random() * 90) + 10),
      }));
      const { markup, template, refs } = build(Math.floor(random() * 3) + 1);

      const shadowHost = doc.createElement('div');
      doc.body.append(shadowHost);
      const shadowNodes = makeUser(shadowHost, specs);
      shadowHost.attachShadow({ mode: 'open' }).innerHTML = markup;

      const lightHost = doc.createElement('div');
      doc.body.append(lightHost);
      const lightNodes = makeUser(lightHost, specs);
      renderInto(template, lightHost);
      await frame();

      let previous = null;
      for (let step = 0; step < 4; step++) {
        const plan = {
          op: pick(['add', 'addText', 'prepend', 'remove', 'reslot', 'reslot', 'reslot']),
          name: pick([...NAMES, 'i', null]),
          text: `x${Math.floor(random() * 90) + 10}`,
          index: Math.floor(random() * 5),
        };
        mutate(shadowHost, shadowNodes, plan);
        mutate(lightHost, lightNodes, plan);
        await frame();
        await frame();

        const native = [...shadowHost.shadowRoot.querySelectorAll('p > slot')].map(read);
        const light = refs.map((slot) => (slot ? read(slot) : 'NO REF — the slot never mounted'));
        compared++;
        const key = JSON.stringify(native);
        if (key !== previous) {
          changed++;
          previous = key;
        }
        if (key !== JSON.stringify(light)) {
          mismatches.push({ seed: start, run, step, specs, markup, plan, native, light });
          break;
        }
      }
      shadowHost.remove();
      lightHost.remove();
    }
  }

  assert.ok(changed > compared * 0.4,
    `CONTROL: only ${changed} of ${compared} readings differed from the step before — little was disturbed`);
  assert.deepEqual(mismatches, [], 'every reading, after every mutation, must match the platform');
});
