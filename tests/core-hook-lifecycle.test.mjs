/**
 * The hook lifecycle — registration, the first pass, cleanup, and the ways a hook silently never
 * runs.
 *
 * `render()` is the commit point of a component's setup: it drives `runHooks()` and then clears the
 * current instance. Everything here follows from that, including the one case that used to fail
 * quietly — a component that registers effects and never renders, whose hooks simply sit there.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const core = await load('core');
const { renderInto: renderer } = await load('renderer');
core.wire({ on: 'render', fn: renderer, priority: 50 });

const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const body = dom.window.document.body;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

let seq = 0;
const define = (setup) => {
  const tag = `x-life-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { setup(this); } });
  const element = dom.window.document.createElement(tag);
  body.appendChild(element);
  return element;
};

/* ── mount, update, removal ─────────────────────────────────────────────────────────────────── */
{
  let renders = 0, effects = 0, cleanups = 0;
  const el = define((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ n: 0 });
    element._state = state;
    core.useEffect(() => { effects++; return () => { cleanups++; }; });
    core.render(() => { renders++; return core.html`<p>${state.n}</p>`; });
  });
  await frame();
  check('mounting runs the render and the effect once', renders === 1 && effects === 1 && cleanups === 0);

  el._state.n = 1;
  await frame();
  check('a tracked write re-renders', renders === 2);
  check('but does not re-run an effect that read nothing', effects === 1);

  body.removeChild(el);
  await frame();
  check('removal runs the cleanup', cleanups === 1);

  const settled = renders;
  el._state.n = 2;
  await frame();
  check('a write after removal renders nothing', renders === settled);
}

/* ── re-attaching, which a list reorder does ────────────────────────────────────────────────── */
{
  let renders = 0;
  const el = define((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ n: 0 });
    element._state = state;
    core.render(() => { renders++; return core.html`<p>${state.n}</p>`; });
  });
  for (let i = 0; i < 3; i++) { await frame(); body.removeChild(el); await frame(); body.appendChild(el); }
  await frame();

  const settled = renders;
  el._state.n = 1;
  await frame();
  check('four attach cycles leave exactly one live render hook', renders === settled + 1,
    `fired ${renders - settled} times`);
  check('and one hook slot, not four', el._hooks.length === 1, `${el._hooks.length} slots`);
  body.removeChild(el);
}

/* ── one throwing hook must not stop the others ─────────────────────────────────────────────── */
{
  const reported = [];
  core.wire({ on: 'error', fn: (error) => reported.push(error?.message), priority: 25 });
  let before = 0, after = 0;
  const el = define((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ n: 0 });
    element._state = state;
    core.useEffect(() => { before++; void state.n; });
    core.useEffect(() => { void state.n; throw new Error('middle hook'); });
    core.useEffect(() => { after++; void state.n; });
    core.render(() => core.html`<p>${state.n}</p>`);
  });
  await frame();
  el._state.n = 1;
  await frame();
  check('a hook before the throwing one runs', before === 2);
  check('and so does one after it', after === 2, `after=${after}`);
  check('the error reaches the error insert', reported.includes('middle hook'));
  body.removeChild(el);
}

/* ── untrack ────────────────────────────────────────────────────────────────────────────────── */
{
  let runs = 0;
  const el = define((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ seen: 0, hidden: 0 });
    element._state = state;
    core.useEffect(() => { runs++; void state.seen; core.untrack(() => void state.hidden); });
    core.render(() => core.html`<p>${state.seen}</p>`);
  });
  await frame();

  let settled = runs;
  el._state.hidden = 1;
  await frame();
  check('an untracked read does not subscribe', runs === settled);

  settled = runs;
  el._state.seen = 1;
  await frame();
  check('a tracked read beside it still does', runs === settled + 1);
  body.removeChild(el);
}

