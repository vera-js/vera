/**
 * **Light slots in a SECOND realm** — a same-origin iframe here, a popped-out window in Studio.
 * A component rendered into another document lives in a different `defaultView`, and the rule for
 * this project is that every document/window touch derives from the node rather than the module
 * global. The live-redistribution observer is the one such touch in `@verajs/renderer/slots`, and
 * whether one realm's `MutationObserver` sees another realm's nodes is a platform decision, so it
 * is measured on the engines rather than under jsdom.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots, slotted } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';

wire([renderer, slots]);
const card = () => html`<header><slot name="h">fb</slot></header><main><slot>none</slot></main>`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A second same-origin document with its own window — the realm split a pop-out creates. */
const otherRealm = async () => {
  const frame = document.createElement('iframe');
  frame.srcdoc = '<!doctype html><body></body>';
  document.body.appendChild(frame);
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  return frame;
};

it('distributes, and stays LIVE, for a host in another document', async () => {
  const frame = await otherRealm();
  const otherDoc = frame.contentDocument;
  expect(otherDoc.defaultView).to.not.equal(window, 'CONTROL: this really is a second realm');

  const host = otherDoc.createElement('div');
  host.innerHTML = '<b slot="h">ONE</b>text';
  otherDoc.body.appendChild(host);
  renderInto(card(), host);

  expect(host.querySelector('header').textContent).to.equal('ONE', 'distributed into the other document');
  expect(host.querySelector('main').textContent).to.equal('text');

  /** The live half: a node added AFTER the render reaches its slot only through the observer. */
  const added = otherDoc.createElement('b');
  added.setAttribute('slot', 'h');
  added.textContent = 'TWO';
  host.appendChild(added);
  await settle();
  expect(host.querySelector('header').textContent).to.equal('ONETWO', 'the observer saw a mutation in the other realm');
  expect(slotted(host, 'h').map((n) => n.textContent)).to.deep.equal(['ONE', 'TWO']);

  /** And removal, which is what restores fallback. */
  added.remove();
  host.querySelector('b').remove();
  await settle();
  expect(host.querySelector('header').textContent).to.equal('fb', 'fallback returned in the other realm');
  frame.remove();
});
