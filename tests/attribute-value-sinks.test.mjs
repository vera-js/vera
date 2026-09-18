/**
 * **Three sinks turn a bound value into an attribute, and they must answer alike.**
 *
 * The renderer's `AttrPart` lets `setAttribute` do the DOMString conversion; `@verajs/renderer/spread`
 * is a separate implementation by design (its header explains the byte budget that forces that); and
 * `@verajs/ssr`'s `escapeHtml` writes the server's half. Three homes for one fact, which is exactly
 * the shape the audit of 2026-09-12 was hunting — and one of them had drifted.
 *
 * `spread` used `String(value)` where the other two use `` `${value}` ``. The two forms differ on
 * exactly one input and it is the one that matters: `String(sym)` returns `"Symbol(s)"` while every
 * DOM conversion and the server's escaper THROW. So `spread` alone accepted a symbol and wrote to
 * the client an attribute the server refuses to produce. The rule was already written down — in
 * `@verajs/ssr`'s own source, predating the audit, choosing `` `${value}` `` for precisely this
 * reason — and this sink used the other form anyway. **A house rule recorded in one of three homes
 * is a house rule in none of them.**
 *
 * The second half is the diagnostic, and its shape was argued and then MEASURED. See
 * `packages/renderer/src/dev-values.ts` for why the accepted set is closed rather than predicated.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { renderer } = await load('renderer');
const core = await load('core');
core.wire([renderer]);
const { renderInto } = await load('renderer/hydrate');
const { spread } = await load('renderer/spread');
const { serializeTemplate } = await import('../packages/ssr/src/vera/index.js');
const doc = dom.window.document;

/** A template result built by hand, so one value can be pushed through all three sinks unchanged. */
const result = (strings, ...values) => ({ ['_$litType$']: 1, strings, values });

/**
 * The shapes a naive guard breaks on. Four of these make `String(v)` THROW, which is why the
 * diagnostic does not call it: `Object.create(null)` is the RECOMMENDED dictionary idiom, and a
 * diagnostic that kills the page for an author writing the most defensive code available is worse
 * than the silence it replaced.
 */
const SHAPES = {
  string: 'hello',
  number: 42,
  boolean: true,
  bigint: 10n,
  url: new URL('https://x.test/a'),
  symbol: Symbol('s'),
  date: new Date(0),
  array: ['a', 'b'],
  object: {},
  nullPrototype: Object.create(null),
  toStringNull: { toString: null },
  toStringThrows: { toString() { throw new Error('nope'); } },
  fn: (element) => element,
};

/** Whatever the sink did: the attribute it wrote, or the error class it raised. */
const through = (sink) => {
  try {
    return `ok:${sink()}`;
  } catch (error) {
    return `throw:${error.constructor.name}`;
  }
};

test('the three attribute sinks agree, shape for shape', () => {
  const disagreed = [];
  for (const [name, value] of Object.entries(SHAPES)) {
    const viaPart = through(() => {
      const host = doc.createElement('div');
      renderInto(result`<i title=${value}></i>`, host);
      return host.querySelector('i')?.getAttribute('title');
    });
    const viaSpread = through(() => {
      const host = doc.createElement('div');
      renderInto(result`<i ${spread({ title: value })}></i>`, host);
      return host.querySelector('i')?.getAttribute('title');
    });
    const viaServer = through(() => serializeTemplate(result`<i title=${value}></i>`));

    /** The server writes markup rather than an attribute, so it is compared on outcome CLASS. */
    const serverAgrees = viaServer.startsWith('throw:') === viaPart.startsWith('throw:');
    if (viaPart !== viaSpread || !serverAgrees)
      disagreed.push(`${name}\n      AttrPart: ${viaPart}\n      spread:   ${viaSpread}\n      ssr:      ${viaServer}`);
  }
  assert.deepEqual(disagreed, [],
    `\n\n  ${disagreed.length} value shape(s) mean different things in different sinks:\n\n    ${disagreed.join('\n\n    ')}\n`);
});

