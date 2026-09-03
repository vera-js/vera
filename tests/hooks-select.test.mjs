/**
 * The behavior controllers, against the built artifacts on a minimal host — no @verajs/ui
 * involved, because the whole point of the layer is that someone can build their own select on
 * it. Dismissal contracts and the keyboard model's edges live here; the styled element's suite
 * (`ui-select`) exercises the same controller through real markup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'KeyboardEvent',
]) {
  globalThis[key] = dom.window[key];
}

const { init } = await load('core');
const { useDismiss, useSelect } = await load('hooks');
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

/** A bare init()'d host — enough lifecycle for the hooks, no renderer needed. */
const host = () => {
  const element = dom.window.document.createElement('x-host');
  dom.window.document.body.append(element);
  init(element);
  return element;
};

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
  { label: 'Gamma', value: 'g', disabled: true },
];

// ── useDismiss ──────────────────────────────────────────────────────────────────────────────────

test('useDismiss: outside pointerdown dismisses, inside does not, Escape passes its event', () => {
  const element = host();
  const calls = [];
  const dismiss = useDismiss(element, (event) => calls.push(event ? 'escape' : 'outside'));

  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.deepEqual(calls, [], 'inert until activated');

  dismiss.activate();
  dismiss.activate(); // idempotent — no double listeners
  element.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, composed: true }));
  assert.deepEqual(calls, [], 'a press inside the element is not a dismissal');

  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.deepEqual(calls, ['outside', 'escape']);

  dismiss.deactivate();
  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(calls.length, 2, 'deactivated means silent');
});

test('useDismiss: unmount releases the document listeners through the _cleanups contract', () => {
  const element = host();
  const calls = [];
  useDismiss(element, () => calls.push('dismiss')).activate();

  /** init() drains _cleanups on disconnect — the release-on-unmount contract. */
  element.remove();
  element._cleanups?.forEach((cleanup) => cleanup());
  dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.deepEqual(calls, [], 'a removed component strands no document listener');
});

// ── useSelect ───────────────────────────────────────────────────────────────────────────────────

test('single mode: pick commits, reports, and closes; disabled options never pick', () => {
  const element = host();
  const seen = [];
  const select = useSelect(element, { onChange: (value) => seen.push(value.map((o) => o.value)) });
  select.state.options = OPTIONS;

  select.open();
  assert.equal(select.state.open, true);
  select.pick(select.matches()[1]);
  assert.deepEqual(seen, [['b']]);
  assert.equal(select.state.open, false, 'single mode closes on pick');

  select.pick(select.matches()[2]);
  assert.deepEqual(seen, [['b']], 'the disabled option committed nothing');
});

test('multi mode: pick toggles membership and the menu stays open', () => {
  const element = host();
  const select = useSelect(element, { multi: () => true });
  select.state.options = OPTIONS;
  select.open();

  select.pick(select.matches()[0]);
  select.pick(select.matches()[1]);
  assert.deepEqual(select.state.value.map((o) => o.value), ['a', 'b']);
  assert.equal(select.state.open, true, 'multi stays open');

  select.pick(select.matches()[0]);
  assert.deepEqual(select.state.value.map((o) => o.value), ['b'], 'picking again toggles off');
});

test('the keyboard walk wraps and skips disabled rows in both directions', () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.options = OPTIONS; // Gamma (index 2) is disabled

  select.step(1);
  assert.equal(select.state.active, 1);
  select.step(1);
  assert.equal(select.state.active, 0, 'skipped disabled Gamma and wrapped');
  select.step(-1);
  assert.equal(select.state.active, 1, 'backwards skips it too');
});

test('search narrows matches and Escape-driven dismissal clears it', async () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.options = OPTIONS;
  select.open();
  select.state.search = 'bet';
  assert.deepEqual(select.matches().map((o) => o.value), ['b']);

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  await frame();
  assert.equal(select.state.open, false, 'Escape closed through useDismiss');
  assert.equal(select.state.search, '', 'closing resets the filter');
});

test('attach stamps an assigned trigger immediately — not on the next state change', () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.options = OPTIONS;
  select.state.value = [OPTIONS[0]];

  const trigger = dom.window.document.createElement('button');
  const value = dom.window.document.createElement('span');
  select.attach({ trigger, value });

  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('data-state'), 'closed');
  assert.equal(value.getAttribute('data-label'), 'Alpha', 'stamped at attach — never rewritten: you slot it, you own it');
  assert.equal(value.textContent, '', 'the slotted node’s children are untouched');

  trigger.click();
  assert.equal(select.state.open, true, 'the assigned trigger drives the same handlers');
});
