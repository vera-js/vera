/**
 * **<vera-menu> over the author's trigger and items**, through its real bundle in jsdom: the wiring it sets at connect
 * (roles, ids, `popovertarget`, labels, separators, `aria-keyshortcuts` from a shown shortcut), what choosing an item does
 * (the item's own click first, then a cancelable `menuaction`; a checkbox or radio item's `aria-checked`; an
 * `aria-disabled` item doing nothing), what it warns (once, with a code), two instances' ids, and its listeners gone with
 * the element. jsdom has no popover, so opening, focus by modality, the keys and placement are an engine's to answer:
 * `tests/browser/menu.test.js`. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

/** The net's named limit: jsdom cannot parse some CSS an engine accepts (anchor positioning, @starting-style). */
const said = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => said.push(String(args[0])));
virtualConsole.on('warn', (...args) => said.push(String(args[0])));
virtualConsole.on('jsdomError', (error) => {
  if (!/^Could not parse CSS stylesheet/.test(error.message)) said.push(String(error.stack ?? error));
});
console.warn = (...args) => said.push(String(args[0]));
console.error = (...args) => said.push(String(args[0]));

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true, virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle'])
  globalThis[key] = dom.window[key];
const doc = dom.window.document;

const { flush } = await load('core');
await load('vera-components/menu');

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const ITEMS =
  '<div slot="menu"><button value="rename">Rename <kbd>F2</kbd></button><a href="#export">Export…</a><hr>' +
  '<button role="menuitemcheckbox" aria-checked="true" value="wrap">Word wrap</button>' +
  '<div role="group" aria-label="Sort"><button role="menuitemradio" aria-checked="true" value="name">Name</button><button role="menuitemradio" aria-checked="false" value="date">Date</button></div>' +
  '<button aria-disabled="true" value="delete">Delete</button><button>Copy <vera-kbd keys="Mod+Shift+C"></vera-kbd></button><button>Find <kbd>⌘F</kbd></button></div>';
const mount = async (inner = `<button slot="trigger">Actions</button>${ITEMS}`, attributes = '') => {
  const holder = doc.createElement('div');
  holder.innerHTML = `<vera-menu ${attributes}>${inner}</vera-menu>`;
  doc.body.append(holder);
  await settle();
  return holder.firstElementChild;
};
const drop = (el) => el.parentElement.remove();
const menuOf = (el) => el.querySelector(':scope > [slot="menu"]');
const item = (el, value) => el.querySelector(`[value="${value}"]`);
const heard = (el) => {
  const log = [];
  el.addEventListener('menuaction', (event) => log.push([event.detail.value, event.detail.checked, event.detail.reason, event.detail.item.getAttribute('value')]));
  return log;
};
/** A development warning said exactly once, naming its code; production says nothing. */
const saidOnce = (code) => {
  const lines = said.splice(0);
  if (isProduction) return assert.deepEqual(lines, [], 'production: nothing said');
  assert.equal(lines.length, 1, lines.join(' | '));
  assert.match(lines[0], code);
  assert.match(lines[0], /^\[vera\] /);
};

test('at connect: the menu, trigger and items are wired in place, and nothing is said', async () => {
  const el = await mount();
  const menu = menuOf(el);
  const trigger = el.querySelector('[slot="trigger"]');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.getAttribute('popover'), 'auto');
  assert.equal(menu.getAttribute('tabindex'), '-1');
  assert.equal(menu.getAttribute('data-vera-part'), 'menu');
  assert.ok(menu.id !== '' && trigger.id !== '', 'ids minted');
  assert.equal(trigger.getAttribute('popovertarget'), menu.id);
  assert.equal(trigger.getAttribute('aria-controls'), menu.id);
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(menu.getAttribute('aria-labelledby'), trigger.id);
  assert.deepEqual(
    [...menu.querySelectorAll('[role^="menuitem"]')].map((node) => node.getAttribute('role')),
    ['menuitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'menuitemradio', 'menuitem', 'menuitem', 'menuitem'],
    'an author\'s checkable role is kept; every other item, links included, is a menuitem',
  );
  assert.equal(menu.querySelector('hr').getAttribute('role'), 'separator');
  assert.deepEqual(said.splice(0), []);
  drop(el);
});

test('an author\'s own ids, label and popover value are kept (CONTROL: the minted ones differ)', async () => {
  const el = await mount('<button slot="trigger" id="t1">Go</button><div slot="menu" id="m1" popover="manual" aria-label="Go menu"><button>One</button></div>');
  const menu = menuOf(el);
  assert.equal(menu.id, 'm1');
  assert.equal(el.querySelector('[slot="trigger"]').getAttribute('popovertarget'), 'm1');
  assert.equal(menu.getAttribute('popover'), 'manual');
  assert.equal(menu.hasAttribute('aria-labelledby'), false, 'an aria-label stands');
  const other = await mount();
  assert.notEqual(menuOf(other).id, 'm1', 'CONTROL: a minted id');
  drop(el);
  drop(other);
});

