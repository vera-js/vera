/**
 * What a shadow root does to ARIA — the constraint a component framework that defaults to shadow DOM
 * owes its users an answer about.
 *
 * `docs/CODE-PRINCIPLES.md` says accessibility is not a follow-up, and `init(this, { mode: 'open' })`
 * is the documented way to write a component. Every ID-based ARIA relationship — `aria-labelledby`,
 * `aria-describedby`, `<label for>` — resolves **within a single tree**, so a shadow boundary breaks
 * it silently: no error, no warning, and an element that simply has no accessible name.
 *
 * Asserted against the engines because it is the platform's rule and not the framework's, and
 * because the answer decides what the docs have to say.
 */
import { expect } from '@esm-bundle/chai';

const host = (html) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.attachShadow({ mode: 'open' }).innerHTML = html;
  return element;
};

it('label association works inside one shadow root', () => {
  const element = host('<label for="a">Name</label><input id="a">');
  const input = element.shadowRoot.querySelector('input');
  expect([...input.labels].length, 'a label in the same root should associate').to.equal(1);
});

it('and does not cross the shadow boundary', () => {
  const outer = document.createElement('div');
  outer.innerHTML = '<label for="crossing">Name</label>';
  document.body.appendChild(outer);
  const element = host('<input id="crossing">');
  const input = element.shadowRoot.querySelector('input');
  expect([...input.labels].length, 'a light-DOM label must not associate across the boundary').to.equal(0);
});

it('an id inside a shadow root is invisible to document.getElementById', () => {
  host('<span id="inner-only">x</span>');
  expect(document.getElementById('inner-only'), 'ids are scoped to their tree').to.equal(null);
});

/**
 * The escape hatch worth knowing: `ElementInternals` sets ARIA on the **host**, which lives in the
 * outer tree, so it is how a component exposes a role and a name without an ID relationship at all.
 */
it('ElementInternals sets ARIA on the host, which is the way across', () => {
  const tag = 'x-aria-internals';
  customElements.define(tag, class extends HTMLElement {
    constructor() { super(); this._internals = this.attachInternals(); }
  });
  const element = document.createElement(tag);
  document.body.appendChild(element);
  element._internals.role = 'button';
  element._internals.ariaLabel = 'Save';
  expect(element._internals.role).to.equal('button');
  expect(element._internals.ariaLabel).to.equal('Save');
});

/**
 * The three ways through, as `@verajs/core`'s README recommends them. Advice that has not been run
 * is a guess, and this is the file that stops it being one.
 */
import { init, render, html, css } from '../../packages/core/dist/development/vera.js';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { wire } from '../../packages/core/dist/development/vera.js';
import { styles } from '../../packages/styles/dist/development/vera-styles.js';

wire([{ on: 'render', fn: renderInto, priority: 50 }, styles]);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

it('1. label and control in the same template associate', async () => {
  const tag = 'x-aria-same-root';
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<label for="f">Email</label><input id="f" />`);
    }
  });
  const element = document.createElement(tag);
  document.body.appendChild(element);
  await frame();
  const input = element.shadowRoot.querySelector('input');
  expect([...input.labels].length, 'the README\'s first recommendation does not work').to.equal(1);
});

it('2. ElementInternals set before init survives it, and is visible on the host', async () => {
  const tag = 'x-aria-host';
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      this._internals ??= this.attachInternals();
      this._internals.role = 'button';
      this._internals.ariaLabel = 'Save';
      init(this, { mode: 'open' });
      render(() => html`<span>Save</span>`);
    }
  });
  const element = document.createElement(tag);
  document.body.appendChild(element);
  await frame();
  expect(element._internals.role, 'init clobbered the host role').to.equal('button');
  expect(element._internals.ariaLabel).to.equal('Save');
  expect(element.shadowRoot.textContent).to.equal('Save');
});

it('3. light DOM lets the page own the relationship, and static styles still apply', async () => {
  const tag = 'x-aria-light';
  customElements.define(tag, class extends HTMLElement {
    static styles = css`input { outline-color: rgb(1, 2, 3) }`;
    connectedCallback() {
      init(this);
      render(() => html`<input id="light-field" />`);
    }
  });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<label for="light-field">Email</label><${tag}></${tag}>`;
  document.body.appendChild(wrapper);
  await frame();
  const input = wrapper.querySelector('input');
  expect(input, 'light DOM rendered nothing').to.not.equal(null);
  expect([...input.labels].length, 'a page-owned label should associate with a light-DOM control').to.equal(1);
  expect(getComputedStyle(input).outlineColor, 'static styles did not reach light DOM').to.equal('rgb(1, 2, 3)');
});

it('delegatesFocus forwards focus to the first focusable child', async () => {
  const tag = 'x-aria-delegates';
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open', delegatesFocus: true });
      render(() => html`<input id="d" />`);
    }
  });
  const element = document.createElement(tag);
  document.body.appendChild(element);
  await frame();
  element.focus();
  expect(element.shadowRoot.activeElement, 'delegatesFocus did not forward').to.equal(
    element.shadowRoot.querySelector('input')
  );
});
