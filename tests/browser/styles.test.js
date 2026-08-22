import { expect } from '@esm-bundle/chai';
import { init, createStore, render, setRenderer, css, html, insert } from '../../packages/core/dist/development/vera.js';
import { render as domRender } from '../../packages/renderer/dist/development/vera-renderer.js';
import { adoptStyles, applyStyles } from '../../packages/styles/dist/development/vera-styles.js';

/**
 * `@verajs/styles`, in an engine that actually implements the platform it targets.
 *
 * Under jsdom this package sat at 60% branches and had **never executed its primary path**: there
 * is no `adoptedStyleSheets`, no `CSSStyleSheet.replaceSync` and no `CSSScopeRule` there, so every
 * jsdom test fell through to the `<style>` fallback. Everything below is the code that actually
 * runs for a user, tested for the first time.
 */

setRenderer(domRender);
insert('init', adoptStyles, 50);

let seq = 0;
const define = (body, options) => {
  const tag = `x-style-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = options;
    connectedCallback() {
      init(this, body.shadow === false ? undefined : { mode: 'open' });
      const state = createStore({ n: 0 });
      render(() => body.template(state));
    }
  });
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
};

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

it('the platform features jsdom lacks are actually here', () => {
  expect('adoptedStyleSheets' in document, 'document.adoptedStyleSheets').to.be.true;
  expect(typeof CSSStyleSheet.prototype.replaceSync, 'replaceSync').to.equal('function');
});

it('a constructed stylesheet is adopted into the shadow root, not injected as <style>', async () => {
  const sheet = css`p { color: rgb(0, 128, 0); }`;
  const el = define({ template: (state) => html`<p>${state.n}</p>` }, sheet);
  await frame();

  const root = el.shadowRoot;
  expect(root.adoptedStyleSheets.length, 'a sheet was adopted').to.equal(1);
  expect(root.adoptedStyleSheets[0]).to.equal(sheet.styleSheet);
  expect(root.querySelector('style[vera-styles]'), 'no <style> fallback was used').to.equal(null);
  el.remove();
});

it('adopted styles actually apply to the rendered DOM', async () => {
  const sheet = css`p { color: rgb(0, 128, 0); }`;
  const el = define({ template: (state) => html`<p>styled ${state.n}</p>` }, sheet);
  await frame();
  const p = el.shadowRoot.querySelector('p');
  /** The point of the whole package: the rule reaches the element. jsdom cannot answer this. */
  expect(getComputedStyle(p).color).to.equal('rgb(0, 128, 0)');
  el.remove();
});

it('re-adopting does not accumulate sheets', async () => {
  const sheet = css`p { color: red; }`;
  const el = define({ template: (state) => html`<p>${state.n}</p>` }, sheet);
  await frame();
  adoptStyles(el);
  adoptStyles(el);
  expect(el.shadowRoot.adoptedStyleSheets.length).to.equal(1);
  el.remove();
});

it('light-DOM styles hoist to the document, scoped to the tag', async () => {
  const before = document.adoptedStyleSheets.length;
  const sheet = css`em { color: rgb(0, 0, 255); }`;
  const el = define({ shadow: false, template: (state) => html`<em>${state.n}</em>` }, sheet);
  await frame();

  expect(document.adoptedStyleSheets.length, 'hoisted to the document').to.equal(before + 1);
  expect(el.querySelector('style'), 'nothing injected inside the element').to.equal(null);

  const text = [...document.adoptedStyleSheets.at(-1).cssRules].map((r) => r.cssText).join('');
  if (typeof CSSScopeRule === 'function') {
    expect(text, 'wrapped in @scope so it cannot leak').to.contain('@scope');
    expect(text).to.contain(el.localName);
  }
  el.remove();
});

it('@scope actually confines light-DOM styles to the component subtree', async function () {
  if (typeof CSSScopeRule !== 'function') this.skip();
  const sheet = css`b { color: rgb(255, 0, 0); }`;
  const el = define({ shadow: false, template: (state) => html`<b>inside ${state.n}</b>` }, sheet);
  await frame();

  const outside = document.createElement('b');
  outside.textContent = 'outside';
  document.body.appendChild(outside);

  expect(getComputedStyle(el.querySelector('b')).color, 'applies inside').to.equal('rgb(255, 0, 0)');
  expect(getComputedStyle(outside).color, 'does NOT leak outside').to.not.equal('rgb(255, 0, 0)');
  el.remove();
  outside.remove();
});

it('applyStyles falls back to a <style> element for a plain string', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.attachShadow({ mode: 'open' });
  applyStyles('i { color: rgb(128, 0, 128); }', el);
  const style = el.shadowRoot.querySelector('style[vera-styles]');
  expect(style, 'string styles use the <style> path even in a modern browser').to.not.equal(null);
  el.shadowRoot.innerHTML += '<i>x</i>';
  expect(getComputedStyle(el.shadowRoot.querySelector('i')).color).to.equal('rgb(128, 0, 128)');
  el.remove();
});
