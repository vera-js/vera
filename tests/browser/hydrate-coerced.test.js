/**
 * Hydration over the markup passes 20–21 **changed**.
 *
 * Three coercions were corrected — an attribute stringifies as the platform does, `checked` and
 * `selected` are boolean properties, and an array comma-joins in an attribute — and every one of
 * them changed the bytes the server emits. Markup matching is only half of it: adoption compares
 * what the parser produced against what the template describes, so a fix that makes the two agree
 * on *paper* still has to let a component adopt in a browser.
 *
 * Each case is the server's real output for that binding, hydrated, and checked for both the value
 * and the identity of the node carrying it.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { renderInto as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Each: the template, the server's markup for it, and what the DOM must hold afterwards. */
const CASES = {
  'an array in an attribute': {
    template: (state) => html`<b id="t" title=${state.list}>x</b>`,
    server: '<b id="t" title="1,2">x</b>',
    check: (node) => expect(node.getAttribute('title')).to.equal('1,2'),
  },
  'a Set in an attribute': {
    template: (state) => html`<b id="t" title=${state.set}>x</b>`,
    server: '<b id="t" title="[object Set]">x</b>',
    check: (node) => expect(node.getAttribute('title')).to.equal('[object Set]'),
  },
  'checked given zero': {
    template: (state) => html`<input id="t" type="checkbox" .checked=${state.zero} />`,
    server: '<input id="t" type="checkbox" />',
    check: (node) => expect(node.checked, 'a falsy value must leave it unchecked').to.equal(false),
  },
  'checked given a truthy string': {
    template: (state) => html`<input id="t" type="checkbox" .checked=${state.word} />`,
    server: '<input id="t" type="checkbox" checked="" />',
    check: (node) => expect(node.checked).to.equal(true),
  },
  /**
   * Two options, because a **lone** `<option>` is selected by the browser whatever anyone binds —
   * a select always has a selection. With a sibling that claims it, the binding is what decides.
   */
  'selected given zero': {
    template: (state) =>
      html`<select><option id="t" .selected=${state.zero}>a</option><option selected>b</option></select>`,
    server: '<select><option id="t">a</option><option selected>b</option></select>',
    check: (node) => expect(node.selected, 'a falsy value must leave it unselected').to.equal(false),
  },
  'value given zero': {
    template: (state) => html`<input id="t" .value=${state.zero} />`,
    server: '<input id="t" value="0" />',
    check: (node) => expect(node.value, 'value is a string property, so zero is "0"').to.equal('0'),
  },
  'a textarea value': {
    template: (state) => html`<textarea id="t" .value=${state.word}></textarea>`,
    server: '<textarea id="t">yes</textarea>',
    check: (node) => expect(node.value).to.equal('yes'),
  },
};

const STATE = { list: [1, 2], set: new Set([1, 2]), zero: 0, word: 'yes' };

let index = 0;
const mount = async (name) => {
  const { template, server } = CASES[name];
  const tag = `coerced-${index++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        const state = createStore({ ...STATE });
        this.state = state;
        render(() => template(state));
      }
    }
  );
  const host = document.createElement('div');
  host.setHTMLUnsafe(`<${tag}><template shadowrootmode="open">${server}</template></${tag}>`);
  document.body.appendChild(host);
  const element = host.firstElementChild;
  const before = element.shadowRoot.querySelector('#t');
  expect(before, `${name}: the server markup has no #t`).to.exist;

  customElements.upgrade(element);
  await frame();
  await frame();
  return { element, before };
};

describe('hydration over the corrected coercions', () => {
  for (const name of Object.keys(CASES)) {
    it(`${name}: adopts and holds the right value`, async () => {
      const { element, before } = await mount(name);
      const node = element.shadowRoot.querySelector('#t');
      expect(node, 'the server node was rebuilt rather than adopted').to.equal(before);
      CASES[name].check(node);
    });
  }

  it('a corrected boolean still follows its binding afterwards', async () => {
    const { element } = await mount('checked given zero');
    element.state.zero = 1;
    await frame();
    expect(element.shadowRoot.querySelector('#t').checked, 'the adopted checkbox stopped following').to.equal(
      true
    );
  });
});
