import { expect } from '@esm-bundle/chai';
import { html } from '../../packages/core/dist/development/vera.js';
import { render } from '../../packages/renderer/dist/development/vera-renderer.js';

/**
 * A `.prop=${…}` binding must survive the target element's upgrade, in a real engine.
 *
 * This belongs here rather than only in jsdom because custom element upgrade timing is precisely
 * what jsdom emulates. The behaviour under test is a chain of real platform guarantees:
 * `customElements.define` upgrading already-parsed elements synchronously, the class's field
 * initializers running inside that upgrade, and `whenDefined` settling afterwards. A jsdom pass is
 * weak evidence for all three.
 *
 * The hazard is the autoloader's ordinary case. A parent renders `<child .item=${store}>` and the
 * child's module is fetched only then, so the property lands on an un-upgraded instance. When the
 * definition arrives, an ES2022 class field — what `item?: Thing` compiles to at target ES2022,
 * where `useDefineForClassFields` defaults to true — is a [[Define]], and it overwrites the bound
 * value with `undefined` before the component reads it.
 *
 * Tag names are written out in full because a tag name is not an interpolatable position: a
 * template can bind attributes and children, not element names.
 */

const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};
/** `whenDefined` settles on a microtask; one task turn is comfortably past it. */
const settle = () => new Promise((r) => setTimeout(r, 0));

it('survives an upgrade whose class field would clobber it', async () => {
  const host = mount();
  const store = { message: 'Hello Dark World' };

  render(html`<x-preup-clobber .item=${store}></x-preup-clobber>`, host);
  const el = host.querySelector('x-preup-clobber');
  expect(el.item === store).to.equal(true, 'binding applies before upgrade');

  customElements.define('x-preup-clobber', class extends HTMLElement { item = undefined; });
  expect(el.item === undefined).to.equal(true, 'the class field does clobber it, synchronously');

  await settle();
  expect(el.item === store).to.equal(true, 'and the renderer puts it back');
});

it('does not overwrite a value the component assigned itself', async () => {
  const host = mount();
  const store = { message: 'from the binding' };
  const own = { message: 'chosen by the component' };

  render(html`<x-preup-own .item=${store}></x-preup-own>`, host);
  const el = host.querySelector('x-preup-own');

  customElements.define('x-preup-own', class extends HTMLElement {
    constructor() { super(); this.item = own; }
  });
  await settle();
  expect(el.item === own).to.equal(true, 'the component keeps what it chose');
});

it('leaves an already-defined element alone', async () => {
  customElements.define('x-preup-defined', class extends HTMLElement {});
  const host = mount();
  const store = { message: 'direct' };

  render(html`<x-preup-defined .item=${store}></x-preup-defined>`, host);
  await settle();
  expect(host.querySelector('x-preup-defined').item === store).to.equal(true);
});

it('leaves plain built-in elements alone', async () => {
  const host = mount();
  render(html`<input .value=${'typed'} />`, host);
  await settle();
  expect(host.querySelector('input').value).to.equal('typed');
});
