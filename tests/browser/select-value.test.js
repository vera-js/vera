/**
 * What `select.value` actually means, so the server can reproduce it in markup.
 *
 * A `<select>` has no `value` content attribute — assigning the property *selects an option*. To
 * serve a pre-selected control the server has to mark the matching `<option selected>`, which is
 * what React's server renderer does and what `@verajs/ssr` now does. Every rule that decides which
 * option matches is the platform's, so it is established here and the node parity suite rests on it.
 */
import { expect } from '@esm-bundle/chai';

const select = (markup) => {
  const host = document.createElement('div');
  host.innerHTML = `<select>${markup}</select>`;
  document.body.appendChild(host);
  return host.querySelector('select');
};

it('an option with no value attribute falls back to its text', () => {
  const element = select('<option>Alpha</option><option value="b">Beta</option>');
  expect(element.options[0].value).to.equal('Alpha');
  element.value = 'Alpha';
  expect(element.selectedIndex, 'matching by the text fallback').to.equal(0);
});

it('and that fallback strips and collapses whitespace', () => {
  const element = select('<option>  Alpha   Beta  </option>');
  expect(element.options[0].value).to.equal('Alpha Beta');
});

it('a select with nothing marked selects its first option', () => {
  const element = select('<option value="a">A</option><option value="b">B</option>');
  expect(element.selectedIndex).to.equal(0);
  expect(element.value).to.equal('a');
});

it('assigning a value that matches nothing selects nothing at all', () => {
  const element = select('<option value="a">A</option><option value="b">B</option>');
  element.value = 'zzz';
  expect(element.selectedIndex, 'no option matches, so none is selected').to.equal(-1);
  expect(element.value).to.equal('');
});

it('and markup cannot express that: a select with no selected option takes the first', () => {
  const element = select('<option value="a">A</option><option value="b">B</option>');
  expect(element.selectedIndex, 'which is why the no-match case is a documented divergence').to.equal(0);
});

it('when several options share a value the first wins', () => {
  const element = select('<option value="a">A</option><option value="a">A again</option>');
  element.value = 'a';
  expect(element.selectedIndex).to.equal(0);
});

it('a disabled option is still selectable by assignment', () => {
  const element = select('<option value="a">A</option><option value="b" disabled>B</option>');
  element.value = 'b';
  expect(element.selectedIndex).to.equal(1);
});
