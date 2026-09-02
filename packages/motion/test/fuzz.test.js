import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseUrl } from '../src/modules/url.ts';
import {
  parseKeyframeList, parseBandedList, parseRange, parseMeasure, parseEasing,
  parseOrigin, parseOffset, parseSelector, getProperty,
} from '../src/modules/schema.ts';
import { resolveEasing } from '../src/easings.ts';
import { paint } from '../src/paint.ts';
import { parsePathData } from '../src/path.ts';
import { sequence } from '../src/sequence.ts';

/**
 * Adversarial input across every parser.
 *
 * The rest of the suite tests the shapes we thought of; this tests the ones we
 * did not — partial brackets, doubled delimiters, numeric look-alikes,
 * non-Latin digits, and a few thousand random strings from the alphabet the
 * grammars actually use.
 *
 * A parser may reject anything it likes. What it may not do is throw, or
 * return a non-finite number: either reaches a style property as garbage, and
 * attribute values are untrusted input (principle #8).
 */
const property = getProperty('translate-y');

/**
 * Module parsers take the same untrusted attribute text as the built-ins, and a
 * module carrying its own validator is exactly where the corpus stops applying
 * by itself — `getProperty('translate-y')` reaches none of it. `paint` runs
 * the value past `CSS.supports` and hands back a slot; `sequence` runs its own
 * origin policy.
 */
const background = paint.find((p) => p.attribute === 'background');
const frameUrl = sequence({ allowedOrigins: ['https://cdn.test'] })
  .find((w) => w.attribute === 'frame-url');

const ALPHA = '0123456789.,;:%[]+-()pxremvhdegabc \t"\'/*{}<>&$#@!?=|~`^';
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const noise = (n) => Array.from({ length: n }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join('');

const SEEDS = [
  '', ' ', ',', ';', ':', '[', ']', '[]', '[-]', '[+]', '[0-]', '[0+', '0%',
  '0% ', ' 0% 0 ', '0%  0', '[0-1]:', '[0-1]::0% 0', ';;;', ',,,',
  '[0-1]:[0-1]:0% 0', 'NaN', 'Infinity', '-Infinity', '1e400', '1e-400',
  '0x10', '1_000', '٣', '½', '0% 0'.repeat(50), 'a'.repeat(5000),
  '[1-2]:'.repeat(100) + '0% 0', '-', '--', '.', '..', '+-1', '1-', '%%',
];

const PARSERS = [
  ['parseKeyframeList', (s) => parseKeyframeList(s, property)],
  ['parseBandedList', (s) => parseBandedList(s, property)],
  ['parseMeasure', (s) => parseMeasure(s, property)],
  ['parseRange', (s) => parseRange(s)],
  ['parseEasing', (s) => parseEasing(s)],
  ['parseOrigin', (s) => parseOrigin(s)],
  ['parseOffset', (s) => parseOffset(s)],
  ['parsePathData', (s) => parsePathData(s)],
  ['parseSelector', (s) => parseSelector(s)],
  ['parseUrl', (s) => parseUrl(s, 'https://x.test/')],
  /** Both ends as well as the middle: a shaper can be finite at 0.5 and not at 1. */
  ['resolveEasing', (s) => {
    const e = resolveEasing(s);
    return e ? [e(0), e(0.5), e(1)] : null;
  }],
  ['paint.parse via parseMeasure', (s) => parseMeasure(s, background)],
  ['paint.parse via parseKeyframeList', (s) => parseKeyframeList(s, background)],
  ['sequence frame-url policy', (s) => frameUrl.parse(s)],
];

const inputs = [...SEEDS];
for (let i = 0; i < 2000; i++) inputs.push(noise(1 + Math.floor(rnd() * 40)));

/** Walks for real non-finite numbers. An `Infinity` max on a range is legitimate. */
const nonFinite = (value, path, out, seen = new Set()) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) && !(path.endsWith('.max') && value === Infinity)) out.push(path);
    return out;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) nonFinite(child, `${path}.${key}`, out, seen);
  return out;
};

describe.each(PARSERS)('%s survives adversarial input', (name, parse) => {
  it(`never throws and never produces a non-finite number (${inputs.length} inputs)`, () => {
    const problems = [];
    for (const input of inputs) {
      let out;
      try {
        out = parse(input);
      } catch (error) {
        problems.push(`threw on ${JSON.stringify(input.slice(0, 30))}: ${error.message}`);
        continue;
      }
      for (const path of nonFinite(out, name, [])) {
        problems.push(`${path} non-finite on ${JSON.stringify(input.slice(0, 30))}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});
