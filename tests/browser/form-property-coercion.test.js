/**
 * How a form property coerces what it is assigned — which the server has to reproduce in markup.
 *
 * `value` is not an ordinary DOMString attribute. Its IDL carries `[LegacyNullToEmptyString]`, so
 * `null` becomes `''` while `undefined` goes through the ordinary ToString and becomes the **text
 * `"undefined"`**. Those two are the same thing to a `== null` test, and `@verajs/ssr` used one for
 * both — so the server served an empty control where the client shows the word `undefined`.
 *
 * That distinction is the platform's, not jsdom's, so it is asserted here first and the node parity
 * suite rests on it.
 */
import { expect } from '@esm-bundle/chai';

it('value is LegacyNullToEmptyString: null empties it, undefined does not', () => {
  for (const tag of ['input', 'textarea']) {
    const element = document.createElement(tag);
    element.value = null;
    expect(element.value, `${tag}: null`).to.equal('');
    element.value = undefined;
    expect(element.value, `${tag}: undefined`).to.equal('undefined');
  }
});

it('and a boolean assigned to value is its text, on both elements', () => {
  for (const tag of ['input', 'textarea']) {
    const element = document.createElement(tag);
    element.value = true;
    expect(element.value, `${tag}: true`).to.equal('true');
    element.value = false;
    expect(element.value, `${tag}: false`).to.equal('false');
  }
});

/**
 * `<option>` and `<select>` are the other two elements whose `value` the server writes, and they do
 * not share `<input>`'s IDL. `option.value` reflects the attribute with a fallback to the element's
 * text; `select.value` selects an option and is not a reflected attribute at all — writing one into
 * markup for it means nothing. Recorded so the serializer's rule is chosen from behaviour rather
 * than from the assumption that four elements named `value` all mean the same thing.
 */
it('option and select do not share input\'s value IDL', () => {
  const option = document.createElement('option');
  option.value = null;
  expect(option.value, 'option: null').to.equal('null');
  option.value = undefined;
  expect(option.value, 'option: undefined').to.equal('undefined');
  option.value = true;
  expect(option.value, 'option: true').to.equal('true');

  const select = document.createElement('select');
  select.value = 'x';
  expect(select.getAttribute('value'), 'select: value is not reflected').to.equal(null);
});

/**
 * `checked` is a plain boolean IDL attribute, so it takes truthiness and none of the above applies —
 * which is why the two are handled by different branches in the serializer.
 */
it('checked is an ordinary boolean, taking truthiness', () => {
  const element = document.createElement('input');
  element.type = 'checkbox';
  element.checked = 'anything';
  expect(element.checked).to.equal(true);
  element.checked = 0;
  expect(element.checked).to.equal(false);
});
