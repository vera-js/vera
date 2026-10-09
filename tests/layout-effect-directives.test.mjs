/**
 * **A `useLayoutEffect` and `@verajs/directives`.** The directives' appliers are hooks of their own owners (one per
 * directive instance), never of the component — so the component's layout-effect priority does not order them; what a
 * layout effect sees of a directive is decided by when the directive applied. Pinned: after a write, a layout effect
 * sees the directive's result. On MOUNT it sees the rendered element without the directive's first application (the
 * engine activates after the component's first pass) — before 2026-10-08 it saw no element at all, since it ran before
 * the render. Measured both ways (`.probe/le-directives.mjs`, hydra worktree).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

/** jsdom reports an exception thrown from a lifecycle callback here, never to the caller: recorded, so a row can see it. */
const thrown = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => thrown.push(error.cause ?? error));
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
const { directives, wireDirectives, expressions, interactions, settled } = await load('directives');
core.wire([renderer, directives]);
wireDirectives([expressions, ...interactions]);

test('after a write, a useLayoutEffect sees the class a directive applied to what the render made', async () => {
  const state = core.createStore({ n: 0 });
  const seen = [];
  customElements.define('x-le-directive', class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useLayoutEffect(() => { seen.push([state.n, this.querySelector('nav')?.classList.contains('busy')]); });
      core.render(() => core.html`<div data-vd-state="{ count: 5 }"><nav data-vd-class="{ busy: count > 3 }">${state.n}</nav></div>`);
    }
  });
  const el = document.createElement('x-le-directive');
  document.body.append(el);
  await settled();
  assert.equal(seen[0]?.[1], false, 'CONTROL: on mount the layout effect ran after the render (the element exists)');
  state.n = 1;
  await settled();
  assert.deepEqual(seen.at(-1), [1, true], 'the update\'s layout effect saw the directive\'s class');
  el.remove();
});

/**
 * TODO (production only, found 2026-10-08): the directives engine's `disconnectedCallback` throws `TypeError: Cannot
 * read properties of undefined (reading 'forEach')` when such a component is removed; development is clean. Suspected:
 * the missing core stamp (directives-packaging). A `todo` row until fixed — the fix proves itself by turning it green.
 */
test('removing a component that renders directives throws nothing', async () => {
  customElements.define('x-le-teardown', class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => core.html`<div data-vd-state="{ count: 5 }"><nav data-vd-class="{ busy: count > 3 }">x</nav></div>`);
    }
  });
  const el = document.createElement('x-le-teardown');
  document.body.append(el);
  await settled();
  assert.equal(el.querySelector('nav')?.classList.contains('busy'), true, 'CONTROL: the directive applied');
  thrown.length = 0;
  el.remove();
  await settled();
  assert.deepEqual(thrown.map(String), [], 'nothing thrown out of teardown');
});
