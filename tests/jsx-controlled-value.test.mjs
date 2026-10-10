/**
 * **A JSX `value` / `checked` is controlled: compared with the control's LIVE state.** Reported from Content Flow
 * (2026-10-01): type a name and press Enter within one frame, the submit handler resets the bound value to '' — and
 * the name stayed in the box. `value={x}` compiled to `.value`, which compares with the last value RENDERED: '' then
 * '' again, so nothing was written over what the user typed. It now compiles to `!value`, which writes whenever the
 * control disagrees. The control row renders the old `.value` spelling through the same steps and must show the bug —
 * or this test could not see it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/** Through dist.mjs — the artifact under test, never a bare resolve. */
const { transformJsx } = await load('jsx');

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[k] = dom.window[k];
const { wire, html } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

/** A JSX module, compiled, run with core's `html`. */
const compiled = (source) => {
  const code = transformJsx(source, 'view.tsx', { namespaces: false }).replace(/^import .*\n/gm, '').replace(/export const (\w+)/, 'const $1');
  return new Function('html', `${code}\nreturn view;`)(html);
};

/** Typed, then reset before any render: the box must show the reset. */
const typeThenReset = (view, checkbox = false) => {
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  const state = { v: checkbox ? false : '' };
  renderInto(view(state), root);
  const control = root.querySelector('input');
  if (checkbox) control.checked = true;
  else control.value = 'Letters';
  /** The input handler sets the state; the submit handler resets it — no render between. */
  state.v = checkbox ? true : 'Letters';
  state.v = checkbox ? false : '';
  renderInto(view(state), root);
  root.remove();
  return checkbox ? control.checked : control.value;
};

test('a JSX value reset within one frame is written: the box clears', () => {
  const view = compiled('export const view = (s) => <input value={s.v} />;');
  assert.equal(typeThenReset(view), '');
});

test('a JSX checked reset within one frame is written: the box unticks', () => {
  const view = compiled('export const view = (s) => <input type="checkbox" checked={s.v} />;');
  assert.equal(typeThenReset(view, true), false);
});

test('CONTROL: the old `.value` spelling keeps the typed text (the reported bug) — so the rows above can see it', () => {
  const view = (s) => html`<input .value=${s.v} />`;
  assert.equal(typeThenReset(view), 'Letters');
});

test('the controlled value still updates normally on a state change', () => {
  const view = compiled('export const view = (s) => <input value={s.v} />;');
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  const state = { v: 'a' };
  renderInto(view(state), root);
  const input = root.querySelector('input');
  assert.equal(input.value, 'a');
  state.v = 'b';
  renderInto(view(state), root);
  assert.equal(input.value, 'b', 'a state change is written');
  root.remove();
});
