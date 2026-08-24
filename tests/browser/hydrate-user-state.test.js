/**
 * **What hydration does to work the user did before the JavaScript arrived.**
 *
 * This is the whole reason server rendering exists — the page is usable before the bundle lands —
 * and it is therefore the window in which a real person types into a field, ticks a box, picks an
 * option or scrolls. Hydration then runs against a DOM that no longer matches what the server sent.
 *
 * There is no `live()` in this renderer: a property bound to a value it already holds is not
 * re-applied, which is what keeps a field the user has typed into. Whether that also holds when the
 * *server's* value is the one being adopted is a different question, and the one that decides
 * whether an SSR page is safe to interact with early.
 *
 * Each case does the thing a person would do, then hydrates, then asks what survived.
 */
import { expect } from '@esm-bundle/chai';
import { setRenderer, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

setRenderer(hydratingRender);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Exactly what `@verajs/ssr` emits for the component below, with the server's values in place. */
const SERVER = `<template shadowrootmode="open"><form id="root">
        <input id="text" value="Ada" />
        <input id="box" type="checkbox" />
        <select id="pick"><option value="a" selected>a</option><option value="b">b</option></select>
        <textarea id="area">server text</textarea>
        <p id="count">0</p>
      </form></template>`;

customElements.define(
  'user-state-probe',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ name: 'Ada', ticked: false, picked: 'a', note: 'server text', count: 0 });
      this.state = state;
      render(
        () => html`<form id="root">
        <input id="text" .value=${state.name} />
        <input id="box" type="checkbox" .checked=${state.ticked} />
        <select id="pick"><option value="a" .selected=${state.picked === 'a'}>a</option><option value="b" .selected=${state.picked === 'b'}>b</option></select>
        <textarea id="area" .value=${state.note}></textarea>
        <p id="count">${state.count}</p>
      </form>`
      );
    }
  }
);

/** Parse the server markup, let a "user" touch it, and only then upgrade. */
const hydrateAfter = async (touch) => {
  const host = document.createElement('div');
  host.setHTMLUnsafe(`<user-state-probe>${SERVER}</user-state-probe>`);
  document.body.appendChild(host);
  const element = host.firstElementChild;
  const shadow = element.shadowRoot;
  expect(shadow, 'declarative shadow DOM did not parse').to.exist;

  touch(shadow);
  customElements.upgrade(element);
  await frame();
  await frame();
  return { element, shadow };
};

describe('hydration over a DOM the user already touched', () => {
  it('keeps what the user typed into a text field', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    expect(shadow.querySelector('#text').value, 'the user’s text was overwritten by the server’s').to.equal(
      'Grace'
    );
  });

  it('keeps a checkbox the user ticked', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#box').checked = true));
    expect(shadow.querySelector('#box').checked, 'the user’s tick was undone').to.equal(true);
  });

  it('keeps a select the user changed', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#pick').value = 'b'));
    expect(shadow.querySelector('#pick').value, 'the user’s choice was reset').to.equal('b');
  });

  it('keeps what the user typed into a textarea', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#area').value = 'typed by hand'));
    expect(shadow.querySelector('#area').value, 'the user’s text was replaced').to.equal('typed by hand');
  });

  it('keeps focus and the caret where the user left them', async () => {
    const { shadow } = await hydrateAfter((root) => {
      const field = root.querySelector('#text');
      field.focus();
      field.setSelectionRange(1, 2);
    });
    const field = shadow.querySelector('#text');
    expect(shadow.activeElement, 'focus was lost through hydration').to.equal(field);
    expect([field.selectionStart, field.selectionEnd], 'the caret moved').to.deep.equal([1, 2]);
  });

  it('still updates that field when the state actually changes', async () => {
    const { element, shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    element.state.name = 'Katherine';
    await frame();
    expect(
      shadow.querySelector('#text').value,
      'the field stopped following its binding after hydration'
    ).to.equal('Katherine');
  });

  it('and the rest of the component hydrated normally', async () => {
    const { element, shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    const paragraph = shadow.querySelector('#count');
    element.state.count = 5;
    await frame();
    expect(shadow.querySelector('#count'), 'the untouched part was rebuilt').to.equal(paragraph);
    expect(paragraph.textContent).to.equal('5');
  });
});
