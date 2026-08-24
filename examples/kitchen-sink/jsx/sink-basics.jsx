/**
 * The JSX twin of `../components/sink-basics.js`, and an exact one.
 *
 * Written the way the JSX docs say to write it — `className`, `hidden={…}` for a boolean attribute,
 * `value={…}` for a form property — and it must produce the **same DOM** as its tagged-template
 * twin. That is the whole claim of `@verajs/jsx`: one JSX call site is one template call site, so
 * template identity and every renderer fast path hold.
 *
 * Its twin covers exactly what JSX can express, which is why it is a separate component from
 * `sink-bindings`: a spread on an element is a compile error in JSX (allowed on components only),
 * an element-position ref has no JSX syntax, and neither has a single-quoted binding. Those live in
 * `sink-bindings`, where the tagged-template form is the only one that can carry them.
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

    render(() => (
      <section id="basics">
        <p id="text">{state.text}</p>
        <p id="multi">
          {state.text} and {state.count}
        </p>
        <p id="falsy">
          [{0}][{false}][{null}][{undefined}][{''}]
        </p>
        <p id="nested">
          <em>{state.text}</em>
        </p>
        <p id="list">{[1, 2, 3]}</p>

        <b id="quoted" title={state.title}>q</b>
        <b id="multipart" className={`a ${state.text} c`}>m</b>
        <b id="removed" title={null}>r</b>
        <b id="dataaria" data-count={state.count} aria-label={state.title}>d</b>

        <b id="boolOn" hidden={true}>on</b>
        <b id="boolOff" hidden={state.busy}>off</b>

        <input id="value" value={state.text} />
        <input id="checked" type="checkbox" checked={true} />
        <textarea id="area" value={state.text}></textarea>

        <svg id="svg" viewBox="0 0 10 10" width="10" height="10">
          {svg`<circle id="circle" cx=${5} cy=${5} r=${state.count} fill="currentColor" />`}
        </svg>
        <math id="math">{mathml`<mi id="mi">${state.text}</mi>`}</math>
      </section>
    ));
    void html;
  }
}

customElements.define('sink-basics', SinkBasics);
