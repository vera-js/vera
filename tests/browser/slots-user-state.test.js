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
