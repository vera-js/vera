/**
 * Springs — synthesized to linear() at generation, the compositor carries the physics.
 * The four corners: the solver's shape (overshoot, exact landing), the PAIR emission on both
 * paths (fallback first — an engine without linear() must lose one declaration, never a
 * shorthand), grammar bounds, and the v1 inertia-ease refusal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body><div id="x">r</div></body>');
globalThis.document = dom.window.document;
const { parseMotion, generateSimple } = await load('motion');
const ctx = () => ({ rejected: [], dropped: [], windowSize: { width: 900, height: 800 } });
const gen = (v) => generateSimple(parseMotion(dom.window.document.getElementById('x'), v, ctx()));

test('seek path: the pair rides after the shorthand, fallback first, curve lands at 1', () => {
  const g = gen("{ keyframes: { opacity: '0% 0, 100% 1' }, ease: 'spring(0.4)' }");
  const pair = g.elementRule.match(/animation-timing-function: (ease-out); animation-timing-function: linear\(([^)]*)\)/);
  assert.ok(pair, 'fallback then linear(), in that order');
  const values = pair[2].split(',').map(Number);
  assert.ok(Math.max(...values) > 1, 'bounce 0.4 overshoots past 1');
  assert.equal(values[values.length - 1], 1, 'and lands exactly');
  assert.match(g.elementRule, /animation: [^;]*ease-out both paused/, 'the SHORTHAND carries only the fallback — linear() inside it would invalidate whole');
});

test('transition path: same pair in the armed longhands', () => {
  const g = gen("{ keyframes: { opacity: '0% 0, 100% 1' }, when: '.go', play: 0.5, ease: 'spring' }");
  assert.match(g.armedRule, /transition-timing-function: ease-out[^;]*; transition-timing-function: linear\(/);
});

test('grammar: bounce bounds, and inertia-ease refuses springs in v1', () => {
  assert.ok(gen("{ keyframes: { opacity: '0% 0, 100% 1' }, ease: 'spring(0.9)' }"), 'high bounce parses');
  const over = parseMotion(dom.window.document.getElementById('x'),
    "{ keyframes: { opacity: '0% 0, 100% 1' }, ease: 'spring(0.99)' }", ctx());
  assert.ok(over.rejected.some((r) => r.code === 'motion-setting-easing'), 'past 0.95 refuses');
  const inertia = parseMotion(dom.window.document.getElementById('x'),
    "{ keyframes: { opacity: '0% 0, 100% 1' }, inertia-ease: 'spring' }", ctx());
  assert.ok(inertia.rejected.some((r) => r.code === 'motion-setting-easing'),
    'inertia-ease refuses by the SAME code — the pair trick has nowhere to live inline');
});
