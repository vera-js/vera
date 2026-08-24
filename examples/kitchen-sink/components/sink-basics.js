/**
 * Exactly what `../jsx/sink-basics.jsx` renders, written as a tagged template.
 *
 * The pair exists so `tests/kitchen-jsx.test.mjs` can compare the two authoring styles as DOM: JSX
 * against the templates it compiles to, one component at a time. It covers what JSX **can** express
 * — a spread on an element, an element-position ref and a single-quoted binding have no JSX syntax
 * and live in `sink-bindings`, whose tagged-template form is the only one that can carry them.
 */
import { init, render, html, svg, mathml, createStore } from '@verajs/core';

export default class SinkBasics extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({
      text: 'hello & <world>',
      count: 3,
      title: 'a "quoted" title',
      busy: false,
    });

    render(
      () => html`<section id="basics">
        <h2>Bindings, the JSX-comparable subset</h2>
        <h3>Exactly what JSX can express, so the same component can be written both ways and diffed</h3>
        <h4>Nothing to click. Its twin in jsx/ renders the same DOM, which tests/kitchen-jsx.test.mjs checks.</h4>
        <p id="text">${state.text}</p>
        <p id="multi">${state.text} and ${state.count}</p>
        <p id="falsy">[${0}][${false}][${null}][${undefined}][${''}]</p>
        <p id="nested"><em>${state.text}</em></p>
        <p id="list">${[1, 2, 3]}</p>

        <b id="quoted" title=${state.title}>q</b>
        <b id="multipart" class="a ${state.text} c">m</b>
        <b id="removed" title=${null}>r</b>
        <b id="dataaria" data-count=${state.count} aria-label=${state.title}>d</b>

        <b id="boolOn" ?hidden=${true}>on</b>
        <b id="boolOff" ?hidden=${state.busy}>off</b>

        <input id="value" .value=${state.text} />
        <input id="checked" type="checkbox" .checked=${true} />
        <textarea id="area" .value=${state.text}></textarea>

        <svg id="svg" viewBox="0 0 10 10" width="10" height="10">
          ${svg`<circle id="circle" cx=${5} cy=${5} r=${state.count} fill="currentColor" />`}
        </svg>
        <math id="math">${mathml`<mi id="mi">${state.text}</mi>`}</math>
      </section>`
    );
  }
}

customElements.define('sink-basics', SinkBasics);
