/**
 * **One renderer wired into TWO cores says so, once, in development** (R3 list, 2026-10-21; built 2026-10-22). Two apps
 * sharing one renderer bundle leave it following the LAST core's seams, so the first app's tracking silently breaks;
 * production stays last-wins (no bytes), development warns `renderer-two-cores`. Rows, in order (one process, one
 * renderer copy): the same registry wired again is silent (the control — a re-wire with options is not a second core);
 * a second core warns exactly once; a third still leaves it at one.
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
const skip = isProduction && 'the warning is development-only';

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
  assert.match(warnings[0], /renderer per core/);
});

test('a third core leaves it at one: said once per renderer copy', { skip }, async () => {
  const third = await load('core', '?copy=3');
  third.wire([renderer]);
  core.wire([renderer]);
  assert.equal(warnings.length, 1);
});
