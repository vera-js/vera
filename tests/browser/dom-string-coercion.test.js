/**
 * What the engines do when a DOM string is handed a symbol.
 *
 * The SSR shim is a DOM implementation, so it has to refuse what the platform refuses — and jsdom
 * is not a good enough stand-in to decide that on its own (see `spread-names.test.js`, where jsdom
 * refuses about fifty attribute names every real engine accepts). This one is a WebIDL `DOMString`
 * conversion rather than a name-validity rule, so the answer should be uniform, but "should be" is
 * how that other rule got assumed wrong. Measured here across Chromium, Firefox and WebKit; the
 * node suite asserts the shim gives the same answers.
 */
import { expect } from '@esm-bundle/chai';

const symbol = Symbol('s');

it('refuses a symbol wherever a DOM string is expected', () => {
  const refused = [];
  const attempt = (label, fn) => {
    try {
      fn(document.createElement('div'));
    } catch (error) {
      refused.push([label, error.constructor.name]);
    }
  };

  attempt('setAttribute value', (el) => el.setAttribute('a', symbol));
  attempt('setAttribute name', (el) => el.setAttribute(symbol, 'v'));
  attempt('getAttribute name', (el) => el.getAttribute(symbol));
  attempt('hasAttribute name', (el) => el.hasAttribute(symbol));
  attempt('removeAttribute name', (el) => el.removeAttribute(symbol));
  attempt('toggleAttribute name', (el) => el.toggleAttribute(symbol, true));
  attempt('setAttributeNS value', (el) => el.setAttributeNS(null, 'a', symbol));
  attempt('className', (el) => { el.className = symbol; });
  attempt('id', (el) => { el.id = symbol; });
  attempt('textContent', (el) => { el.textContent = symbol; });
  attempt('createElement', () => document.createElement(symbol));

  expect(refused.map(([label]) => label), 'every one of them refuses').to.deep.equal([
    'setAttribute value', 'setAttribute name', 'getAttribute name', 'hasAttribute name',
    'removeAttribute name', 'toggleAttribute name', 'setAttributeNS value', 'className', 'id',
    'textContent', 'createElement',
  ]);
  expect([...new Set(refused.map(([, kind]) => kind))], 'and all with a TypeError').to.deep.equal(['TypeError']);
});

/** `insertAdjacentHTML` with a position it does not know is a DOMException, not a plain Error. */
it('rejects an unknown insertAdjacentHTML position with a DOMException', () => {
  const element = document.createElement('div');
  let caught;
  try {
    element.insertAdjacentHTML('nowhere', '<b></b>');
  } catch (error) {
    caught = error;
  }
  expect(Boolean(caught), 'it throws').to.equal(true);
  expect(caught.constructor.name, 'the kind of error').to.equal('DOMException');
  expect(caught.name, 'and its name').to.equal('SyntaxError');
});
