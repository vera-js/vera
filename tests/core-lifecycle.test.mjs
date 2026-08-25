/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="app"></div>', { pretendToBeVisual: true });
const { window } = dom;
globalThis.HTMLElement = window.HTMLElement;
globalThis.document = window.document;
globalThis.customElements = window.customElements;
let rafQ = [];
globalThis.requestAnimationFrame = (fn) => rafQ.push(fn);
const flushRaf = () => { const q = rafQ; rafQ = []; q.forEach((f) => f()); };
const tick = () => new Promise((r) => setTimeout(r, 10));

const core = await load('core');
/**
 * Style adoption moved to its own package in 0.2.0. `insert` comes from core so the registration
 * lands in the map core reads — taking it from `@verajs/inserts` would write to a different copy
 * in the production build and silently do nothing.
 */
const { adoptStyles } = await load('styles');
core.wire({ on: 'init', fn: adoptStyles, priority: 50 });
const app = window.document.getElementById('app');
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

// ---- teardown ----
let cleanups = 0, userDisconnects = 0, effectRuns = 0;
class TickerEl extends window.HTMLElement {
  connectedCallback() {
    core.init(this);
    this.state = core.createStore({ n: 0 });
    core.useEffect(() => { effectRuns++; this.state.n; return () => cleanups++; });
    core.render(() => String(this.state.n));
  }
  disconnectedCallback() { userDisconnects++; }
}
window.customElements.define('ticker-el', TickerEl);
const el = window.document.createElement('ticker-el');
app.appendChild(el); await tick(); flushRaf(); await tick();
check('mount runs effect once', effectRuns === 1 && cleanups === 0);

el.remove(); await tick();
check('removal runs cleanup', cleanups === 1);
check('author disconnectedCallback chained', userDisconnects === 1);

app.appendChild(el); await tick(); flushRaf(); await tick();
check('reconnect re-arms (no stacked wrappers)', effectRuns === 2 && userDisconnects === 1);
el.state.n = 1; await tick(); flushRaf(); await tick();
check('cleanup-before-rerun still swaps registry', cleanups === 2 && effectRuns === 3);
el.remove(); await tick();
check('second removal runs latest cleanup once', cleanups === 3 && userDisconnects === 2);

// ---- sync effect cleanup on removal ----
let syncCleanups = 0;
class SyncEl extends window.HTMLElement {
  connectedCallback() {
    core.init(this);
    this.state = core.createStore({ n: 0 });
    core.useSyncEffect(() => { this.state.n; return () => syncCleanups++; });
    core.render(() => '');
  }
}
window.customElements.define('sync-el', SyncEl);
const se = window.document.createElement('sync-el');
app.appendChild(se); await tick();
se.remove(); await tick();
check('useSyncEffect cleanup runs on removal', syncCleanups >= 1);

// ---- a hook registered outside init()→render() is ignored ----
// The warning is __DEV__-only, like every other diagnostic in core: production carries neither the
// check nor the message. The hook is dropped either way, which is the part that matters.
let warns = 0; const ow = console.warn; console.warn = () => warns++;
core.useEffect(() => {});
console.warn = ow;
check(
  isProduction ? 'late/orphan hook is silent in production' : 'late/orphan hook warns',
  warns === (isProduction ? 0 : 1)
);

// ---- _delete real + clean ----
const raw = { x: 1 };
const store = core.createStore(raw);
check('_delete not enumerable on raw', !Object.keys(raw).includes('_delete'));
let fired = 0;
core.createHook({ element: app, priority: 60, callback: () => { fired++; store.x; } });
[...app._hooks[0]][0](undefined, true);
const f0 = fired;
store._delete();
store.x = 99;
check('_delete severs subscriptions', fired === f0);

// ---- error messages ----
let msg = '';
try { core.init(null); } catch (e) { msg = e.message; }
check('init error has a message', msg.includes('element'));
try { core.createStore(null); } catch (e) { msg = e.message; }
check('createStore error has a message', msg.includes('object'));

// ---- styles: shadow string path dedupe + light-DOM hoist ----
class StyledEl extends window.HTMLElement {
  static styles = 'p { color: red }';
  connectedCallback() { core.init(this, { mode: 'open' }); }
}
window.customElements.define('styled-el', StyledEl);
const s = window.document.createElement('styled-el');
app.appendChild(s); s.remove(); app.appendChild(s); await tick();
check('shadow string styles dedupe on re-init', s.shadowRoot.querySelectorAll('style').length === 1);

class LightEl extends window.HTMLElement {
  static styles = 'em { color: blue }';
  connectedCallback() { core.init(this); }
}
window.customElements.define('light-el', LightEl);
const l1 = window.document.createElement('light-el');
const l2 = window.document.createElement('light-el');
app.appendChild(l1); app.appendChild(l2); await tick();
const headStyles = [...window.document.head.querySelectorAll('style')].filter((st) => st.textContent.includes('em'));
check('light-DOM styles hoisted once per class', headStyles.length === 1);
check('no styles injected inside light element', l1.querySelectorAll('style').length === 0);


// ---- one scheduler, not two ----
// `useEffect` used to hardcode its own `requestAnimationFrame`, a byte-for-byte copy of
// `animationFrame` in setRenderScheduler. Swapping the scheduler therefore moved renders and left
// effects on frames: an author who chose microtask scheduling precisely to escape the frame
// boundary still waited one for every effect. Same final order, up to 16 ms later.
{
  const order = [];
  core.setRenderScheduler(core.microtask);
  class SchedEl extends window.HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.useLayoutEffect(() => { order.push('layout'); void state.n; });
      core.useEffect(() => { order.push('effect'); void state.n; });
      core.render(() => { order.push('render'); return core.html`<p>${state.n}</p>`; });
    }
  }
  window.customElements.define('sched-el', SchedEl);
  const el = window.document.createElement('sched-el');
  app.appendChild(el);
  await tick();

  order.length = 0;
  el._state.n = 1;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  check('a swapped scheduler moves effects too, not just renders', order.join(',') === 'layout,render,effect',
    `settled as "${order.join(',')}" without waiting for a frame`);
  el.remove();
  /** Back to the default, so nothing after this file inherits a swapped scheduler. */
  core.setRenderScheduler((run) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : run()
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);