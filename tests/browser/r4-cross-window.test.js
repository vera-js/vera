/**
 * **R4 — a component moved into ANOTHER window's document, and back, is kept** (2026-10-22), on real engines, through a
 * same-origin iframe and a real `window.open` pop-out. Setup ONCE out and back with its state; its effects re-run
 * against the new window (cleanup, then run) and again on the way back; its styles hold in both (a move empties a shadow
 * root's adopted sheets); a child component created while it is out is upgraded (built in the home realm); a keyed
 * reorder re-runs nothing; a resource does not refetch; a built-in host re-homes too. Assertions are booleans for
 * anything from another document (CLAUDE.md: a failing cross-realm inspection reads as a timeout).
 */
import { expect } from '@esm-bundle/chai';
import { wire, define, init, html, createStore, effect } from '../../packages/core/dist/development/vera.js';
import { renderer, renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { nativeElements } from '../../packages/renderer/dist/development/vera-renderer-native-elements.js';
import { keyed } from '../../packages/renderer/dist/development/vera-renderer-keyed.js';
import { styles, css } from '../../packages/styles/dist/development/vera-styles.js';
import { resource } from '../../packages/store/dist/development/vera-store-resource.js';
import { portal } from '../../packages/renderer/dist/development/vera-renderer-portal.js';
import { multiWindow } from '../../packages/renderer/dist/development/vera-renderer-multi-window.js';

wire([renderer, styles, nativeElements, multiWindow]);
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
      effect(() => {
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

  it("styles hold for a component styled by define's OPTION, out and back", async () => {
    define({ tag: 'r4-optstyled', shadow: 'open', styles: css`b { color: rgb(0, 128, 0); }` }, () => () => html`<b>x</b>`);
    const el = document.createElement('r4-optstyled');
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
    expect({ home1, out, home2: color() }).to.deep.equal({ home1: 'rgb(0, 128, 0)', out: 'rgb(0, 128, 0)', home2: 'rgb(0, 128, 0)' });
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
    define('r4-row', () => { effect(() => { runs++; }); return () => html`<i></i>`; });
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
      effect(() => {
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

  it('a PAUSED component (persist) re-added in ANOTHER window stays live past its window: the timer is cleared where it was set', async () => {
    let setups = 0;
    const s = createStore({ n: 1 });
    define({ tag: 'r4-persist', persist: 0.3 }, () => { setups++; return () => html`<b>${s.n}</b>`; });
    const el = document.createElement('r4-persist');
    document.body.append(el);
    await frame();
    el.remove();
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    await new Promise((r) => setTimeout(r, 600));
    s.n = 2;
    await frame(f.contentWindow);
    await frame();
    expect({ connected: el.isConnected, setups, live: el.textContent === '2' }).to.deep.equal({ connected: true, setups: 1, live: true });
    el.remove();
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

  it('moveBefore() keeps a component: no teardown, no second setup (Chromium, Firefox; WebKit has no moveBefore)', async function () {
    if (typeof Element.prototype.moveBefore !== 'function') this.skip();
    let setups = 0, cleanups = 0;
    define('r4-mb', () => { setups++; effect(() => () => { cleanups++; }); return () => html`<i></i>`; });
    const a = document.createElement('div'), b = document.createElement('div');
    document.body.append(a, b);
    const el = document.createElement('r4-mb');
    a.append(el);
    await frame();
    b.moveBefore(el, null);
    await frame();
    expect({ setups, cleanups, moved: el.parentNode === b }).to.deep.equal({ setups: 1, cleanups: 0, moved: true });
    el.remove();
    await frame();
    expect(cleanups).to.equal(1);
    a.remove(); b.remove();
  });

  it('focus across a cross-window move: lost, while the value and selection are kept (the platform; BROWSER-LEDGER 2026-10-22)', async () => {
    define('r4-focus', () => () => html`<input value="hello">`);
    const el = document.createElement('r4-focus');
    document.body.append(el);
    await frame();
    const input = el.querySelector('input');
    input.focus();
    input.setSelectionRange(1, 3);
    const f = await iframe();
    f.contentDocument.body.append(el);
    await frame();
    const kept = { focused: f.contentDocument.activeElement === input || document.activeElement === input, value: input.value === 'hello', selection: input.selectionStart === 1 && input.selectionEnd === 3 };
    document.body.append(el);
    await frame();
    expect(kept).to.deep.equal({ focused: false, value: true, selection: true });
    el.remove();
    f.remove();
  });

  it('a portal with a target FUNCTION follows its component into a real pop-out and back: moved, never redrawn, its inner component set up once', async function () {
    let draws = 0, inner = 0;
    define('r4-pin', () => { inner++; return () => html`<b>in</b>`; });
    define('r4-pown', (host) => { portal(() => host.ownerDocument.body, () => (draws++, html`<r4-pin></r4-pin>`)); return () => html`<i>own</i>`; });
    const el = document.createElement('r4-pown');
    document.body.append(el);
    await frame();
    const w = window.open('about:blank', 'r4pop2', 'width=300,height=200');
    if (w === null) this.skip();
    w.document.body.append(el);
    await new Promise((r) => setTimeout(r, 50));
    const out = w.document.body.querySelector('r4-pin') !== null && document.body.querySelector('r4-pin') === null;
    document.body.append(el);
    await frame();
    const home = document.body.querySelector('r4-pin') !== null;
    w.close();
    expect({ out, home, draws, inner }).to.deep.equal({ out: true, home: true, draws: 1, inner: 1 });
    el.remove();
    await frame();
    expect(document.body.querySelector('r4-pin') === null).to.equal(true);
  });

  it('a REACTIVE portal target switched within one document keeps a focused input focused where moveBefore exists (Chromium, Firefox)', async () => {
    const a = document.createElement('div'), b = document.createElement('div');
    document.body.append(a, b);
    const s = createStore({ where: 'a' });
    define('r4-pfocus', () => { portal(() => (s.where === 'a' ? a : b), () => html`<input value="x">`); });
    const el = document.createElement('r4-pfocus');
    document.body.append(el);
    await frame();
    const input = a.querySelector('input');
    input.focus();
    s.where = 'b';
    await frame();
    const moved = b.querySelector('input') === input;
    const focused = document.activeElement === input;
    expect({ moved, focused }).to.deep.equal({ moved: true, focused: typeof Element.prototype.moveBefore === 'function' });
    el.remove();
    a.remove(); b.remove();
  });

  it('a portal whose pop-out CLOSES: nothing throws, and the next target gets its content (records whether the engine kept the nodes)', async function () {
    let inner = 0;
    define('r4-pdead', () => { inner++; return () => html`<b>in</b>`; });
    const w = window.open('about:blank', 'r4pop3', 'width=300,height=200');
    if (w === null) this.skip();
    const s = createStore({ out: true });
    define('r4-pdown', () => { portal(() => (s.out ? w.document.body : document.body), () => html`<r4-pdead></r4-pdead>`); });
    const el = document.createElement('r4-pdown');
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 50));
    const wasOut = w.document.body.querySelector('r4-pdead') !== null;
    w.close();
    await new Promise((r) => setTimeout(r, 100));
    s.out = false;
    await frame();
    const back = document.body.querySelector('r4-pdead') !== null;
    console.log(`[r4-pdead] inner setups after the close: ${inner} (1 = the engine kept the nodes and they moved; 2 = redrawn)`);
    expect({ wasOut, back }).to.deep.equal({ wasOut: true, back: true });
    el.remove();
  });

  describe('multiWindow: a component left in a pop-out that CLOSES is released (R4 decision 4)', () => {
    const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
    it('a panel left behind, and a child it built while out: each cleanup exactly once, and a later write wakes neither', async function () {
      const counts = { panelClean: 0, childClean: 0, panelRenders: 0, childRenders: 0 };
      const s = createStore({ n: 1, kid: false });
      define('r4-rel-kid', () => { effect(() => () => counts.childClean++); return () => (counts.childRenders++, html`<i>${s.n}</i>`); });
      define('r4-rel-panel', () => { effect(() => () => counts.panelClean++); return () => (counts.panelRenders++, html`<b>${s.n}</b>${s.kid ? html`<r4-rel-kid></r4-rel-kid>` : ''}`); });
      const el = document.createElement('r4-rel-panel');
      document.body.append(el);
      await frame();
      const w = window.open('about:blank', 'r4rel1', 'width=300,height=200');
      if (w === null) this.skip();
      w.document.body.append(el);
      await settle(50);
      s.kid = true;
      await settle(50);
      const childThere = w.document.querySelector('r4-rel-kid')?.textContent === '1';
      /** The move in already ran the panel's cleanup once (a cross-window move re-runs its effects): the release adds ONE. */
      const panelBefore = counts.panelClean;
      w.close();
      await settle();
      const before = { ...counts };
      s.n = 2;
      await settle(50);
      expect({ childThere, panelReleased: counts.panelClean - panelBefore, childClean: counts.childClean, woke: counts.panelRenders !== before.panelRenders || counts.childRenders !== before.childRenders })
        .to.deep.equal({ childThere: true, panelReleased: 1, childClean: 1, woke: false });
    });

    it('a panel moved BACK during the pop-out\'s own pagehide survives: set up once, still live', async function () {
      let setups = 0, cleans = 0;
      const s = createStore({ n: 1 });
      define('r4-rel-back', () => { setups++; effect(() => () => cleans++); return () => html`<b>${s.n}</b>`; });
      const el = document.createElement('r4-rel-back');
      document.body.append(el);
      await frame();
      const w = window.open('about:blank', 'r4rel2', 'width=300,height=200');
      if (w === null) this.skip();
      w.document.body.append(el);
      await settle(50);
      w.addEventListener('pagehide', () => document.body.append(el));
      w.close();
      await settle();
      s.n = 2;
      await settle(50);
      /** Effects re-run on each cross-window move (cleanup, then run): out and back is two cleanups, never a release. */
      expect({ home: el.ownerDocument === document, live: el.textContent === '2', setups }).to.deep.equal({ home: true, live: true, setups: 1 });
      el.remove();
    });

    it('a PERSISTED hide (the back/forward cache) releases nothing', async function () {
      let cleans = 0;
      define('r4-rel-bf', () => { effect(() => () => cleans++); return () => html`<b>x</b>`; });
      const el = document.createElement('r4-rel-bf');
      document.body.append(el);
      await frame();
      const w = window.open('about:blank', 'r4rel3', 'width=300,height=200');
      if (w === null) this.skip();
      w.document.body.append(el);
      await settle(50);
      const afterMove = cleans;
      w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: true }));
      await settle();
      const kept = cleans === afterMove;
      w.close();
      await settle();
      expect({ kept, releasedOnClose: cleans === afterMove + 1 }).to.deep.equal({ kept: true, releasedOnClose: true });
    });

    it('a component APPENDED directly into a pop-out (never moved) is released too (multiWindow\'s init watch)', async function () {
      let cleans = 0, renders = 0;
      const s = createStore({ n: 1 });
      define('r4-rel-direct', () => { effect(() => () => cleans++); return () => (renders++, html`<b>${s.n}</b>`); });
      const w = window.open('about:blank', 'r4rel5', 'width=300,height=200');
      if (w === null) this.skip();
      w.document.body.append(document.createElement('r4-rel-direct'));
      await settle(50);
      const ran = renders === 1;
      w.close();
      await settle();
      const before = renders;
      s.n = 2;
      await settle(50);
      expect({ ran, cleans, woke: renders !== before }).to.deep.equal({ ran: true, cleans: 1, woke: false });
    });

    it('a HOME component portals into the pop-out; the pop-out closes; the target returns home: the content is visible and LIVE (redrawn, not the released one)', async function () {
      let inner = 0;
      const w = window.open('about:blank', 'r4rel4', 'width=300,height=200');
      if (w === null) this.skip();
      const s = createStore({ out: true, n: 1 });
      define('r4-rel-pin', () => { inner++; return () => html`<i>${s.n}</i>`; });
      define('r4-rel-powner', () => { portal(() => (s.out ? w.document.body : document.body), () => html`<r4-rel-pin></r4-rel-pin>`); });
      const el = document.createElement('r4-rel-powner');
      document.body.append(el);
      await settle(50);
      w.close();
      await settle();
      s.out = false;
      await settle(50);
      s.n = 3;
      await settle(50);
      const pin = document.body.querySelector('r4-rel-pin');
      expect({ visible: pin !== null, live: pin?.textContent === '3' }).to.deep.equal({ visible: true, live: true });
      console.log(`[r4-rel-portal] inner setups: ${inner}`);
      el.remove();
    });
  });
});

