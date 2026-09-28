/**
 * **`@verajs/renderer/elements`' unrelated consumer, on the engines: `autofocus` that works after load.**
 *
 * Measured on Chromium, Firefox and WebKit before this was built (portal probe `autofocus`): the first
 * `autofocus` element rendered after page load takes focus, and EVERY LATER ONE IS IGNORED — so in an
 * app, the second form that appears (an edit dialog, a step two) never gets the focus its markup asks
 * for. The five-line claim below is the README's recipe; it runs because `mount` fires once the render
 * has finished, with the element in place, which is the whole reason mount waits for that.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { elements } from '../../packages/renderer/dist/development/vera-renderer-elements.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';

const autofocus = { mount: (element) => element.focus() };
wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('autofocus') ? autofocus : undefined), priority: 50 }]);

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const form = (step) => html`<form><label>Step ${step} <input autofocus name=${'f' + step}></label></form>`;

it('every form rendered after load takes the focus its autofocus asks for', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const other = document.createElement('div');
  document.body.append(other);

  renderInto(form(1), host);
  await settle();
  expect(document.activeElement?.getAttribute('name')).to.equal('f1', 'the first');

  document.activeElement.blur();
  renderInto(form(2), other);
  await settle();
  expect(document.activeElement?.getAttribute('name')).to.equal('f2', 'and the second — which the platform alone ignores');
  host.remove();
  other.remove();
});

it('CONTROL: without the claim, the platform ignores the second one', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  host.innerHTML = '<input autofocus name="plain1">';
  await settle();
  document.activeElement?.blur();
  host.innerHTML = '<input autofocus name="plain2">';
  await settle();
  expect(document.activeElement?.getAttribute('name')).to.not.equal('plain2', 'the gap this closes is real on this engine');
  host.remove();
});
