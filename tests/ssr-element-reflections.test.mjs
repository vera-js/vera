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

/**
 * **A numeric property converts before it writes.**
 *
 * The platform applies the WebIDL conversion for the property's type at *assignment* and writes the
 * **converted** number to the attribute, not what the caller passed. This wrote the value verbatim, so
 * `element.width = 3.9` produced `width="3.9"` on the server where the client writes `width="3"` — a
 * hydration mismatch from ordinary code, since a fractional dimension is what arithmetic produces.
 *
 * Every expectation below is **measured in Chromium**, not derived. That distinction has already paid
 * twice in this area: `area.shape` came to answer the probe value used to measure it because a row was
 * reasoned about rather than measured, and an earlier draft of this very test asserted
 * `iframe.width = 'probe'` writes `"0"` — recalled, and wrong, because `iframe.width` is a `DOMString`
 * reflection that echoes.
 *
 * **What is deliberately not covered**: the per-property handling of a *negative* value. Eleven of
 * these properties clamp it to 0, six to 1, four refuse it, two allow it, and `canvas` and
 * `input.size` substitute an element default. Encoding that means thirty-one hand-classified rows in
 * a table whose hand-classified rows are what produced Defect 49. A negative width is already a
 * caller's mistake; a fractional one is not. The measured table is in the audit if that trade is worth
 * revisiting.
 */
test('a numeric reflection writes the converted number, not the value it was given', () => {
  /** `[tag, property, attribute, written, the attribute Chromium writes]` */
  const MEASURED = [
    ['img', 'width', 'width', 3.9, '3'],
    ['img', 'width', 'width', 'probe', '0'],
    ['img', 'width', 'width', '', '0'],
    ['img', 'height', 'height', 7, '7'],
    ['td', 'colSpan', 'colspan', 3.9, '3'],
    ['canvas', 'width', 'width', 'probe', '0'],
    ['input', 'maxLength', 'maxlength', 3.9, '3'],
    ['ol', 'start', 'start', 3.9, '3'],
    ['select', 'size', 'size', 'probe', '0'],
    ['textarea', 'rows', 'rows', 3.9, '3'],
  ];

  for (const [tag, property, attribute, written, expected] of MEASURED) {
    const element = document.createElement(tag);
    element[property] = written;
    assert.equal(
      element.getAttribute(attribute),
      expected,
      `<${tag}>.${property} = ${JSON.stringify(written)} wrote ${JSON.stringify(element.getAttribute(attribute))}; Chromium writes ${JSON.stringify(expected)}`
    );
  }
});

/**
 * And the properties that only *look* numeric. `iframe.width`, `embed.width`, `object.width` and
 * `table.width` are `DOMString` reflections in IDL — measured in Chromium, they echo what is written.
 * Applying the numeric conversion to them would be a regression, so both directions are pinned.
 */
test('a string reflection that looks numeric still echoes what it was given', () => {
  /**
   * `table` is **not** in this list, and not because it behaves differently: it is absent from the
   * reflections table entirely, because `table` is absent from the tag list
   * `scripts/measure-element-reflections.mjs` measures. `table.width = 'probe'` therefore lands as a
   * plain JavaScript property and writes no attribute at all, where Chromium reflects it. Recorded in
   * the audit with the other per-tag members that are neither implemented nor listed out of scope.
   */
  for (const tag of ['iframe', 'embed', 'object']) {
    const element = document.createElement(tag);
    element.width = 'probe';
    assert.equal(
      element.getAttribute('width'),
      'probe',
      `<${tag}>.width is a DOMString reflection and should echo; the numeric conversion has been over-applied`
    );
  }
});
