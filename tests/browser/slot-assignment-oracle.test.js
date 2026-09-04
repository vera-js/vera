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

/**
 * **The cases the 2026-09-04 light-slots work was measured against.**
 *
 * Everything asserted that day — flatten's contents, a slot nested in another slot's fallback, and
 * the order a re-slotted node joins its new bucket — was compared against jsdom's shadow DOM,
 * because the node suites run under jsdom. That is the arrangement this file exists to make safe:
 * the node suites prove `light === jsdom's shadow`, and these prove `jsdom's shadow === every real
 * engine's shadow`. Without them the day's parity claims rest on jsdom being right about slot
 * assignment, which `CLAUDE.md` says never to assume.
 *
 * `<slot name="o">` here holds a nested `<slot name="i">` in its fallback, which is the arrangement
 * that produced two content-loss defects: while the outer slot is assigned its fallback is not
 * rendered, and the question is whether the inner slot goes on participating in assignment anyway.
 */
customElements.define(
  'oracle-nest',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<div class="box"><slot name="o"><em>E</em><!--mine--><slot name="i">DEEP</slot></slot></div>';
    }
  }
);
const nest = () => {
  const el = document.createElement('oracle-nest');
  document.body.appendChild(el);
  made.push(el);
  return {
    el,
    outer: el.shadowRoot.querySelector('slot[name="o"]'),
    inner: el.shadowRoot.querySelector('slot[name="i"]'),
  };
};
const show = (nodes) =>
  nodes.map((n) => (n.nodeType === 1 ? `<${n.localName}>${n.textContent}` : `"${n.textContent}"`)).join(',') || '-';

it('flatten returns SLOTTABLES — a comment in fallback content is not one', () => {
  const { outer } = nest();
  expect(show(outer.assignedNodes()), 'CONTROL: nothing assigned').to.equal('-');
  expect(show(outer.assignedNodes({ flatten: true })), 'the <!--mine--> is absent, and the nested slot flattens through')
    .to.equal('<em>E,"DEEP"');
});

it('a slot nested in an unrendered fallback still takes its assignment', () => {
  const { el, outer, inner } = nest();
  const owned = document.createElement('u');
  owned.setAttribute('slot', 'o');
  el.appendChild(owned);
  expect(show(outer.assignedNodes()), 'CONTROL: the outer slot is assigned, so its fallback is not rendered')
    .to.equal('<u>');

  const deep = document.createElement('b');
  deep.setAttribute('slot', 'i');
  deep.textContent = 'LATE';
  el.appendChild(deep);
  expect(show(inner.assignedNodes()), 'the inner slot assigns it even though it is not being rendered')
    .to.equal('<b>LATE');

  owned.remove();
  expect(show(outer.assignedNodes({ flatten: true })), 'and when the outer slot falls back, that content is what shows')
    .to.equal('<em>E,<b>LATE');
});

it('a re-slotted node joins in DOCUMENT order, not the order it arrived', () => {
  const el = host();
  const early = document.createElement('u');
  early.textContent = 'EARLY';
  el.appendChild(early);

  const late = document.createElement('u');
  late.textContent = 'LATE';
  el.appendChild(late);
  const slot = el.shadowRoot.querySelector('slot');
  expect(show(slot.assignedNodes()), 'CONTROL: both are on the default slot to begin with')
    .to.equal('<u>EARLY,<u>LATE');

  /** Out and back: the node has not moved in the light tree, so it returns to its own place. */
  early.setAttribute('slot', 'gone');
  expect(show(slot.assignedNodes()), 'CONTROL: naming a slot that does not exist un-assigns it').to.equal('<u>LATE');
  early.setAttribute('slot', '');
  expect(show(slot.assignedNodes()), 'it comes back AHEAD of the one that was already there')
    .to.equal('<u>EARLY,<u>LATE');

  const front = document.createElement('u');
  front.textContent = 'FRONT';
  el.insertBefore(front, el.firstChild);
  front.setAttribute('slot', 'gone');
  front.setAttribute('slot', '');
  expect(show(slot.assignedNodes()), 'and a node inserted at the front takes the front')
    .to.equal('<u>FRONT,<u>EARLY,<u>LATE');
});
