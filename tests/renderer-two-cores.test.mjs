/**
 * **One renderer wired into TWO cores says so, in EVERY build** (R3 list, 2026-10-21; built 2026-10-22). Two apps
 * sharing one renderer bundle leave it following the LAST core's seams, so the first app's tracking silently breaks.
 * The hazard exists only in PRODUCTION — development's core copies share one registry, so there these rows wire copies
 * that do not (`?copy=` loads a separate core; in development they share `@verajs/inserts`, so the rows SKIP there and
 * say why) — and production prints the short code, whose docs entry holds the prose. Rows, in order (one process, one
 * renderer copy): the same registry wired again is silent (the control); a second core warns exactly once; a third
 * core is another takeover and warns once more.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer } = await load('renderer');
/** Development: the copies share one registry, so there is no second core to warn about (measured 2026-10-22). */
const skip = !isProduction && 'development core copies share one registry — the hazard is production-only';

const warnings = [];
const warn = console.warn;
console.warn = (...args) => { const line = args.join(' '); if (line.includes('renderer-two-cores')) warnings.push(line); else warn(...args); };
test.after(() => { console.warn = warn; });

test('CONTROL: the same core wired again (with options) is silent', { skip }, () => {
  core.wire([renderer]);
  core.wire([renderer({ shadow: 'open' })]);
  assert.equal(warnings.length, 0);
});

test('a second core wiring the same renderer warns exactly once, coded and prefixed', { skip }, async () => {
  const second = await load('core', '?copy=2');
  assert.notEqual(second.wire, core.wire, 'CONTROL: a separate copy of core');
  second.wire([renderer]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[vera\]/);
  assert.match(warnings[0], /renderer-two-cores/);
});

test('a third core is another takeover: one more warning, and the same core re-wired adds none', { skip }, async () => {
  const third = await load('core', '?copy=3');
  third.wire([renderer]);
  assert.equal(warnings.length, 2);
  third.wire([renderer]);
  assert.equal(warnings.length, 2, 'the same registry again is silent');
});
