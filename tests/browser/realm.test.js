/**
 * **A component belongs to the window its element is in** — CODE-PRINCIPLES §3, and the rule every
 * component in `@verajs/ui` is held to: it must work in a popped-out window.
 *
 * Reported from a real app on core 0.3.1 / renderer 0.2.2, and reproduced on three engines: an element
 * moved into a same-origin iframe was redrawn on the OPENER's `requestAnimationFrame` (one opener
 * call, none on the iframe's), so it waits on a clock that stops when the opener's tab is hidden; and
 * the renderer imported every template through the module's `document`, so a custom element in a
 * template rendered into another window was constructed by the opener's registry, with the opener's
 * class — whose constructed stylesheets that window cannot adopt.
 *
 * An iframe stands in for a popped-out window: same realm boundary, and a real browser is the only
 * place either half can be observed.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html, wire, init, render, useEffect, createStore } from '../../packages/core/dist/development/vera.js';

wire([renderer]);

const store = createStore({ count: 0 });
let effects = 0;
customElements.define('x-realm-counter', class extends HTMLElement {
  connectedCallback() {
    init(this);
    useEffect(() => {
      store.count;
      effects++;
    });
    render(() => html`<span>${store.count}</span>`);
  }
});

const openIframe = async () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return iframe;
};

/** Counts calls to one window's requestAnimationFrame, passing them through. */
const spyFrames = (view) => {
  const real = view.requestAnimationFrame.bind(view);
  const spy = { calls: 0, restore: () => { view.requestAnimationFrame = real; } };
  view.requestAnimationFrame = (callback) => {
    spy.calls++;
    return real(callback);
  };
  return spy;
};

it('a component moved into another window re-renders, and runs effects, on that window\'s frames', async () => {
  const iframe = await openIframe();
  const element = document.createElement('x-realm-counter');
  document.body.append(element);
  await new Promise((resolve) => setTimeout(resolve, 50));
  iframe.contentDocument.body.append(element);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const effectsBefore = effects;

  const opener = spyFrames(window);
  const inner = spyFrames(iframe.contentWindow);
  try {
    store.count++;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    opener.restore();
    inner.restore();
  }
  expect(element.textContent.trim()).to.equal(String(store.count), 'CONTROL: it re-rendered');
  expect(effects).to.be.above(effectsBefore, 'CONTROL: the effect re-ran');
  expect(inner.calls).to.be.at.least(2, 'the render and the effect were scheduled on the iframe\'s clock');
  expect(opener.calls).to.equal(0, 'and none on the opener\'s');
  iframe.remove();
});

it('a template rendered into another window builds its custom elements with that window\'s registry', async () => {
  const iframe = await openIframe();
  const view = iframe.contentWindow;
  /** One tag, two definitions: the opener's and the iframe's own, each a class of its own realm. */
  class OpenerCard extends HTMLElement {}
  customElements.define('x-realm-card', OpenerCard);
  const IframeCard = class extends view.HTMLElement {};
  view.customElements.define('x-realm-card', IframeCard);

  const container = iframe.contentDocument.createElement('div');
  iframe.contentDocument.body.append(container);
  renderInto(html`<section><x-realm-card></x-realm-card></section>`, container);

  const card = container.querySelector('x-realm-card');
  expect(card, 'CONTROL: it rendered').to.not.equal(null);
  expect(card.ownerDocument).to.equal(iframe.contentDocument, 'created in the document it lives in');
  expect(card instanceof IframeCard).to.equal(true, 'upgraded by the iframe\'s registry');
  expect(card instanceof OpenerCard).to.equal(false, 'not by the opener\'s');
  iframe.remove();
});
