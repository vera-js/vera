/**
 * **`static styles` in the window the component is in** — CODE-PRINCIPLES #2 and `@vera-components/select`'s rule
 * that every component works in a popped-out window.
 *
 * Found while rebuilding `@verajs/styles` (2026-09-28) by reading it against the principle, not by
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
import { until } from './until.js';

wire([renderer, styles]);

const openIframe = async () => {
  const iframe = document.createElement('iframe');
  /** Listened for before the append: an engine may fire an empty iframe's load during it. */
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  document.body.append(iframe);
  await loaded;
  return iframe;
};
/** The color a rendered paragraph computes in its own window, or null before it renders. */
const colorIn = (root) => {
  const p = root?.querySelector('p');
  return p ? p.ownerDocument.defaultView.getComputedStyle(p).color : null;
};

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
  await until(() => colorIn(element) === 'rgb(1, 2, 3)', 'styled in the opener', 5000);
  expect(getComputedStyle(element.querySelector('p')).color).to.equal('rgb(1, 2, 3)', 'CONTROL: styled in the opener');

  iframe.contentDocument.body.append(element);
  await until(() => element.ownerDocument === iframe.contentDocument && colorIn(element) === 'rgb(1, 2, 3)', 'styled in the iframe', 5000);
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
  await until(() => colorIn(element.shadowRoot) === 'rgb(4, 5, 6)', 'styled in the opener', 5000);
  iframe.contentDocument.body.append(element);
  await until(() => element.ownerDocument === iframe.contentDocument && colorIn(element.shadowRoot) === 'rgb(4, 5, 6)', 'styled in the iframe', 5000);
  const paragraph = element.shadowRoot.querySelector('p');
  expect(paragraph, 'CONTROL: it rendered in the iframe').to.not.equal(null);
  expect(iframe.contentWindow.getComputedStyle(paragraph).color).to.equal(
    'rgb(4, 5, 6)',
    'the rules reached the shadow root in a form its window accepts'
  );
  element.remove();
  iframe.remove();
});
