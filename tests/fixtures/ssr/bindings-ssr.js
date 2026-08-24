import { init, render, html, createStore } from '@verajs/core';

/**
 * Every binding kind in one component, so the browser suite can hydrate them all through real
 * declarative shadow DOM. `tests/hydrate-bindings.test.mjs` covers the same matrix under jsdom,
 * which cannot parse `<template shadowrootmode>` — the two together are what make the claim.
 *
 * Each `id` is a probe: hydration must adopt that exact node, not replace it.
 */
export default class BindingsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ text: 'hello & <world>', count: 3, rows: ['a', 'b'] });
    render(
      () => html`<section id="root">
        <p id="text">${state.text}</p>
        <p id="multi">${state.text} and ${state.count}</p>
        <p id="falsy">[${0}][${false}][${null}]</p>
        <b id="quoted" title="${state.text}">q</b>
        <b id="single" title='${state.text}'>s</b>
        <b id="unquoted" title=${state.text}>u</b>
        <b id="multipart" class="a ${state.text} c">m</b>
        <b id="removed" title=${null}>r</b>
        <b id="boolOn" ?hidden=${true}>on</b>
        <b id="boolOff" ?hidden=${false}>off</b>
        <b id="boolSingle" ?hidden='${true}'>bs</b>
        <input id="value" .value=${state.text} />
        <input id="valueSingle" .value='${state.text}' />
        <input id="checked" type="checkbox" .checked=${true} />
        <b id="dropProp" .someProp=${state.text}>dp</b>
        <b id="dropEvent" @click=${() => {}}>de</b>
        <b id="dropEventSingle" @click='${() => {}}'>des</b>
        <b id="dropOnClick" onClick=${() => {}}>doc</b>
        <p id="nested">${html`<em>${state.text}</em>`}</p>
        <ul id="list">
          ${state.rows.map((row) => html`<li>${row}</li>`)}
        </ul>
        <ul id="empty">${[]}</ul>
        <p id="looksLikeAttr">total=${state.count}</p>
      </section>`
    );
  }
}
customElements.define('bindings-ssr', BindingsSsr);
