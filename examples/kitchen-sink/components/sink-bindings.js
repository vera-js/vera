/**
 * Every binding kind the renderer and the serializer both understand, in one component.
 *
 * The point is coverage of the *matrix*, not of any one binding: text and attribute positions,
 * all three quoting styles, booleans, form properties, spreads, refs, events, SVG and MathML
 * namespaces, and the falsy values whose handling server and client have disagreed about before.
 * Deterministic by construction — no clock, no randomness — because the same markup has to come out
 * of `renderToString` and out of a browser.
 */
import { init, render, html, svg, mathml, createStore, ref } from '@verajs/core';
import { spread } from '@verajs/renderer/spread';

export default class SinkBindings extends HTMLElement {
  connectedCallback() {
    /**
     * Assigned here, never as a class field: a field runs during upgrade and would overwrite
     * anything a parent had already set on the element. `packages/eslint-config` refuses one.
     */
    this.captured = null;
    init(this, { mode: 'open' });
    const state = createStore({
      text: 'hello & <world>',
      count: 3,
      title: 'a "quoted" title',
      busy: false,
    });
    /** An object ref: the renderer assigns `.value`. A function ref is covered below it. */
    const box = ref(null);
    this.box = box;

    render(
      () => html`<section id="bindings">
        <p id="text">${state.text}</p>
        <p id="multi">${state.text} and ${state.count}</p>
        <p id="falsy">[${0}][${false}][${null}][${undefined}][${''}]</p>
        <p id="nested">${html`<em>${state.text}</em>`}</p>
        <p id="list">${[1, 2, 3]}</p>
        <p id="looks-like-attr">total=${state.count}</p>

        <b id="quoted" title="${state.title}">q</b>
        <b id="single" title='${state.title}'>s</b>
        <b id="unquoted" title=${state.title}>u</b>
        <b id="multipart" class="a ${state.text} c">m</b>
        <b id="removed" title=${null}>r</b>
        <b id="colon" xml:lang=${'en'}>c</b>
        <b id="dataaria" data-count=${state.count} aria-label=${state.title}>d</b>

        <b id="boolOn" ?hidden=${true}>on</b>
        <b id="boolOff" ?hidden=${state.busy}>off</b>
        <b id="boolSingle" ?hidden='${true}'>bs</b>

        <input id="value" .value=${state.text} />
        <input id="checked" type="checkbox" .checked=${true} />
        <select id="select">
          <option id="option" .selected=${true} value="a">a</option>
        </select>
        <textarea id="area" .value=${state.text}></textarea>

        <b id="spread" ${spread({ id: 'spread', title: state.title, '?hidden': false, 'data-x': '1' })}>sp</b>
        <b id="spreadNull" title="kept" ${spread({ title: null })}>sn</b>

        <input id="ref" ${box} />
        <input id="fnref" ${(element) => (this.captured = element)} />

        <svg id="svg" viewBox="0 0 10 10" width="10" height="10">
          ${svg`<circle id="circle" cx=${5} cy=${5} r=${state.count} fill="currentColor" />`}
        </svg>
        <math id="math">${mathml`<mi id="mi">${state.text}</mi>`}</math>
      </section>`
    );
  }
}

customElements.define('sink-bindings', SinkBindings);
