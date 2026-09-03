/**
 * **What a real engine decides about light-DOM slots**, and the promise that matters most: a
 * re-render must not disturb the user's own nodes. Focus, an edited input value, scroll position
 * and selection are state the DOM holds and no framework can restore — so the only acceptable
 * behaviour is not to touch the nodes at all.
 *
 * jsdom cannot settle any of this (no layout, focus is a stub), which is why it is here: the jsdom
 * suites are the regression net, browser suites are the release gate.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots, slotted } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';

wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** ONE draw function called twice — two template literals are two templates, even when identical,
 *  so writing the markup out again would rebuild rather than update and prove nothing. */
const draw = (label) => html`<article><header><slot name="head">none</slot></header>
  <main><slot>empty</slot></main><footer>${label}</footer></article>`;

const mount = (markup) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  renderInto(draw('one'), host);
  return host;
};

it('a re-render leaves focus, caret and an edited value untouched', async () => {
  const host = mount('<input slot="head" value="server">');
  const input = host.querySelector('input');
  expect(input.parentElement.localName).to.equal('header', 'CONTROL: it really was distributed');

  input.focus();
  input.value = 'typed by the reader';
  input.setSelectionRange(5, 9);
  expect(document.activeElement).to.equal(input, 'CONTROL: focus actually took');

  renderInto(draw('two'), host);
  await settle();

  expect(host.querySelector('footer').textContent).to.equal('two', 'CONTROL: the re-render happened');
  expect(host.querySelector('input')).to.equal(input, 'the same node, never re-created');
  expect(document.activeElement).to.equal(input, 'focus survived');
  expect(input.value).to.equal('typed by the reader', 'the edited value survived');
  expect([input.selectionStart, input.selectionEnd]).to.deep.equal([5, 9], 'and the caret');
  host.remove();
});

it('live redistribution moves the node itself, so its state moves with it', async () => {
  const host = mount('<input slot="head" value="a">');
  const input = host.querySelector('input');
  input.value = 'edited';
  input.focus();

  /** Re-slot to the default slot — the platform's own way of moving assigned content. */
  input.setAttribute('slot', '');
  await settle();

  expect(input.parentElement.localName).to.equal('main', 'it moved to the default slot');
  expect(host.querySelector('input')).to.equal(input, 'as the same node');
  expect(input.value).to.equal('edited', 'value came with it');
  expect(host.querySelector('header').textContent.trim()).to.equal('none', 'and the vacated slot fell back');
  host.remove();
});

it('fallback returns when the last assigned node leaves, and goes again when it comes back', async () => {
  const host = mount('<b slot="head">MINE</b>');
  const node = host.querySelector('b');
  expect(host.querySelector('header').textContent).to.equal('MINE');

  node.remove();
  await settle();
  expect(host.querySelector('header').textContent.trim()).to.equal('none', 'fallback restored');

  host.appendChild(node);
  await settle();
  expect(host.querySelector('header').textContent).to.equal('MINE', 'and displaced again on return');
  expect(slotted(host, 'head')).to.deep.equal([node], 'the capture map agrees');
  host.remove();
});

/**
 * **Slotted content takes its place in the FLATTENED tree, not in the order the user wrote it.**
 * The author here writes SECOND before FIRST and the template renders those slots the other way
 * round, so the two orders disagree — which is the only arrangement that can tell them apart.
 *
 * Measured as layout position, because that is the engine's own answer to "what is the flattened
 * order", and it is what sequential focus navigation then follows. Asserted against a real shadow
 * root on the same page rather than against a description of one.
 *
 * (`compareDocumentPosition` is the wrong instrument and was the first thing tried: in shadow mode
 * the buttons never leave the host's light DOM, so the DOM tree still reports the author's order
 * while the page renders the other one. The CONTROL caught it.)
 */
it('places slotted content in the flattened order, as native shadow slotting does', async () => {
  const markup = '<button slot="second">SECOND</button><button slot="first">FIRST</button>';
  const order = {};

  for (const mode of ['shadow', 'light']) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.appendChild(host);
    if (mode === 'shadow') {
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<nav><slot name="first"></slot></nav><aside><slot name="second"></slot></aside>';
    } else {
      renderInto(html`<nav><slot name="first"></slot></nav><aside><slot name="second"></slot></aside>`, host);
    }
    await settle();

    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.length).to.equal(2, `CONTROL: both buttons present in ${mode} mode`);
    const tops = buttons.map((button) => button.getBoundingClientRect().top);
    expect(new Set(tops).size).to.equal(2, `CONTROL: the two ${mode} buttons occupy different rows, or this measures nothing`);
    order[mode] = buttons
      .slice()
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((button) => button.textContent);
    host.remove();
  }

  expect(order.shadow).to.deep.equal(['FIRST', 'SECOND'],
    'CONTROL: the platform lays out by slot position, not by the order the author wrote');
  expect(order.light).to.deep.equal(order.shadow, 'and light distribution matches it');
});
