import { expect } from '@esm-bundle/chai';
import { html } from '../../packages/core/dist/development/vera.js';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';

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

  renderInto(html`<x-preup-bare .item=${store}></x-preup-bare>`, host);
  const el = host.querySelector('x-preup-bare');
  expect(el.item === store).to.equal(true, 'binding applies before upgrade');

  customElements.define('x-preup-bare', class extends HTMLElement { item; });
  expect(el.item === undefined).to.equal(true, 'the field clobbers it, synchronously, in a real engine');

  await settle();
  expect(warnings.filter((w) => w.includes('item')).length).to.equal(1);
});

it('a field with a default destroys it too, and is reported', async () => {
  const host = mount();

  renderInto(html`<x-preup-default .count=${5}></x-preup-default>`, host);
  const el = host.querySelector('x-preup-default');

  customElements.define('x-preup-default', class extends HTMLElement { count = 0; });
  await settle();
  expect(el.count).to.equal(0, 'the default wins, which is why repairing only `undefined` was wrong');
  expect(warnings.filter((w) => w.includes('count')).length).to.equal(1);
});

it('a declared field keeps the bound value and says nothing', async () => {
  const host = mount();
  const store = { message: 'kept' };

  renderInto(html`<x-preup-declared .item=${store}></x-preup-declared>`, host);
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

  renderInto(html`<x-preup-defined .item=${store}></x-preup-defined>`, host);
  await settle();
  expect(host.querySelector('x-preup-defined').item === store).to.equal(true);
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});

it('leaves plain built-in elements alone', async () => {
  const host = mount();
  renderInto(html`<input .value=${'typed'} />`, host);
  await settle();
  expect(host.querySelector('input').value).to.equal('typed');
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});

/**
 * The defined-FIRST half: instances are stamped with `importNode`, whose cloning steps upgrade
 * defined elements at clone time, so a `.prop` commit goes through the class — in the engine's own
 * words, not jsdom's. Before the fix a `cloneNode` fragment stayed un-upgraded until insertion:
 * the setter below fired zero times with a dead own property shadowing it forever, and the field
 * case silently read back its initializer.
 */
it('a defined accessor fires — the clone upgrades before the commit', async () => {
  let setterRuns = 0;
  customElements.define('x-preup-accessor', class extends HTMLElement {
    set item(v) { setterRuns++; this._held = v; }
    get item() { return this._held; }
  });
  const host = mount();
  const store = { message: 'through the class' };

  renderInto(html`<x-preup-accessor .item=${store}></x-preup-accessor>`, host);
  const el = host.querySelector('x-preup-accessor');
  expect(setterRuns).to.equal(1, 'the class setter received the commit');
  expect(Object.getOwnPropertyDescriptor(el, 'item')).to.equal(undefined, 'no own property shadows it');
  expect(el.item === store).to.equal(true);
  await settle();
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});

it('a defined field initializer runs before the commit, so the binding wins', async () => {
  customElements.define('x-preup-fielded', class extends HTMLElement { count = 0; });
  const host = mount();

  renderInto(html`<x-preup-fielded .count=${5}></x-preup-fielded>`, host);
  await settle();
  expect(host.querySelector('x-preup-fielded').count).to.equal(5);
  expect(warnings.length).to.equal(0, warnings.join(' | '));
});
