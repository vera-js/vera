/**
 * The render scheduler, under every scheduler the docs offer — and one that misbehaves.
 *
 * `setRenderScheduler` is a documented public API with three published shapes: the default animation
 * frame, the exported `microtask`, and a synchronous `(run) => run()` that `llms.txt` builds its
 * `flushSync` recipe out of for View Transitions. Every render and every effect in the framework goes
 * through whichever one is installed, which makes it the single widest blast radius in core and,
 * until pass 92, a thing no audit had pointed at.
 *
 * The failure it hides is the one this repo keeps finding: **silent and total**. The coalescing flag
 * is raised before the pass is handed to the scheduler and lowered inside it, so a scheduler that
 * never runs the pass leaves the flag raised — and the component stops rendering *forever*, with no
 * error and no warning, surviving even a restore of the default scheduler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto } = await load('renderer');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

let seq = 0;
/** A counter component, freshly tagged each time so no two tests share an upgrade. */
const counter = (extra) => {
  const tag = `x-sched-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      extra?.(state);
      core.render(() => core.html`<p>${state.n}</p>`);
    }
  });
  const element = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(element);
  return element;
};

/** The recipe `llms.txt` publishes, copied rather than paraphrased. */
const flushSync = (fn) => {
  const previous = core.setRenderScheduler((run) => run());
  try { fn(); } finally { core.setRenderScheduler(previous); }
};

test('the flushSync recipe in llms.txt renders synchronously', async () => {
  const element = counter();
  await frame();
  assert.equal(element.shadowRoot.textContent, '0');
  flushSync(() => { element._state.n = 42; });
  assert.equal(element.shadowRoot.textContent, '42',
    'the View Transitions recipe depends on the DOM being updated before flushSync returns');
});

test('and leaves the previous scheduler in place afterwards', async () => {
  const element = counter();
  await frame();
  flushSync(() => { element._state.n = 1; });
  element._state.n = 2;
  assert.equal(element.shadowRoot.textContent, '1', 'the write after the swap must not still be synchronous');
  await frame();
  assert.equal(element.shadowRoot.textContent, '2', 'and the restored scheduler must still deliver it');
});

test('the exported microtask scheduler renders', async () => {
  const previous = core.setRenderScheduler(core.microtask);
  try {
    const element = counter();
    await macrotask();
    element._state.n = 7;
    await macrotask();
    assert.equal(element.shadowRoot.textContent, '7');
  } finally {
    core.setRenderScheduler(previous);
  }
});

/**
 * The defect pass 92 found. A scheduler that throws left the coalescing flag raised, so every later
 * write returned early and the component never rendered again — measured frozen at its initial value
 * for the rest of the page, and *not* revived by restoring the default scheduler.
 *
 * Both halves are asserted because both carry the flag independently: `useRender` has `queued` and
 * `coalesce` has `scheduled`, and fixing one would have left effects dead while renders recovered.
 */
test('a scheduler that throws does not freeze the component permanently', async () => {
  let effects = 0;
  const element = counter((state) => core.useEffect(() => { void state.n; effects++; }));
  await frame();
  const settled = effects;

  /**
   * The throw does **not** reach the writer, and that is deliberate: `createHook` isolates a hook's
   * error to the `'error'` insert so one bad hook cannot take out its siblings. So a throwing
   * scheduler is invisible to the code doing `state.n = 1` — which is exactly why the component
   * freezing silently afterwards was so hard to see.
   */
  const failures = [];
  core.wire({ on: 'error', fn: (error) => failures.push(error), priority: 50 });
  const previous = core.setRenderScheduler(() => { throw new Error('scheduler exploded'); });
  assert.doesNotThrow(() => { element._state.n = 1; }, 'a hook error is isolated, not rethrown at the write');
  core.setRenderScheduler(previous);
  assert.ok(
    failures.some((error) => /scheduler exploded/.test(String(error?.message))),
    'the failure should still be reported through the error insert rather than vanishing'
  );

  element._state.n = 2;
  await frame();
  assert.equal(element.shadowRoot.textContent, '2', 'the render never recovered — `queued` stayed raised');
  assert.ok(effects > settled, 'the effect never recovered — `scheduled` stayed raised');
});

/**
 * The harder half, which was nearly left unfixed on the reasoning that a dropped pass cannot be told
 * apart from a deferred one. That is true *at the moment of scheduling* and it is not the only
 * moment: once the scheduler has been **replaced**, whatever the old one was holding is provably
 * never going to run, because nothing will ever call it again. So the guard stops honouring a flag
 * raised under a scheduler that no longer exists.
 *
 * A component that never renders again is not something to leave standing behind an argument about
 * contracts.
 */
test('a scheduler that silently drops the pass does not freeze the component once it is replaced', async () => {
  let effects = 0;
  const element = counter((state) => core.useEffect(() => { void state.n; effects++; }));
  await frame();
  const settled = effects;

  const previous = core.setRenderScheduler(() => {});
  element._state.n = 1;
  await macrotask();
  assert.equal(element.shadowRoot.textContent, '0', 'the dropping scheduler should indeed drop it');

  core.setRenderScheduler(previous);
  element._state.n = 2;
  await frame();
  assert.equal(element.shadowRoot.textContent, '2', 'the render never recovered from the stranded pass');
  assert.ok(effects > settled, 'the effect never recovered from the stranded run');
});

test('re-queueing does not fire twice while one scheduler stays installed', async () => {
  /**
   * The recovery only relaxes the guard across a *replacement*. Within one scheduler the flag must
   * still coalesce, or every write in a tick would schedule its own pass — which is the whole point
   * of the flag.
   */
  let renders = 0;
  const tag = `x-sched-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.render(() => { renders++; return core.html`<p>${state.n}</p>`; });
    }
  });
  const element = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(element);
  await frame();

  const before = renders;
  for (let i = 1; i <= 20; i++) element._state.n = i;
  await frame();
  assert.equal(renders - before, 1, `twenty writes in one tick should render once, rendered ${renders - before}`);
});

/**
 * A render that throws must not leave the `<select>.value` queue holding anything.
 *
 * The queue is module state in the renderer, filled during a pass and drained at the end of
 * `renderInto`. A throw in between left the element in it — retaining it, and handing the stranded
 * value to the **next** `renderInto` call, so an unrelated component's render silently changed a
 * select it has nothing to do with. Found by re-running pass 84's leak lens over the module state
 * this session added, rather than over the state that existed when pass 84 ran.
 */
test('a render that throws leaves nothing queued for the next one', async () => {
  const { renderInto } = await load('renderer');
  const D = dom.window.document;
  const explode = { toString() { throw new Error('value exploded'); } };
  const draw = (value, tail) =>
    core.html`<div><select .value=${value}><option value="a">A</option><option value="b">B</option></select><p title=${tail}>x</p></div>`;

  const host = D.createElement('div');
  renderInto(draw('a', 'fine'), host);
  const select = host.querySelector('select');
  assert.equal(select.value, 'a');

  assert.throws(() => renderInto(draw('b', explode), host), /value exploded/);
  assert.equal(select.value, 'b', 'the queued value should be applied by its own pass, not a later one');

  /** Reset by hand: anything still queued would land on the next unrelated render. */
  select.value = 'a';
  renderInto(core.html`<p>${'unrelated'}</p>`, D.createElement('div'));
  assert.equal(select.value, 'a',
    'an unrelated render applied a value stranded by an earlier failure');
});
