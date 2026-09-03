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
  'KeyboardEvent', 'FormData', 'MutationObserver',
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
  element.addEventListener('change', (event) => events.push(event.detail.value));

  part(element, 'trigger').click();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open');
  assert.equal(part(element, 'trigger').getAttribute('aria-expanded'), 'true');

  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  assert.deepEqual(events, ['b'], 'the detail carries the mode-shaped string value');
  assert.equal(element.value, 'b', 'single mode: value is a string');
  assert.deepEqual(element.selectedOptions.map((o) => o.label), ['Beta'], 'selectedOptions carries the objects');
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
  assert.deepEqual(element.value, ['a', 'b'], 'multi: value is a string array');
  assert.equal(options()[0].getAttribute('aria-selected'), 'true');
  options()[0].click();
  await frame();
  assert.deepEqual(element.value, ['b'], 'toggled off');

  /** Pills: the multi value renders chips with real remove buttons — legal now that the trigger
   *  is a div (interactive-inside-button was why v1 cut them). */
  const pills = () => root(element).querySelectorAll('[part="pill"]');
  assert.equal(pills().length, 1);
  assert.match(pills()[0].textContent, /Beta/);
  pills()[0].querySelector('[part="pill-remove"]').click();
  await frame();
  assert.deepEqual(element.value, [], 'the chip’s remove button unpicks');
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open', 'and does not toggle the menu');

  options()[0].click();
  await frame();
  options()[1].click();
  await frame();
  part(element, 'trigger').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  await frame();
  assert.deepEqual(element.value, ['a'], 'Backspace on the trigger removes the most recent pill');
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
  assert.equal(element.value, 'b');

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
  element.value = 'a';
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
  assert.equal(element.value, 'mint-id', 'the shaped option was picked');
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
  /** Gamma (index 2) is last but DISABLED — the disabled-highlight invariant holds at every
   *  door now, so End lands on the last enabled row. (The old positional End was the one door
   *  that could tint a row Enter refused.) */
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1');
  await key('Home');
  await key('ArrowDown');
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1');
  await key('Enter');
  assert.equal(element.value, 'b');
  assert.equal(trigger.getAttribute('aria-activedescendant'), null, 'closed means no active descendant');
  element.remove();
});

test('icons are aria-hidden by contract, descriptions announce, groups are real groups', async () => {
  const element = await mount();
  element.options = [
    { label: 'Vanilla', value: 'v', group: 'Classics', iconBefore: '🍦', description: 'the safe pick' },
    { label: 'Chocolate', value: 'c', group: 'Classics' },
    { label: 'Matcha', value: 'm', group: 'Modern', iconAfter: '🍵' },
    { label: 'Plain', value: 'p' },
  ];
  await frame();
  part(element, 'trigger').click();
  await frame();

  const icons = root(element).querySelectorAll('[part="option-icon"]');
  assert.equal(icons.length, 2);
  for (const icon of icons) assert.equal(icon.getAttribute('aria-hidden'), 'true', 'decorative by contract');
  assert.equal(icons[0].textContent.trim(), '🍦', 'a plain string renders as text — data cannot inject');

  const described = root(element).querySelector('[part="option"]');
  assert.match(described.textContent, /the safe pick/, 'the description is inside the option, so it announces');

  const groups = [...root(element).querySelectorAll('[part="group"]')];
  assert.deepEqual(groups.map((group) => group.getAttribute('aria-label')), ['Classics', 'Modern']);
  assert.equal(groups[0].getAttribute('role'), 'group');
  assert.equal(groups[0].querySelectorAll('[part="option"]').length, 2, 'consecutive same-group rows cluster');
  assert.equal(groups[0].querySelector('[part="group-label"]').getAttribute('aria-hidden'), 'true');

  /** Grouping must not disturb the flat keyboard identity. (Two presses: a CLICK-opened menu
   *  starts with no active row — the phantom-hover fix — so the first ArrowDown lands on 0.) */
  const trigger = part(element, 'trigger');
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1', 'indexes stay flat across groups');
  element.remove();
});

