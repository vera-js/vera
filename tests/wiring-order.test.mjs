/**
 * Wiring order must not change anything.
 *
 * `wire([renderer, router])` is the documented call, and the order inside that array is arbitrary:
 * every module carries its own `priority`, chains are stored priority-sorted, and `CLAUDE.md` is
 * explicit that the modules are independent. So an app that wires them in a different order — or adds
 * one to the end of the list a year later — must behave identically.
 *
 * Nothing checked it. Each module's suite wires that module; the combination suites wire a fixed
 * order. A regression would be near-silent: the chain still runs, the app still renders, and only
 * something that depends on *when* a callback ran comes out different, on somebody else's machine
 * because their import list is in a different order.
 *
 * ## Two halves, because they fail differently
 *
 * The synthetic half shuffles many descriptors into a **fresh insert point per trial**, which is what
 * makes it cheap: a unique `on` name sidesteps the module-level registry without a new process. It
 * pins the ordering rule itself.
 *
 * The real half wires the actual modules forward and reversed in child processes, because their
 * registrations are at fixed insert points and one process holds one registry. It pins what the
 * synthetic half cannot: that no module does order-dependent work *at wire time*. All 24 permutations
 * of renderer/router/autoloader/styles were compared when this was written and produced byte-identical
 * DOM; two are kept here, since the cost is a process each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const { wire, inserts } = await load('core');

/** A deterministic shuffle, so a failure is reproducible rather than a story about one CI run. */
const shuffled = (items, seed) => {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

test('a chain runs in priority order however it was wired', () => {
  const priorities = [50, 10, 75, 33, 100, 1, 62];
  const expected = [...priorities].sort((a, b) => a - b);

  for (let seed = 1; seed <= 40; seed++) {
    /** A fresh insert point per trial, so one process can hold forty independent registries. */
    const point = `probe-order-${seed}`;
    const ran = [];
    for (const priority of shuffled(priorities, seed))
      wire({ on: point, fn: () => ran.push(priority), priority });

    for (const callback of inserts.get(point) ?? []) callback();
    assert.deepEqual(ran, expected, `seed ${seed}: wiring order leaked into run order`);
  }
});

test('and the chain holds every registration exactly once', () => {
  const point = 'probe-order-count';
  for (const priority of shuffled([5, 4, 3, 2, 1], 7)) wire({ on: point, fn: () => {}, priority });
  assert.equal(inserts.get(point).length, 5, 'five distinct priorities, five entries');
});

/** Wires the named modules in the given order, runs a component, and prints the resulting DOM. */
const APP = `
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','MouseEvent','PopStateEvent','MutationObserver','ShadowRoot','history','location'])
  globalThis[k] = dom.window[k];
dom.window.scrollTo = () => {};
const D = new URL('../packages/', import.meta.url).href;
const LOAD = {
  renderer: async () => (await import(D + 'renderer/dist/development/vera-renderer.js')).renderer,
  router: async () => (await import(D + 'router/dist/development/vera-router.js')).router,
  autoloader: async () => (await import(D + 'autoloader/dist/development/vera-autoloader.js')).autoloader('https://x.test/app.js', 'c'),
  styles: async () => (await import(D + 'styles/dist/development/vera-styles.js')).styles,
};
const core = await import(D + 'core/dist/development/vera.js');
const { html } = await import(D + 'renderer/dist/development/vera-renderer-tag.js');
const modules = [];
/**
 * The order arrives by environment, not argv. Run with \`-e\` there is no script path in
 * \`process.argv\`, so \`slice(2)\` silently drops the first module -- which looked exactly like a
 * wiring-order defect: forward lost the renderer and produced only a stylesheet, reversed lost styles
 * and produced only content. Caught by the probe disagreeing, not by the test.
 */
for (const name of process.env.VERA_WIRE_ORDER.split(',')) modules.push(await LOAD[name]());
core.wire(modules);
class Thing extends HTMLElement {
  static styles = ':host{color:red}';
  connectedCallback() {
    const store = core.createStore({ n: 1 });
    core.init(this, { mode: 'open' });
    core.render(() => html\`<p class="v" data-n=\${store.n}>\${store.n}</p><unknown-tag></unknown-tag>\`);
    this._store = store;
  }
}
customElements.define('a-thing', Thing);
const element = dom.window.document.createElement('a-thing');
dom.window.document.getElementById('app').appendChild(element);
await new Promise((r) => setTimeout(r, 30));
element._store.n = 2;
await new Promise((r) => setTimeout(r, 30));
const root = element.shadowRoot ?? element;
console.log(JSON.stringify({ markup: (root.innerHTML || '').replace(/<!---->/g, ''), hasShadow: !!element.shadowRoot }));
`;

const runApp = (order) =>
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', APP], {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { ...process.env, VERA_WIRE_ORDER: order.join(',') },
  })
    .trim()
    .split('\n')
    .pop();

test('the real modules render the same DOM wired forward or reversed', () => {
  const order = ['renderer', 'router', 'autoloader', 'styles'];
  const forward = runApp(order);
  const reversed = runApp([...order].reverse());

  /** A child that printed nothing would make the two agree vacuously. */
  assert.match(forward, /"hasShadow":true/, 'the app actually ran');
  assert.equal(reversed, forward, 'wiring order changed what the app rendered');
});
