/**
 * **The server's DOM names elements as each engine does** (2026-11-23). `createElement` refuses a name whose first
 * character is not an ASCII letter unless it is `:`, `_` or a character from U+0080 followed only by ASCII letters and
 * digits, `-`, `.`, `:`, `_` and characters from U+0080, and accepts the rest by the relaxed rule. The server's answers
 * come from `scripts/build-hydration-fixture.mjs` (`--check`ed in the gate); jsdom still applies the older XML rule to
 * `·a`, `a!` and the controls, so only an engine can judge those. Attribute names likewise: an engine keeps VT, the
 * other controls and DEL in a name and refuses the parser's whitespace and NUL (2026-11-23).
 */
import { expect } from '@esm-bundle/chai';
import { ELEMENT_NAMES } from './fixtures/hello-ssr.html.js';

it('createElement accepts and refuses the names the server accepts and refuses', () => {
  const ours = ELEMENT_NAMES.names.map((name) => {
    try {
      return document.createElement(name).localName;
    } catch (error) {
      return `THREW ${error.name}`;
    }
  });
  expect(ours.filter((answer) => answer.startsWith('THREW')).length).to.be.above(3, 'CONTROL: some names are refused');
  expect(JSON.stringify(ours)).to.equal(JSON.stringify(ELEMENT_NAMES.served));
});

it('setAttribute accepts and refuses the names the server accepts and refuses: controls and DEL are kept', () => {
  const ours = ELEMENT_NAMES.attributes.map((name) => {
    try {
      document.createElement('div').setAttribute(name, '1');
      return 'ok';
    } catch (error) {
      return `THREW ${error.name}`;
    }
  });
  expect(ours.filter((answer) => answer === 'ok').length).to.be.above(2, 'CONTROL: some names are accepted');
  expect(JSON.stringify(ours)).to.equal(JSON.stringify(ELEMENT_NAMES.servedAttributes));
});