test('a symbol is refused by every sink — the drift that started this', () => {
  /** NON-ZERO CONTROL: if this stops throwing, the suite above is comparing two silences. */
  assert.throws(() => {
    const host = doc.createElement('div');
    renderInto(result`<i ${spread({ title: Symbol('s') })}></i>`, host);
  }, TypeError, 'spread must refuse a symbol exactly as setAttribute and the server do');
});

/**
 * The diagnostic, driven through the sink that carries it rather than imported.
 *
 * Tests here run against BUILT artifacts, so the dev module is not importable by path — and that
 * constraint pushes this the right way: the question is what an author is TOLD while rendering, not
 * what a function returns. Each case gets its own attribute name, because the diagnostic reports
 * once per element+name+kind and a shared name would silence every case after the first.
 */
const complainAbout = (attribute, value) => {
  const host = doc.createElement('div');
  const real = console.warn;
  const seen = [];
  console.warn = (message) => seen.push(String(message));
  let threw = null;
  try {
    renderInto({ ['_$litType$']: 1, strings: Object.assign([`<i ${attribute}=`, `></i>`], { raw: [] }), values: [value] }, host);
  } catch (error) {
    threw = error;
  } finally {
    console.warn = real;
  }
  return { message: seen.find((m) => m.includes('An attribute value is a string')) ?? null, threw };
};

test('the diagnostic never throws, including on the shapes that break a naive guard',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    /**
     * `String(v)` raises on all three of these, which is why the diagnostic does not call it.
     * `Object.create(null)` is the RECOMMENDED dictionary idiom — a guard that kills the page for
     * an author writing the most defensive code available is worse than the silence it replaced.
     */
    for (const name of ['nullPrototype', 'toStringNull', 'toStringThrows']) {
      /**
       * The message IS the proof of survival, and it is the only proof available: the guard runs
       * before the conversion, so a warning can only exist if the guard completed. Whatever raises
       * afterwards is the sink's own `setAttribute` — a `TypeError` for the null-prototype and
       * null-`toString` shapes, and for `toStringThrows` the author's OWN error, unwrapped and
       * with their stack, which is the right thing for it to be.
       */
      const { message } = complainAbout(`guard-${name}`, SHAPES[name]);
      assert.notEqual(message, null,
        `${name}: the diagnostic must survive this shape AND name it — a guard that dies here is ` +
          `worse than the silence it replaced, since this is the recommended dictionary idiom`);
    }
  });

test('the accepted set is CLOSED: primitives and the blessed list pass, everything else is named',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    const silent = [];
    const reported = [];
    for (const [name, value] of Object.entries(SHAPES))
      (complainAbout(`closed-${name}`, value).message === null ? silent : reported).push(name);
    assert.deepEqual(silent.sort(), ['bigint', 'boolean', 'number', 'string', 'url'],
      'the accepted set is a named list — a new member is a reviewed row, never a widened predicate');
    assert.ok(reported.length > 0, 'NON-ZERO CONTROL: nothing reported means the instrument is dead');
  });

test('each complaint names what the value would BECOME, and what to write instead',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    assert.match(complainAbout('says-fn', SHAPES.fn).message, /its own SOURCE TEXT/);
    assert.match(complainAbout('says-array', SHAPES.array).message, /joined by commas/);
    assert.match(complainAbout('says-date', SHAPES.date).message, /TIMEZONE/,
      'a Date is an SSR/CSR divergence, not merely a bad string');
    assert.match(complainAbout('says-symbol', SHAPES.symbol).message, /every DOM conversion refuses/);
    /** A refusal that does not name the alternative leaves the author where they started. */
    for (const name of ['fn', 'array', 'date', 'object'])
      assert.match(complainAbout(`alt-${name}`, SHAPES[name]).message, /bind a property instead/, name);
  });

