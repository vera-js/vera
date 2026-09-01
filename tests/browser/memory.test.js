import { expect } from '@esm-bundle/chai';
import { init, createStore, render, useEffect, ref, wire, html, mount } from '../../packages/core/dist/development/vera.js';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { keyed } from '../../packages/renderer/dist/development/vera-renderer-keyed.js';

wire({ on: 'render', fn: renderInto, priority: 50 });

/**
 * Collectability, proved rather than assumed.
 *
 * `@verajs/autoloader` keeps one `MutationObserver` watching every component it discovers through,
 * and never disconnects it — which is only safe if an observed node stays collectable once the page
 * drops it. The DOM spec says an observer's node list holds weak references; this is the check that
 * it is true here.
 *
 * jsdom cannot answer it: there, a removed node observed by a live observer is reported as retained
 * **even after `disconnect()`** — bookkeeping of its own rather than the observer contract. Chromium
 * is launched with `--js-flags=--expose-gc` for this; the other engines skip.
 */
const collect = async () => {
  for (let i = 0; i < 5; i++) {
    window.gc();
    await new Promise((r) => setTimeout(r, 30));
  }
};

const dropAndCollect = async (observe) => {
  const observer = new MutationObserver(() => {});
  let host = document.createElement('div');
  document.body.appendChild(host);
  if (observe) observer.observe(host, { childList: true, subtree: true });
  const ref = new WeakRef(host);
  host.remove();
  host = null;
  await collect();
  return { collected: ref.deref() === undefined, observer };
};

/** Guards the measurement itself: if nothing is ever collected here, the suite proves nothing. */
it('the control is collected, so the measurement means something', async function () {
  if (!window.gc) this.skip();
  const { collected } = await dropAndCollect(false);
  expect(collected, 'a removed, unobserved node is collectable').to.equal(true);
});

it('a removed node observed by a live MutationObserver is still collectable', async function () {
  if (!window.gc) this.skip();
  const { collected, observer } = await dropAndCollect(true);
  expect(collected, 'observation must not pin the node').to.equal(true);
  observer.disconnect();
});

/**
 * The shape the autoloader actually creates: one observer, many watched roots, hosts coming and
 * going. Asserted as a large majority rather than all of them — a collector is free to be late, and
 * the last host of a loop is routinely still reachable from a stack slot. A retention *bug* would
 * hold all fifty, not one. The two tests above are the deterministic proof; this one is the shape.
 */
it('many hosts on one shared observer are collectable', async function () {
  if (!window.gc) this.skip();
  const observer = new MutationObserver(() => {});
  const refs = [];
  for (let i = 0; i < 50; i++) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    observer.observe(host, { childList: true, subtree: true });
    refs.push(new WeakRef(host));
    host.remove();
  }
  await collect();
  const retained = refs.filter((ref) => ref.deref() !== undefined).length;
  expect(retained, `${retained}/50 still reachable`).to.be.below(5);
  observer.disconnect();
});

/**
 * **Do components let go?**
 *
 * This is the question none of the other suites can answer. A retained component throws nothing and
 * renders nothing wrong — the page simply grows until a long-lived tab dies, which is exactly the
 * shape of failure that reaches production intact.
 *
 * It lives here rather than in a jsdom suite for the reason this file already gives: jsdom keeps
 * bookkeeping of its own and reports removed nodes as retained that a real engine collects. A
 * measurement that cannot be trusted in the direction that matters is worse than none.
 *
 * Proportions, not single objects, for the same reason as the observer case above: the last element
 * of a loop is routinely still reachable from a stack slot, while a retention *bug* holds all forty.
 * A probe written the other way round — one component, one `gc()` — reported seven leaks that all
 * evaporated when it was run forty times.
 */
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let tagSeq = 0;
/** Mounts and drops the same component shape N times, and answers how many survived. */
const cycleComponent = async (body, { renders = true, times = 40 } = {}) => {
  const tag = `x-mem-${tagSeq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      body(this);
      /**
       * **`init()` opens a setup and something has to close it.** `render()` does; a component that
       * only registers effects has to call `mount()`. This read `if (renders) return;`, which closes
       * nothing — so the three effect-only shapes below registered hooks that never ran, and the
       * cases most likely to retain something were measuring components with no live effects at all.
       *
       * Core said so on every run — "registered 1 hook(s) but its setup was never committed" — in a
       * suite whose output nobody was reading, which is the whole reason a warning has to be a
       * failure somewhere.
       */
      if (!renders) mount();
    }
  });
  const refs = [];
  for (let i = 0; i < times; i++) {
    let element = document.createElement(tag);
    document.body.appendChild(element);
    await settle();
    element.remove();
    refs.push(new WeakRef(element));
    element = null;
  }
  await settle();
  await collect();
  return refs.filter((weak) => weak.deref() !== undefined).length;
};

/** A store that outlives every component below, which is the shape that would pin them. */
const outliving = createStore({ n: 0, rows: [1, 2, 3] });

const SHAPES = [
  ['a plain rendering component', () => render(() => html`<i>x</i>`)],
  ['one subscribed to a store that outlives it', () => render(() => html`<i>${outliving.n}</i>`)],
  ['one with an effect on that store', () => useEffect(() => { void outliving.n; }), { renders: false }],
  ['one whose effect registers a cleanup', () => useEffect(() => { void outliving.n; return () => {}; }), { renders: false }],
  ['one with an event listener in its template', () => render(() => html`<button @click=${() => {}}>go</button>`)],
  ['one rendering a keyed list', () => render(() => html`<ul>${outliving.rows.map((r) => keyed(r, html`<li>${r}</li>`))}</ul>`)],
  ['one listening to itself', (self) => { self.addEventListener('custom', () => {}); render(() => html`<i>x</i>`); }],
  ['one holding an element ref of its own', () => { const box = ref(); render(() => html`<i ${box}>x</i>`); }],
];

for (const [label, body, options] of SHAPES) {
  it(`${label} is collectable once removed`, async function () {
    if (!window.gc) this.skip();
    this.timeout(20000);
    const retained = await cycleComponent(body, options);
    expect(retained, `${retained}/40 still reachable`).to.be.below(5);
  });
}

/**
 * And writing to the outliving store afterwards must not still be reaching hundreds of dead
 * subscribers — a subscription list that only grows is a leak the `WeakRef` check cannot see,
 * because the elements are gone while their entries are not.
 */
it('a store does not accumulate subscriptions from components that are gone', async function () {
  if (!window.gc) this.skip();
  this.timeout(20000);
  await cycleComponent(() => render(() => html`<i>${outliving.n}</i>`), { times: 100 });
  const started = performance.now();
  for (let i = 0; i < 500; i++) outliving.n = i;
  const elapsed = performance.now() - started;
  /** Generous by design: this is looking for an order of magnitude, not a regression in ns. */
  expect(elapsed, `500 writes took ${elapsed.toFixed(1)}ms after 100 components were dropped`).to.be.below(250);
});
