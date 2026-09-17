/**
 * Component reception of bound properties — the `_$props$` record and `init()`'s drain.
 *
 * The renderer records what a parent's `.name`/`props()` bindings delivered before anything could
 * receive them, and `init()` drains that record into store-backed accessors: no `static
 * properties`, no props argument. Two arrival orders both matter and are asserted separately,
 * because they fail differently: an EAGER component's values survive the upgrade but are
 * indistinguishable from its own fields by `connectedCallback`, and a LAZY one's values are
 * overwritten by the class's field initializers at upgrade — in BOTH field spellings, `item;` and
 * `item = default`, which is why the drain re-applies unconditionally rather than detecting.
 *
 * Under the production build this suite is also the mangling proof: the record is written by the
 * renderer bundle and drained by core's, so it passes only if `_$props$` survives both builds.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
                 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent',
                 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { html, wire, init, render, ref, createStore, useEffect } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread, props } = await load('renderer/spread');
wire([renderer]);

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const text = (el) => (el.shadowRoot ?? el).textContent.trim();
const mount = (tag) => {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
};

test('eager: an accessor read in render is tracked, and the parent’s next commit re-renders', async () => {
  customElements.define('cp-eager', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.n)}</p>`);
    }
  });
  const host = mount();
  const draw = (n) => renderInto(html`<cp-eager .n=${n}></cp-eager>`, host);
  draw(1);
  await frame(); await frame();
  const el = host.querySelector('cp-eager');
  assert.equal(text(el), '1', 'the bound value is readable as this.n with no declaration');
  draw(2);
  await frame(); await frame();
  assert.equal(text(el), '2', 'the parent’s property commit lands in the accessor and re-renders');
});

test('lazy: the field-initializer clobber is repaired, in both field spellings — and silently', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  const host = mount();
  renderInto(html`<cp-lazy ${props({ bare: 'bound-bare', defaulted: 'bound-def' })}></cp-lazy>`, host);
  customElements.define('cp-lazy', class extends HTMLElement {
    bare;                                  // the `item;` spelling — initializes to undefined
    defaulted = 'class-default';           // the `item = default` spelling — a plausible value
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.bare} ${this.defaulted}</p>`);
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  console.warn = realWarn;
  assert.equal(text(host.querySelector('cp-lazy')), 'bound-bare bound-def',
    'both spellings resolve to the bound value — a bound value outranks a class default');
  assert.deepEqual(warned, [],
    'a repaired clobber is not warned about — the detector checks ownership, not identity, ' +
      'so the store proxy a drained value reads back as never trips it');
});

test('a ref passed through props() stays live: mutating ref.value re-renders the child', async () => {
  customElements.define('cp-ref', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.box.value)}</p>`);
    }
  });
  const host = mount();
  const box = ref(5);
  renderInto(html`<cp-ref ${props({ box })}></cp-ref>`, host);
  await frame(); await frame();
  const el = host.querySelector('cp-ref');
  assert.equal(text(el), '5');
  box.value = 6;
  await frame(); await frame();
  assert.equal(text(el), '6', 'the ref arrived by identity, so its subscription reaches the child’s render');
});

test('a store passed through props() stays live: mutating the inner store re-renders', async () => {
  customElements.define('cp-store', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.model.n)}</p>`);
    }
  });
  const host = mount();
  const model = createStore({ n: 10 });
  renderInto(html`<cp-store ${props({ model })}></cp-store>`, host);
  await frame(); await frame();
  const el = host.querySelector('cp-store');
  assert.equal(text(el), '10');
  model.n = 11;
  await frame(); await frame();
  assert.equal(text(el), '11', 'a store inside the adoption store still tracks — the proxies compose');
});

test('a platform property on a lazy tag is never recorded, and survives the drain intact', async () => {
  const host = mount();
  renderInto(html`<cp-platform .title=${'tip'} .payload=${42}></cp-platform>`, host);
  const raw = host.querySelector('cp-platform');
  assert.equal(raw.title, 'tip', 'pre-upgrade, .title reached HTMLElement.prototype’s accessor');
  customElements.define('cp-platform', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.payload)}</p>`);
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  assert.equal(text(raw), '42', 'the custom property was adopted');
  raw.title = 'still-platform';
  assert.equal(raw.getAttribute('title'), 'still-platform',
    'the platform accessor still answers for .title — the drain never shadowed it');
});

test('a defined non-vera element is untouched: its own accessor receives, nothing is recorded', () => {
  customElements.define('cp-foreign', class extends HTMLElement {
    #v;
    get item() { return this.#v; }
    set item(value) { this.#v = value; }
  });
  const host = mount();
  const draw = (n) => renderInto(html`<cp-foreign .item=${n}></cp-foreign>`, host);
  draw(1);
  const el = host.querySelector('cp-foreign');
  assert.equal(el.item, 1, 'the value went through the element’s own setter');
  assert.equal(el._$props$?.item, undefined, 'an accessor-received property is never recorded');
  draw(2);
  assert.equal(el.item, 2, 'the update path is the plain property write');
});

test('the spread surface records through the same channel — the deliberate twin', async () => {
  const host = mount();
  renderInto(html`<cp-spread ${spread({ '.data': 'via-spread' })}></cp-spread>`, host);
  customElements.define('cp-spread', class extends HTMLElement {
    data;
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.data}</p>`);
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  assert.equal(text(host.querySelector('cp-spread')), 'via-spread',
    'spread’s recorder repaired the clobber exactly as the template part’s does');
});

test('a key arriving AFTER init() is adopted live — the conditional-keys idiom stays reactive', async () => {
  let effectRuns = 0;
  customElements.define('cp-late', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      useEffect(() => {
        effectRuns++;
      });
      render(() => html`<p>${String(this.a)} ${this.b === undefined ? 'no-b' : String(this.b)}</p>`);
    }
  });
  const host = mount();
  const draw = (bag) => renderInto(html`<cp-late ${spread(bag)}></cp-late>`, host);
  draw({ '.a': 1 });
  await frame(); await frame();
  const el = host.querySelector('cp-late');
  assert.equal(text(el), '1 no-b');
  const effectsBefore = effectRuns;
  draw({ '.a': 1, '.b': 2 });                  // the bag grows a key on a LIVE, drained element
  await frame(); await frame();
  assert.equal(text(el), '1 2',
    'the late key went through _$adopt$, not into a record nobody drains — and re-rendered');
  assert.equal(effectRuns, effectsBefore,
    'only the RENDER hooks were re-run — a prop arriving must not re-fire side effects');
  draw({ '.a': 1, '.b': 3 });
  await frame(); await frame();
  assert.equal(text(el), '1 3', 'and stays reactive on later commits');
});

test('a component’s own accessor pair is handed the value, never hijacked by the drain', async () => {
  const host = mount();
  renderInto(html`<cp-own-accessor ${props({ item: 'delivered' })}></cp-own-accessor>`, host);
  let setterRan = 0;
  customElements.define('cp-own-accessor', class extends HTMLElement {
    #item;
    get item() { return this.#item; }
    set item(value) { setterRan++; this.#item = value; }   // private-field pair — the drain must not shadow it
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.item}</p>`);
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  const el = host.querySelector('cp-own-accessor');
  assert.equal(setterRan, 1, 'the recorded value went through the class’s own setter');
  assert.equal(text(el), 'delivered');
  assert.equal(Object.getOwnPropertyDescriptor(el, 'item'), undefined,
    'no own accessor shadows the pair — the class still owns the property');
});

test('a getter-only property refuses by name instead of throwing out of init()', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  const host = mount();
  renderInto(html`<cp-readonly ${props({ locked: 'overwrite' })}></cp-readonly>`, host);
  customElements.define('cp-readonly', class extends HTMLElement {
    get locked() { return 'immutable'; }
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.locked}</p>`);
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  console.warn = realWarn;
  assert.equal(text(host.querySelector('cp-readonly')), 'immutable', 'the getter still answers');
  const complaints = warned.filter((w) => w.includes('locked'));
  assert.equal(complaints.length, isProduction ? 0 : 1,
    'development names the refused binding once; production is silent');
});

test('the drain runs once: a reconnect keeps the adopted values and their reactivity', async () => {
  customElements.define('cp-reconnect', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${String(this.n)}</p>`);
    }
  });
  const host = mount();
  renderInto(html`<cp-reconnect .n=${7}></cp-reconnect>`, host);
  await frame(); await frame();
  const el = host.querySelector('cp-reconnect');
  assert.equal(text(el), '7');
  const parent = el.parentNode;
  el.remove();
  parent.append(el);                       // connectedCallback runs again — init(), no record
  await frame(); await frame();
  assert.equal(text(el), '7', 'the accessor and its value survive the second init()');
});