test('typeahead: typing on the trigger opens and jumps, cycles on repeat, skips disabled', async () => {
  const element = await mount(); // Alpha, Beta, Gamma(disabled)
  const trigger = part(element, 'trigger');
  const type = (key) => {
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
    return frame();
  };
  await type('b');
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open', 'typing opens');
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1', 'and lands on Beta');
  await type('g');
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1', 'disabled Gamma is never landed on');
  element.remove();
});

test('the status line announces result counts in the consumer’s words, and loading', async () => {
  const element = await mount((el) => {
    el.setAttribute('searchable', '');
    el.setAttribute('results-message', '{count} flavors on offer');
  });
  assert.equal(part(element, 'status').getAttribute('role'), 'status');
  assert.equal(part(element, 'status').textContent.trim(), '', 'silent while closed');
  part(element, 'trigger').click();
  await frame();
  assert.equal(part(element, 'status').textContent.trim(), '3 flavors on offer');
  const search = part(element, 'search');
  search.value = 'alp';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  assert.equal(part(element, 'status').textContent.trim(), '1 flavors on offer');
  element.setAttribute('loading', '');
  await frame();
  assert.equal(part(element, 'status').textContent.trim(), 'Loading…');
  element.remove();
});

test('required reflects aria-required on the trigger', async () => {
  const element = await mount((el) => el.setAttribute('required', ''));
  assert.equal(part(element, 'trigger').getAttribute('aria-required'), 'true');
  element.removeAttribute('required');
  await frame();
  const after = part(element, 'trigger').getAttribute('aria-required');
  assert.ok(after === null || after === '', 'and releases it');
  element.remove();
});

test('HTML-authored options: option/optgroup parse, selected seeds value AND reset-to-defaults', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.innerHTML = `
    <optgroup label="Classics">
      <option value="vanilla" selected>Vanilla</option>
      <option value="chocolate" data-description="the safe pick">Chocolate</option>
    </optgroup>
    <option disabled>Durian</option>
  `;
  dom.window.document.body.append(element);
  await frame();

  assert.deepEqual(
    element.options.map((o) => [o.value, o.label, o.group ?? null, o.disabled ?? false]),
    [
      ['vanilla', 'Vanilla', 'Classics', false],
      ['chocolate', 'Chocolate', 'Classics', false],
      ['Durian', 'Durian', null, true],
    ],
    'a value-less option falls back to its text; optgroup label becomes the group'
  );
  assert.equal(element.options[1].description, 'the safe pick');
  assert.equal(element.value, 'vanilla', 'selected seeded the value');

  part(element, 'trigger').click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  assert.equal(element.value, 'chocolate');
  element.formResetCallback();
  assert.equal(element.value, 'vanilla', 'reset restores DEFAULTS, not emptiness');
  element.remove();
});

test('vera-option: rich rows — icon cloned in (light DOM untouched), description, label, value fallback', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.innerHTML = `
    <vera-option value="pistachio">
      <!-- decorative note that must never reach the label -->
      <svg slot="icon" data-mark="nut"></svg>
      Pistachio
      <span slot="description">polarizing, correctly</span>
    </vera-option>
  `;
  dom.window.document.body.append(element);
  await frame();
  part(element, 'trigger').click();
  await frame();

  const [option] = element.options;
  assert.equal(option.value, 'pistachio');
  assert.equal(option.label, 'Pistachio', 'label is the unslotted text, trimmed');
  // and a comment child is not content (its textContent is its data — it polluted the label once)
  assert.equal(option.description, 'polarizing, correctly');

  const icon = root(element).querySelector('[part="option-icon"]');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.ok(icon.querySelector('svg[data-mark="nut"]'), 'the authored svg reached the row');
  assert.ok(element.querySelector('vera-option svg[data-mark="nut"]'), 'as a CLONE — the source markup keeps its node');
  assert.match(root(element).querySelector('[part="option"]').textContent, /polarizing/);
  element.remove();
});