test('a shown shortcut is hidden from the item\'s name and said by aria-keyshortcuts where it parses as words; a glyph is not guessed', async () => {
  const el = await mount();
  const [rename, copy, find] = [item(el, 'rename'), [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Copy')), [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Find'))];
  assert.equal(rename.querySelector('kbd').getAttribute('aria-hidden'), 'true');
  assert.equal(rename.getAttribute('aria-keyshortcuts'), 'F2');
  assert.equal(copy.getAttribute('aria-keyshortcuts'), 'Control+Shift+C', 'Mod is Control off Apple platforms (jsdom reports none)');
  assert.equal(find.hasAttribute('aria-keyshortcuts'), false, 'a glyph is left unset');
  assert.equal(find.querySelector('kbd').getAttribute('aria-hidden'), 'true', 'CONTROL: still hidden from the name');
  drop(el);
});

test('choosing an item: its own click runs first, then menuaction with its value, reason and no checked', async () => {
  const el = await mount();
  const order = [];
  item(el, 'rename').addEventListener('click', () => order.push('click'));
  el.addEventListener('menuaction', () => order.push('menuaction'));
  const log = heard(el);
  item(el, 'rename').click();
  assert.deepEqual(order, ['click', 'menuaction']);
  assert.deepEqual(log, [['rename', null, 'keyboard', 'rename']], 'click() has detail 0, as a screen reader\'s and a key\'s click do');
  item(el, 'rename').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.equal(log[1][2], 'pointer');
  const link = el.querySelector('a');
  link.addEventListener('click', (event) => event.preventDefault());
  link.click();
  assert.equal(log[2][0], 'Export…', 'no value: the item\'s text');
  drop(el);
});

test('a checkbox item toggles; a radio item checks itself and unchecks its group, not the checkbox', async () => {
  const el = await mount();
  const log = heard(el);
  item(el, 'wrap').click();
  assert.equal(item(el, 'wrap').getAttribute('aria-checked'), 'false');
  item(el, 'date').click();
  assert.equal(item(el, 'date').getAttribute('aria-checked'), 'true');
  assert.equal(item(el, 'name').getAttribute('aria-checked'), 'false');
  assert.equal(item(el, 'wrap').getAttribute('aria-checked'), 'false', 'outside the group: untouched');
  assert.deepEqual(log.map(([value, checked]) => [value, checked]), [['wrap', false], ['date', true]]);
  drop(el);
});

test('an aria-disabled item does nothing: no menuaction, its default prevented (CONTROL: an enabled item fires)', async () => {
  const el = await mount();
  const log = heard(el);
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  item(el, 'delete').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(log, []);
  item(el, 'rename').click();
  assert.equal(log.length, 1, 'CONTROL');
  drop(el);
});

test('a click outside any item, or on the menu itself, fires nothing', async () => {
  const el = await mount();
  const log = heard(el);
  menuOf(el).click();
  el.querySelector('hr').click();
  assert.deepEqual(log, []);
  drop(el);
});

test('context mode: the target and one point node are wired, and no trigger is needed', async () => {
  const el = await mount('<div slot="target">Area</div><div slot="menu" aria-label="Area"><button>One</button></div>', 'opener="context"');
  const points = el.querySelectorAll('[data-vera-part="point"]');
  assert.equal(points.length, 1);
  assert.equal(points[0].getAttribute('aria-hidden'), 'true');
  assert.equal(menuOf(el).getAttribute('role'), 'menu');
  assert.deepEqual(said.splice(0), []);
  drop(el);
});

test('it warns once, with a code: no menu, no trigger, no target, an unnamed context menu, a link without href', async () => {
  for (const [inner, attributes, code] of [
    ['<button slot="trigger">Go</button>', '', /menu-no-list/],
    ['<div slot="menu"><button>One</button></div>', '', /menu-no-trigger/],
    ['<button slot="trigger">Go</button><div slot="menu"><button>One</button></div>', 'opener="context"', /menu-no-target/],
    ['<div slot="target">Area</div><div slot="menu"><button>One</button></div>', 'opener="context"', /menu-no-label/],
    ['<button slot="trigger">Go</button><div slot="menu"><a>Nowhere</a><button>One</button></div>', '', /menu-link-no-href/],
  ]) {
    const el = await mount(inner, attributes);
    saidOnce(code);
    drop(el);
  }
});

test('two instances mint distinct ids', async () => {
  const [a, b] = [await mount(), await mount()];
  assert.notEqual(menuOf(a).id, menuOf(b).id);
  assert.notEqual(a.querySelector('[slot="trigger"]').id, b.querySelector('[slot="trigger"]').id);
  drop(a);
  drop(b);
});

test('its listeners go with the element: a click after removal fires no menuaction (CONTROL: before removal it does)', async () => {
  const el = await mount();
  const log = heard(el);
  item(el, 'rename').click();
  assert.equal(log.length, 1, 'CONTROL');
  const holder = el.parentElement;
  el.remove();
  await settle();
  item(el, 'rename').click();
  assert.equal(log.length, 1);
  holder.remove();
});
