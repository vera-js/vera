/**
 * **<vera-tabs> over the author's buttons and panels**, through its real bundle in jsdom: the wiring it sets, how it
 * pairs panels, what a press, a key or a write to `value` does and says, a disabled selected tab handing over, what it
 * warns (once per element), two instances' ids, and its listeners gone with the element. The indicator's anchoring is
 * an engine's to answer: `tests/browser/tabs-anchor.test.js`. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

/** The net's named limit: jsdom cannot parse some CSS an engine accepts (anchor positioning, @scope). */
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
await load('vera-components/tabs');

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const TABS = '<div slot="tabs"><button type="button" value="a">A</button><button type="button" value="b">B</button><button type="button" value="c">C</button></div>';
const PANELS = '<section data-value="a">Pa</section><section data-value="b">Pb <button type="button">x</button></section><section data-value="c">Pc</section>';
const mount = async (inner = TABS + PANELS, attributes = '') => {
  const holder = doc.createElement('div');
  holder.innerHTML = `<vera-tabs ${attributes}>${inner}</vera-tabs>`;
  doc.body.append(holder);
  await settle();
  return holder.firstElementChild;
};
const drop = (el) => el.parentElement.remove();
const tabsOf = (el) => [...el.querySelectorAll('[role="tab"]')];
const shown = (el) => [...el.querySelectorAll(':scope > section, :scope > div:not([slot])')].filter((panel) => !panel.hasAttribute('hidden')).map((panel) => panel.textContent.trim().slice(0, 2));
const heard = (el) => {
  const log = [];
  for (const type of ['beforetabchange', 'tabchange']) el.addEventListener(type, (event) => log.push([type, event.detail.value, event.detail.previous, event.detail.reason]));
  return log;
};
const key = (target, name) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
/** A development warning said exactly once, naming its code; production says nothing. */
const saidOnce = (code) => {
  const lines = said.splice(0);
  if (isProduction) return assert.deepEqual(lines, [], 'production: nothing said');
  assert.equal(lines.length, 1, lines.join(' | '));
  assert.match(lines[0], code);
};

test('the wiring: tablist, tabs and panels get their roles and pair by id; the first tab is chosen and only its panel shows', async () => {
  const holder = doc.createElement('div');
  holder.innerHTML = `<vera-tabs-not-yet>${TABS}${PANELS}</vera-tabs-not-yet>`;
  assert.equal(holder.querySelector('[role]'), null, 'CONTROL: markup alone carries no role');
  const el = await mount();
  const list = el.querySelector(':scope > [slot="tabs"]');
  assert.equal(list.getAttribute('role'), 'tablist');
  const tabs = tabsOf(el);
  assert.equal(tabs.length, 3, 'three tabs');
  const panels = [...el.querySelectorAll('[role="tabpanel"]')];
  assert.equal(panels.length, 3, 'three panels');
  tabs.forEach((tab, i) => {
    assert.equal(tab.getAttribute('aria-controls'), panels[i].id, `tab ${i} controls its panel`);
    assert.equal(panels[i].getAttribute('aria-labelledby'), tab.id, `panel ${i} is named by its tab`);
  });
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', 'false', 'false']);
  assert.deepEqual(shown(el), ['Pa'], 'only the first panel shows');
  assert.equal(el.getAttribute('value'), 'a', 'value reflects the selection');
  assert.equal(panels[0].getAttribute('tabindex'), '0', 'a panel with nothing focusable takes focus itself');
  drop(el);
});

test('a press selects: beforetabchange then tabchange, with value, previous and reason; a canceled one changes nothing', async () => {
  const el = await mount();
  const log = heard(el);
  tabsOf(el)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  assert.deepEqual(log, [['beforetabchange', 'b', 'a', 'pointer'], ['tabchange', 'b', 'a', 'pointer']]);
  assert.deepEqual(shown(el), ['Pb'], 'its panel shows');
  assert.equal(el.querySelector('[data-value="b"]').hasAttribute('tabindex'), false, 'a panel holding a focusable control takes no tabindex');
  assert.equal(el.querySelector('[data-value="a"]').hasAttribute('tabindex'), false, 'the panel hidden again gives back its tabindex');
  log.length = 0;
  el.addEventListener('beforetabchange', (event) => event.preventDefault(), { once: true });
  tabsOf(el)[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  assert.deepEqual(log, [['beforetabchange', 'c', 'b', 'pointer']], 'canceled: no tabchange');
  assert.deepEqual(shown(el), ['Pb'], 'and the panel stays');
  drop(el);
});

test('the arrows move the one tab stop and select (automatic); with activation="manual" they only move focus', async () => {
  const el = await mount();
  const log = heard(el);
  const tabs = tabsOf(el);
  tabs[0].focus();
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1], 'CONTROL: one tab stop');
  key(tabs[0], 'ArrowRight');
  await settle();
  assert.equal(doc.activeElement, tabs[1], 'focus moved');
  assert.deepEqual(log.at(-1), ['tabchange', 'b', 'a', 'keyboard'], 'and selected');
  drop(el);
  const manual = await mount(undefined, 'activation="manual"');
  const quiet = heard(manual);
  const mtabs = tabsOf(manual);
  mtabs[0].focus();
  key(mtabs[0], 'ArrowRight');
  await settle();
  assert.equal(doc.activeElement, mtabs[1], 'focus moved');
  assert.deepEqual(quiet, [], 'nothing selected');
  assert.deepEqual(shown(manual), ['Pa'], 'the panel stays');
  drop(manual);
});

