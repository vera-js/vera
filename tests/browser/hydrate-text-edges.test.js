/**
 * Hydration where the *text* is the awkward part.
 *
 * The renderer is markerless — server markup carries no framework comments — so a child slot's
 * anchor is a text node, and adoption depends on the parser having produced the nodes the template
 * expects. Every one of these is a shape where the parser's answer is not the obvious one: adjacent
 * bindings become one text node, an empty binding produces none, and a comment in the markup is a
 * node the template never described.
 *
 * A mismatch here is silent — the DOM is repaired and the page looks right — so identity is the
 * only thing that distinguishes adoption from a quiet rebuild.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Each case: the component's template, and exactly what `@verajs/ssr` emits for it. */
const CASES = {
  'three adjacent bindings': {
    template: (state) => html`<p id="body">${state.a}${state.b}${state.c}</p>`,
    server: '<p id="body">123</p>',
    after: '123',
    change: (state) => (state.a = 9),
    then: '923',
  },
  'a binding whose value is empty': {
    template: (state) => html`<p id="body">[${state.empty}]</p>`,
    server: '<p id="body">[]</p>',
    after: '[]',
    change: (state) => (state.empty = 'filled'),
    then: '[filled]',
  },
  'a binding whose value is null': {
    template: (state) => html`<p id="body">[${state.nothing}]</p>`,
    server: '<p id="body">[]</p>',
    after: '[]',
    change: (state) => (state.nothing = 'now here'),
    then: '[now here]',
  },
  'text either side of an element': {
    template: (state) => html`<p id="body">${state.a}<b>x</b>${state.b}</p>`,
    server: '<p id="body">1<b>x</b>2</p>',
    after: '1x2',
    change: (state) => (state.b = 7),
    then: '1x7',
  },
  'a binding beside literal text': {
    template: (state) => html`<p id="body">total=${state.a} items</p>`,
    server: '<p id="body">total=1 items</p>',
    after: 'total=1 items',
    change: (state) => (state.a = 42),
    then: 'total=42 items',
  },
  'a value that is only whitespace': {
    template: (state) => html`<p id="body">[${state.spaces}]</p>`,
    server: '<p id="body">[   ]</p>',
    after: '[   ]',
    change: (state) => (state.spaces = ' x '),
    then: '[ x ]',
  },
  'a value containing a newline': {
    template: (state) => html`<p id="body">${state.lines}</p>`,
    server: '<p id="body">a\nb</p>',
    after: 'a\nb',
    change: (state) => (state.lines = 'c\nd'),
    then: 'c\nd',
  },
};

const STATE = { a: 1, b: 2, c: 3, empty: '', nothing: null, spaces: '   ', lines: 'a\nb' };

let index = 0;
const mount = async (name) => {
  const { template, server } = CASES[name];
  const tag = `text-edge-${index++}`;
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
  const before = element.shadowRoot.querySelector('#body');
  expect(before, `${name}: the server markup has no #body`).to.exist;

  customElements.upgrade(element);
  await frame();
  await frame();
  return { element, before };
};

describe('hydration over awkward text', () => {
  for (const name of Object.keys(CASES)) {
    it(`${name}: adopts the server node`, async () => {
      const { element, before } = await mount(name);
      expect(
        element.shadowRoot.querySelector('#body'),
        'the server node was rebuilt rather than adopted'
      ).to.equal(before);
    });

    it(`${name}: reads correctly and stays reactive`, async () => {
      const { element } = await mount(name);
      expect(element.shadowRoot.querySelector('#body').textContent, 'the adopted text is wrong').to.equal(
        CASES[name].after
      );
      /** Each case changes the value **it** binds, and says exactly what that should produce. */
      CASES[name].change(element.state);
      await frame();
      expect(
        element.shadowRoot.querySelector('#body').textContent,
        'the adopted text stopped following its binding'
      ).to.equal(CASES[name].then);
    });
  }

  it('a comment in the server markup does not defeat adoption', async () => {
    customElements.define(
      'text-edge-comment',
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const state = createStore({ n: 1 });
          this.state = state;
          render(() => html`<p id="body">${state.n}</p>`);
        }
      }
    );
    const host = document.createElement('div');
    host.setHTMLUnsafe(
      `<text-edge-comment><template shadowrootmode="open"><!-- from a proxy --><p id="body">1</p></template></text-edge-comment>`
    );
    document.body.appendChild(host);
    const element = host.firstElementChild;
    const before = element.shadowRoot.querySelector('#body');

    customElements.upgrade(element);
    await frame();
    await frame();

    /** Whatever it does with the comment, the page must end up as the template describes. */
    expect(element.shadowRoot.querySelector('#body').textContent).to.equal('1');
    element.state.n = 4;
    await frame();
    expect(element.shadowRoot.querySelector('#body').textContent).to.equal('4');
    void before;
  });
});
