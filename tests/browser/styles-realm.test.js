/**
 * **`static styles` in the window the component is in** — CODE-PRINCIPLES #2 and `@verajs/ui`'s rule
 * that every component works in a popped-out window.
 *
 * Found in the lean rebuild of `@verajs/styles` (2026-09-28) by reading it against the principle, not by
 * a report: `applyStyles` hoisted light-DOM styles into the GLOBAL `document` (the opener's, for a
 * component moved into another window), marked a class hoisted once per page rather than per document,
 * and handed a shadow root sheets built in the opener's window — which a document of another realm
 * cannot adopt. An iframe stands in for a popped-out window: same realm boundary, and only a real
 * browser enforces it.
 */
import { expect } from '@esm-bundle/chai';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html, wire, init } from '../../packages/core/dist/development/vera.js';
import { css, styles } from '../../packages/styles/dist/development/vera-styles.js';

wire([renderer, styles]);

const openIframe = async () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return iframe;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

customElements.define('x-realm-light-styled', class extends HTMLElement {
  static styles = css`p { color: rgb(1, 2, 3); }`;
  connectedCallback() {
    init(this, () => {
      return () => html`<p>light</p>`;
    });
  }
});

customElements.define('x-realm-shadow-styled', class extends HTMLElement {
  static styles = css`p { color: rgb(4, 5, 6); }`;
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>shadow</p>`;
    });
  }
});

it('a light-DOM component moved into another window is styled there, not in the opener', async () => {
  const iframe = await openIframe();
  const element = document.createElement('x-realm-light-styled');
  document.body.append(element);
  await settle();
  expect(getComputedStyle(element.querySelector('p')).color).to.equal('rgb(1, 2, 3)', 'CONTROL: styled in the opener');

  iframe.contentDocument.body.append(element);
  await settle();
  const paragraph = element.querySelector('p');
  expect(paragraph, 'CONTROL: it rendered in the iframe').to.not.equal(null);
  expect(iframe.contentWindow.getComputedStyle(paragraph).color).to.equal(
    'rgb(1, 2, 3)',
    'its styles were hoisted into the document it now lives in'
  );
  element.remove();
  iframe.remove();
});

it('a shadow component in another window is styled, though that window cannot adopt the opener\'s sheet', async () => {
  const iframe = await openIframe();
  const element = document.createElement('x-realm-shadow-styled');
  document.body.append(element);
  await settle();
  iframe.contentDocument.body.append(element);
  await settle();
  const paragraph = element.shadowRoot.querySelector('p');
  expect(paragraph, 'CONTROL: it rendered in the iframe').to.not.equal(null);
  expect(iframe.contentWindow.getComputedStyle(paragraph).color).to.equal(
    'rgb(4, 5, 6)',
    'the rules reached the shadow root in a form its window accepts'
  );
  element.remove();
  iframe.remove();
});
