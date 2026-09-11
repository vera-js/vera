/**
 * Tier N for custom ranges — the static mapping from `scroll` alignments to `animation-range`.
 * Family math pinned shape by shape, and the refusals BY ABSENCE (no #n rule = tier C keeps the
 * element, which is the always-correct floor).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body><div id="x">r</div></body>');
const { parseMotion, generateSimple } = await load('motion');

const rangeFor = (extra) => {
  const parsed = parseMotion(dom.window.document.getElementById('x'),
    `{ keyframes: { opacity: '0% 0, 100% 1' }${extra ? ', ' + extra : ''} }`,
    { rejected: [], dropped: [], windowSize: { width: 900, height: 800 } });
  const generated = generateSimple(parsed);
  const match = generated?.nativeRule.match(/animation-range: ([^;]*);/);
  return match ? match[1].split(',')[0].trim() : null;
};

test('the mapping table, shape by shape', () => {
  assert.equal(rangeFor(''), 'cover 0% cover 100%', 'default window');
  assert.equal(rangeFor("scroll: '100%, 0%'"), 'cover 0% cover 100vh', 'the canonical pair');
  assert.equal(rangeFor("scroll: '70%'"), 'cover 30vh cover 100%', 'one viewport line');
  assert.equal(rangeFor("scroll: '80%, 30%'"), 'cover 20vh cover 70vh', 'two lines, ordered');
  assert.equal(rangeFor("scroll: '0%, 100%'"), null, 'reversed refuses by absence');
  assert.equal(rangeFor("scroll: '50%', anchor: 'self'"), null, 'anchor keeps tier C (v1 gate; self is native-mappable someday)');
});
