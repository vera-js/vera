/**
 * **A handler Vera binds never subscribes the hook that happens to be running** (2026-10-09). An effect that fires an
 * event synchronously (`el.click()`) runs the handler inside itself, and the handler's reads subscribed that effect —
 * a handler doing `state.n++` made the effect re-run on every later click (measured: a self-feeding loop, held to one
 * round per frame, forever). Three places bind handlers, one row each: the template's `@event`, spread's `@event` key,
 * and the directives' `data-vd-on-*` (one choke point, `runAssignments`). Not covered, by design: a listener added
 * with `addEventListener` — read through `untrack` there (core README).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
const { spread } = await load('renderer/spread');
const { directives, wireDirectives, expressions, interactions, settled, stateOf } = await load('directives');
core.wire([renderer, directives]);
wireDirectives([expressions, ...interactions]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A component whose effect clicks its button ONCE; `draw` binds the handler one of the three ways. */
const run = async (name, draw, probe = () => undefined) => {
  const state = core.createStore({ n: 0, clicks: 0 });
  let effectRuns = 0;
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useEffect(() => {
        void state.n;
        effectRuns++;
        if (!this.clicked) { this.clicked = true; this.querySelector('button').click(); }
      });
      core.render(() => draw(state));
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await settled?.();
  await tick();
  const afterMount = effectRuns;
  for (let i = 0; i < 3; i++) { el.querySelector('button').click(); await tick(); }
  const probed = probe(el);
  el.remove();
  return { afterMount, effectRuns, state, probed };
};

/**
 * The effect reads ONLY `n`; the handler reads-and-writes `clicks`. Tracked, the handler's read of `clicks` subscribed
 * the effect, and every later click re-ran it; untracked, later clicks leave it alone.
 */
test('template `@click`: later clicks do not re-run the effect that once fired it', async () => {
  const { afterMount, effectRuns, state } = await run('hu-template', (state) => core.html`<button @click=${() => { state.clicks++; }}>x</button>`);
  assert.equal(state.clicks, 4, 'CONTROL: the handler ran for the effect\'s click and three more');
  assert.equal(effectRuns - afterMount, 0, 'the effect never re-ran — the handler\'s read did not subscribe it');
});

test('spread `@click`: the same', async () => {
  const { afterMount, effectRuns, state } = await run('hu-spread', (state) => core.html`<button ${spread({ '@click': () => { state.clicks++; } })}>x</button>`);
  assert.equal(state.clicks, 4, 'CONTROL: the handler ran four times');
  assert.equal(effectRuns - afterMount, 0, 'the effect never re-ran');
});

/**
 * Directives' `data-vd-on-click` reads `count` from the directive state. Only meaningful where the engine's store and
 * the component's effect share ONE core — development (core stays external); a production bundle inlines its own
 * core into directives (the missing core stamp, group A), so there the effect could never track it at all.
 */
test('directives `data-vd-on-click`: later clicks do not re-run the effect that once fired it', { skip: isProduction && 'production directives bundle carries its own core (group A stamp)' }, async () => {
  const draw = () => core.html`<div data-vd-state="{ count: 0 }"><button data-vd-on-click="{ count: count + 1 }">x</button></div>`;
  const { afterMount, effectRuns, probed } = await run('hu-directives', draw, (el) => stateOf(el.querySelector('[data-vd-state]'))?.count);
  /** ≥ 3, not 4: one click currently runs `data-vd-on-click` TWICE (the todo row below) — the control only needs it ran. */
  assert.ok(probed >= 3, `CONTROL: the on-click assignment ran on the later clicks (count ${probed})`);
  assert.equal(effectRuns - afterMount, 0, 'the effect never re-ran');
});

/**
 * TODO (found 2026-10-09 writing the row above; predates it — the engine before the untracking change counts the same;
 * jsdom only, a real browser unconfirmed): ONE click runs a light component's `data-vd-on-click` TWICE (count 2, 4,
 * 6). Suspect: the delegated listener sits on two roots the click bubbles through. A `todo` row until fixed.
 */
test('one click runs data-vd-on-click once', { todo: 'one click runs it twice (delegated on two roots?)' }, async () => {
  customElements.define('hu-once', class extends HTMLElement {
    connectedCallback() { core.init(this); core.render(() => core.html`<div data-vd-state="{ count: 0 }"><button data-vd-on-click="{ count: count + 1 }">x</button></div>`); }
  });
  const el = doc.createElement('hu-once');
  doc.body.append(el);
  await settled();
  await tick();
  el.querySelector('button').click();
  await tick();
  assert.equal(stateOf(el.querySelector('[data-vd-state]'))?.count, 1);
  el.remove();
});
