/**
 * The properties that exist only on some elements, and reach the markup.
 *
 * The server DOM carried only the members every element shares, so `button.disabled = true` set a
 * plain JavaScript property: it read back `true`, wrote no attribute, and **rendered a button that
 * was not disabled**. `input.value`, `input.checked` and `option.selected` were lost the same way,
 * and reading any of them before writing answered `undefined` where a browser answers `''` or
 * `false` — so `input.value.trim()` threw on the server and worked in the client.
 *
 * The markup is the half that matters: a control that must not be interactive shipped interactive,
 * and stayed that way until the bundle landed. Nothing failed, which is why it lasted.
 *
 * The table itself is measured from Chromium, Firefox and WebKit rather than written from memory
 * (`packages/ssr/src/vera/reflections.js`), and `tests/browser/element-reflections.test.js` fails if
 * it and a real engine ever disagree. This suite covers what the table is *for*.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import '@verajs/ssr';
const make = (tag) => globalThis.document.createElement(tag);
const parse = (markup) => {
  const host = make('div');
  host.innerHTML = markup;
  return host.firstElementChild;
};

test('a property only some elements have exists only on those elements', () => {
  assert.equal('disabled' in make('button'), true);
  assert.equal('disabled' in make('input'), true);
  /** An element answering for members its interface does not have is the same lie as one missing
   * the members it does — a `<p>` has no `disabled`, and `'disabled' in p` must stay false. */
  assert.equal('disabled' in make('p'), false);
  assert.equal('href' in make('a'), true);
  assert.equal('href' in make('span'), false);
  assert.equal('colSpan' in make('td'), true);
  assert.equal('colSpan' in make('div'), false);
});

test('setting a boolean property writes the attribute, so it reaches the markup', () => {
  for (const [tag, property, attribute] of [
    ['button', 'disabled', 'disabled'],
    ['input', 'required', 'required'],
    ['input', 'readOnly', 'readonly'],
    ['select', 'multiple', 'multiple'],
    ['textarea', 'disabled', 'disabled'],
    ['option', 'disabled', 'disabled'],
    ['fieldset', 'disabled', 'disabled'],
    ['details', 'open', 'open'],
    ['script', 'defer', 'defer'],
    ['ol', 'reversed', 'reversed'],
  ]) {
    const element = make(tag);
    assert.equal(element[property], false, `${tag}.${property} with the attribute absent`);
    element[property] = true;
    assert.equal(element.getAttribute(attribute), '', `${tag}.${property} = true wrote no ${attribute}`);
    assert.equal(element[property], true);
    assert.match(element.outerHTML, new RegExp(`\\b${attribute}\\b`), `${tag}.${property} never reached the markup`);
    element[property] = false;
    assert.equal(element.hasAttribute(attribute), false, `${tag}.${property} = false left the attribute`);
  }
});

test('a string property answers the attribute, and an empty string when it is absent', () => {
  for (const [tag, property, attribute] of [
    ['input', 'placeholder', 'placeholder'],
    ['input', 'name', 'name'],
    ['a', 'href', 'href'],
    ['img', 'src', 'src'],
    ['img', 'alt', 'alt'],
    ['label', 'htmlFor', 'for'],
    ['option', 'label', 'label'],
  ]) {
    const element = make(tag);
    assert.equal(element[property], '', `${tag}.${property} with the attribute absent`);
    element[property] = 'x';
    assert.equal(element.getAttribute(attribute), 'x');
    /** Closed explicitly for anything that is not void — the parser declines markup that would need
     * error recovery, which is its documented contract and not a gap to work around here. */
    const markup = ['input', 'img'].includes(tag) ? `<${tag} ${attribute}="y">` : `<${tag} ${attribute}="y"></${tag}>`;
    assert.equal(parse(markup)[property], 'y', `${tag}.${property} read from markup`);
  }
});

test('a numeric property parses the attribute and defaults where a browser does', () => {
  assert.equal(make('textarea').rows, 2);
  assert.equal(make('textarea').cols, 20);
  assert.equal(make('input').maxLength, -1);
  assert.equal(make('td').colSpan, 1);
  const cell = make('td');
  cell.colSpan = 3;
  assert.equal(cell.getAttribute('colspan'), '3');
  assert.equal(parse('<td colspan="4">').colSpan, 4);
  /** A browser answers the default for anything it cannot parse, not `NaN`. */
  assert.equal(parse('<td colspan="wat">').colSpan, 1);
});

test('an enumerated property answers a state, not the attribute text', () => {
  assert.equal(make('input').type, 'text');
  assert.equal(parse('<input type="CHECKBOX">').type, 'checkbox', 'states are case-insensitive');
  assert.equal(parse('<input type="bogus">').type, 'text', 'an unknown state answers the default');
  /** And the markup keeps what was written, exactly as every engine does. */
  assert.equal(parse('<input type="bogus">').getAttribute('type'), 'bogus');
  assert.equal(make('button').type, 'submit');
  assert.equal(make('form').method, 'get');
  assert.equal(make('th').scope, '');
  assert.equal(parse('<th scope="col">').scope, 'col');
});

test('form state is mirrored to the markup, because on a server the markup is the whole output', () => {
  /** A browser keeps these off the markup deliberately (the "dirty value"), which would mean losing
   * them entirely here. `serializer.js` already mirrors the same three for template bindings; this
   * is that rule applied to a property assignment, so the two ways of writing it agree. */
  const text = make('input');
  assert.equal(text.value, '', 'an untouched input reads "" and not undefined');
  text.value = 'typed';
  assert.equal(text.getAttribute('value'), 'typed');
  assert.match(text.outerHTML, /value="typed"/);

  const box = make('input');
  assert.equal(box.checked, false);
  box.checked = true;
  assert.match(box.outerHTML, /\bchecked\b/);

  const area = make('textarea');
  assert.equal(area.value, '', 'a textarea reads its content');
  area.value = 'body';
  assert.equal(area.textContent, 'body', 'a textarea has no value attribute — its value is content');
  assert.match(area.outerHTML, />body</);
  assert.equal(parse('<textarea>seed</textarea>').value, 'seed');

  const option = make('option');
  assert.equal(option.selected, false);
  option.selected = true;
  assert.match(option.outerHTML, /\bselected\b/);
});

test('a select is served as the option that is selected', () => {
  const select = parse('<select><option value="a">A</option><option value="b">B</option></select>');
  assert.equal(select.value, 'a', 'with nothing selected a browser takes the first');
  select.value = 'b';
  assert.match(select.outerHTML, /<option value="b" selected/);
  assert.equal(select.value, 'b');
  assert.doesNotMatch(select.outerHTML.split('value="b"')[0], /selected/, 'the other option was cleared');
  assert.equal(parse('<select><option>x</option><option selected>y</option></select>').value, 'y');
});

test('the layer survives parsing and cloning, not only createElement', () => {
  /** Elements arrive three ways — created, parsed out of markup, and cloned — and a layer that only
   * covers the first is worse than none, because it works in the test and not on the page. */
  const parsed = parse('<input required>');
  assert.equal(parsed.required, true);
  const clone = parsed.cloneNode(true);
  assert.equal(clone.required, true, 'a clone lost its interface');
  clone.disabled = true;
  assert.match(clone.outerHTML, /\bdisabled\b/);
});

test('an unknown or custom tag is left alone', () => {
  const custom = make('my-widget');
  assert.equal('disabled' in custom, false);
  custom.disabled = true;
  assert.equal(custom.hasAttribute('disabled'), false, 'a plain property, as it is in a browser');
});