/* ── mount(): committing a component that draws nothing ─────────────────────────────────────── */
{
  /**
   * **A separate function for this was built and rejected once, and the decision was reversed.**
   *
   * The original reasoning is worth keeping because half of it still holds. A standalone `commit()`
   * measured 25 B against a bare `render()`'s 6 B, and it added a second function to choose
   * between; committing automatically at the end of `connectedCallback` measured 31 B and, worse,
   * ran a headless component's effects a microtask later than a rendering component's — identical
   * code with two orderings depending on whether it drew anything. That last option stays rejected.
   *
   * What the size comparison could not measure is that **a bare `render()` is undiscoverable**. It
   * is legal, documented, and guessed by nobody, because "render" names the one thing the call is
   * not doing. Hooks that are never committed never run — no error, no render, an effect that
   * simply does not happen — so the cost of not finding it is silent and total.
   *
   * `mount()` is also no longer the 25 B the rejected `commit()` was: it shares `setupTarget` and
   * `commit` with `render`, which is the same split that makes `render` exactly `useRender` plus
   * `mount` rather than a parallel implementation.
   *
   * A bare `render()` still commits, and warns. Refusing would turn a naming preference into
   * effects that never run, which is the failure this exists to prevent.
   */
  let ran = 0;
  const el = define((element) => {
    core.init(element);
    const state = core.createStore({ n: 0 });
    element._state = state;
    element.innerHTML = '<span>pre-existing</span>';
    core.useEffect(() => { ran++; void state.n; });
    core.mount();
  });
  check('mount() runs the first pass synchronously', ran === 1);

  el._state.n = 1;
  await frame();
  check('and the effect stays subscribed afterwards', ran === 2, `ran ${ran}`);
  check('light DOM is untouched — nothing rendered', el.innerHTML === '<span>pre-existing</span>', el.innerHTML);
  body.removeChild(el);

  /** The old spelling, kept working on purpose: it commits, and says what to write instead. */
  let bare = 0;
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const legacy = define((element) => {
    core.init(element);
    core.useEffect(() => { bare++; });
    core.render();
  });
  console.warn = realWarn;
  check('a bare render() still commits', bare === 1);
  if (isProduction) {
    check('production says nothing about it', said.length === 0);
  } else {
    /**
     * **Asserted for substance, not for wording.** This used to match the literal string
     * "render() needs a template", which is what let that message drift into saying something false:
     * it claimed a bare `render()` no longer commits, two lines below a check proving it does. The
     * message now has to name `mount()` and must not contradict the line above it.
     */
    check('and warns, naming mount()', said.some((l) => l.includes('mount()')), said.join(' | '));
    check(
      'and the warning does not claim the hooks failed to run',
      said.every((l) => !/needs a template|used to do|will not run|never run/.test(l)),
      said.join(' | ')
    );
  }
  body.removeChild(legacy);

  check('a bare render() outside a component does nothing', (core.render(), true));
  check('mount() outside a component does nothing', (core.mount(), true));
}

/* ── the silent case: the setup is never committed ──────────────────────────────────────────── */
{
  let ran = 0;
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const el = define((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ n: 0 });
    element._state = state;
    core.useEffect(() => { ran++; void state.n; });
    /** Neither render() nor mount() is called, which is the mistake. */
  });
  await frame();
  console.warn = realWarn;

  check('an uncommitted hook never runs', ran === 0);
  if (isProduction) {
    check('production says nothing about it', said.length === 0);
  } else {
    const warned = said.filter((line) => line.includes('setup was never committed'));
    check('development warns it will never run', warned.length === 1, said.join(' | '));
    check('and names render() for a component with markup', warned[0]?.includes('render(()'));
    check('and mount() for one without', warned[0]?.includes('mount();'));
    check('and names the component', warned[0]?.includes(el.localName));
  }
  body.removeChild(el);
}

/* ── createHook runs at the priority it was given ──────────────────────────────────────────────
 * `createHook` is how a third party builds its own hook type — #6 makes that the product — and the
 * only thing it can rely on is the ordering: `useLayoutEffect` is 25, the render is 50, `useEffect`
 * is 75, and a hook registered below or between them runs there.
 */
{
  const order = [];
  class Ordered extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.createHook({ callback: () => order.push('early'), priority: 10 });
      core.createHook({ callback: () => order.push('late'), priority: 90 });
      core.useEffect(() => order.push('effect'));
      core.render(() => '');
    }
  }
  customElements.define('hook-order-probe', Ordered);
  document.body.appendChild(document.createElement('hook-order-probe'));
  await frame();
  await frame();

  check('a hook below the render runs first', order.indexOf('early') < order.indexOf('effect'), order.join(','));
  check('and one above useEffect runs after it', order.indexOf('late') > order.indexOf('effect'), order.join(','));
}

