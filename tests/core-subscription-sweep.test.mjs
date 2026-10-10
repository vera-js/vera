/**
 * **A removed component leaves nothing behind in a store** (R1 — exact unsubscription, regression #11; Brian
 * 2026-10-10). A component's hooks subscribe to every store key they read, and the store holds them weakly; before, a
 * removed component's entries stayed until that key was next WRITTEN, so a key never written (config, a locale) grew by
 * one dead entry per component that ever read it (measured: 50 542 at 50k, ~90 B each). The first fix swept those Sets
 * on growth — and cost Firefox 3–13% on component creation, the sweep's work itself. Now each hook records the Sets it
 * actually joined and LEAVES them when it retires (a real removal, or a re-init), so nothing dead accumulates and nothing
 * is ever swept. A move keeps the component, so it keeps its subscriptions.
 *
 * Rows. CORRECTNESS, in this process: live readers all redraw; a moved component still does; a re-added one does.
 * RETENTION, in a child process run with `--expose-gc` — the one exception to "tests do not force collection" (Brian,
 * 2026-10-10; CLAUDE.md names it): there gc is the measuring instrument, alone in its own process, with both controls
 * (a dropped object that must die, live readers that must stay). Counted with `v8.queryObjects` over WeakRef objects —
 * the thing a dead subscription IS (counting surviving components would read clean while a store grows).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const { init, html, wire, createStore } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('every live reader redraws on one write — 300 of them, through a move and a removal-and-return', async () => {
  const config = createStore({ label: 'a' });
  customElements.define('sw-row', class extends HTMLElement {
    connectedCallback() { init(this, () => () => html`<i>${config.label}</i>`); }
  });
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  doc.body.append(a, b);
  for (let i = 0; i < 300; i++) a.append(doc.createElement('sw-row'));
  await tick();
  assert.ok([...a.children].every((el) => el.textContent === 'a'), 'CONTROL: every reader rendered');
  /** A move keeps a component, so it keeps its subscriptions. */
  const moved = a.firstElementChild;
  b.append(moved);
  /** A real removal retires them; coming back subscribes afresh. */
  const returned = a.lastElementChild;
  returned.remove();
  await tick();
  a.append(returned);
  await tick();
  config.label = 'b';
  await tick();
  assert.equal([...a.children, ...b.children].filter((el) => el.textContent === 'b').length, 300, 'every one redrew');
  assert.equal(moved.textContent, 'b', 'the moved one');
  assert.equal(returned.textContent, 'b', 'the returned one');
  a.remove();
  b.remove();
});

/**
 * The child: `churn` components (or computeds) made and removed in batches of 100, gc between batches, 100 live readers
 * of the same key kept throughout; then WeakRef objects counted. `mode`:
 * - `never`   — components reading a key never written;
 * - `noread`  — the same churn reading nothing (the baseline);
 * - `inner`   — components whose SETUP creates a computed reading the key (retired with the component);
 * - `free`    — free-standing computeds created and dropped (no component: the documented residual), then the key
 *               written — the bound: a write prunes them, exactly as before.
 */