test('a write to value selects that tab and fires nothing', async () => {
  const el = await mount();
  const log = heard(el);
  el.setAttribute('value', 'c');
  await settle();
  assert.deepEqual(shown(el), ['Pc'], 'the attribute selected c');
  el.value = 'b';
  await settle();
  assert.deepEqual(shown(el), ['Pb'], 'the property selected b');
  assert.deepEqual(log, [], 'no event');
  drop(el);
});

test('without keys, panels pair by order and a heading between them is skipped; a disabled tab is not chosen first', async () => {
  const el = await mount('<div slot="tabs"><button type="button" disabled>One</button><button type="button">Two</button></div><h3>Head</h3><div>P1</div><div>P2</div>');
  const tabs = tabsOf(el);
  assert.equal(tabs[0].getAttribute('aria-controls'), el.querySelectorAll(':scope > div:not([slot])')[0].id, 'the first div, not the heading');
  assert.equal(el.querySelector('h3').hasAttribute('role'), false, 'the heading is no panel');
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'true'], 'the first enabled tab is chosen');
  drop(el);
});

test('the selected tab disabled later hands over to the next, with tabchange reason "disabled"', async () => {
  const el = await mount();
  const log = heard(el);
  tabsOf(el)[0].disabled = true;
  await settle();
  assert.deepEqual(log, [['tabchange', 'b', 'a', 'disabled']]);
  assert.deepEqual(shown(el), ['Pb']);
  drop(el);
});

test('no slot="tabs" child: said once, and the panels are left as written (CONTROL: with one, nothing is said)', async () => {
  said.length = 0;
  const fine = await mount();
  assert.deepEqual(said, [], 'CONTROL: nothing said');
  drop(fine);
  const el = await mount('<section>Only</section>');
  saidOnce(/\(tabs-no-list\)/);
  assert.equal(el.querySelector('section').hasAttribute('role'), false, 'left as written');
  drop(el);
});

test('more tabs than panels by order: said once, however often the tabs change', async () => {
  said.length = 0;
  const el = await mount('<div slot="tabs"><button type="button">One</button><button type="button">Two</button></div><div>P1</div>');
  el.querySelector('[slot="tabs"]').insertAdjacentHTML('beforeend', '<button type="button">Three</button>');
  await settle();
  saidOnce(/\(tabs-count-mismatch\)/);
  drop(el);
});

test('a tab that is not a button: said once', async () => {
  said.length = 0;
  const el = await mount('<div slot="tabs"><span value="a">A</span><button type="button" value="b">B</button></div><div data-value="a">Pa</div><div data-value="b">Pb</div>');
  el.value = 'b';
  await settle();
  saidOnce(/\(tabs-not-button\)/);
  drop(el);
});

test('two instances write no id twice', async () => {
  const one = await mount('<div slot="tabs"><button type="button">A</button></div><div>P</div>');
  const two = await mount('<div slot="tabs"><button type="button">A</button></div><div>P</div>');
  const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
  assert.ok(ids.length >= 4, 'CONTROL: ids were written');
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
  drop(one);
  drop(two);
});

test('removed, its listeners are gone: a press on a kept tab changes nothing (CONTROL: before removal it did)', async () => {
  const el = await mount();
  const tabs = tabsOf(el);
  tabs[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true', 'CONTROL: a press selected');
  const log = heard(el);
  drop(el);
  await settle();
  tabs[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  assert.deepEqual(log, [], 'nothing heard');
  assert.equal(tabs[2].getAttribute('aria-selected'), 'false', 'nothing selected');
});

test('nothing said by any row above that did not mean to', () => {
  assert.deepEqual(said, []);
});