test('precedence: HTML seeds, property wins — and permanently retires the markup as source', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.innerHTML = '<option value="from-html">From HTML</option>';
  dom.window.document.body.append(element);
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['from-html']);

  element.options = OPTIONS;
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['a', 'b', 'g'], 'the property replaced the markup');

  element.insertAdjacentHTML('beforeend', '<option value="late">Late</option>');
  await frame();
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['a', 'b', 'g'], 'markup mutations no longer apply');
  element.remove();
});

test('markup stays live in shadow mode: added options appear, selected edits move the defaults', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.setAttribute('multi', ''); // plural defaults are a multi concern; single truncates to one
  element.innerHTML = '<option value="one" selected>One</option>';
  dom.window.document.body.append(element);
  await frame();

  element.insertAdjacentHTML('beforeend', '<option value="two">Two</option>');
  await frame();
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['one', 'two'], 'the observer saw the new option');

  element.querySelector('option[value="two"]').setAttribute('selected', '');
  await frame();
  await frame();
  element.formResetCallback();
  assert.deepEqual(element.selectedOptions.map((o) => o.value), ['one', 'two'], 'defaults track the markup');
  element.remove();
});

test('light mode: children seed the options and are consumed by the first render — one-shot, documented', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.setAttribute('light', '');
  element.innerHTML = '<option value="lit">Lit</option>';
  dom.window.document.body.append(element);
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['lit'], 'parsed before render consumed them');
  assert.equal(element.querySelector('option'), null, 'the light render owns the subtree now');
  element.remove();
});

test('the value model: strings in, mode-shaped out, objects accepted, null clears', async () => {
  const element = await mount();
  element.value = 'b';
  await frame();
  assert.equal(element.value, 'b');
  assert.match(part(element, 'value').textContent, /Beta/, 'a bare string found its option and label');

  element.value = null;
  assert.equal(element.value, '', 'null clears to the empty string');

  element.value = OPTIONS[1]; // a full option still works — it adopts its own label
  assert.equal(element.value, 'b');

  element.setAttribute('multi', '');
  await frame();
  element.value = ['a', 'b'];
  assert.deepEqual(element.value, ['a', 'b'], 'multi takes and returns string arrays');
  element.value = ['a', 'a', 'b'];
  assert.deepEqual(element.value, ['a', 'b'], 'duplicate entries collapse — selection identity is the value');
  element.removeAttribute('multi'); // the mode change itself is a door (found by the chaos fuzz)
  await frame();
  assert.equal(element.value, 'a', 'toggling multi off truncates a plural selection to one');
  element.remove();
});

test('the value attribute seeds single-mode initial value and doubles as the reset default', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.setAttribute('value', 'b');
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  await frame();
  /** Attribute read at connect; options arrived just after — the pending resolution covers it. */
  const fresh = dom.window.document.createElement('vera-select');
  fresh.options = OPTIONS;
  fresh.setAttribute('value', 'b');
  dom.window.document.body.append(fresh);
  await frame();
  assert.equal(fresh.value, 'b', 'the attribute seeded the value');
  fresh.value = 'a';
  fresh.formResetCallback();
  assert.equal(fresh.value, 'b', 'and doubles as the reset default');
  element.remove();
  fresh.remove();
});

test('selectedOptions is the label cache: a remote refilter cannot orphan the chosen label', async () => {
  const element = await mount((el) => el.setAttribute('remote', ''));
  part(element, 'trigger').click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[1].click(); // Beta
  await frame();
  element.options = [{ label: 'Zeta', value: 'z' }]; // the "server" refiltered Beta away
  await frame();
  assert.equal(element.value, 'b', 'the selection identity survives');
  assert.deepEqual(element.selectedOptions.map((o) => o.label), ['Beta'], 'and so does its label');
  assert.match(part(element, 'value').textContent, /Beta/);
  element.remove();
});