const child = (mode) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  import v8 from 'node:v8';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore } = await load('core');
  const { renderer } = await load('renderer');
  const { computed } = await load('store/computed');
  wire([renderer]);
  const config = createStore({ label: 'x' });
  const mode = ${JSON.stringify(mode)};
  customElements.define('g-row', class extends HTMLElement { connectedCallback() {
    init(this, () => {
      if (mode === 'inner') { const c = computed(() => config.label + '!'); return () => html\`<i>\${c.value}</i>\`; }
      return () => (mode === 'never' ? html\`<i>\${config.label}</i>\` : html\`<i>x</i>\`);
    });
  } });
  /** rerun / reinit: ONE living component, re-rendered 10× (another key drives it) or set up again in place. */
  const tick = createStore({ n: 0 });
  customElements.define('g-one', class extends HTMLElement { connectedCallback() { this.setUp(); } setUp() {
    init(this, () => () => html\`<i>\${config.label}\${tick.n}</i>\`);
  } });
  customElements.define('g-keep', class extends HTMLElement { connectedCallback() { init(this, () => () => html\`<b>\${config.label}</b>\`); } });
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const count = () => v8.queryObjects(WeakRef, { format: 'count' });
  const churn = document.createElement('div'), keep = document.createElement('div');
  document.body.append(churn, keep);
  for (let i = 0; i < 100; i++) keep.append(document.createElement('g-keep'));
  await settle();
  const dropped = new WeakRef({ plain: true });
  if (mode === 'rerun' || mode === 'reinit') {
    await gc();
    const before = count();
    const one = document.createElement('g-one');
    churn.append(one);
    await settle();
    if (mode === 'rerun') for (let i = 0; i < 10; i++) { tick.n++; await settle(); }
    else for (let i = 0; i < 10; i++) { one.setUp(); await settle(); }
    await gc();
    const living = count() - before;
    const text = one.textContent;
    one.remove();
    await settle();
    await gc();
    process.stdout.write(JSON.stringify({ living, retired: count() - before, text, droppedDied: dropped.deref() === undefined, keptLive: [...keep.children].every((el) => el.textContent === config.label) }));
    process.exit(0);
  }
  for (let i = 0; i < 5000; i += 100) {
    if (mode === 'free') { for (let j = 0; j < 100; j++) computed(() => config.label); }
    else {
      for (let j = 0; j < 100; j++) churn.append(document.createElement('g-row'));
      await settle();
      churn.replaceChildren();
    }
    await settle();
    await gc();
  }
  const weakRefs = count();
  let afterWrite = null;
  if (mode === 'free') { config.label = 'y'; await settle(); await gc(); afterWrite = count(); }
  process.stdout.write(JSON.stringify({
    weakRefs, afterWrite,
    droppedDied: dropped.deref() === undefined,
    keptLive: [...keep.children].every((el) => el.textContent === config.label),
  }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

const baseline = child('noread');
test('CONTROLS: gc ran (a dropped object died), and the 100 live readers are still subscribed', () => {
  assert.ok(baseline.droppedDied && baseline.keptLive, JSON.stringify(baseline));
});

test('5000 components read a key never written and are removed: NOTHING of theirs is left in the store', () => {
  const never = child('never');
  assert.ok(never.droppedDied && never.keptLive, 'CONTROLS');
  /** Before: ~5000 (one per component ever made); with the sweep: up to 2 × the peak live count; now: none. */
  assert.ok(never.weakRefs - baseline.weakRefs <= 2, `${never.weakRefs - baseline.weakRefs} over the no-read baseline's ${baseline.weakRefs}`);
});

test("a computed created in a component's setup leaves with the component", () => {
  const inner = child('inner');
  assert.ok(inner.droppedDied && inner.keptLive, 'CONTROLS');
  assert.ok(inner.weakRefs - baseline.weakRefs <= 2, `${inner.weakRefs - baseline.weakRefs} over the baseline`);
});

test('free-standing computeds have no removal — the documented residual — and a write to the key prunes them, as before', () => {
  const free = child('free');
  assert.ok(free.droppedDied && free.keptLive, 'CONTROLS');
  assert.ok(free.weakRefs - baseline.weakRefs >= 4000, `CONTROL: the residual is there before the write (${free.weakRefs - baseline.weakRefs})`);
  assert.ok(free.afterWrite - baseline.weakRefs <= 2, `pruned by the write: ${free.afterWrite - baseline.weakRefs} left`);
});

/**
 * ONE `WeakRef` per hook for its whole life — `retire` deletes exactly the ref it recorded, so a hook that made a new
 * one per run would leave the rest behind. A living component re-rendered 10× while reading the key holds as many refs
 * as it has hooks (one per hook, whatever the runs), and none once it is removed.
 */
test('a component re-rendered 10× holds one subscription per hook, and none once removed', () => {
  const rerun = child('rerun');
  assert.ok(rerun.droppedDied && rerun.keptLive, 'CONTROLS');
  assert.ok(rerun.text.endsWith('10'), `CONTROL: it re-rendered 10 times (${rerun.text})`);
  assert.ok(rerun.living >= 1 && rerun.living <= 3, `its hooks' refs while living, independent of runs: ${rerun.living}`);
  assert.ok(rerun.retired <= 0, `none once removed: ${rerun.retired}`);
});

/**
 * The second retirement point: a component set up AGAIN in place (a new generation on a live element) leaves the old
 * generation's subscriptions — ten set-ups hold one generation's worth, not ten.
 */
test('a component set up again in place keeps only its newest generation subscribed', () => {
  const reinit = child('reinit');
  assert.ok(reinit.droppedDied && reinit.keptLive, 'CONTROLS');
  assert.ok(reinit.living >= 1 && reinit.living <= 3, `one generation's refs after 10 set-ups: ${reinit.living}`);
  assert.ok(reinit.retired <= 0, `none once removed: ${reinit.retired}`);
});
