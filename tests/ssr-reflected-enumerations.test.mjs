/**
 * The SSR shim against the enumerated-reflection rule the engines actually follow.
 *
 * These are the members jsdom does not implement, so the generated differential next door skips all
 * of them — it counted 60 such members and had never compared any of them to anything. That is the
 * gap this file closes: an enumerated property answers a *state*, not the attribute's text, and the
 * shim returned the text for every one.
 *
 * The rule is measured, not assumed — `tests/browser/reflected-enumerations.test.js` records it on
 * Chromium, Firefox and WebKit, and this asserts the same answers here. Markup is unaffected either
 * way (the attribute is stored verbatim, which is what the engines do too), so the only thing this
 * changes is what a component *reads* on the server — which is precisely the kind of divergence
 * that shows up later as a hydration mismatch with nothing left to explain it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@verajs/ssr';

const withAttribute = (attribute, value) => {
  const element = document.createElement('div');
  element.setAttribute(attribute, value);
  return element;
};

const CASES = [
  ['inputMode', 'inputmode', '', '', 'numeric'],
  ['enterKeyHint', 'enterkeyhint', '', '', 'go'],
  ['autocapitalize', 'autocapitalize', '', 'sentences', 'words'],
  ['popover', 'popover', null, 'manual', 'auto'],
  ['writingSuggestions', 'writingsuggestions', 'true', 'true', 'false'],
  ['virtualKeyboardPolicy', 'virtualkeyboardpolicy', '', '', 'manual'],
];

test('an enumerated reflection answers a state rather than the attribute text', () => {
  for (const [property, attribute, missing, invalid, valid] of CASES) {
    assert.equal(document.createElement('div')[property], missing, `${property}: absent`);
    assert.equal(withAttribute(attribute, 'bogus')[property], invalid, `${property}: an unknown value`);
    assert.equal(withAttribute(attribute, valid)[property], valid, `${property}: a known value`);
    assert.equal(withAttribute(attribute, valid.toUpperCase())[property], valid, `${property}: upper case`);
  }
});

/**
 * **`spellcheck` and `autocorrect` are deliberately not in that list.** The engines genuinely
 * disagree — an invalid `spellcheck` reads `true` in Chromium and WebKit and `false` in Firefox,
 * and `autocorrect` is absent in Chromium and a boolean in the other two. There is no single answer
 * to match, so the shim keeps its own and this records why rather than leaving it to be
 * rediscovered as a gap.
 */
test('leaves the two the engines disagree about alone', () => {
  assert.equal(typeof document.createElement('div').spellcheck, 'boolean', 'spellcheck stays a boolean');
  assert.ok('autocorrect' in document.createElement('div'), 'autocorrect stays present');
});

test('validates what is assigned to contentEditable', () => {
  const set = (value) => {
    const element = document.createElement('div');
    element.contentEditable = value;
    return [element.getAttribute('contenteditable'), element.contentEditable];
  };
  assert.deepEqual(set('true'), ['true', 'true']);
  assert.deepEqual(set('false'), ['false', 'false']);
  assert.deepEqual(set('plaintext-only'), ['plaintext-only', 'plaintext-only']);
  assert.deepEqual(set('TRUE'), ['true', 'true'], 'it lowercases what it accepts');
  assert.deepEqual(set('inherit'), [null, 'inherit'], 'inherit removes the attribute');

  for (const bad of ['', 'bogus'])
    assert.throws(() => { document.createElement('div').contentEditable = bad; },
      (error) => error.name === 'SyntaxError', `assigning ${JSON.stringify(bad)} must throw`);

  assert.equal(document.createElement('div').contentEditable, 'inherit', 'absent');
  assert.equal(withAttribute('contenteditable', '').contentEditable, 'true', 'an empty attribute is true');
  assert.equal(withAttribute('contenteditable', 'bogus').contentEditable, 'inherit', 'an unknown value');
});

/**
 * `part` and `classList` are declared `[PutForwards=value]`, so assigning to them is a legal
 * operation in every engine. Both were getter-only here, which made a `TypeError` out of something
 * the browser performs — the same failure as being too permissive, with the direction reversed.
 */
test('accepts an assignment to part and classList', () => {
  const a = document.createElement('div');
  a.part = 'a b';
  assert.equal(a.getAttribute('part'), 'a b');
  assert.equal(a.part.length, 2, 'and it stays a token list');

  const b = document.createElement('div');
  b.classList = 'a b';
  assert.equal(b.getAttribute('class'), 'a b');
  assert.equal(b.classList.length, 2, 'and it stays a token list');

  /** And the markup carries what was assigned, which is the point of doing it on a server. */
  assert.match(a.openTag(), /part="a b"/);
});