test('the same kind is reported once per binding — but a different kind still speaks',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    assert.notEqual(complainAbout('dedup', {}).message, null, 'first time: reported');
    assert.equal(complainAbout('dedup', {}).message, null, 'second time: quiet');
    /**
     * `Date`, `Array` and `{}` are all `typeof 'object'`, so a key of that granularity reported
     * whichever arrived first and silently swallowed the rest — an author who fixed the Date would
     * never have been told about the array. Keyed by brand instead.
     */
    assert.notEqual(complainAbout('dedup', [1]).message, null, 'an array is a different complaint');
    assert.notEqual(complainAbout('dedup', new Date(0)).message, null, 'and so is a Date');
  });

/**
 * **A boolean in a CHILD position is the other half of "a value nobody meant to interpolate."**
 *
 * `${cond && html`…`}` with a false `cond` puts the word "false" on the page. The value is
 * legitimate, nothing throws, and `@verajs/renderer` renders it deliberately — lit does the same,
 * and templates are lit-shaped on purpose. So the behaviour stays and the MISTAKE is named, which
 * is the only channel left when the author's intent and the language's answer disagree.
 *
 * It carries a second job: `@verajs/jsx` compiles a boolean child away (React's rule, where React
 * expectations live), so this is the one value semantic on which JSX and a hand-written template
 * differ — and this warning is what meets someone who pastes JSX-shaped code into a template.
 */
const childComplaint = (value) => {
  const host = doc.createElement('div');
  const real = console.warn;
  const seen = [];
  console.warn = (message) => seen.push(String(message));
  try {
    renderInto({ ['_$litType$']: 1, strings: Object.assign(['<p>', '</p>'], { raw: [] }), values: [value] }, host);
  } finally {
    console.warn = real;
  }
  return { text: host.textContent, message: seen.find((m) => m.includes('child position')) ?? null };
};

test('a boolean child still renders, and development says so',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    const off = childComplaint(false);
    assert.equal(off.text, 'false', 'the behaviour is unchanged — lit parity is the point');
    assert.match(off.message, /cond && /, 'and the message names the idiom that produced it');
    assert.match(off.message, /cond \? … : null/, 'and the fix');

    assert.equal(childComplaint(true).text, 'true', '`true` renders too');
    assert.notEqual(childComplaint(true).message, null, 'and is named for the same reason');

    /** The values that legitimately render nothing must stay silent, or the channel is noise. */
    for (const quiet of [null, undefined, 0, '', 'text'])
      assert.equal(childComplaint(quiet).message, null, `${JSON.stringify(quiet)} is not a complaint`);
  });

/**
 * **Once per distinct value, not once per render.** Both child sinks gate the report on the value
 * CHANGING. `ChildPart`'s dirty check sits below the branch this is reported from, so calling it
 * above spammed a warning every pass for an unchanged `false` — measured at four renders, four
 * warnings — while its own comment claimed otherwise. A channel that repeats is as useless as one
 * that stays quiet, and the same rule that forbids over-deduping forbids this.
 */
test('the same boolean is reported once, and a different one still speaks',
  { skip: isProduction && 'diagnostics are folded away', concurrency: false }, () => {
    const host = doc.createElement('div');
    const real = console.warn;
    const seen = [];
    console.warn = (message) => seen.push(String(message));
    /**
     * ONE `strings` array, hoisted. Template identity is that array, so building a fresh one per
     * call makes every render a rebuild rather than an update — a new part each time, reporting
     * each time, which looks exactly like the spam this test is here to catch. The repo's oldest
     * probe rule, and it caught this test before this test caught anything.
     */
    const strings = Object.assign(['<p>', '</p>'], { raw: [] });
    const draw = (value) => renderInto({ ['_$litType$']: 1, strings, values: [value] }, host);
    try {
      draw(false);
      draw(false);
      draw(false);
      assert.equal(seen.length, 1, 'three identical commits report once');
      draw(true);
      assert.equal(seen.length, 2, 'but a different boolean is its own observation');
    } finally {
      console.warn = real;
    }
  });

test('production carries neither the check nor the message',
  { skip: !isProduction && 'this is the production half' }, () => {
    const off = childComplaint(false);
    assert.equal(off.text, 'false', 'behaviour is identical in both builds');
    assert.equal(off.message, null, 'and the diagnostic is folded away');
  });