/* ── a component that comes back does not bring its old hooks with it ────────────────────────── */
/**
 * `connectedCallback` runs again every time an element is re-added — a router navigating back, a
 * list reordering, a conditional subtree returning — so `init()` and `render()` build a fresh set
 * of hooks. The old set was dropped from `_hooks` and left registered in the store, which holds it
 * **weakly**: eventually correct, but only once a garbage collection happens. Until then the
 * element had two live subscriptions and ran everything twice, and a second reconnect made it
 * three times.
 *
 * Renders are idempotent, so those merely cost. `useEffect` is not: duplicates mean duplicate
 * fetches, duplicate subscriptions and duplicate analytics, and the effect had already fired by
 * the time a collector could have prevented it. Measured, before the fix: +1, +2, +3 effects per
 * write across zero, one and two reconnects.
 *
 * Deliberately asserted without forcing a collection — `--expose-gc` made the old behaviour look
 * correct, which is exactly why it survived.
 */
{
  const state = core.createStore({ n: 0 });
  let renders = 0;
  let effects = 0;

  const tag = `x-life-${seq++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.useEffect(() => {
          core.deps(state.n);
          effects++;
        });
        core.render(() => {
          renders++;
          return core.html`<b>${state.n}</b>`;
        });
      }
    }
  );

  const element = dom.window.document.createElement(tag);
  body.append(element);
  await frame();
  await frame();

  for (let reconnects = 0; reconnects <= 3; reconnects++) {
    if (reconnects > 0) {
      element.remove();
      body.append(element);
      await frame();
      await frame();
    }

    const beforeRenders = renders;
    const beforeEffects = effects;
    state.n = reconnects + 1;
    await frame();
    await frame();

    check(
      `one render per write after ${reconnects} reconnect(s)`,
      renders - beforeRenders === 1,
      `${renders - beforeRenders}`
    );
    check(
      `one effect per write after ${reconnects} reconnect(s)`,
      effects - beforeEffects === 1,
      `${effects - beforeEffects}`
    );
  }

  /** The live hook still works, which is the half a "make it inert" fix can get wrong. */
  check('the component is still following its binding', element.shadowRoot.textContent.includes('4'),
    element.shadowRoot.textContent);
  element.remove();
}

/* ── teardown ordering, which nothing asserted ─────────────────────────────────────────────────
 * Running order is pinned above; the reverse trip was not. Three contracts live here and each is
 * something a component author can rely on: an author's own `disconnectedCallback` runs **first**
 * (the README says so — "if the component has one of its own, it still runs first"), cleanups then
 * run in the same priority order the hooks did, and nothing the component owns does any work after
 * removal.
 */
{
  const order = [];
  class Torn extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.useLayoutEffect(() => () => order.push('layout cleanup'));
      core.useEffect(() => () => order.push('effect cleanup'));
      core.render(() => core.html`<p>${state.n}</p>`);
    }
    disconnectedCallback() { order.push('author disconnectedCallback'); }
  }
  customElements.define('teardown-order-probe', Torn);
  const element = document.createElement('teardown-order-probe');
  document.body.appendChild(element);
  await frame();

  order.length = 0;
  element.remove();
  await frame();
  check("the author's disconnectedCallback runs before any cleanup",
    order[0] === 'author disconnectedCallback', order.join(','));
  check('and cleanups run in the priority order the hooks did',
    order.indexOf('layout cleanup') < order.indexOf('effect cleanup'), order.join(','));

  order.length = 0;
  element._state.n = 99;
  await frame();
  check('a write after removal does no work at all', order.length === 0, order.join(','));
}

/* ── cleanups stay paired across repeated attach/detach, which a list reorder does repeatedly ── */
{
  let runs = 0, cleanups = 0;
  class Cycled extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.useEffect(() => { runs++; void state.n; return () => { cleanups++; }; });
      core.render(() => core.html`<p>${state.n}</p>`);
    }
  }
  customElements.define('teardown-cycle-probe', Cycled);
  const element = document.createElement('teardown-cycle-probe');
  document.body.appendChild(element);
  await frame();
  for (let i = 0; i < 5; i++) {
    element.remove();
    await frame();
    document.body.appendChild(element);
    await frame();
  }
  check('five detach/attach cycles leave exactly one live effect',
    runs - cleanups === 1, `${runs} runs, ${cleanups} cleanups`);

  element._state.n = 1;
  await frame();
  check('and the component is still reactive afterwards',
    element.shadowRoot.textContent === '1', element.shadowRoot.textContent);
}

/* ── a cleanup that throws must not take its siblings with it ───────────────────────────────────
 * Same isolation the hook loop has for a callback that throws: cleanups run in one pass, so an
 * escaping error would skip every cleanup after the failing one and leak whatever they released.
 */
{
  const done = [];
  const said = [];
  const realError = console.error;
  console.error = (...args) => said.push(args.join(' '));
  /**
   * Reported through the `'error'` insert when one is registered, and `console.error` only when none
   * is — `reportHookError` chooses, and this suite registers an insert earlier, so asserting the
   * console alone reported nothing and looked like silence.
   */
  core.wire({ on: 'error', fn: (error) => said.push(String(error?.message ?? error)), priority: 90 });
  class Throwing extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      core.useEffect(() => () => { done.push('first'); throw new Error('cleanup exploded'); });
      core.useEffect(() => () => done.push('second'));
      core.render(() => core.html`<p>x</p>`);
    }
  }
  customElements.define('teardown-throw-probe', Throwing);
  const element = document.createElement('teardown-throw-probe');
  document.body.appendChild(element);
  await frame();
  element.remove();
  await frame();
  console.error = realError;
  check('a cleanup that throws does not skip the next one', done.includes('second'), done.join(','));
  check('and the failure is reported rather than swallowed',
    said.some((line) => /cleanup exploded/.test(line)), said.join(' | ') || '(nothing reported)');
}


/* ── a second init() in one setup discards the hooks between them ──────────────────────────────
 * Dropping hooks is correct and load-bearing on a *reconnect*: `connectedCallback` runs again every
 * time an element is re-added, and a fresh generation is what stops effects doubling. Called twice
 * in one setup it is a mistake instead, and the hooks registered between the two calls simply never
 * ran — no error, no warning, an effect that looks registered and is not.
 *
 * Found by a sweep calling the lifecycle in wrong orders. The two cases are told apart by whether a
 * setup is already open, so the reconnect path must stay silent — which is asserted here too,
 * because a diagnostic that fires on every router navigation would be worse than none.
 */
{
  const seen = [];
  const before = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  let effects = 0;
  let effectsWithoutSecondInit = 0;
  try {
    const lossy = define((element) => {
      core.init(element, { mode: 'open' });
      core.useEffect(() => { effects++; });
      core.init(element, { mode: 'open' });
      core.render(() => core.html`<p>x</p>`);
    });
    const control = define((element) => {
      core.init(element, { mode: 'open' });
      core.useEffect(() => { effectsWithoutSecondInit++; });
      core.render(() => core.html`<p>x</p>`);
    });
    await frame();
    void lossy;
    void control;
  } finally {
    console.warn = before;
  }
  check('the control effect ran', effectsWithoutSecondInit === 1, String(effectsWithoutSecondInit));
  check('a hook registered before a second init() does not run', effects === 0, String(effects));
  if (!isProduction) {
    const warned = seen.filter((line) => /called init\(\) twice in one setup/.test(line));
    check('and it says so', warned.length === 1, seen.join(' | ') || '(silent)');
    check('naming how many hooks were discarded', /1 hook\(s\)/.test(warned[0] ?? ''), warned[0] ?? '');
  }
}

/* ── and the reconnect path stays silent ───────────────────────────────────────────────────────
 * The whole value of the warning above depends on this: a component re-added by a router calls
 * `init()` again with hooks from the previous generation still on the element, and must not warn.
 */
{
  const seen = [];
  const before = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  let runs = 0;
  try {
    const tag = `x-reconnect-${Math.random().toString(36).slice(2, 8)}`;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.useEffect(() => { runs++; });
        core.render(() => core.html`<p>x</p>`);
      }
    });
    const element = dom.window.document.createElement(tag);
    for (let cycle = 0; cycle < 3; cycle++) {
      body.appendChild(element);
      await frame();
      body.removeChild(element);
      await frame();
    }
  } finally {
    console.warn = before;
  }
  check('three reconnects run the effect three times', runs === 3, String(runs));
  check('and none of them warn', seen.filter((l) => /init\(\) twice/.test(l)).length === 0, seen.join(' | '));
}


/* ── an element that removes itself inside its own effect ──────────────────────────────────────
 * `disconnectedCallback` runs every cleanup and clears the set. A cleanup is registered when the
 * effect *returns*, so an effect that calls `this.remove()` — a toast dismissing itself, a component
 * that redirects — finished *after* that sweep and added its cleanup to a set nothing would ever
 * drain again. The interval or listener it was meant to release ran forever, silently: the exact
 * failure `_cleanups` exists to prevent, reached by the one order that skips it.
 *
 * Found by a sweep of timing hazards. The control matters as much as the case: an element removed on
 * a later tick must still run its cleanup exactly once, and one never removed must not run it at all.
 */
{
  const runFor = async (when) => {
    let cleanups = 0;
    const tag = `x-selfrm-${when}-${Math.random().toString(36).slice(2, 8)}`;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.useEffect(() => {
          if (when === 'in-effect') this.remove();
          return () => { cleanups++; };
        });
        core.render(() => core.html`<p>x</p>`);
      }
    });
    const element = dom.window.document.createElement(tag);
    body.appendChild(element);
    await frame();
    await frame();
    if (when === 'later') { element.remove(); await frame(); }
    return cleanups;
  };

  check('CONTROL: removed on a later tick runs its cleanup', (await runFor('later')) === 1);
  check('an element removed inside its own effect runs it too', (await runFor('in-effect')) === 1);
  check('and one never removed does not', (await runFor('never')) === 0);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
