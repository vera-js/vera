/**
 * **The oracle the light-DOM parity suites are measured against, pinned in real engines.**
 *
 * `tests/slots-transition-parity.test.mjs` and its siblings assert that light-DOM slots behave as
 * a shadow root does — and they ask jsdom what a shadow root does, because they run under jsdom.
 * That makes jsdom the oracle for slot ASSIGNMENT, which is a thing the platform decides, and
 * `CLAUDE.md` is explicit that jsdom is the regression net and never the oracle for those
 * (`spread-names.test.js` records what taking its word on attribute-name validity cost).
 *
 * So this file asserts the same answers here, on Chromium, Firefox and WebKit. Together the two
 * halves close the loop: the node suites prove `light === jsdom's shadow`, this proves
 * `jsdom's shadow === every real engine's shadow`, and the parity claim survives the composition.
 * If an engine ever disagrees, this fails while the node suites stay green — which is exactly the
 * shape of report that tells you the oracle moved rather than the feature.
 *
 * Measured 2026-09-09: all four agree on every case below, so the week's parity work stands.
 * The cases are the ones the light-DOM implementation actually had to answer, including the two
 * counter-intuitive ones — an EMPTY text node suppresses the fallback, and a comment does not —
 * which are the platform's own gotchas that light DOM inherits rather than invents.
 */
import { expect } from '@esm-bundle/chai';

customElements.define(
  'oracle-card',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<div class="box"><slot>FB</slot></div>';
    }
  }
);

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const host = () => {
  const el = document.createElement('oracle-card');
  document.body.appendChild(el);
  made.push(el);
  return el;
};
/** What the default slot is given, in flat-tree order. */
const assigned = (el) =>
  el.shadowRoot
    .querySelector('slot')
    .assignedNodes()
    .map((n) => (n.nodeType === 3 ? `"${n.data}"` : `<${n.localName}>`))
    .join(',') || 'FALLBACK';

it('assigns by document order, not by arrival order', () => {
  const el = host();
  el.append(document.createTextNode('A'));
  el.insertBefore(document.createTextNode('NEW'), el.firstChild);
  expect(assigned(el)).to.equal('"NEW","A"');
});

it('appends at the tail', () => {
  const el = host();
  el.append(document.createTextNode('A'));
  el.append(document.createTextNode('NEW'));
  expect(assigned(el)).to.equal('"A","NEW"');
});

it('takes bare text with no attribute, and a slot="" element beside it', () => {
  const el = host();
  const named = document.createElement('i');
  named.setAttribute('slot', '');
  el.append(document.createTextNode('A'), named);
  expect(assigned(el)).to.equal('"A",<i>');
});

it('takes a node the component appended to ITSELF', () => {
  const el = host();
  el.appendChild(document.createElement('canvas'));
  expect(assigned(el), 'a light child is a light child, whoever added it').to.equal('<canvas>');
});

/**
 * The two the light implementation had to match deliberately rather than by accident: an empty or
 * whitespace-only text node IS a slottable and therefore suppresses the fallback, while a comment
 * is not one and leaves it showing. Getting the first wrong makes fallbacks vanish; getting the
 * second wrong makes every framework marker into slot content.
 */
it('an empty or whitespace text node suppresses the fallback; a comment does not', () => {
  const empty = host();
  empty.append(document.createTextNode(''));
  expect(assigned(empty), 'empty text is still a slottable').to.equal('""');

  const space = host();
  space.append(document.createTextNode('  '));
  expect(assigned(space), 'whitespace too — the platform gotcha light DOM inherits').to.equal('"  "');

  const commented = host();
  commented.append(document.createComment('c'));
  expect(assigned(commented), 'a comment is never a slottable — which is why markers are safe').to.equal('FALLBACK');
});
