/**
 * **A component's hooks run in ONE order — priority, then creation — however they were registered** (work queue 5,
 * 2026-10-11). The hooks live in one flat list, kept sorted as each joins: a hook joins at the end unless a LOWER
 * priority arrives after a higher one, which moves back past the hooks that run after it. The scheduler orders every
 * flush by the same order on its own, so the list's order is what the FIRST pass follows.
 *
 * **Run order is two fields — priority, then creation — never one packed number** (Brian, 2026-10-11). The packed key
 * `priority × 1e9 + creation` misordered close fractional priorities, collided past priority ≈ 9e6 (2^53), and — its
 * creation count being global — read a priority-50 hook as 51 once a page had created 1e9 hooks. One row each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key] ?? globalThis[key];
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

test('a lower priority registered AFTER a higher one still runs first on the first pass', async () => {
  const order = [];
  const tag = `ho-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, () => {
        core.useEffect(() => { order.push('effect 75'); });
        core.useHook(() => { order.push('hook 25'); }, 25);
        core.useLayoutEffect(() => { order.push('layout 60'); });
        return () => { order.push('render 50'); return core.html`<p>x</p>`; };
      });
    }
  });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  assert.deepEqual(order, ['hook 25', 'render 50', 'layout 60', 'effect 75']);
  el.remove();
});

/** A component with no render of its own: an owner for hooks registered after setup, run by the caller. */
const host = () => {
  const tag = `ho-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { core.init(this, () => {}); } });
  const el = doc.createElement(tag);
  doc.body.append(el);
  return el;
};
/** Hooks on a plain owner, created only to move the creation count — what a busy page does between two hooks. */
const churn = (n) => {
  const owner = {};
  for (let i = 0; i < n; i++) core.createHook({ element: owner, priority: 1, callback: () => {} });
};

test('close FRACTIONAL priorities run in priority order, however many hooks were created between them', async () => {
  const el = host();
  const state = core.createStore({ n: 0 });
  const order = [];
  const a = core.useHook(() => { state.n; order.push('50.000002'); }, 50.000002, el);
  churn(1500);
  const b = core.useHook(() => { state.n; order.push('50.000001'); }, 50.000001, el);
  a(undefined, true);
  b(undefined, true);
  order.length = 0;
  state.n++;
  await tick();
  assert.deepEqual(order, ['50.000001', '50.000002'], 'the lower priority first — not the one created first');
  el.remove();
});

test('a priority past 2^53 / 1e9 still orders by creation within itself', async () => {
  const el = host();
  const state = core.createStore({ n: 0 });
  const order = [];
  const P = 1e12;
  const first = core.useHook(() => { state.n; order.push('first'); }, P, el);
  const second = core.useHook(() => { state.n; order.push('second'); }, P, el);
  /** Subscribed second-first, so a write queues `second` before `first` — the queue must reorder by creation. */
  second(undefined, true);
  first(undefined, true);
  order.length = 0;
  state.n++;
  await tick();
  assert.deepEqual(order, ['first', 'second']);
  el.remove();
});

test('a render hook is priority 50 by its priority, never by its creation count (development: the fields are mangled in production)', { skip: isProduction && 'reads the hook record, whose fields production mangles' }, async () => {
  let renders = 0;
  const tag = `ho-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() { core.init(this, () => () => { renders++; return core.html`<p>x</p>`; }); }
  });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  const render = el._$h$.find((hook) => hook._y === 50);
  assert.ok(render && renders === 1, 'CONTROL: the render hook ran its first pass');
  /** What a page that has created two billion hooks gives the next one. */
  render._k = 2e9;
  el._$adopt$('late', 1);
  assert.equal(renders, 2, 'a prop arriving late re-runs the render: it is still in the render band');
  el.remove();
});

test('a priority that is not a finite number THROWS from useHook and createHook, and registers nothing', () => {
  const el = host();
  const before = el._$h$?.length ?? 0;
  for (const priority of [NaN, Infinity, -Infinity]) {
    assert.throws(() => core.useHook(() => {}, priority, el), /priority-not-finite/, `useHook(${priority})`);
    assert.throws(() => core.createHook({ element: el, priority, callback: () => {} }), /priority-not-finite/, `createHook(${priority})`);
  }
  assert.equal(el._$h$?.length ?? 0, before, 'no hook was added');
  el.remove();
});

/**
 * **Removal runs cleanups in priority order — after a re-run too** (work queue 5, step 3). Each hook keeps its latest
 * cleanup ON itself, as React keeps an effect's `destroy`; they used to sit in one Set on the element, where a re-run
 * moved its cleanup to the END — so after the layout effect re-ran, the effect's cleanup ran first (measured
 * 2026-10-11, both builds). Then the cleanups other packages register in `_$c$` (`useDismiss`, ui's select), in
 * registration order — a third party's cleanup still sees what core's cleanups did.
 */
test('removal runs every cleanup in priority order, even after a re-run, then the other packages’ cleanups', async () => {
  const order = [];
  const state = core.createStore({ width: 0 });
  const seen = { closed: false };
  let layoutRuns = 0;
  const tag = `ho-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, (host) => {
        /** A third party's removal cleanup, registered the way `useDismiss` does — it reads what core's cleanup wrote. */
        (host._$c$ ??= new Set()).add(() => order.push(`third party (saw closed: ${seen.closed})`));
        core.useLayoutEffect(() => { state.width; layoutRuns++; return () => order.push('layout cleanup'); });
        core.useEffect(() => () => { seen.closed = true; order.push('effect cleanup'); });
        return () => core.html`<p>x</p>`;
      });
    }
  });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  state.width = 1;
  await tick();
  assert.equal(layoutRuns, 2, 'CONTROL: the layout effect re-ran');
  assert.deepEqual(order, ['layout cleanup'], 'CONTROL: its re-run ran its previous cleanup');
  order.length = 0;
  el.remove();
  await tick();
  assert.deepEqual(order, ['layout cleanup', 'effect cleanup', 'third party (saw closed: true)']);
});
