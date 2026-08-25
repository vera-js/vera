import { expect } from '@esm-bundle/chai';
import { init, createStore, render, wire, css, html} from '../../packages/core/dist/development/vera.js';
import { render as renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { adoptStyles } from '../../packages/styles/dist/development/vera-styles.js';

/**
 * How `@verajs/styles` behaves when things change — the question being: does a `var()` in
 * `static styles` track a custom property that moves at runtime?
 *
 * Two mechanisms are easy to conflate. The **sheet** is adopted once and is immutable in practice:
 * `adoptStyles` runs on the `init` insert, once per element for shadow DOM and once per *class*
 * ever for light DOM, and the `styleSheet` behind `css` is a static member shared by every
 * instance. The **values inside it** are a platform concern — `var()` resolves against the
 * element's inherited custom properties at computed-style time, so it re-resolves whenever those
 * change, no matter how the sheet got there.
 *
 * So static styles are not reactive, and do not need to be: custom properties are the seam.
 * Everything below pins that down in an engine that actually implements adoptedStyleSheets and
 * @scope, which jsdom does not.
 */

wire({ on: 'render', fn: renderer, priority: 50 });
wire({ on: 'init', fn: adoptStyles, priority: 50 });

let seq = 0;
const mount = (el) => { document.body.appendChild(el); return el; };
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const colorOf = (node) => getComputedStyle(node).color;

it('a var() in shadow-adopted styles tracks a change on the host', async () => {
  const tag = `x-dynvar-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = css`p { color: var(--accent, rgb(0, 0, 255)); }`;
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>tinted</p>`);
    }
  });
  const el = mount(document.createElement(tag));
  await frame();
  const p = el.shadowRoot.querySelector('p');
  expect(colorOf(p)).to.equal('rgb(0, 0, 255)', 'the fallback applies first');

  // Custom properties inherit *through* the shadow boundary, which is what makes this work.
  el.style.setProperty('--accent', 'rgb(255, 0, 0)');
  expect(colorOf(p)).to.equal('rgb(255, 0, 0)', 'and the adopted sheet re-resolves it');
});

it('an inherited var from an ancestor reaches into the shadow root too', async () => {
  const tag = `x-dynvar-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = css`p { color: var(--accent, rgb(0, 0, 255)); }`;
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>tinted</p>`);
    }
  });
  const wrapper = mount(document.createElement('div'));
  const el = wrapper.appendChild(document.createElement(tag));
  await frame();
  const p = el.shadowRoot.querySelector('p');

  wrapper.style.setProperty('--accent', 'rgb(0, 128, 0)');
  expect(colorOf(p)).to.equal('rgb(0, 128, 0)');
});

it('the same holds for light-DOM styles hoisted under @scope', async () => {
  const tag = `x-dynvar-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = css`p { color: var(--accent, rgb(0, 0, 255)); }`;
    connectedCallback() {
      init(this);                       // no shadow root — the @scope hoist path
      render(() => html`<p>tinted</p>`);
    }
  });
  const el = mount(document.createElement(tag));
  await frame();
  const p = el.querySelector('p');
  expect(colorOf(p)).to.equal('rgb(0, 0, 255)');

  el.style.setProperty('--accent', 'rgb(255, 0, 0)');
  expect(colorOf(p)).to.equal('rgb(255, 0, 0)');
});

it('reactive state drives it through a style binding on an element in the template', async () => {
  const tag = `x-dynvar-${seq++}`;
  let state;
  customElements.define(tag, class extends HTMLElement {
    static styles = css`p { color: var(--accent, rgb(0, 0, 255)); }`;
    connectedCallback() {
      init(this, { mode: 'open' });
      state = createStore({ accent: 'rgb(0, 0, 255)' });
      render(() => html`<div style="--accent: ${state.accent}"><p>tinted</p></div>`);
    }
  });
  const el = mount(document.createElement(tag));
  await frame();
  const p = el.shadowRoot.querySelector('p');
  expect(colorOf(p)).to.equal('rgb(0, 0, 255)');

  state.accent = 'rgb(255, 0, 0)';
  await frame();
  expect(colorOf(p)).to.equal('rgb(255, 0, 0)', 'a store write re-renders the binding, the var re-resolves');
});

it('the sheet itself is NOT reactive — replacing `static styles` after init does nothing', async () => {
  const tag = `x-dynvar-${seq++}`;
  const Klass = class extends HTMLElement {
    static styles = css`p { color: rgb(0, 0, 255); }`;
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>tinted</p>`);
    }
  };
  customElements.define(tag, Klass);
  const el = mount(document.createElement(tag));
  await frame();
  const p = el.shadowRoot.querySelector('p');
  expect(colorOf(p)).to.equal('rgb(0, 0, 255)');

  // adoptStyles ran once, on the `init` insert. Nothing re-reads the static member.
  Klass.styles = css`p { color: rgb(255, 0, 0); }`;
  await frame();
  expect(colorOf(p)).to.equal('rgb(0, 0, 255)', 'unchanged — use a custom property, not a new sheet');
});

it('a constructed sheet is shared by every instance, so it cannot carry per-instance values', async () => {
  const tag = `x-dynvar-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = css`p { color: var(--accent, rgb(0, 0, 255)); }`;
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>tinted</p>`);
    }
  });
  const a = mount(document.createElement(tag));
  const b = mount(document.createElement(tag));
  await frame();

  expect(a.shadowRoot.adoptedStyleSheets[0]).to.equal(
    b.shadowRoot.adoptedStyleSheets[0],
    'one sheet object, adopted by both — mutating it would hit every instance'
  );

  // Per-instance variation therefore comes from the host, not the sheet.
  a.style.setProperty('--accent', 'rgb(255, 0, 0)');
  expect(colorOf(a.shadowRoot.querySelector('p'))).to.equal('rgb(255, 0, 0)');
  expect(colorOf(b.shadowRoot.querySelector('p'))).to.equal('rgb(0, 0, 255)', 'the sibling is untouched');
});
