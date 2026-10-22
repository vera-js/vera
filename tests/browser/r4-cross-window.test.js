/**
 * **R4 — a component moved into ANOTHER window's document, and back, is kept** (2026-10-22), on real engines, through a
 * same-origin iframe and a real `window.open` pop-out. Setup ONCE out and back with its state; its effects re-run
 * against the new window (cleanup, then run) and again on the way back; its styles hold in both (a move empties a shadow
 * root's adopted sheets); a child component created while it is out is upgraded (built in the home realm); a keyed
 * reorder re-runs nothing; a resource does not refetch; a built-in host re-homes too. Assertions are booleans for
 * anything from another document (CLAUDE.md: a failing cross-realm inspection reads as a timeout).
 */
import { expect } from '@esm-bundle/chai';
import { wire, define, init, html, createStore, useEffect } from '../../packages/core/dist/development/vera.js';
import { renderer, renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { nativeElements } from '../../packages/renderer/dist/development/vera-renderer-native-elements.js';
import { keyed } from '../../packages/renderer/dist/development/vera-renderer-keyed.js';
import { styles, css } from '../../packages/styles/dist/development/vera-styles.js';
import { resource } from '../../packages/store/dist/development/vera-store-resource.js';

wire([renderer, styles, nativeElements]);
const frame = (win = window) => new Promise((r) => win.requestAnimationFrame(() => setTimeout(r, 0)));
const iframe = async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  await new Promise((r) => (f.contentDocument?.readyState === 'complete' ? r() : f.addEventListener('load', r, { once: true })));
  return f;
};