test('a slotted search input is wired like our own: filtering, keyboard, combobox aria', async () => {
  const element = dom.window.document.createElement('vera-select');
  const search = dom.window.document.createElement('input');
  search.slot = 'search';
  element.append(search);
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  await frame();
  await frame();

  assert.equal(search.getAttribute('aria-controls'), 'listbox');
  assert.equal(search.getAttribute('aria-autocomplete'), 'list');

  part(element, 'trigger').click();
  await frame();
  search.value = 'bet';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  assert.equal(root(element).querySelectorAll('[part="option"]').length, 1, 'the slotted input filters');
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await frame();
  assert.equal(element.value, 'b', 'and its Enter picks through the same keyboard model');
  element.remove();
});

test('a slotted empty message replaces ours', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.setAttribute('searchable', '');
  const empty = dom.window.document.createElement('p');
  empty.slot = 'empty';
  empty.textContent = 'The void stares back';
  element.append(empty);
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  await frame();
  part(element, 'trigger').click();
  await frame();
  const search = part(element, 'search');
  search.value = 'zzz';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  /** Fallback content stays in the shadow tree either way — assignment is what displaces it. */
  const slot = root(element).querySelector('slot[name="empty"]');
  assert.equal(slot.assignedElements().length, 1, 'the page’s message is assigned in place of ours');
  assert.match(slot.assignedElements()[0].textContent, /void/);
  element.remove();
});

test('the keyboard highlight tracks the OPTION, not its index, across a remote refresh', async () => {
  const element = await mount((el) => el.setAttribute('remote', ''));
  const trigger = part(element, 'trigger');
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-1', 'Beta is highlighted');

  element.options = [OPTIONS[1], OPTIONS[0]]; // the "server" reordered — Beta is index 0 now
  await frame();
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-0', 'the highlight followed Beta');
  assert.match(root(element).querySelector('[data-active]').textContent, /Beta/);

  element.options = [OPTIONS[0]]; // Beta vanished entirely
  await frame();
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'opt-0', 'a vanished option lands the highlight at the top');
  element.remove();
});

test('AUDIT P1 — reconnection: live state survives a DOM move; nothing re-seeds, nothing leaks', async () => {
  const element = dom.window.document.createElement('vera-select');
  element.setAttribute('value', 'x');
  dom.window.document.body.append(element);
  element.options = [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }];
  await frame();
  element.options = [{ label: 'Two', value: '2' }]; // live replacement
  element.value = '2';

  element.remove();
  dom.window.document.body.append(element); // the move
  await frame();
  assert.deepEqual(element.options.map((o) => o.value), ['2'], 'options survive — reconnect must not re-seed');
  assert.equal(element.value, '2', 'the live selection survives — the value attribute must not re-apply');

  /** Removed while open, after a reconnect: the dismissal listeners must go with it. */
  element.open();
  await frame();
  const toggled = [];
  element.addEventListener('toggle', () => toggled.push(1));
  element.remove();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(toggled.length, 0, 'a detached element hears nothing from document — no leaked listener');
});

test('AUDIT P1 — disabling while open closes the menu, through both the attribute and the form path', async () => {
  const element = await mount();
  element.open();
  await frame();
  element.setAttribute('disabled', '');
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'attribute path');
  element.removeAttribute('disabled');
  await frame();
  element.open();
  await frame();
  element.formDisabledCallback(true); // a fieldset disabling
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'form path');
  element.formDisabledCallback(false);
  element.remove();
});

test('AUDIT P1 — the value getter answers correctly before connect', () => {
  const element = dom.window.document.createElement('vera-select');
  element.options = [{ label: 'B', value: 'b' }];
  element.value = 'b';
  assert.equal(element.value, 'b', 'pending resolves through the same path as selectedOptions');
  assert.deepEqual(element.selectedOptions.map((o) => o.label), ['B']);
});

