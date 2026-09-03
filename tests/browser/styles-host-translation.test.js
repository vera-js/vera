/**
 * **The same stylesheet has to style the element in BOTH modes**, which is the styling half of the
 * one-version-of-every-component promise and was the half that did not hold. Measured here before
 * the translation existed: `:host` and `:host(.flag)` applied under a shadow root and did nothing
 * in light DOM, while ordinary rules applied in both.
 *
 * `:host` is how a web component styles its own element — every component published to npm uses
 * it — so this cannot be solved by telling authors to write something else. It is translated to
 * `:scope`, which inside the `@scope (tag)` block the styles module already emits IS the element.
 *
 * A real engine is the only oracle: jsdom has no `@scope`, so the whole scoped branch falls through
 * there and this parity is invisible to the node suites.
 */
import { expect } from '@esm-bundle/chai';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { styles } from '../../packages/styles/dist/development/vera-styles.js';
import { html, wire, init, render, css } from '../../packages/core/dist/development/vera.js';

wire([renderer, styles]);
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** ONE stylesheet, shared by both components — the point is that it is the same source. */
const SHEET = css`
  :host { border-top-style: dashed }
  :host(.flag) { border-right-style: double }
  p { border-left-style: dotted }
  q::after { content: ":host" }
`;
customElements.define('ht-light', class extends HTMLElement {
  static styles = SHEET;
  connectedCallback() { init(this); render(() => html`<p>x</p><q></q>`); }
});
customElements.define('ht-shadow', class extends HTMLElement {
  static styles = SHEET;
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>x</p><q></q>`); }
});

it('styles the element itself from :host in light DOM, exactly as under a shadow root', async () => {
  expect(typeof CSSScopeRule).to.equal('function', 'CONTROL: this engine has @scope, so the scoped branch runs');
  document.body.innerHTML = '<ht-light class="flag"></ht-light><ht-shadow class="flag"></ht-shadow>';
  await frame();

  const reading = {};
  for (const tag of ['ht-light', 'ht-shadow']) {
    const element = document.querySelector(tag);
    const root = element.shadowRoot ?? element;
    const own = getComputedStyle(element);
    reading[tag] = {
      host: own.borderTopStyle,
      hostFunctional: own.borderRightStyle,
      ownContent: getComputedStyle(root.querySelector('p')).borderLeftStyle,
      valueUntouched: getComputedStyle(root.querySelector('q'), '::after').content,
    };
  }

  expect(reading['ht-shadow']).to.deep.equal(
    { host: 'dashed', hostFunctional: 'double', ownContent: 'dotted', valueUntouched: '":host"' },
    'CONTROL: this is what the platform does with the same sheet under a shadow root'
  );
  expect(reading['ht-light']).to.deep.equal(reading['ht-shadow'], 'and light DOM must read identically');
});

it('does not leak the translated rules to anything outside the component', async () => {
  document.body.innerHTML = '<ht-light class="flag"></ht-light><p id="outsider">out</p>';
  await frame();
  expect(getComputedStyle(document.getElementById('outsider')).borderLeftStyle).to.equal('none',
    'a `p` outside the component must be untouched — @scope is what keeps the rewrite honest');
  expect(getComputedStyle(document.body).borderTopStyle).to.equal('none',
    ':scope must bind to the component, not to whatever else the document contains');
});
