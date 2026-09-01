/**
 * The lit-html compatibility claim, checked against lit-html's own output.
 *
 * `packages/renderer/README.md` prints a table of what a child position does with each kind of value
 * and states: *"These match lit-html exactly, `null` and `undefined` included."* Every other suite
 * here asserts vera against expectations written by the same people who wrote vera. This one asserts
 * it against a different implementation, which is the only thing that can actually settle a
 * compatibility claim.
 *
 * `tests/lit-output.mjs` holds lit's answers, measured from lit-html and checked in, so every build
 * everywhere can be compared without lit being resolvable. The last test re-measures when lit *is*
 * present, so the recording cannot quietly go stale.
 *
 * **It is present more often than this file used to claim.** `lit-html` is a root `devDependency`,
 * not only a `bench/` one, so a root `npm ci` installs it and CI runs that re-measurement too. The
 * old note said CI could not import lit, which is why a recording that only held on one machine went
 * unnoticed here and failed there.
 *
 * **The divergences are the interesting half.** `llms.txt` documents exactly one, and this suite
 * requires that list to be exactly right in both directions: a difference not on it fails, and one on
 * it that has stopped being a difference fails too.
 */
import { load, isProduction } from './dist.mjs';
import { LIT_OUTPUT } from './lit-output.mjs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

/** Both libraries leave marker comments; the claim is about rendered content, not bookkeeping. */
const strip = (host) => host.innerHTML.replace(/<!--[\s\S]*?-->/g, '').trim();

/** The same values the recording was made from, by the same labels. */
const VALUES = {
  'a string': 'text',
  'an empty string': '',
  'a number': 42,
  zero: 0,
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  'a negative number': -1,
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  'a bigint': 10n,
  'an array of strings': ['a', 'b'],
  'an empty array': [],
  'an array with holes': ['a', null, undefined, 'b'],
  'a nested array': [['a', ['b']], 'c'],
  'an object': { a: 1 },
  /**
   * **No `Date`.** Both libraries render a non-plain object with `String(value)`, so a `Date`
   * exercises nothing `an object` does not — and its string form carries the machine's timezone
   * and locale. Recorded on one machine it fails on every other: this suite was green here and
   * red in CI, which runs UTC, comparing `GMT-0800 (Pacific Standard Time)` against
   * `GMT+0000 (Coordinated Universal Time)`. A recording can only hold output that does not
   * depend on where it was taken.
   */
  'a Set': new Set(['a', 'b']),
  'a Map': new Map([['k', 'v']]),
  'markup in a string': '<b>not markup</b>',
  'an entity in a string': 'a &amp; b',
  'a quote in a string': 'say "hi"',
  unicode: 'héllo 日本 🎉',
};

const POSITIONS = {
  child: (value) => html`<p>[${value}]</p>`,
  attribute: (value) => html`<div class=${value}>x</div>`,
  multiPartAttribute: (value) => html`<div class="lead ${value} tail">x</div>`,
  booleanAttribute: (value) => html`<input ?disabled=${value} />`,
};

/**
 * The single documented divergence, from `llms.txt`: *"In a single-expression attribute,
 * `null`/`undefined` REMOVE the attribute (there is no `nothing`)."* lit leaves `class=""` there.
 */
const DOCUMENTED_DIVERGENCES = new Set(['attribute/null', 'attribute/undefined']);

const renderVera = (position, value) => {
  const host = document.createElement('div');
  renderInto(POSITIONS[position](value), host);
  return strip(host);
};

test('vera renders what lit-html renders, except where the docs say otherwise', () => {
  const unexpected = [];
  const stale = [];
  for (const position of Object.keys(POSITIONS)) {
    for (const [label, value] of Object.entries(VALUES)) {
      const expected = LIT_OUTPUT[position][label];
      assert.ok(expected !== undefined, `the recording has no entry for ${position}/${label}`);
      const actual = renderVera(position, value);
      const key = `${position}/${label}`;
      if (actual === expected) {
        if (DOCUMENTED_DIVERGENCES.has(key)) stale.push(key);
      } else if (!DOCUMENTED_DIVERGENCES.has(key)) {
        unexpected.push(`${key}\n      vera: ${JSON.stringify(actual)}\n      lit:  ${JSON.stringify(expected)}`);
      }
    }
  }
  assert.deepEqual(unexpected, [], `these differ from lit-html and nothing documents them:\n${unexpected.join('\n')}`);
  assert.deepEqual(
    stale,
    [],
    `these are documented as differing from lit-html and no longer do — remove them from llms.txt: ${stale.join(', ')}`
  );
});

/**
 * The divergence stated positively, so the documentation is asserted rather than merely excluded: a
 * single-expression attribute given `null` or `undefined` is **removed**, where lit leaves it empty.
 */
test('a nullish single-expression attribute is removed, which is the documented difference', () => {
  for (const value of [null, undefined]) {
    assert.equal(renderVera('attribute', value), '<div>x</div>', `class=${String(value)} should be removed`);
    assert.equal(LIT_OUTPUT.attribute[String(value)], '<div class="">x</div>', 'lit no longer leaves it empty');
  }
  /** And among statics it is the empty string in both, which is why only the single case diverges. */
  for (const value of [null, undefined])
    assert.equal(renderVera('multiPartAttribute', value), LIT_OUTPUT.multiPartAttribute[String(value)]);
});

/**
 * And the recording itself, re-measured where lit is installed. Skipped in CI by design — `bench` is
 * not a workspace member — so this is the check that runs for whoever has run `cd bench && npm
 * install`, and the reason the data above can be trusted between times.
 */
test('the recorded lit output still matches lit-html', { skip: isProduction && 'the recording is build-independent' }, async (t) => {
  let lit;
  try {
    lit = createRequire(new URL('../bench/package.json', import.meta.url))('lit-html');
  } catch {
    t.skip('lit-html is not installed — run `cd bench && npm install` to check the recording');
    return;
  }
  const drift = [];
  for (const [position, make] of Object.entries({
    child: (v) => lit.html`<p>[${v}]</p>`,
    attribute: (v) => lit.html`<div class=${v}>x</div>`,
    multiPartAttribute: (v) => lit.html`<div class="lead ${v} tail">x</div>`,
    booleanAttribute: (v) => lit.html`<input ?disabled=${v} />`,
  })) {
    for (const [label, value] of Object.entries(VALUES)) {
      const host = document.createElement('div');
      lit.render(make(value), host);
      const actual = strip(host);
      if (actual !== LIT_OUTPUT[position][label])
        drift.push(`${position}/${label}: recorded ${JSON.stringify(LIT_OUTPUT[position][label])}, lit now renders ${JSON.stringify(actual)}`);
    }
  }
  assert.deepEqual(drift, [], `tests/lit-output.mjs is stale:\n${drift.join('\n')}`);
});