describe('R4: cross-window moves keep the component', () => {
  it('setup once out and back, state kept, a write while out renders there', async () => {
    const counts = { setup: 0 };
    const s = createStore({ n: 1 });
    define('r4-basic', () => { counts.setup++; return () => html`<b>${s.n}</b>`; });
    const el = document.createElement('r4-basic');
    document.body.append(el);
    await frame();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    s.n = 2;
    await frame();
    const out = el.textContent === '2';
    document.body.append(el);
    await frame();
    expect({ setups: counts.setup, renderedWhileOut: out, home: el.textContent === '2' }).to.deep.equal({ setups: 1, renderedWhileOut: true, home: true });
    el.remove();
    f.remove();
  });

  it("an effect's listener on the element's window re-binds to the new window, cleanup once per move, no doubling", async () => {
    let cleanups = 0;
    const heard = [];
    define('r4-listen', (host) => {
      useEffect(() => {
        const win = host.ownerDocument.defaultView;
        const on = () => heard.push(win === window ? 'main' : 'other');
        win.addEventListener('r4-ping', on);
        return () => { cleanups++; win.removeEventListener('r4-ping', on); };
      });
      return () => html`<i></i>`;
    });
    const el = document.createElement('r4-listen');
    document.body.append(el);
    await frame();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    f.contentWindow.dispatchEvent(new f.contentWindow.Event('r4-ping'));
    window.dispatchEvent(new Event('r4-ping'));
    const whileOut = heard.join();
    document.body.append(el);
    await frame();
    window.dispatchEvent(new Event('r4-ping'));
    f.contentWindow.dispatchEvent(new f.contentWindow.Event('r4-ping'));
    expect({ whileOut, all: heard.join(), cleanups }).to.deep.equal({ whileOut: 'other', all: 'other,main', cleanups: 2 });
    el.remove();
    f.remove();
  });

  it('styles hold in the other window and after returning (a shadow root, static styles)', async () => {
    define({ tag: 'r4-styled', shadow: 'open' }, () => () => html`<b>x</b>`);
    customElements.get('r4-styled').styles = css`b { color: rgb(255, 0, 0); }`;
    const el = document.createElement('r4-styled');
    document.body.append(el);
    await frame();
    const color = () => el.ownerDocument.defaultView.getComputedStyle(el.shadowRoot.querySelector('b')).color;
    const home1 = color();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame(f.contentWindow);
    const out = color();
    document.body.append(el);
    await frame();
    const home2 = color();
    expect({ home1, out, home2 }).to.deep.equal({ home1: 'rgb(255, 0, 0)', out: 'rgb(255, 0, 0)', home2: 'rgb(255, 0, 0)' });
    el.remove();
    f.remove();
  });

  it('a child component created while out is upgraded on every engine (built in the home realm)', async () => {
    const s = createStore({ show: false });
    define('r4-child', () => () => html`<i>child</i>`);
    define({ tag: 'r4-panel', shadow: 'open' }, () => () => html`${s.show ? html`<r4-child></r4-child>` : ''}`);
    const el = document.createElement('r4-panel');
    document.body.append(el);
    await frame();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    s.show = true;
    await frame();
    const child = el.shadowRoot.querySelector('r4-child');
    expect({ found: child !== null, defined: child !== null && child.matches(':defined'), text: child?.textContent ?? null }).to.deep.equal({ found: true, defined: true, text: 'child' });
    el.remove();
    f.remove();
  });

  it("a component the IFRAME's own registry defines builds its children with the iframe's classes (the realm it renders into)", async () => {
    const f = await iframe();
    const view = f.contentWindow;
    /** One child tag, two definitions; the parent component is defined by the IFRAME, set up through this core. */
    class OpenerChild extends HTMLElement {}
    customElements.define('r4-both-child', OpenerChild);
    const IframeChild = class extends view.HTMLElement {};
    view.customElements.define('r4-both-child', IframeChild);
    view.customElements.define('r4-iframe-parent', class extends view.HTMLElement {
      connectedCallback() { init({ host: this, shadow: 'open' }, () => () => html`<r4-both-child></r4-both-child>`); }
    });
    const parent = f.contentDocument.createElement('r4-iframe-parent');
    f.contentDocument.body.append(parent);
    await frame();
    const child = parent.shadowRoot.querySelector('r4-both-child');
    expect({ found: child !== null, iframes: child instanceof IframeChild, openers: child instanceof OpenerChild }).to.deep.equal({ found: true, iframes: true, openers: false });
    f.remove();
  });

  it('a keyed reorder within one document re-runs no effect', async () => {
    let runs = 0;
    define('r4-row', () => { useEffect(() => { runs++; }); return () => html`<i></i>`; });
    const host = document.createElement('div');
    document.body.append(host);
    const rows = (ids) => html`${ids.map((id) => keyed(id, html`<r4-row id=${id}></r4-row>`))}`;
    renderInto(rows(['a', 'b', 'c']), host);
    await frame();
    const before = runs;
    renderInto(rows(['c', 'a', 'b']), host);
    await frame();
    expect({ before, after: runs, moved: [...host.querySelectorAll('r4-row')].map((r) => r.id).join() }).to.deep.equal({ before: 3, after: 3, moved: 'c,a,b' });
    host.remove();
  });

  it('a resource does not refetch across a cross-window move', async () => {
    let calls = 0;
    let cell;
    define('r4-data', () => { cell = resource(() => { calls++; return 'v'; }); return () => html`<b>${cell.value}</b>`; });
    const el = document.createElement('r4-data');
    document.body.append(el);
    await frame();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    document.body.append(el);
    await frame();
    expect({ calls, value: cell.value }).to.deep.equal({ calls: 1, value: 'v' });
    el.remove();
    f.remove();
  });

  it('a built-in host (native-elements) re-homes too: its effect re-binds to the new window', async () => {
    let cleanups = 0;
    const heard = [];
    const host = document.createElement('div');
    init(host, () => {
      useEffect(() => {
        const win = host.ownerDocument.defaultView;
        const on = () => heard.push(win === window ? 'main' : 'other');
        win.addEventListener('r4-ping2', on);
        return () => { cleanups++; win.removeEventListener('r4-ping2', on); };
      });
      return () => html`<span>n</span>`;
    });
    document.body.append(host);
    await frame();
    const f = await iframe();
    f.contentDocument.body.append(host);
    await frame();
    f.contentWindow.dispatchEvent(new f.contentWindow.Event('r4-ping2'));
    expect({ heard: heard.join(), cleanups }).to.deep.equal({ heard: 'other', cleanups: 1 });
    host.remove();
    f.remove();
  });

  it('a real window.open pop-out: out and back, setup once, state kept', async function () {
    let setups = 0;
    const s = createStore({ n: 1 });
    define('r4-pop', () => { setups++; return () => html`<b>${s.n}</b>`; });
    const el = document.createElement('r4-pop');
    document.body.append(el);
    await frame();
    const w = window.open('about:blank', 'r4pop', 'width=300,height=200');
    /** A blocked pop-up SKIPS, never passes empty: the iframe rows above carry the same path. */
    if (w === null) this.skip();
    w.document.body.append(el);
    s.n = 2;
    await new Promise((r) => setTimeout(r, 50));
    const out = el.textContent === '2';
    document.body.append(el);
    await frame();
    w.close();
    expect({ setups, out, home: el.textContent === '2' }).to.deep.equal({ setups: 1, out: true, home: true });
    el.remove();
  });
});
