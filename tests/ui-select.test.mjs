/**
 * `<vera-select>` against the built artifacts: both DOM modes, default and slotted markup, the
 * event contract, keyboard, form reset, and the pre-upgrade property dance. The renderer and
 * styles are wired the way an app wires them — this suite is also the first consumer of
 * @verajs/ui outside its own package.
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
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'KeyboardEvent', 'FormData',
]) {
  globalThis[key] = dom.window[key];
}

const { wire } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
wire([renderer, styles]);

/**
 * Pre-upgrade assignment happens before the definition loads, so the element is created — and its
 * `options` set — before `@verajs/ui` is imported. The dance in connectedCallback must re-route it.
 */
const early = dom.window.document.createElement('vera-select');
early.options = [{ label: 'Early', value: 'e' }];

await load('ui');
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
  { label: 'Gamma', value: 'g', disabled: true },
];

const mount = async (setup = (element) => element) => {
  const element = dom.window.document.createElement('vera-select');
  setup(element);
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  await frame();
  return element;
};

const root = (element) => element.shadowRoot ?? element;
const part = (element, name) => root(element).querySelector(`[part="${name}"]`);

test('a property assigned before upgrade survives the dance', async () => {
  dom.window.document.body.append(early);
  await frame();
  assert.deepEqual(early.options.map((o) => o.value), ['e'], 'the pre-upgrade own property reached the store');
  assert.match(root(early).querySelector('[part="option"]').textContent, /Early/);
  early.remove();
});

test('shadow by default: parts render, the menu opens on click, a pick commits and closes', async () => {
  const element = await mount();
  assert.ok(element.shadowRoot, 'shadow root attached');
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed');

  const events = [];
  element.addEventListener('change', (event) => events.push(event.detail.value.map((o) => o.value)));

  part(element, 'trigger').click();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open');
  assert.equal(part(element, 'trigger').getAttribute('aria-expanded'), 'true');

  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  assert.deepEqual(events, [['b']]);
  assert.deepEqual(element.value.map((o) => o.value), ['b']);
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'single mode closes');
  assert.match(part(element, 'value').textContent, /Beta/);
});

test('multi: stays open, toggles, marks aria-selected', async () => {
  const element = await mount((el) => el.setAttribute('multi', ''));
  part(element, 'trigger').click();
  await frame();
  const options = () => root(element).querySelectorAll('[part="option"]');
  options()[0].click();
  await frame();
  options()[1].click();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open', 'multi stays open');
  assert.deepEqual(element.value.map((o) => o.value), ['a', 'b']);
  assert.equal(options()[0].getAttribute('aria-selected'), 'true');
  options()[0].click();
  await frame();
  assert.deepEqual(element.value.map((o) => o.value), ['b'], 'toggled off');
  element.remove();
});

test('keyboard: ArrowDown opens from the trigger; arrows skip disabled; Enter picks; Escape closes', async () => {
  const element = await mount();
  const trigger = part(element, 'trigger');
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open');

  const menu = part(element, 'menu');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  const active = root(element).querySelector('[part="option"][data-active]');
  assert.match(active.textContent, /Beta/, 'stepped past Alpha; Gamma is disabled so next is Beta');

  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await frame();
  assert.deepEqual(element.value.map((o) => o.value), ['b']);

  trigger.click();
  await frame();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'Escape dismisses');
  element.remove();
});

test('search filters the listbox and the empty message reports a barren query', async () => {
  const element = await mount();
  part(element, 'trigger').click();
  await frame();
  const search = part(element, 'search');
  search.value = 'zzz';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  assert.equal(root(element).querySelectorAll('[part="option"]').length, 0);
  assert.equal(part(element, 'empty').getAttribute('data-state'), 'visible');
  element.remove();
});

test('light attribute: same markup, no shadow root, parts addressable by plain selector', async () => {
  const element = await mount((el) => el.setAttribute('light', ''));
  assert.equal(element.shadowRoot, null);
  assert.ok(element.querySelector('[part="trigger"]'), 'parts live in the light DOM');
  element.querySelector('[part="trigger"]').click();
  await frame();
  assert.equal(element.querySelector('[part="menu"]').getAttribute('data-state'), 'open');
  element.remove();
});

test('a slotted trigger is wired like our own: role, state stamps, and the same handlers', async () => {
  const element = dom.window.document.createElement('vera-select');
  const trigger = dom.window.document.createElement('button');
  trigger.slot = 'trigger';
  trigger.textContent = 'Custom';
  element.append(trigger);
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  element.value = [OPTIONS[0]];
  await frame();
  await frame();

  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('data-state'), 'closed');
  trigger.click();
  await frame();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'the user’s node drives the controller');
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open');
  element.remove();
});

test('the accessible name lands on the trigger — the wp-omni year-long regression, pinned', async () => {
  const element = await mount((el) => el.setAttribute('aria-label', 'Flavor'));
  assert.equal(part(element, 'trigger').getAttribute('aria-label'), 'Flavor', 'reflected through the boundary');
  element.setAttribute('aria-label', 'Taste');
  await frame();
  assert.equal(part(element, 'trigger').getAttribute('aria-label'), 'Taste', 'and it stays live');
  element.remove();

  const unnamed = await mount();
  const label = part(unnamed, 'trigger').getAttribute('aria-label');
  assert.ok(label === null || label === '', `no name means no attribute — got ${JSON.stringify(label)}`);
  unnamed.remove();
});

