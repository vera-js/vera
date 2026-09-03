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

/**
 * **`slotchange` must carry the OTHER window's `Event`.** A component in a popped-out window is
 * handed events by code loaded in this one, and an event built from the wrong realm is not the
 * `Event` that window's handlers know: `instanceof` is false, and a strict DOM refuses the object
 * outright. The constructor comes from the HOST's document for exactly this — and deliberately not
 * from the slot element, whose `ownerDocument` is a `<template>`'s inert one with no window at all.
 */
it('dispatches slotchange in the host window\'s own realm', async () => {
  const frame = await otherRealm();
  const otherDoc = frame.contentDocument;
  const otherWin = otherDoc.defaultView;
  expect(otherWin).to.not.equal(window, 'CONTROL: a second realm');

  const seen = [];
  const host = otherDoc.createElement('div');
  host.innerHTML = '<b slot="h">ONE</b>';
  otherDoc.body.appendChild(host);
  renderInto(
    html`<header><slot name="h" @slotchange=${(event) => seen.push(event)}>fb</slot></header>`,
    host
  );
  await settle();

  expect(seen.length).to.equal(1, 'fired for the assignment it was rendered with');
  expect(seen[0]).to.be.instanceOf(otherWin.Event, "the popped-out window's Event, not this one's");
  expect(seen[0].type).to.equal('slotchange');
  expect(seen[0].target.assignedElements().map((n) => n.textContent)).to.deep.equal(['ONE']);
  frame.remove();
});

it('slotchange and assignedNodes track live changes in a real engine', async () => {
  const seen = [];
  const host = document.createElement('div');
  host.innerHTML = '<b slot="h">ONE</b>';
  document.body.appendChild(host);
  let held = null;
  renderInto(
    html`<header><slot name="h" &ref=${(node) => { held = node; }}
      @slotchange=${(event) => seen.push(event.target.assignedElements().map((n) => n.textContent).join('+') || '(none)')}
    >fb</slot></header>`,
    host
  );
  await settle();

  const added = document.createElement('b');
  added.setAttribute('slot', 'h');
  added.textContent = 'TWO';
  host.appendChild(added);
  await settle();

  host.querySelector('b').remove();
  await settle();

  expect(seen).to.deep.equal(['ONE', 'ONE+TWO', 'TWO'], 'first assignment, then each change');
  expect(held.assignedNodes().map((n) => n.textContent)).to.deep.equal(['TWO']);
  expect(slotted(host, 'h').map((n) => n.textContent)).to.deep.equal(['TWO'], 'and slotted() agrees');
  host.remove();
});