test('AUDIT P2 — the menu consumes its Escape; the filter debounce dies with the element', async () => {
  const element = await mount();
  element.open();
  await frame();
  let pageEscapes = 0;
  const pageHandler = (event) => event.key === 'Escape' && pageEscapes++;
  dom.window.document.addEventListener('keydown', pageHandler);
  dom.window.document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
  );
  await frame();
  dom.window.document.removeEventListener('keydown', pageHandler);
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'the menu closed');
  assert.equal(pageEscapes, 0, 'and the page modal underneath never heard the keystroke');
  element.remove();

  const remote = await mount((el) => {
    el.setAttribute('remote', '');
    el.setAttribute('debounce', '20');
  });
  remote.open();
  await frame();
  const search = part(remote, 'search');
  search.value = 'q';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  let late = 0;
  remote.addEventListener('filter', () => late++);
  remote.remove();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(late, 0, 'no filter event fires on a detached element');
});

test('AUDIT P5 — focus() delegates to the effective trigger, built-in or slotted, either mode', async () => {
  const element = await mount();
  element.focus();
  assert.equal(root(element).activeElement, part(element, 'trigger'), 'shadow: focus lands on our trigger');
  element.remove();

  const slotted = dom.window.document.createElement('vera-select');
  const trigger = dom.window.document.createElement('button');
  trigger.slot = 'trigger';
  slotted.append(trigger);
  dom.window.document.body.append(slotted);
  slotted.options = OPTIONS;
  await frame();
  slotted.focus();
  assert.equal(dom.window.document.activeElement, trigger, 'a slotted trigger receives the delegation');
  slotted.remove();

  const light = await mount((el) => el.setAttribute('light', ''));
  light.focus();
  assert.equal(dom.window.document.activeElement, light.querySelector('[part="trigger"]'), 'light mode too');
  light.remove();
});

test('AUDIT P8 — single mode holds one; restore rejects non-strings; the last three strings are attributes', async () => {
  const element = await mount();
  element.value = ['a', 'b']; // multi-shaped in single mode
  assert.equal(element.value, 'a', 'single mode keeps the first entry, same as every pick path');

  element.formStateRestoreCallback(JSON.stringify(['b', 42, null, 'a']));
  assert.equal(element.value, 'b', 'non-string entries in restore state are discarded, single keeps first');
  element.remove();

  const worded = await mount((el) => {
    el.setAttribute('creatable', '');
    el.setAttribute('multi', '');
    el.setAttribute('loading', '');
    el.setAttribute('create-message', 'Invent “{label}”');
    el.setAttribute('remove-message', 'Drop {label}');
    el.setAttribute('loading-message', 'Scooping…');
  });
  worded.value = ['a'];
  await frame();
  part(worded, 'trigger').click();
  await frame();
  assert.equal(
    root(worded).querySelector('[part="pill-remove"]').getAttribute('aria-label'),
    'Drop Alpha',
    'the pill remove name interpolates the consumer’s words'
  );
  const search = part(worded, 'search');
  search.value = 'Mango';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await frame();
  assert.match(root(worded).querySelector('[data-create]').textContent, /Invent “Mango”/);
  worded.options = [];
  await frame();
  assert.match(part(worded, 'empty').textContent, /Scooping…/);
  worded.remove();
});

test('disabled means inert: gestures, keys, typeahead and open() all refuse — including via fieldset', async () => {
  const element = await mount((el) => el.setAttribute('disabled', ''));
  const trigger = part(element, 'trigger');
  assert.equal(trigger.getAttribute('tabindex'), '-1', 'a disabled trigger leaves the tab order');
  assert.equal(trigger.getAttribute('aria-disabled'), 'true');
  trigger.click();
  element.open();
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'nothing opens it');

  element.removeAttribute('disabled');
  await frame();
  element.formDisabledCallback(true); // what a disabled <fieldset> delivers
  await frame();
  element.open();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'form disabling behaves identically');
  element.formDisabledCallback(false);
  element.remove();
});