test('search is opt-in: hidden by default, shown by searchable, implied by creatable and remote', async () => {
  const plain = await mount();
  assert.equal(part(plain, 'search').hidden, true, 'a plain select has no search line');
  plain.remove();
  for (const attribute of ['searchable', 'creatable', 'remote']) {
    const element = await mount((el) => el.setAttribute(attribute, ''));
    assert.equal(part(element, 'search').hidden, false, `${attribute} shows the search line`);
    element.remove();
  }
});

test('search-placeholder and empty-message are the consumer’s words', async () => {
  const element = await mount((el) => {
    el.setAttribute('searchable', '');
    el.setAttribute('search-placeholder', 'Find a flavor…');
    el.setAttribute('empty-message', 'Nothing scooped');
  });
  assert.equal(part(element, 'search').getAttribute('placeholder'), 'Find a flavor…');
  assert.equal(part(element, 'search').getAttribute('aria-label'), 'Find a flavor…');
  part(element, 'trigger').click();
  await frame();
  const search = part(element, 'search');
  search.value = 'zzz';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  assert.match(part(element, 'empty').textContent, /Nothing scooped/);
  element.remove();
});

test('creatable offers exactly the missing label; the create event is cancelable and shapes the option', async () => {
  const element = await mount((el) => el.setAttribute('creatable', ''));
  part(element, 'trigger').click();
  await frame();
  const search = part(element, 'search');
  const type = async (text) => {
    search.value = text;
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await frame();
  };

  await type('Alpha');
  assert.equal(root(element).querySelector('[data-create]'), null, 'an existing label offers no create row');
  await type('Mint');
  const row = root(element).querySelector('[data-create]');
  assert.match(row.textContent, /Create “Mint”/);

  const created = [];
  element.addEventListener('create', (event) => {
    created.push(event.detail.label);
    event.detail.option.value = 'mint-id'; // the host shapes the option
  });
  row.click();
  await frame();
  assert.deepEqual(created, ['Mint']);
  assert.deepEqual(element.value.map((o) => o.value), ['mint-id'], 'the shaped option was picked');
  assert.ok(element.options.some((o) => o.value === 'mint-id'), 'and joined the options');

  /** A canceled create leaves everything untouched. */
  part(element, 'trigger').click();
  await frame();
  await type('Fig');
  element.addEventListener('create', (event) => event.preventDefault(), { once: true });
  root(element).querySelector('[data-create]').click();
  await frame();
  assert.ok(!element.options.some((o) => o.label === 'Fig'), 'preventDefault claimed the creation');
  element.remove();
});

test('remote mode: no client filtering, a debounced filter event, loading and overflow surfaces', async () => {
  const element = await mount((el) => {
    el.setAttribute('remote', '');
    el.setAttribute('debounce', '10');
    el.setAttribute('overflow-message', '40 more on the server');
  });
  const queries = [];
  element.addEventListener('filter', (event) => queries.push(event.detail.query));

  part(element, 'trigger').click();
  await frame();
  const search = part(element, 'search');
  const type = (text) => {
    search.value = text;
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  type('z');
  type('zz');
  type('zzz'); // three edits inside one debounce window
  assert.equal(queries.length, 0, 'not yet — debounced');
  await frame();
  assert.equal(root(element).querySelectorAll('[part="option"]').length, 3, 'remote mode never client-filters');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(queries, ['zzz'], 'three edits, one event, the last query');

  assert.match(part(element, 'overflow').textContent, /40 more on the server/);
  assert.equal(part(element, 'overflow').getAttribute('data-state'), 'visible');

  element.options = [];
  element.setAttribute('loading', '');
  await frame();
  assert.match(part(element, 'empty').textContent, /Loading…/);
  element.remove();
});

test('without a search line the trigger drives the open menu: arrows, Home/End, Enter, activedescendant', async () => {
  const element = await mount();
  const trigger = part(element, 'trigger');
  const key = (name) => {
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
    return frame();
  };
  await key('ArrowDown'); // opens
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-0');
  await key('End');
  /** Gamma (index 2) is last but disabled rows are only skipped by stepping; End is positional. */
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-2');
  await key('Home');
  await key('ArrowDown');
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1');
  await key('Enter');
  assert.deepEqual(element.value.map((o) => o.value), ['b']);
  assert.equal(trigger.getAttribute('aria-activedescendant'), null, 'closed means no active descendant');
  element.remove();
});

test('form reset empties the selection; the change event carries a copy, not the store', async () => {
  const element = await mount();
  element.value = [OPTIONS[0]];
  await frame();
  let detail;
  element.addEventListener('change', (event) => (detail = event.detail.value));
  part(element, 'trigger').click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  detail.push({ label: 'X', value: 'x' });
  assert.equal(element.value.length, 1, 'mutating the event detail cannot corrupt the store');

  element.formResetCallback();
  await frame();
  assert.deepEqual(element.value, []);
  element.remove();
});
