/**
 * **The fragment-era mutation sequences, run against REAL shadow DOM in real engines.**
 *
 * Every defect the light-slots mutation fuzz found — content lost in a displaced fallback,
 * re-slotting out of a park going unseen, arrival-order buckets — was found and fixed under jsdom,
 * whose `MutationObserver` batching is an imitation of the platform's. The whole feature rides the
 * observer, so a pass under the imitation is the regression net and this is the oracle: the same
 * sequences, light host against a NATIVE shadow host in the same page, on Chromium, Firefox and
 * WebKit. Every comparison reads through `assignedNodes()` on both sides — rendered `textContent`
 * does not compose in shadow (the r39 trap, six occurrences and counting), and positional
 * addressing cannot name "the same node" across modes (the addressing trap, five), so nodes are
 * held by reference and read through the API.
 *
 * The shell is the fragment-era arrangement: a named outer slot whose FALLBACK holds a nested
 * slot — the shape whose displaced lifecycle produced the content-loss fixes.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';

wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const SHELL = '<div class="box"><slot name="o"><em>E</em><slot name="i">D</slot></slot><main><slot>DF</slot></main></div>';
customElements.define(
  'mo-shadow',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = SHELL;
    }
  }
);

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});

/** One pair per test: a native shadow host, and a light host rendered with the same shell. */
const pair = async () => {
  const shadow = document.createElement('mo-shadow');
  document.body.appendChild(shadow);

  const light = document.createElement('div');
  document.body.appendChild(light);
  const handles = {};
  renderInto(
    html`<div class="box"><slot name="o" &ref=${(s) => { handles.o = s; }}><em>E</em><slot name="i" &ref=${(s) => { handles.i = s; }}>D</slot></slot><main><slot &ref=${(s) => { handles.d = s; }}>DF</slot></main></div>`,
    light
  );
  made.push(shadow, light);
  await settle();
  const slotsOf = (host) =>
    host.shadowRoot
      ? {
          o: host.shadowRoot.querySelector('slot[name="o"]'),
          i: host.shadowRoot.querySelector('slot[name="i"]'),
          d: host.shadowRoot.querySelector('main slot'),
        }
      : handles;
  return { shadow, light, sh: slotsOf(shadow), li: slotsOf(light) };
};

const read = (slotMap) =>
  ['o', 'i', 'd']
    .map((name) => {
      const flat = slotMap[name].assignedNodes({ flatten: true });
      return `${name}=${flat.map((n) => (n.nodeType === 3 ? `"${n.textContent}"` : `<${n.localName}>${n.textContent}`)).join(',') || '-'}`;
    })
    .join(' ');

/** The same mutation on both hosts, by parallel construction — never by query. */
const both = (fn) => {
  const a = fn();
  const b = fn();
  return { forShadow: a, forLight: b };
};

it('content added for a DISPLACED nested slot appears when the outer falls back', async () => {
  const { shadow, light, sh, li } = await pair();
  const owned = both(() => {
    const n = document.createElement('u');
    n.setAttribute('slot', 'o');
    n.textContent = 'OWN';
    return n;
  });
  shadow.appendChild(owned.forShadow);
  light.appendChild(owned.forLight);
  await settle();
  expect(read(li), 'CONTROL: outer assigned in both').to.equal(read(sh));

  const late = both(() => {
    const n = document.createElement('b');
    n.setAttribute('slot', 'i');
    n.textContent = 'IN';
    return n;
  });
  shadow.appendChild(late.forShadow);
  light.appendChild(late.forLight);
  await settle();
  expect(read(li), 'the displaced nested slot took the late node').to.equal(read(sh));

  owned.forShadow.remove();
  owned.forLight.remove();
  await settle();
  expect(read(li), 'and the fallback renders it — the content-loss case, on the engine').to.equal(read(sh));
});

