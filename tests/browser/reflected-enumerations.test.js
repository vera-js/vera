/**
 * What an enumerated reflection answers, in the engines that decide it.
 *
 * These properties do not hand back the attribute's text: `inputmode="bogus"` reads as `''`, and an
 * *absent* attribute has its own answer which is frequently a different one again — `autocapitalize`
 * is `''` when missing and `'sentences'` when invalid. jsdom implements almost none of them, so the
 * SSR shim had never been compared against anything here and returned the raw text for all of them.
 *
 * Recorded rather than read off a spec, because that is how the attribute-*name* rule next door got
 * assumed wrong (see `spread-names.test.js`). Every expectation below was measured on Chromium,
 * Firefox and WebKit first; `tests/ssr-reflected-enumerations.test.mjs` asserts the shim agrees.
 */
import { expect } from '@esm-bundle/chai';

/** Absent in some engines — a member an engine does not implement cannot be evidence about it. */
const has = (property) => property in document.createElement('div');
const withAttribute = (attribute, value) => {
  const element = document.createElement('div');
  element.setAttribute(attribute, value);
  return element;
};

const CASES = [
  ['inputMode', 'inputmode', { missing: '', invalid: '', valid: ['numeric', 'numeric'] }],
  ['enterKeyHint', 'enterkeyhint', { missing: '', invalid: '', valid: ['go', 'go'] }],
  ['autocapitalize', 'autocapitalize', { missing: '', invalid: 'sentences', valid: ['words', 'words'] }],
  ['popover', 'popover', { missing: null, invalid: 'manual', valid: ['auto', 'auto'] }],
  ['writingSuggestions', 'writingsuggestions', { missing: 'true', invalid: 'true', valid: ['false', 'false'] }],
  ['virtualKeyboardPolicy', 'virtualkeyboardpolicy', { missing: '', invalid: '', valid: ['manual', 'manual'] }],
];

it('answers a state rather than the attribute text', () => {
  let checked = 0;
  for (const [property, attribute, rule] of CASES) {
    if (!has(property)) continue;
    checked++;
    expect(document.createElement('div')[property], `${property}: absent`).to.equal(rule.missing);
    expect(withAttribute(attribute, 'bogus')[property], `${property}: an unknown value`).to.equal(rule.invalid);
    expect(withAttribute(attribute, rule.valid[0])[property], `${property}: a known value`).to.equal(rule.valid[1]);
    /** Enumerated attributes are ASCII case-insensitive, and the answer is canonical. */
    expect(withAttribute(attribute, rule.valid[0].toUpperCase())[property], `${property}: upper case`)
      .to.equal(rule.valid[1]);
  }
  expect(checked, 'this engine implements none of them, so it proves nothing').to.be.greaterThan(2);
});

/**
 * `contentEditable` is the only one whose *setter* validates, and `'inherit'` is a removal rather
 * than a value to write.
 */
it('validates what is assigned to contentEditable', () => {
  const set = (value) => {
    const element = document.createElement('div');
    element.contentEditable = value;
    return [element.getAttribute('contenteditable'), element.contentEditable];
  };
  expect(set('true'), 'true').to.deep.equal(['true', 'true']);
  expect(set('false'), 'false').to.deep.equal(['false', 'false']);
  expect(set('plaintext-only'), 'plaintext-only').to.deep.equal(['plaintext-only', 'plaintext-only']);
  expect(set('TRUE'), 'it lowercases what it accepts').to.deep.equal(['true', 'true']);
  expect(set('inherit'), 'inherit removes the attribute').to.deep.equal([null, 'inherit']);

  for (const bad of ['', 'bogus']) {
    let name;
    try { document.createElement('div').contentEditable = bad; } catch (error) { name = error.name; }
    expect(name, `assigning ${JSON.stringify(bad)} throws`).to.equal('SyntaxError');
  }

  expect(document.createElement('div').contentEditable, 'absent').to.equal('inherit');
  expect(withAttribute('contenteditable', '').contentEditable, 'an empty attribute is true').to.equal('true');
  expect(withAttribute('contenteditable', 'bogus').contentEditable, 'an unknown value').to.equal('inherit');
});

/** `part` and `classList` are `[PutForwards=value]`, so assigning to them writes the attribute. */
it('accepts an assignment to part and classList', () => {
  const a = document.createElement('div');
  a.part = 'a b';
  expect(a.getAttribute('part'), 'part').to.equal('a b');
  expect(a.part.length, 'and it stays a token list').to.equal(2);

  const b = document.createElement('div');
  b.classList = 'a b';
  expect(b.getAttribute('class'), 'classList').to.equal('a b');
  expect(b.classList.length, 'and it stays a token list').to.equal(2);
});
