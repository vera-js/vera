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

const { html, wire, init, ref, createStore, useEffect } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread, props } = await load('renderer/spread');
wire([renderer]);

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const text = (el) => (el.shadowRoot ?? el).textContent.trim();
const mount = () => {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
};

test('eager: an accessor read in render is tracked, and the parent’s next commit re-renders', async () => {
  customElements.define('cp-eager', class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${String(this.n)}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.bare} ${this.defaulted}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${String(this.box.value)}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${String(this.model.n)}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${String(this.payload)}</p>`;
      });
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  assert.equal(text(raw), '42', 'the custom property was adopted');
  raw.title = 'still-platform';
  assert.equal(raw.getAttribute('title'), 'still-platform',
    'the platform accessor still answers for .title — the drain never shadowed it');
});

test('lazy, and the element never calls init(): the clobber is NAMED in development — the silence above is not deafness', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(String(args[0]));
  const host = mount();
  renderInto(html`<cp-lazy-plain .item=${'bound'}></cp-lazy-plain>`, host);
  customElements.define('cp-lazy-plain', class extends HTMLElement {
    item;                                  // no init(): nothing drains, so the field wins
  });
  dom.window.customElements.upgrade(host);
  await frame();
  console.warn = realWarn;
  assert.equal(host.querySelector('cp-lazy-plain').item, undefined, 'the control: the field really did clobber it');
  const named = warned.filter((w) => w.includes('was replaced while the element upgraded'));
  assert.equal(named.length, isProduction ? 0 : 1, named.join(' | '));
  if (!isProduction) assert.match(named[0], /^\[vera\] renderer: <cp-lazy-plain> — the value bound to `item` was replaced while the element upgraded[\s\S]*`declare item\?: …`[\s\S]*\(upgrade-clobber\)$/);
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.data}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        useEffect(() => {
          effectRuns++;
        });
        return () => html`<p>${String(this.a)} ${this.b === undefined ? 'no-b' : String(this.b)}</p>`;
      });
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.item}</p>`;
      });
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

/**
 * **An accessor on the INSTANCE is handed the value too** — one a constructor installs with
 * `Object.defineProperty(this, …)`, which the prototype walk never sees. Without the own-descriptor
 * check the drain deleted it and put a store accessor in its place, so the component's setter never ran
 * and its property stopped being its own (found by the lean rebuild's mutation controls, 2026-09-28:
 * nothing failed without that check).
 */
test('an accessor the instance defines on itself is handed the value, never replaced', async () => {
  const host = mount();
  renderInto(html`<cp-instance-accessor ${props({ item: 'delivered' })}></cp-instance-accessor>`, host);
  let setterRan = 0;
  customElements.define('cp-instance-accessor', class extends HTMLElement {
    constructor() {
      super();
      let item;
      Object.defineProperty(this, 'item', {
        get: () => item,
        set: (value) => { setterRan++; item = value; },
        configurable: true,
      });
    }
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.item}</p>`;
      });
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  const el = host.querySelector('cp-instance-accessor');
  assert.equal(setterRan, 1, 'the recorded value went through the instance’s own setter');
  assert.equal(text(el), 'delivered');
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
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.locked}</p>`;
      });
    }
  });
  dom.window.customElements.upgrade(host);
  await frame(); await frame();
  console.warn = realWarn;
  assert.equal(text(host.querySelector('cp-readonly')), 'immutable', 'the getter still answers');
  const complaints = warned.filter((w) => w.includes('locked'));
  assert.equal(complaints.length, isProduction ? 0 : 1,
    'development names the refused binding once; production is silent');
  if (!isProduction) assert.match(complaints[0], /\(getter-only-prop\)$/, 'by its code');
});

