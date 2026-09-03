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

test('re-slotting a trigger away and back never double-wires it', () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.options = OPTIONS;
  const a = dom.window.document.createElement('button');
  const b = dom.window.document.createElement('button');
  select.attach({ trigger: a });
  select.attach({ trigger: b });
  select.attach({ trigger: a }); // back again — the A -> B -> A shuffle
  a.click();
  assert.equal(select.state.open, true, 'one click, one toggle — duplicate listeners would cancel out');
});

test('a disabled row never takes the hover highlight', () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.options = OPTIONS; // Gamma (index 2) disabled
  select.state.active = 0;
  const row = dom.window.document.createElement('div');
  row.dataset.index = '2';
  dom.window.document.body.append(row);
  /** Two moves with different coordinates: the first primes the parked-cursor guard. */
  for (const clientX of [10, 11]) {
    const event = new dom.window.MouseEvent('pointermove', { bubbles: true, clientX, clientY: 10 });
    Object.defineProperty(event, 'target', { value: row });
    select.handlers.onListHover(event);
  }
  assert.equal(select.state.active, 0, 'the highlight stayed put');
  row.remove();
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

// ── AUDIT: highlight modality and stickiness (Brian's phantom-hover report) ─────────────────────

test('AUDIT — a pointer open highlights nothing; keyboard opens highlight selected-or-first', () => {
  const element = host();
  const select = useSelect(element, {});
  select.setOptions(OPTIONS);

  select.handlers.onTriggerClick();
  assert.equal(select.state.active, -1, 'mouse open with nothing selected: no phantom hover');
  select.close(false);

  select.open();
  assert.equal(select.state.active, 0, 'keyboard open: the first enabled row is the starting point');
  select.close(false);

  select.state.value = [OPTIONS[1]];
  select.handlers.onTriggerClick();
  assert.equal(select.state.active, 1, 'a real selection is highlighted whatever opened the menu');
});

test('AUDIT — the highlight clears when the pointer leaves the list; travel re-enters sanely', () => {
  const element = host();
  const select = useSelect(element, {});
  select.setOptions(OPTIONS);
  select.open();
  select.handlers.onListLeave();
  assert.equal(select.state.active, -1, 'pointer gone: no row keeps the tint');
  select.step(1);
  assert.equal(select.state.active, 0, 'ArrowDown from cleared starts at the top');
  select.handlers.onListLeave();
  select.step(-1);
  assert.equal(select.state.active, 1, 'ArrowUp from cleared starts at the bottom, skipping disabled Gamma');
  select.handlers.onListLeave();
  select.activate(select.state.active);
  assert.equal(select.state.value.length, 0, 'Enter with no highlighted row picks nothing');
});

test('AUDIT — Space selects the active option like Enter; warm typeahead keeps it a character', () => {
  const element = host();
  const select = useSelect(element, {});
  select.setOptions(OPTIONS);
  select.open();
  const space = new dom.window.KeyboardEvent('keydown', { key: ' ', cancelable: true });
  select.handlers.onTriggerKeydown(space);
  assert.deepEqual(select.state.value.map((option) => option.value), ['a'], 'Space picked the active row');
  assert.equal(space.defaultPrevented, true, 'and the page did not scroll');
  assert.equal(select.state.open, false, 'single mode closes on pick');

  select.open();
  select.handlers.onTriggerKeydown(new dom.window.KeyboardEvent('keydown', { key: 'b', cancelable: true }));
  const typedSpace = new dom.window.KeyboardEvent('keydown', { key: ' ', cancelable: true });
  select.handlers.onTriggerKeydown(typedSpace);
  assert.deepEqual(select.state.value.map((option) => option.value), ['a'], 'mid-typeahead Space picked nothing');
  assert.equal(select.state.open, true, 'and closed nothing — it joined the type buffer');
});

test('AUDIT — Space inside the search input types; Space with no active row only guards the page', () => {
  const element = host();
  const select = useSelect(element, {});
  select.setOptions(OPTIONS);
  select.open();
  const input = dom.window.document.createElement('input');
  dom.window.document.body.append(input);
  const typing = new dom.window.KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
  Object.defineProperty(typing, 'target', { value: input });
  select.handlers.onMenuKeydown(typing);
  assert.equal(typing.defaultPrevented, false, 'the search keeps its space character');
  assert.deepEqual(select.state.value, [], 'and nothing was picked');
  input.remove();

  select.handlers.onListLeave();
  const idle = new dom.window.KeyboardEvent('keydown', { key: ' ', cancelable: true });
  select.handlers.onMenuKeydown(idle);
  assert.equal(idle.defaultPrevented, true, 'no active row: still consumed, so the page never scrolls');
  assert.deepEqual(select.state.value, [], 'and nothing was picked');
});

test('AUDIT — the disabled-highlight invariant holds at EVERY door: Home, End, refresh, filter', () => {
  const element = host();
  const select = useSelect(element, {});
  const EDGED = [
    { label: 'Gate', value: 'g', disabled: true },
    { label: 'Alpha', value: 'a' },
    { label: 'Omega', value: 'o', disabled: true },
  ];
  select.setOptions(EDGED);
  assert.equal(select.state.active, 1, 'seeding lands on the first ENABLED row');
  select.open();
  select.handlers.onMenuKeydown(new dom.window.KeyboardEvent('keydown', { key: 'End' }));
  assert.equal(select.state.active, 1, 'End lands on the last enabled row, not disabled Omega');
  select.handlers.onMenuKeydown(new dom.window.KeyboardEvent('keydown', { key: 'Home' }));
  assert.equal(select.state.active, 1, 'Home lands on the first enabled row, not disabled Gate');

  const input = dom.window.document.createElement('input');
  input.value = '';
  const event = new dom.window.Event('input');
  Object.defineProperty(event, 'target', { value: input });
  select.handlers.onSearchInput(event);
  assert.equal(select.state.active, 1, 'a filter reset lands on the first enabled row');

  select.setOptions([{ label: 'New', value: 'n', disabled: true }, { label: 'Live', value: 'l' }]);
  assert.equal(select.state.active, 1, 'a refresh that loses the highlighted row falls to the first enabled');

  select.setOptions(EDGED.map((option) => ({ ...option, disabled: true })));
  assert.equal(select.state.active, -1, 'all disabled: nothing takes the highlight');
});

test('AUDIT — End reaches the create row; activate there creates', () => {
  const element = host();
  let made = '';
  const select = useSelect(element, { creatable: () => true, onCreate: (label) => (made = label) });
  select.setOptions([{ label: 'Alpha', value: 'a' }]);
  select.open();
  select.state.search = 'delta';
  select.handlers.onMenuKeydown(new dom.window.KeyboardEvent('keydown', { key: 'End' }));
  select.activate(select.state.active);
  assert.equal(made, 'delta', 'End walked to the create row and Enter created');
});

test('AUDIT — a selection made before its option existed upgrades its label when options arrive', () => {
  const element = host();
  const select = useSelect(element, {});
  select.state.value = [{ label: 'b', value: 'b' }]; // placeholder label = raw value (pre-options)
  select.setOptions([{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }]);
  assert.equal(select.state.value[0].label, 'Beta', 'placeholder label upgraded to the real one');
  assert.equal(select.state.value[0].value, 'b', 'the value string is unchanged');
});

test('AUDIT — a selection whose option is absent from the new set keeps its cached label (remote)', () => {
  const element = host();
  const select = useSelect(element, { remote: () => true });
  select.setOptions([{ label: 'Server B', value: 'b' }]);
  select.state.value = [{ label: 'Server B', value: 'b' }];
  select.setOptions([{ label: 'Other', value: 'z' }]); // b gone from the list
  assert.equal(select.state.value[0].label, 'Server B', 'the cached label survives a refresh that drops it');
});
