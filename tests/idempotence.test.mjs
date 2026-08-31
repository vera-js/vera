/**
 * Calling a public entry twice with the same arguments.
 *
 * Pass 95 established that wiring **order** does not matter. This is its twin: **repetition** must not
 * either. The permitted outcomes are a no-op or a complaint. The one that must not happen is a silent
 * double-effect — two shadow roots, two stylesheets, two observers, two chain entries — because that
 * is invisible in every passing test and surfaces later as a leak or a doubled side effect.
 *
 * This is not a hypothetical shape. An app whose entry points share a setup module calls `wire`
 * from each of them, and `inserts.ts` carries a long note about the warning that used to fire on
 * exactly that. A component moved between documents runs `connectedCallback` again. A dev server
 * re-executing a module runs the whole entry again.
 *
 * ## Every case asserts the first call did something
 *
 * "The same after twice as after once" is satisfied trivially by an entry that never worked. The
 * first draft of this had precisely that bug: the `autoload` case watched an element with no
 * `autoloader` attribute, so `watch` returned early, `observe()` was **0** both times, and the row
 * reported perfect idempotence while measuring nothing at all. Each case below pins the once-value to
 * something non-trivial first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];
dom.window.scrollTo = () => {};

const core = await load('core');
const { renderer } = await load('renderer');
const { styles, applyStyles } = await load('styles');
const { autoloader } = await load('autoloader');
core.wire([renderer, styles]);

const element = () => dom.window.document.createElement('div');

test('init twice attaches one shadow root', () => {
  const host = element();
  core.init(host, { mode: 'open' });
  assert.ok(host.shadowRoot, 'the first init attached one');
  const first = host.shadowRoot;

  core.init(host, { mode: 'open' });
  assert.equal(host.shadowRoot, first, 'the second init did not attach another');
});

test('applyStyles twice leaves one stylesheet', () => {
  const host = element();
  host.attachShadow({ mode: 'open' });
  applyStyles(':host{color:red}', host);
  const after = () => host.shadowRoot.querySelectorAll('style').length + (host.shadowRoot.adoptedStyleSheets ?? []).length;
  assert.equal(after(), 1, 'the first call applied one');

  applyStyles(':host{color:red}', host);
  assert.equal(after(), 1, 'the second call applied it again');
});

test('wiring the same descriptor twice leaves one entry', () => {
  const descriptor = { on: 'probe-idempotent', fn: () => {}, priority: 42 };
  core.wire(descriptor);
  assert.equal(core.inserts.get('probe-idempotent').length, 1, 'the first wire registered it');

  core.wire(descriptor);
  assert.equal(core.inserts.get('probe-idempotent').length, 1, 'the second wire duplicated it');
});

/**
 * Two *different* callbacks claiming one priority is the deliberate exception: the second replaces
 * the first, and `inserts.ts` explains at length why it says so out loud. That it warns is the point
 * — a replacement nobody is told about is how a module silently never runs.
 */
test('but two different callbacks at one priority replace, and say so', { skip: isProduction && 'the warning is __DEV__' }, () => {
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    core.wire({ on: 'probe-clash', fn: () => 'a', priority: 50 });
    assert.deepEqual(said, [], 'the first is not a clash');
    core.wire({ on: 'probe-clash', fn: () => 'b', priority: 50 });
  } finally {
    console.warn = original;
  }

  assert.equal(core.inserts.get('probe-clash').length, 1, 'one entry, not two');
  assert.equal(said.length, 1, 'and the replacement was reported');
  assert.match(said[0], /^\[vera\]/, 'with the framework prefix');
});

test('watching a root twice observes it once', () => {
  const host = element();
  /** `watch` returns early without this, and then the whole case measures nothing. */
  host.setAttribute('autoloader', '');
  dom.window.document.body.appendChild(host);

  let observed = 0;
  const Real = dom.window.MutationObserver;
  globalThis.MutationObserver = class extends Real {
    observe(...args) { observed++; return super.observe(...args); }
  };
  try {
    const autoload = autoloader('https://x.test/app.js', 'c');
    autoload(host);
    assert.equal(observed, 1, 'the first call actually observed the root');

    autoload(host);
    assert.equal(observed, 1, 'the second call observed it again');
  } finally {
    globalThis.MutationObserver = Real;
  }
});