test('EAGER get-only refuses identically — one rule for both arrival orders, and no throw', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  customElements.define('cp-readonly-eager', class extends HTMLElement {
    get locked() { return 'immutable'; }
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.locked}</p>`;
      });
    }
  });
  const host = mount();
  const draw = (n) => renderInto(html`<cp-readonly-eager .locked=${n}></cp-readonly-eager>`, host);
  draw('first');                                // the old order threw a raw TypeError right here
  await frame(); await frame();
  draw('second');                               // and the post-flip plain write threw here
  await frame(); await frame();
  console.warn = realWarn;
  assert.equal(text(host.querySelector('cp-readonly-eager')), 'immutable', 'the getter still answers');
  assert.equal(warned.filter((w) => w.includes('locked')).length, isProduction ? 0 : 1,
    'refused by name once — the receiver is the one voice, not one per commit');
});

test('a non-vera get-only element gets the refusal from the renderer itself', () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  customElements.define('cp-foreign-readonly', class extends HTMLElement {
    get frozen() { return 'theirs'; }
  });
  const host = mount();
  renderInto(html`<cp-foreign-readonly .frozen=${'mine'}></cp-foreign-readonly>`, host);
  console.warn = realWarn;
  const el = host.querySelector('cp-foreign-readonly');
  assert.equal(el.frozen, 'theirs', 'no write reached the getter-only surface, and nothing threw');
  const named = warned.filter((w) => w.includes('frozen'));
  assert.equal(named.length, isProduction ? 0 : 1,
    'the renderer names the refusal — no init() means no other voice exists');
  if (!isProduction) assert.match(named[0], /^\[vera\] renderer: <cp-foreign-readonly> — [\s\S]*\(getter-only-prop\)$/, 'the same code core uses, from the shared table');
});

test('!prop on a component delivers the property — the client half of the SSR fixture’s live row', async () => {
  /** `tests/ssr-component-props.test.mjs` pins `!live=${true}` rendering `true` server-side and
   *  claims the client renders the same string; THIS is that pin — the claim held only by
   *  reasoning until it existed. LIVE bindings write the property directly (no record, no adopt),
   *  so the component reads a plain own property. */
  customElements.define('cp-live', class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.flag === undefined ? 'no-flag' : String(this.flag)}</p>`;
      });
    }
  });
  const host = mount();
  renderInto(html`<cp-live !flag=${true}></cp-live>`, host);
  await frame(); await frame();
  assert.equal(text(host.querySelector('cp-live')), 'true',
    'the live-bound property reaches the component — same string the server renders');
});

test('the whole JSX thread: bare-prop source compiles, renders, adopts, and stays reactive', async () => {
  /**
   * Every seam of this thread is pinned elsewhere — the transform's grammar in `jsx.test.mjs`,
   * the `.name` runtime here — but no other test walks it END TO END: author-shaped JSX in,
   * reactive component out. This is that walk, through the real transform and the real engine.
   */
  const { transformJsx } = await load('jsx');
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const compiled = transformJsx(
    `const { html } = globalThis.__cpJsx;
     export const view = (model, n) => <cp-jsx-thread model={model} count={n} active />;`,
    'thread.jsx',
    { inject: false }
  );
  assert.ok(compiled.includes('.model=') && compiled.includes('.count=') && compiled.includes('.active=${true}'),
    'the transform emitted property bindings for the bare props');

  globalThis.__cpJsx = { html };
  const dir = mkdtempSync(join(tmpdir(), 'vera-cp-jsx-'));
  writeFileSync(join(dir, 'thread.mjs'), compiled);
  const { view } = await import(pathToFileURL(join(dir, 'thread.mjs')).href);
  rmSync(dir, { recursive: true, force: true });

  customElements.define('cp-jsx-thread', class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${this.model.label} ${String(this.count)} ${String(this.active)}</p>`;
      });
    }
  });
  const host = mount();
  const model = createStore({ label: 'jsx' });
  renderInto(view(model, 1), host);
  await frame(); await frame();
  const el = host.querySelector('cp-jsx-thread');
  assert.equal(text(el), 'jsx 1 true', 'bare JSX props arrived as reactive props, flag included');

  renderInto(view(model, 2), host);
  await frame(); await frame();
  assert.equal(text(el), 'jsx 2 true', 'the parent’s re-render lands in the adopted accessor');

  model.label = 'live';
  await frame(); await frame();
  assert.equal(text(el), 'live 2 true', 'a store passed as a bare JSX prop stays reactive');
});

test('the drain runs once: a reconnect keeps the adopted values and their reactivity', async () => {
  customElements.define('cp-reconnect', class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${String(this.n)}</p>`;
      });
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
