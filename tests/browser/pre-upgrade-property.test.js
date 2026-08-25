import { expect } from '@esm-bundle/chai';
import { html } from '../../packages/core/dist/development/vera.js';
import { render, handle } from '../../packages/renderer/dist/development/vera-renderer.js';
/** List rendering is a module. These suites drive the renderer directly, so they use the
 *  no-registry door rather than `wire([domRender, lists])`. */
import { lists as __lists } from '../../packages/renderer/dist/development/vera-renderer-lists.js';
handle(__lists.fn);


/**
 * A `.prop=${…}` binding is destroyed when the target element upgrades — in a real engine.
 *
 * This belongs in the browser layer and not only in jsdom because custom element upgrade timing is
 * exactly what jsdom emulates. Three real platform guarantees are under test: `customElements.define`
 * upgrading already-parsed elements synchronously, the class's field initializers running inside
 * that upgrade, and `whenDefined` settling afterwards.
 *
 * The framework reports this rather than repairing it. Repair was implemented and removed: it
 * covered `item?: Thing` but not `item = someDefault`, so it was silently partial, and it left
 * `declare` mandatory anyway because an imperatively assigned property is unrecoverable.
 *
 * Tag names are written out in full — a tag name is not an interpolatable position; a template can
 * bind attributes and children, not element names.
 */

const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};
/** `whenDefined` settles on a microtask; one task turn is comfortably past it. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let warnings = [];
const realWarn = console.warn;
beforeEach(() => { warnings = []; console.warn = (...a) => warnings.push(a.join(' ')); });
afterEach(() => { console.warn = realWarn; });

it('a bare class field destroys the bound value, and is reported', async () => {
  const host = mount();
  const store = { message: 'Hello Dark World' };

  render(html`<x-preup-bare .item=${store}></x-preup-bare>`, host);
  const el = host.querySelector('x-preup-bare');
  expect(el.item === store).to.equal(true, 'binding applies before upgrade');

  customElements.define('x-preup-bare', class extends HTMLElement { item; });
  expect(el.item === undefined).to.equal(true, 'the field clobbers it, synchronously, in a real engine');

  await settle();
  expect(warnings.filter((w) => w.includes('item')).length).to.equal(1);
});

it('a field with a default destroys it too, and is reported', async () => {
  const host = mount();

  render(html`<x-preup-default .count=${5}></x-preup-default>`, host);
  const el = host.querySelector('x-preup-default');

  customElements.define('x-preup-default', class extends HTMLElement { count = 0; });
  await settle();
  expect(el.count).to.equal(0, 'the default wins, which is why repairing only `undefined` was wrong');
  expect(warnings.filter((w) => w.includes('count')).length).to.equal(1);
});

it('a declared field keeps the bound value and says nothing', async () => {
  const host = mount();
  const store = { message: 'kept' };

  render(html`<x-preup-declared .item=${store}></x-preup-declared>`, host);
  const el = host.querySelector('x-preup-declared');

  customElements.define('x-preup-declared', class extends HTMLElement {});  // what `declare` emits
  await settle();
  expect(el.item === store).to.equal(true);
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});

it('leaves an already-defined element alone', async () => {
  customElements.define('x-preup-defined', class extends HTMLElement {});
  const host = mount();
  const store = { message: 'direct' };

  render(html`<x-preup-defined .item=${store}></x-preup-defined>`, host);
  await settle();
  expect(host.querySelector('x-preup-defined').item === store).to.equal(true);
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});

it('leaves plain built-in elements alone', async () => {
  const host = mount();
  render(html`<input .value=${'typed'} />`, host);
  await settle();
  expect(host.querySelector('input').value).to.equal('typed');
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});
