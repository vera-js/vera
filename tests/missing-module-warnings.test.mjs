/**
 * **Markup that asks for a module nobody wired.**
 *
 * The failure this guards is the quietest one the framework has: a component pasted from a demo
 * brings its markup along, and an attribute addressed to a module the app never wired is not an
 * error — it is nothing at all. `data-vd-on-click` on an app that wired only the renderer looks
 * supported and does exactly nothing, and the thing that would normally complain about an unknown
 * directive is the thing that is missing.
 *
 * Core answers it the way it already answered the same question for `@verajs/styles`: warn once,
 * name the import, and carry none of it into production. That earlier warning had no test at all —
 * it is the precedent this one is modelled on, so it is pinned here too rather than left as the
 * only diagnostic in core nothing checks.
 *
 * **The control lives in its own file, and that is not tidiness.** The warning fires once per page
 * and the flag that enforces it is module-scoped, so a "stays silent when wired" test placed AFTER
 * the firing test in this file passes whether the feature works or not — it is silent because the
 * budget is spent, not because the check is correct. Two files means two processes and two fresh
 * registries. See `missing-module-quiet.test.mjs`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

/**
 * `load('core')` rather than reaching core through a re-export — the guard under test is core's
 * own `__DEV__` branch, and `tests/dist.mjs` explains why a re-export would silently resolve to the
 * production build and assert against a program that has no guard at all.
 */
const { wire, init, render, html } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);

/** Captures warnings for one mount, then restores — a leaked override poisons every later suite. */
const capture = async (fn) => {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    await fn();
    /** The check is a microtask off the end of `connectedCallback`, so a turn has to pass. */
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = original;
  }
  return seen;
};

let counter = 0;
const mount = (markup) => capture(async () => {
  const tag = `pasted-${++counter}`;
  dom.window.customElements.define(tag, class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`${markup}`);
    }
  });
  const el = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(el);
});

test('a pasted component using directives with none wired says so, and names the import', async (t) => {
  if (isProduction) return t.skip('the whole check is a __DEV__ branch — production has neither it nor its message');

  const warnings = await mount(
    dom.window.document.createRange().createContextualFragment(
      '<button data-vd-on-click="{ open: !open }">menu</button>'
    )
  );
  const hit = warnings.find((w) => w.includes('data-vd-'));
  assert.ok(hit, 'markup addressed to an unwired module must not be silent');
  assert.match(hit, /no directives engine is wired/, 'it says what is missing');
  assert.match(hit, /data-vd-on-click/, 'and quotes the attribute that made it look, not a generic hint');
  assert.match(hit, /@verajs\/directives/, 'and names the package to import');
  assert.match(hit, /wire\(\[renderer, directives\]\)/, 'with the call to make, not a description of it');
});

test('production carries neither the check nor its prose', async () => {
  const { readFileSync } = await import('node:fs');
  const bundle = readFileSync(new URL('../packages/core/dist/vera.min.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /no directives engine is wired/, 'the message folded away');
  assert.doesNotMatch(bundle, /vera\.claims/,
    'and so did the registry lookup — a top-level Symbol.for() survives DCE, so it lives inside ' +
    'the dev-only function on purpose');
  assert.doesNotMatch(bundle, /declares `static styles`/, 'the same for the warning this one copies');
});
