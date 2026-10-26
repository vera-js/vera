/**
 * **`@verajs/hot` on real engines** (2026-10-22): a redefine swaps a live component IN PLACE inside a closed shadow root
 * (old cleanup exactly once, the element kept), a name a new version starts observing is replayed through the engine's
 * own `MutationObserver`, a shadow-mode change is a cancelable reload request on the element's window, and hot's
 * `'init'` insert (priority −1) replaces none of the others: native-elements (0) and slots (10…) still run with it wired.
 */
import { expect } from '@esm-bundle/chai';
import { wire, define, init, html, createStore, effect } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { nativeElements } from '../../packages/renderer/dist/development/vera-renderer-native-elements.js';
import { hot } from '../../packages/hot/dist/development/vera-hot.js';

wire([renderer, slots, nativeElements, hot]);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const reloads = [];
window.addEventListener('vera-hot-reload', (event) => { reloads.push(event.detail); event.preventDefault(); });

describe('@verajs/hot', () => {
  it('swaps a live component in place inside a closed root: old cleanup once, new setup once, element kept', async () => {
    const counts = { old: 0, cleanup: 0, next: 0 };
    const state = createStore({ n: 1 });
    define({ tag: 'hot-card', shadow: 'closed' }, () => { counts.old++; effect(() => () => counts.cleanup++); return () => html`<b>a${state.n}</b>`; });
    define({ tag: 'hot-shell', shadow: 'closed' }, () => () => html`<hot-card></hot-card>`);
    const shell = document.createElement('hot-shell');
    document.body.append(shell);
    await frame();
    expect(counts).to.deep.equal({ old: 1, cleanup: 0, next: 0 });
    let card;
    define({ tag: 'hot-card', shadow: 'closed' }, (host) => { counts.next++; card = host; return () => html`<b>b${state.n}</b>`; });
    await frame();
    expect(counts).to.deep.equal({ old: 1, cleanup: 1, next: 1 });
    state.n = 2;
    await frame();
    expect(card !== undefined && card.isConnected).to.equal(true);
    shell.remove();
  });

  it('replays a newly observed attribute through the engine\'s MutationObserver, and delivers later writes', async () => {
    const seen = [];
    customElements.define('hot-attrs', class extends HTMLElement {
      static observedAttributes = ['a'];
      attributeChangedCallback(name, _old, value) { seen.push(`old:${name}=${value}`); }
    });
    const el = document.createElement('hot-attrs');
    el.setAttribute('b', 'x');
    document.body.append(el);
    customElements.define('hot-attrs', class extends HTMLElement {
      static observedAttributes = ['b'];
      attributeChangedCallback(name, _old, value) { seen.push(`new:${name}=${value}`); }
    });
    el.setAttribute('b', 'y');
    await frame();
    expect(seen).to.deep.equal(['new:b=x', 'new:b=y']);
    el.remove();
  });

  it('a shadow-mode change is a cancelable reload request on the element\'s window, and the live element is not re-set-up', async () => {
    let setups = 0;
    define({ tag: 'hot-mode', shadow: 'open' }, () => { setups++; return () => html`<i></i>`; });
    const el = document.createElement('hot-mode');
    document.body.append(el);
    await frame();
    reloads.length = 0;
    define({ tag: 'hot-mode', shadow: 'closed' }, () => { setups++; return () => html`<i></i>`; });
    await frame();
    expect(reloads).to.deep.equal([{ tag: 'hot-mode', reason: 'its shadow-root mode changed' }]);
    expect(setups).to.equal(1);
    el.remove();
  });

  it("wired with slots and native-elements: hot's insert replaces neither, and a swapped light component still distributes", async () => {
    let nativeRenders = 0;
    const host = document.createElement('div');
    init(host, () => () => { nativeRenders++; return html`<span>native</span>`; });
    document.body.append(host);
    define({ tag: 'hot-slotted', shadow: false }, () => () => html`<p>one:<slot></slot></p>`);
    const light = document.createElement('hot-slotted');
    light.append(document.createTextNode('child'));
    document.body.append(light);
    await frame();
    expect(nativeRenders > 0).to.equal(true);
    expect(light.querySelector('p')?.textContent).to.equal('one:child');
    define({ tag: 'hot-slotted', shadow: false }, () => () => html`<p>two:<slot></slot></p>`);
    await frame();
    expect(light.querySelector('p')?.textContent).to.equal('two:child');
    host.remove();
    light.remove();
  });

  it('a redefine while the component is POPPED OUT (R4) reaches it there, and it comes home on the new version, setup once per version', async () => {
    const counts = { old: 0, next: 0 };
    const state = createStore({ n: 1 });
    define('hot-away', () => { counts.old++; return () => html`<b>a${state.n}</b>`; });
    const el = document.createElement('hot-away');
    document.body.append(el);
    await frame();
    const f = document.createElement('iframe');
    document.body.append(f);
    await new Promise((r) => (f.contentDocument?.readyState === 'complete' ? r() : f.addEventListener('load', r, { once: true })));
    f.contentDocument.body.append(el);
    await frame();
    define('hot-away', () => { counts.next++; return () => html`<b>b${state.n}</b>`; });
    await frame();
    const there = el.ownerDocument === f.contentDocument && el.textContent === 'b1';
    document.body.append(el);
    state.n = 2;
    await frame();
    expect({ there, home: el.textContent === 'b2', counts }).to.deep.equal({ there: true, home: true, counts: { old: 1, next: 1 } });
    el.remove();
    f.remove();
  });
});

