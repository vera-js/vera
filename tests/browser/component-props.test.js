/**
 * Component props in real engines — upgrade timing is exactly what a fake DOM emulates weakly, and
 * this feature IS upgrade timing: the renderer records what a parent bound before the element
 * could receive it, and `init()` drains the record into reactive accessors. jsdom's suite
 * (`tests/component-props.test.mjs`) is the regression net; the browser run is the truth for the
 * clone-upgrades-before-commit ordering (eager) and define-clobbers-after-commit ordering (lazy)
 * these cases depend on.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, init, render, ref } from '../../packages/core/dist/development/vera.js';
import { renderer, renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { props } from '../../packages/renderer/dist/development/vera-renderer-spread.js';

wire([renderer]);

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const text = (el) => (el.shadowRoot ?? el).textContent.trim();
const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};

it('eager: a defined component reads bound props with no declaration, reactively', async () => {
  customElements.define('bp-eager', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.n)}</p>`);
    }
  });
  const host = mount();
  const draw = (n) => renderInto(html`<bp-eager .n=${n}></bp-eager>`, host);
  draw(1);
  await frame(); await frame();
  const el = host.querySelector('bp-eager');
  expect(text(el)).to.equal('1');
  draw(2);
  await frame(); await frame();
  expect(text(el)).to.equal('2');
});

it('lazy: a late definition’s field initializers do not destroy bound values — both spellings', async () => {
  const host = mount();
  renderInto(html`<bp-lazy ${props({ bare: 'bound-bare', defaulted: 'bound-def' })}></bp-lazy>`, host);
  await frame();
  customElements.define('bp-lazy', class extends HTMLElement {
    bare;
    defaulted = 'class-default';
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.bare} ${this.defaulted}</p>`);
    }
  });
  await customElements.whenDefined('bp-lazy');
  await frame(); await frame();
  expect(text(host.querySelector('bp-lazy'))).to.equal('bound-bare bound-def');
});

it('a ref through props() stays reactive across the boundary', async () => {
  customElements.define('bp-ref', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.box.value)}</p>`);
    }
  });
  const host = mount();
  const box = ref(5);
  renderInto(html`<bp-ref ${props({ box })}></bp-ref>`, host);
  await frame(); await frame();
  const el = host.querySelector('bp-ref');
  expect(text(el)).to.equal('5');
  box.value = 6;
  await frame(); await frame();
  expect(text(el)).to.equal('6');
});

it('a platform property on a lazy tag keeps its platform behavior after adoption', async () => {
  const host = mount();
  renderInto(html`<bp-platform .title=${'tip'} .payload=${42}></bp-platform>`, host);
  const raw = host.querySelector('bp-platform');
  expect(raw.title).to.equal('tip');
  customElements.define('bp-platform', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.payload)}</p>`);
    }
  });
  await customElements.whenDefined('bp-platform');
  await frame(); await frame();
  expect(text(raw)).to.equal('42');
  raw.title = 'still-platform';
  expect(raw.getAttribute('title')).to.equal('still-platform');
});
