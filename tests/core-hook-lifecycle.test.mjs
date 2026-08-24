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
const { render: domRender } = await load('renderer');
core.setRenderer(domRender);

const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const body = dom.window.document.body;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

let seq = 0;
const mount = (setup) => {
  const tag = `x-life-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { setup(this); } });
  const element = dom.window.document.createElement(tag);
  body.appendChild(element);
  return element;
};

/* ── mount, update, removal ─────────────────────────────────────────────────────────────────── */
{
  let renders = 0, effects = 0, cleanups = 0;
  const el = mount((element) => {
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
  const el = mount((element) => {
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
  core.insert('error', (error) => reported.push(error?.message), 25);
  let before = 0, after = 0;
  const el = mount((element) => {
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
  const el = mount((element) => {
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

/* ── render() with nothing to draw ──────────────────────────────────────────────────────────── */
{
  /**
   * `render()` has always ended a component's setup as well as declaring its markup. A component
   * whose whole job is a side effect has nothing to draw, so calling it bare says exactly that —
   * rather than `render(() => html``)`, which is ceremony pretending to draw.
   *
   * Two alternatives were built and rejected. A separate `commit()` measured 25 B against 6 B and
   * added a second function to choose between. Committing automatically after `connectedCallback`
   * measured 31 B and, worse, ran a headless component's effects a microtask later than a rendering
   * component's — identical code with two orderings depending on whether it drew anything.
   */
  let ran = 0;
  const el = mount((element) => {
    core.init(element);
    const state = core.createStore({ n: 0 });
    element._state = state;
    element.innerHTML = '<span>pre-existing</span>';
    core.useEffect(() => { ran++; void state.n; });
    core.render();
  });
  check('a bare render() runs the first pass synchronously', ran === 1);

  el._state.n = 1;
  await frame();
  check('and the effect stays subscribed afterwards', ran === 2, `ran ${ran}`);
  check('existing light DOM is untouched', el.innerHTML === '<span>pre-existing</span>', el.innerHTML);
  body.removeChild(el);

  check('a bare render() outside a component does nothing', (core.render(), true));
}

/* ── the silent case: render() never called at all ──────────────────────────────────────────── */
{
  let ran = 0;
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const el = mount((element) => {
    core.init(element, { mode: 'open' });
    const state = core.createStore({ n: 0 });
    element._state = state;
    core.useEffect(() => { ran++; void state.n; });
    /** render() is never called, which is the mistake. */
  });
  await frame();
  console.warn = realWarn;

  check('an uncommitted hook never runs', ran === 0);
  if (isProduction) {
    check('production says nothing about it', said.length === 0);
  } else {
    const warned = said.filter((line) => line.includes('never called render()'));
    check('development warns it will never run', warned.length === 1, said.join(' | '));
    check('and says a bare render() is the fix', warned[0]?.includes('call it bare'));
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

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