test('input fires before change, once per commit; beforetoggle can veto; toggle reports the settled state', async () => {
  const element = await mount((el) => el.setAttribute('multi', ''));
  const order = [];
  element.addEventListener('input', () => order.push('input'));
  element.addEventListener('change', () => order.push('change'));
  element.addEventListener('toggle', (event) => order.push(`toggle:${event.newState ?? event.detail.newState}`));

  element.addEventListener('beforetoggle', (event) => event.preventDefault(), { once: true });
  element.open();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'beforetoggle vetoed the open');

  element.open();
  await frame();
  element.addEventListener('beforetoggle', (event) => event.preventDefault(), { once: true });
  element.close();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'open', 'the close direction vetoes too');
  element.close();
  await frame();
  assert.equal(part(element, 'menu').getAttribute('data-state'), 'closed', 'and un-vetoed close proceeds');
  element.open();
  await frame();

  element.open();
  await frame();
  root(element).querySelectorAll('[part="option"]')[0].click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  element.close();
  await frame();
  assert.deepEqual(
    order,
    ['toggle:open', 'toggle:closed', 'toggle:open', 'input', 'change', 'input', 'change', 'toggle:closed'],
    'platform order: input then change, one pair per commit; toggles bookend, vetoed transitions are silent'
  );
  element.remove();
});

test('formStateRestoreCallback rebuilds the selection — known values from options, unknown as placeholders', async () => {
  const element = await mount((el) => el.setAttribute('multi', '')); // restoring plural is a multi concern
  element.formStateRestoreCallback(JSON.stringify(['b', 'ghost']));
  await frame();
  assert.deepEqual(element.selectedOptions.map((o) => [o.value, o.label]), [['b', 'Beta'], ['ghost', 'ghost']]);
  element.formStateRestoreCallback('not json'); // hostile restore state must be a no-op
  assert.equal(element.selectedOptions.length, 2);
  element.remove();
});

test('form reset empties the selection; the change event carries a copy, not the store', async () => {
  const element = await mount();
  element.value = 'a';
  await frame();
  let detail;
  element.addEventListener('change', (event) => (detail = event.detail.selectedOptions));
  part(element, 'trigger').click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[1].click();
  await frame();
  detail.push({ label: 'X', value: 'x' });
  assert.equal(element.selectedOptions.length, 1, 'mutating the event detail cannot corrupt the store');

  element.formResetCallback();
  await frame();
  assert.equal(element.value, '', 'single-mode empty is the empty string');
  element.remove();
});

test('AUDIT — hover is not sticky: pointerleave clears data-active; click-open shows no phantom row', async () => {
  const element = await mount();
  part(element, 'trigger').click();
  await frame();
  assert.equal(
    root(element).querySelector('[part="option"][data-active]'),
    null,
    'a mouse open with nothing selected tints no row'
  );
  const rows = root(element).querySelectorAll('[part="option"]');
  /** Two moves with different coordinates: the first primes the parked-cursor guard. */
  rows[1].dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }));
  rows[1].dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 11, clientY: 10 }));
  await frame();
  assert.ok(rows[1].hasAttribute('data-active'), 'hovering a row tints it');
  part(element, 'list').dispatchEvent(new dom.window.Event('pointerleave'));
  await frame();
  assert.equal(
    root(element).querySelector('[part="option"][data-active]'),
    null,
    'the tint leaves with the pointer — the last-hovered row does not keep it'
  );
  element.remove();
});

test('AUDIT — the listbox opts out of sequential focus explicitly (scroll containers are UA-focusable)', async () => {
  const element = await mount();
  part(element, 'trigger').click();
  await frame();
  assert.equal(
    part(element, 'list').getAttribute('tabindex'),
    '-1',
    'Chrome/Firefox implicitly tab-focus scrollable divs; the explicit -1 is the opt-out Tab depends on'
  );
  element.remove();
});

