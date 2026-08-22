import { expect } from '@esm-bundle/chai';
import { init, createStore, render, setRenderer, html } from '../../packages/core/dist/development/vera.js';
import { render as domRender, keyed } from '../../packages/renderer/dist/development/vera-renderer.js';

/**
 * Focus, selection and scroll across re-renders.
 *
 * jsdom tracks `activeElement` but has no layout, no real selection model and no scroll — so
 * "the user's cursor survived an update" was untestable. It is the single most user-visible
 * property of a keyed renderer and it had no coverage at all.
 */

setRenderer(domRender);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let seq = 0;
const mount = (template) => {
  const tag = `x-focus-${seq++}`;
  let state;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      state = createStore({ n: 0, rows: [1, 2, 3] });
      render(() => template(state));
    }
  });
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return { el, get state() { return state; } };
};

it('keeps focus and cursor position when unrelated state changes', async () => {
  const app = mount((s) => html`<input><p>${s.n}</p>`);
  await frame();
  const input = app.el.shadowRoot.querySelector('input');
  input.focus();
  input.value = 'hello world';
  input.setSelectionRange(5, 5);

  app.state.n = 1;
  await frame();

  const after = app.el.shadowRoot.querySelector('input');
  expect(after, 'the same input element').to.equal(input);
  expect(app.el.shadowRoot.activeElement, 'still focused').to.equal(input);
  expect(after.value, 'text intact').to.equal('hello world');
  expect(after.selectionStart, 'cursor position intact').to.equal(5);
  app.el.remove();
});

it('a keyed reorder moves the node rather than rebuilding it', async () => {
  const app = mount((s) => html`<ul>${s.rows.map((r) => keyed(r, html`<li><input data-row=${r}></li>`))}</ul>`);
  await frame();
  const root = app.el.shadowRoot;
  const second = root.querySelector('input[data-row="2"]');
  second.focus();
  second.value = 'row two';

  app.state.rows = [3, 2, 1];
  await frame();

  const after = root.querySelector('input[data-row="2"]');
  /** Compare booleans, never nodes: a failed `.to.equal` makes chai stringify two DOM elements to
      build a diff, which hangs the runner rather than reporting the failure. */
  expect(after === second, 'keyed reconciliation moved the node, it did not rebuild it').to.be.true;
  expect(after.value, 'so anything the template does not bind survives').to.equal('row two');
  expect(after.isConnected).to.be.true;
  app.el.remove();
});

it('focus does NOT survive a keyed move — and that is the platform, not the framework', async () => {
  /**
   * Moving a focused element blurs it in Chromium. Verified against a bare `insertBefore` with no
   * framework involved: focus is lost there too. So every keyed renderer that reorders by moving
   * nodes inherits this, ours included — it is not a defect to fix in reconciliation.
   *
   * Pinned as a test because without it this reads like a framework bug the first time someone
   * reorders a list while a field is focused. If we ever decide to save and restore focus around a
   * move, this test is what will tell us we changed the behaviour deliberately.
   */
  const bare = document.createElement('div');
  document.body.appendChild(bare);
  bare.innerHTML = '<input id="a"><input id="b">';
  const a = bare.querySelector('#a');
  a.focus();
  expect(document.activeElement === a, 'focused to begin with').to.be.true;
  bare.insertBefore(a, null);
  expect(document.activeElement === a, 'a bare DOM move blurs it, with no framework involved').to.be.false;
  bare.remove();

  const app = mount((s) => html`<ul>${s.rows.map((r) => keyed(r, html`<li><input data-row=${r}></li>`))}</ul>`);
  await frame();
  const root = app.el.shadowRoot;
  const second = root.querySelector('input[data-row="2"]');
  second.focus();
  expect(root.activeElement === second).to.be.true;

  app.state.rows = [3, 2, 1];
  await frame();
  expect(root.activeElement === second, 'same behaviour through the renderer').to.be.false;
  app.el.remove();
});

it('preserves scroll position of a container across an update', async () => {
  const app = mount((s) => html`<div id="box" style="height:60px;overflow:auto">
    <div style="height:600px">tall ${s.n}</div>
  </div>`);
  await frame();
  const box = app.el.shadowRoot.getElementById('box');
  box.scrollTop = 120;
  expect(box.scrollTop, 'a real browser actually scrolls').to.equal(120);

  app.state.n = 1;
  await frame();
  expect(app.el.shadowRoot.getElementById('box').scrollTop, 'scroll survived the update').to.equal(120);
  app.el.remove();
});
