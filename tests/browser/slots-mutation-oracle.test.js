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
import { ever, until } from './until.js';

wire([renderer, slots]);
/** A macrotask: the light host's capture (a mutation-observer delivery) of anything done before it has run. Not a time. */
const task = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  const light = document.createElement('mo-light'); // a CUSTOM element, by name: light slots capture only those (ruling 4)
  document.body.appendChild(light);
  const handles = {};
  renderInto(
    html`<div class="box"><slot name="o" &ref=${(s) => { handles.o = s; }}><em>E</em><slot name="i" &ref=${(s) => { handles.i = s; }}>D</slot></slot><main><slot &ref=${(s) => { handles.d = s; }}>DF</slot></main></div>`,
    light
  );
  made.push(shadow, light);
  await task();
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
/**
 * **The light side has caught up**: native slotting answers at once, the light host's capture a delivery later; every
 * step below changes what the native side reads, so the light side matches it only once it has caught up (its previous
 * reading is the previous step's). Polled, then asserted, so a miss shows both readings. A fixed 30 ms read a late
 * delivery as a wrong one.
 */
const agree = async (li, sh, what) => {
  await ever(() => read(li) === read(sh), 2000);
  expect(read(li), what).to.equal(read(sh));
};

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
  await agree(li, sh, 'CONTROL: outer assigned in both');

  const late = both(() => {
    const n = document.createElement('b');
    n.setAttribute('slot', 'i');
    n.textContent = 'IN';
    return n;
  });
  shadow.appendChild(late.forShadow);
  light.appendChild(late.forLight);
  await agree(li, sh, 'the displaced nested slot took the late node');

  owned.forShadow.remove();
  owned.forLight.remove();
  await agree(li, sh, 'and the fallback renders it — the content-loss case, on the engine');
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
  await agree(li, sh, 'CONTROL: both assigned');

  /** The node rests inside the park fragment on the light side — outside the host's subtree. */
  inner.forShadow.setAttribute('slot', '');
  inner.forLight.setAttribute('slot', '');
  await agree(li, sh, 'the attribute change on a parked node was seen and re-routed');
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
  await agree(li, sh, 'CONTROL: displaced');

  owned.forShadow.remove();
  owned.forLight.remove();
  await agree(li, sh, 'round trip 1: fallback');

  shadow.appendChild(owned.forShadow);
  light.appendChild(owned.forLight);
  await agree(li, sh, 'round trip 2: redisplaced');

  owned.forShadow.remove();
  owned.forLight.remove();
  await agree(li, sh, 'round trip 3: restore from the SECOND displacement');
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
  await agree(li, sh, 'CONTROL: the first node distributed');

  const front = both(() => {
    const n = document.createElement('u');
    n.textContent = 'FRONT';
    return n;
  });
  shadow.insertBefore(front.forShadow, shadow.firstChild);
  light.insertBefore(front.forLight, light.firstChild);
  await agree(li, sh, 'front insertion lands ahead, as document order demands');

  /** And the ordering fix's case: re-slot the earlier node into a bucket with a later arrival. */
  front.forShadow.setAttribute('slot', 'gone');
  front.forLight.setAttribute('slot', 'gone');
  await agree(li, sh, 'moved out to a slot nobody has');
  front.forShadow.setAttribute('slot', '');
  front.forLight.setAttribute('slot', '');
  await agree(li, sh, 'it comes back AHEAD — light-tree order, not arrival order');
});

/**
 * **`assign()` exists on the light handle and is inert — closing the HTMLSlotElement surface.**
 * jsdom cannot answer this one (it has not implemented `assign` at all), but in engines the ghost
 * is a real `HTMLSlotElement`, so the method is on its prototype — and the spec makes it a no-op
 * for any slot whose root is not a manual-assignment shadow tree, which a detached handle never
 * is. That is the same inertness a named-assignment shadow slot has, so it is parity, not a gap.
 * (`slotAssignment: 'manual'` itself is an `attachShadow` option: a shadow component passes it
 * through `init({ host: this, shadow: { mode, slotAssignment } }, setup)` and native slotting owns it; light has no
 * counterpart by construction.)
 */
it('assign() is present and inert on the light handle, as on any named-assignment slot', async () => {
  const { light, li } = await pair();
  const owned = document.createElement('u');
  owned.setAttribute('slot', 'o');
  owned.textContent = 'OWN';
  light.appendChild(owned);
  await until(() => read(li).includes('OWN'), 'the owned node captured', 2000);
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
  await until(() => read(li).includes('STRAY'), 'the stray captured', 2000);
  const before = read(li);
  li.o.assign(stray);
  /**
   * The barrier for "changed nothing": a control node added after assign() and taken away again, each change waited
   * for, so every delivery queued behind assign() has been read when the reading is compared.
   */
  const control = document.createElement('i');
  control.textContent = 'CTL';
  light.appendChild(control);
  await until(() => read(li).includes('CTL'), 'the control captured', 2000);
  control.remove();
  await until(() => !read(li).includes('CTL'), 'the control released', 2000);
  expect(read(li), 'assign() changed nothing — inert outside manual mode, exactly as in shadow').to.equal(before);
  stray.remove();
});
