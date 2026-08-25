import { expect } from '@esm-bundle/chai';
import { BINDINGS_HTML } from './fixtures/hello-ssr.html.js';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

/**
 * Every binding kind, adopted through **real declarative shadow DOM**.
 *
 * `tests/hydrate-bindings.test.mjs` covers the same matrix under jsdom, which cannot parse
 * `<template shadowrootmode>` at all — so it hydrates light DOM and the component half of the
 * handoff never happens there. This is the other half: the browser parses the server's markup into
 * a shadow root, the component upgrades into it, and adoption has to survive that.
 *
 * Assertions are on **identity**. A mismatch is silent by design — the mismatched DOM is repaired in
 * place, so the page looks perfect and the server work is silently redone. Only holding a
 * reference to a server-built node and checking it is still there can tell the difference.
 */

wire({ on: 'render', fn: hydratingRender, priority: 50 });

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** The same component the fixture was generated from, defined here so it upgrades over that markup. */
customElements.define(
  'bindings-ssr',
  class extends HTMLElement {
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
);

const PROBES = [
  'root', 'text', 'multi', 'falsy', 'quoted', 'single', 'unquoted', 'multipart', 'removed',
  'boolOn', 'boolOff', 'boolSingle', 'value', 'valueSingle', 'checked', 'dropProp', 'dropEvent',
  'dropEventSingle', 'dropOnClick', 'nested', 'list', 'empty', 'looksLikeAttr',
];

const host = document.createElement('div');
host.setHTMLUnsafe(BINDINGS_HTML);
document.body.appendChild(host);

const element = host.querySelector('bindings-ssr');
const before = {};
for (const id of PROBES) before[id] = element.shadowRoot.getElementById(id);

await frame();
await frame();

it('the server markup parsed into a real shadow root', () => {
  expect(element.shadowRoot, 'declarative shadow DOM became a shadow root').to.not.equal(null);
  for (const id of PROBES) expect(before[id], `#${id} missing from the server markup`).to.not.equal(null);
});

it('every binding adopts its server node rather than replacing it', () => {
  const replaced = PROBES.filter((id) => element.shadowRoot.getElementById(id) !== before[id]);
  expect(replaced, `these fell back instead of adopting: ${replaced.join(', ')}`).to.have.length(0);
});

it('the adopted values are right', () => {
  const shadow = element.shadowRoot;
  expect(shadow.getElementById('text').textContent).to.equal('hello & <world>');
  expect(shadow.getElementById('falsy').textContent).to.equal('[0][false][]');
  expect(shadow.getElementById('quoted').getAttribute('title')).to.equal('hello & <world>');
  expect(shadow.getElementById('single').getAttribute('title')).to.equal('hello & <world>');
  expect(shadow.getElementById('multipart').getAttribute('class')).to.equal('a hello & <world> c');
  expect(shadow.getElementById('removed').hasAttribute('title'), 'nullish removes').to.equal(false);
  expect(shadow.getElementById('boolOn').hasAttribute('hidden')).to.equal(true);
  expect(shadow.getElementById('boolOff').hasAttribute('hidden')).to.equal(false);
  expect(shadow.getElementById('boolSingle').hasAttribute('hidden'), 'single-quoted boolean').to.equal(true);
  expect(shadow.getElementById('looksLikeAttr').textContent, 'text is text').to.equal('total=3');
  expect(shadow.getElementById('list').querySelectorAll('li')).to.have.length(2);
});

it('properties are set on the client, and never leak into server markup as attributes', () => {
  const shadow = element.shadowRoot;
  expect(shadow.getElementById('value').value).to.equal('hello & <world>');
  expect(shadow.getElementById('valueSingle').value, 'single-quoted .value').to.equal('hello & <world>');
  expect(shadow.getElementById('checked').checked).to.equal(true);

  for (const id of ['dropProp', 'dropEvent', 'dropEventSingle', 'dropOnClick']) {
    const names = [...shadow.getElementById(id).attributes].map((a) => a.name);
    expect(names, `#${id} leaked a binding into markup: ${names.join(', ')}`).to.deep.equal(['id']);
  }
});
