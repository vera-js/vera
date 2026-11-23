/**
 * **The server's DOM keeps in a name what every engine keeps** (2026-11-23). Chromium, Firefox and WebKit accept VT,
 * the other C0 controls and DEL in `createElement` and `setAttribute` names, and refuse the parser's whitespace (tab,
 * LF, FF, CR, space) and NUL; this DOM refused every control, so a component doing it worked in a browser and threw on
 * the server. The names that survive serialize as given and read back as one name (jsdom applies the older XML rule
 * here, so the engines' side is `tests/browser/ssr-element-names.test.js`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const parser = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');

const KEPT = ['a\vb', 'a\x01b', 'a\x1fb', 'a\x7fb'];
const REFUSED = ['a\tb', 'a\nb', 'a\fb', 'a\rb', 'a b', 'a\0b'];
const answer = (make) => {
  try {
    make();
    return 'ok';
  } catch (error) {
    return error.name;
  }
};

test('setAttribute and createElement keep VT, the other controls and DEL, and refuse whitespace and NUL', () => {
  for (const name of KEPT) {
    assert.equal(answer(() => document.createElement('div').setAttribute(name, '1')), 'ok', `attribute ${JSON.stringify(name)}`);
    assert.equal(answer(() => document.createElement(name)), 'ok', `element ${JSON.stringify(name)}`);
  }
  for (const name of REFUSED) {
    assert.equal(answer(() => document.createElement('div').setAttribute(name, '1')), 'InvalidCharacterError', `attribute ${JSON.stringify(name)}`);
    assert.equal(answer(() => document.createElement(name)), 'InvalidCharacterError', `element ${JSON.stringify(name)}`);
  }
});

test('a kept name is served whole: a parser reads one attribute by that name', () => {
  for (const name of KEPT) {
    const element = document.createElement('p');
    element.setAttribute(name, 'v');
    const holder = parser.createElement('div');
    holder.innerHTML = element.outerHTML;
    const read = holder.firstElementChild;
    assert.equal(read.attributes.length, 1, `${JSON.stringify(name)}: ${element.outerHTML}`);
    assert.equal(read.attributes[0].name, name, JSON.stringify(name));
    assert.equal(read.attributes[0].value, 'v');
  }
});