it('re-slotting a node OUT of a displaced park is observed on the engine', async () => {
  const { shadow, light, sh, li } = await pair();
  const owned = both(() => {
    const n = document.createElement('u');
    n.setAttribute('slot', 'o');
    n.textContent = 'OWN';
    return n;
  });
  const inner = both(() => {
    const n = document.createElement('b');
    n.setAttribute('slot', 'i');
    n.textContent = 'IN';
    return n;
  });
  shadow.append(owned.forShadow, inner.forShadow);
  light.append(owned.forLight, inner.forLight);
  await settle();

  /** The node rests inside the park fragment on the light side — outside the host's subtree. */
  inner.forShadow.setAttribute('slot', '');
  inner.forLight.setAttribute('slot', '');
  await settle();
  expect(read(li), 'the attribute change on a parked node was seen and re-routed').to.equal(read(sh));
});

it('displacement round trips: remove, re-add, remove again', async () => {
  const { shadow, light, sh, li } = await pair();
  const owned = both(() => {
    const n = document.createElement('u');
    n.setAttribute('slot', 'o');
    n.textContent = 'OWN';
    return n;
  });
  shadow.appendChild(owned.forShadow);
  light.appendChild(owned.forLight);
  await settle();

  owned.forShadow.remove();
  owned.forLight.remove();
  await settle();
  expect(read(li), 'round trip 1: fallback').to.equal(read(sh));

  shadow.appendChild(owned.forShadow);
  light.appendChild(owned.forLight);
  await settle();
  expect(read(li), 'round trip 2: redisplaced').to.equal(read(sh));

  owned.forShadow.remove();
  owned.forLight.remove();
  await settle();
  expect(read(li), 'round trip 3: restore from the SECOND displacement').to.equal(read(sh));
});

it('a prepended node precedes distributed content — light-tree order on the engine', async () => {
  const { shadow, light, sh, li } = await pair();
  const first = both(() => {
    const n = document.createElement('u');
    n.textContent = 'A';
    return n;
  });
  shadow.appendChild(first.forShadow);
  light.appendChild(first.forLight);
  await settle();

  const front = both(() => {
    const n = document.createElement('u');
    n.textContent = 'FRONT';
    return n;
  });
  shadow.insertBefore(front.forShadow, shadow.firstChild);
  light.insertBefore(front.forLight, light.firstChild);
  await settle();
  expect(read(li), 'front insertion lands ahead, as document order demands').to.equal(read(sh));

  /** And the ordering fix's case: re-slot the earlier node into a bucket with a later arrival. */
  front.forShadow.setAttribute('slot', 'gone');
  front.forLight.setAttribute('slot', 'gone');
  await settle();
  front.forShadow.setAttribute('slot', '');
  front.forLight.setAttribute('slot', '');
  await settle();
  expect(read(li), 'it comes back AHEAD — light-tree order, not arrival order').to.equal(read(sh));
});

/**
 * **`assign()` exists on the light handle and is inert — closing the HTMLSlotElement surface.**
 * jsdom cannot answer this one (it has not implemented `assign` at all), but in engines the ghost
 * is a real `HTMLSlotElement`, so the method is on its prototype — and the spec makes it a no-op
 * for any slot whose root is not a manual-assignment shadow tree, which a detached handle never
 * is. That is the same inertness a named-assignment shadow slot has, so it is parity, not a gap.
 * (`slotAssignment: 'manual'` itself is an `attachShadow` option: a shadow component passes it
 * through `init(this, { mode, slotAssignment })` and native slotting owns it; light has no
 * counterpart by construction.)
 */
it('assign() is present and inert on the light handle, as on any named-assignment slot', async () => {
  const { light, li } = await pair();
  const owned = document.createElement('u');
  owned.setAttribute('slot', 'o');
  owned.textContent = 'OWN';
  light.appendChild(owned);
  await settle();
  expect(typeof li.o.assign, 'the ghost is a real HTMLSlotElement').to.equal('function');
  /**
   * The stray is appended and CAPTURE settles first — an unnamed element is a legitimate
   * default-slot slottable, and the first version of this test appended it inside the
   * before/after window, then read capture's correct routing as assign() acting. The engines
   * were asserting native semantics against a probe that misattributed them.
   */
  const stray = document.createElement('b');
  stray.textContent = 'STRAY';
  light.appendChild(stray);
  await settle();
  const before = read(li);
  li.o.assign(stray);
  await settle();
  expect(read(li), 'assign() changed nothing — inert outside manual mode, exactly as in shadow').to.equal(before);
  stray.remove();
});
