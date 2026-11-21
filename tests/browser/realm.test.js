/**
 * **A component belongs to the window its element is in** — CODE-PRINCIPLES §3, and the rule every
 * component in `@vera-components/select` is held to: it must work in a popped-out window.
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
import { html, wire, init, effect, createStore } from '../../packages/core/dist/development/vera.js';
import { until } from './until.js';

wire([renderer]);

const store = createStore({ count: 0 });
let effects = 0;
customElements.define('x-realm-counter', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      effect(() => {
        store.count;
        effects++;
      });
      return () => html`<span>${store.count}</span>`;
    });
  }
});

/** A component whose effect writes what it reads, up to `loop.until`: its third run in a flush waits for a frame. */
const loop = { until: 0 };
customElements.define('x-realm-loop', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const state = createStore({ n: 0 });
      this._state = state;
      effect(() => {
        if (state.n < loop.until) state.n++;
      });
      return () => html`<b>${state.n}</b>`;
    });
  }
});

const openIframe = async () => {
  const iframe = document.createElement('iframe');
  /** Listened for before the append: an engine may fire an empty iframe's load during it. */
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  document.body.append(iframe);
  await loaded;
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

it('a component moved into another window re-renders, and runs effects, never on the opener\'s clock', async () => {
  const iframe = await openIframe();
  const element = document.createElement('x-realm-counter');
  document.body.append(element);
  /** A task boundary after each move, not a time: a flush is a microtask, so this orders the test behind it. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  iframe.contentDocument.body.append(element);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const effectsBefore = effects;

  const opener = spyFrames(window);
  const inner = spyFrames(iframe.contentWindow);
  try {
    store.count++;
    /** The re-render is the sentinel: the opener's frame, if asked for, is asked for inside the flush that renders. */
    await until(() => element.textContent.trim() === String(store.count) && effects > effectsBefore, 'the moved component re-rendered and re-ran its effect', 5000);
  } finally {
    opener.restore();
    inner.restore();
  }
  expect(element.textContent.trim()).to.equal(String(store.count), 'CONTROL: it re-rendered');
  expect(effects).to.be.above(effectsBefore, 'CONTROL: the effect re-ran');
  /** Within the budget a flush is a microtask (2026-10-08): no clock at all, so a hidden opener cannot freeze it. */
  expect(opener.calls).to.equal(0, 'none on the opener\'s clock');
  iframe.remove();
});

/**
 * **What does wait for a frame waits for the ELEMENT's window's** — a hook's third run in one flush (a self-feeding
 * loop), and work past the budget. On the opener's clock it would stop whenever the opener's tab is hidden.
 */
it('a component in another window waits for THAT window\'s frames when it must wait at all', async () => {
  const iframe = await openIframe();
  /** Made where its tag is defined, then moved — as a popped-out window receives one. */
  const element = document.createElement('x-realm-loop');
  document.body.append(element);
  /** A task boundary after each move, not a time: a flush is a microtask, so this orders the test behind it. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  iframe.contentDocument.body.append(element);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const opener = spyFrames(window);
  const inner = spyFrames(iframe.contentWindow);
  try {
    loop.until = 6;
    element._state.n = 1;
    await until(() => element.textContent.trim() === '6', 'the loop settled on the iframe's frames', 5000);
  } finally {
    opener.restore();
    inner.restore();
    loop.until = 0;
  }
  expect(element.textContent.trim()).to.equal('6', 'CONTROL: the loop settled');
  expect(inner.calls).to.be.at.least(1, 'its held runs waited on the iframe\'s frames');
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
