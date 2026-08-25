/**
 * Light-DOM `static styles` through the whole round trip.
 *
 * A component with no shadow root has its CSS **hoisted to the document once per class**, wrapped in
 * `@scope (tag) { … }`. Server-side that CSS comes back on `styles` rather than in the markup,
 * because it belongs to the page shell — so a server-rendered page has it in `<head>` before any
 * script runs, and the client then hoists it again when the component initialises.
 *
 * That is exactly the shape that had the shadow-DOM path applying its CSS twice: the server must
 * emit something a browser can use without JavaScript, and the client must not then add a second
 * copy of it. This asks the same question of the half that was never checked.
 */
import { expect } from '@esm-bundle/chai';
import { setRenderer, init, render, html, css, wire } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';
import { adoptStyles } from '../../packages/styles/dist/development/vera-styles.js';

setRenderer(hydratingRender);
wire({ on: 'init', fn: adoptStyles, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Exactly what `renderToString` returns on `styles` for the component below. */
const SERVER_CSS = '@scope (scoped-probe) {\n  .scoped { color: rgb(0, 128, 0); }\n}';

customElements.define(
  'scoped-probe',
  class extends HTMLElement {
    static styles = css`
      .scoped {
        color: rgb(0, 128, 0);
      }
    `;
    connectedCallback() {
      init(this);
      render(() => html`<p class="scoped">scoped to the tag</p>`);
    }
  }
);

/** How many places this component's rule is currently applied from. */
const applications = () => {
  const inSheets = [...document.adoptedStyleSheets].filter((sheet) =>
    [...sheet.cssRules].some((rule) => rule.cssText.includes('scoped-probe'))
  ).length;
  const inTags = [...document.querySelectorAll('style')].filter((element) =>
    element.textContent.includes('scoped-probe')
  ).length;
  return { inSheets, inTags };
};

it('the server CSS styles the page before any component runs', async () => {
  /** What a shell does with `styles`: put it in the document. */
  const shellStyle = document.createElement('style');
  shellStyle.id = 'from-server';
  shellStyle.textContent = SERVER_CSS;
  document.head.appendChild(shellStyle);

  const element = document.createElement('scoped-probe');
  element.innerHTML = '<p class="scoped">scoped to the tag</p>';
  document.body.appendChild(element);

  expect(
    getComputedStyle(element.querySelector('.scoped')).color,
    'a reader without JavaScript sees an unstyled component'
  ).to.equal('rgb(0, 128, 0)');
});

it('hoists once per class, however many instances there are', async () => {
  const before = applications();
  const host = document.createElement('div');
  for (let i = 0; i < 4; i++) host.appendChild(document.createElement('scoped-probe'));
  document.body.appendChild(host);
  await frame();
  await frame();

  const after = applications();
  const added = after.inSheets - before.inSheets + (after.inTags - before.inTags);
  expect(added, `four instances added ${added} copies of one class's CSS`).to.be.at.most(1);
});

it('the component is styled after hydration, from exactly one source', async () => {
  await frame();
  const element = document.querySelector('scoped-probe');
  expect(getComputedStyle(element.querySelector('.scoped')).color).to.equal('rgb(0, 128, 0)');

  const { inSheets, inTags } = applications();
  /**
   * The server's `<style>` and the client's hoisted sheet are two copies of the same rule. Both
   * being present is not *wrong* — `@scope` is idempotent and the page looks right — but it is a
   * second parse and a second match for every element, on every page, forever. Stated as a number
   * so a change to it is a decision rather than a surprise.
   */
  expect(inSheets + inTags, 'the same scoped rule is applied from more than two places').to.be.at.most(2);
});

it('the scope really does bound the rules', async () => {
  const outsider = document.createElement('p');
  outsider.className = 'scoped';
  document.body.appendChild(outsider);
  await frame();
  expect(
    getComputedStyle(outsider).color,
    '@scope did not bound the rule — it reached an element outside the component'
  ).to.not.equal('rgb(0, 128, 0)');
});