test('AUDIT — native IDL reflections: name/disabled/required/multi reflect, labels/form/type answer', async () => {
  const element = await mount((el) => el.setAttribute('name', 'flavor'));
  assert.equal(element.name, 'flavor', 'name reads the attribute');
  element.name = 'renamed';
  assert.equal(element.getAttribute('name'), 'renamed', 'name setter reflects');

  assert.equal(element.disabled, false);
  element.disabled = true;
  assert.equal(element.hasAttribute('disabled'), true, 'disabled = true is no longer a silent expando');
  element.disabled = false;
  assert.equal(element.hasAttribute('disabled'), false);

  element.required = true;
  assert.equal(element.hasAttribute('required'), true);

  assert.equal(element.type, 'select-one', 'the native <select> vocabulary');
  element.multi = true;
  assert.equal(element.hasAttribute('multi'), true, 'multi reflects like the rest');
  assert.equal(element.type, 'select-multiple');
  element.multi = false;

  /** jsdom's ElementInternals does not track form ownership on reparenting — presence is
   *  asserted here; the BEHAVIOR (form identity, labels list) is pinned in the browser suite. */
  assert.ok('form' in element, 'the form accessor exists');
  assert.ok('labels' in element, 'the labels accessor exists');
  element.remove();
});

test('AUDIT — a pre-upgrade `disabled = true` expando survives the dance like options does', async () => {
  /** The dance list must carry every accessor: an own property assigned before upgrade shadows
   *  the prototype accessor forever unless re-routed. */
  const element = dom.window.document.createElement('vera-select');
  element.disabled = true;
  element.name = 'early';
  dom.window.document.body.append(element);
  await frame();
  assert.equal(element.hasAttribute('disabled'), true, 'the early boolean reached the attribute');
  assert.equal(element.getAttribute('name'), 'early', 'the early string reached the attribute');
  element.remove();
});

test('AUDIT — a menu appearing under a PARKED cursor does not steal the keyboard highlight', async () => {
  const element = await mount();
  part(element, 'trigger').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  const rows = root(element).querySelectorAll('[part="option"]');
  /** Engines re-dispatch boundary/move events with UNCHANGED coordinates when content appears
   *  under a resting mouse (Firefox, measured live). Same coords twice = parked, ignored. */
  rows[1].dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
  rows[1].dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
  await frame();
  assert.ok(rows[0].hasAttribute('data-active'), 'the keyboard starting point survives a parked cursor');
  part(element, 'trigger').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await frame();
  assert.ok(rows[1].hasAttribute('data-active'), 'and arrows continue from it');
  element.remove();
});

test('AUDIT — a [slot="value"] nested INSIDE a slotted trigger is found and stamped', async () => {
  /** Slot assignment reaches only direct host children, so the natural authoring shape
   *  (<button slot="trigger"><span slot="value">…) never reaches <slot name="value"> — the
   *  controller must find it in the slotted trigger's subtree. The demo card rendered its label
   *  from this stamp and silently never updated (measured). */
  const element = dom.window.document.createElement('vera-select');
  const trigger = dom.window.document.createElement('button');
  trigger.slot = 'trigger';
  const valueNode = dom.window.document.createElement('span');
  valueNode.setAttribute('slot', 'value');
  valueNode.textContent = 'Pick…';
  trigger.append(valueNode);
  element.append(trigger);
  dom.window.document.body.append(element);
  element.options = OPTIONS;
  await frame();
  trigger.click();
  await frame();
  root(element).querySelectorAll('[part="option"]')[0].click();
  await frame();
  assert.equal(valueNode.getAttribute('data-label'), 'Alpha', 'the nested value node is stamped');
  assert.equal(valueNode.textContent, 'Pick…', 'and its children are untouched — you slot it, you own it');
  element.remove();
});

test('AUDIT — value set BEFORE options resolves its label once options arrive', async () => {
  const element = dom.window.document.createElement('vera-select');
  dom.window.document.body.append(element);
  await frame();
  element.value = 'b';                       // no options yet -> placeholder label 'b'
  await frame();
  element.options = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];
  await frame();
  assert.equal(element.value, 'b', 'the value string holds');
  assert.equal(element.selectedOptions[0].label, 'Beta', 'the label upgraded from the raw value');
  assert.match(part(element, 'value').textContent, /Beta/, 'and the trigger shows it');
  element.remove();
});
