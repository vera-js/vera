/**
 * **<vera-input> as a page meets it, in jsdom**: the user's input kept where it is, a default input from the host's
 * attributes read once, clear's visibility and its value write, Escape on a search input, a composite's open list
 * keeping both, loading's aria-busy and mark, and development's warnings. jsdom refuses `execCommand('delete')`, so
 * clear runs its setter fallback here; the undo history is the browser suite's. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const said = [];
console.warn = (...args) => said.push(String(args[0]));
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/input');

const settle = async () => {
  flush();
  await Promise.resolve();
  flush();
};
/** A task later: development's warnings are read then, after a field around the input has wired it. */
const task = () => new Promise((resolve) => dom.window.setTimeout(resolve, 0));
const mount = async (markup) => {
  said.length = 0;
  document.body.innerHTML = markup;
  await settle();
  return document.querySelector('vera-input');
};
const codes = () => said.map((line) => /\(([a-z-]+)\)\s*$/.exec(line)?.[1] ?? line);
const part = (element, name) => element.querySelector(`[data-vera-part="${name}"]`);
const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
};

test("the user's own input is kept where it is, with their prefix and suffix, and nothing is rendered over it", async () => {
  const element = await mount('<label>Search <vera-input><span data-vera-part="prefix">$</span><input id="mine" name="q"><span data-vera-part="suffix">.00</span></vera-input></label>');
  const input = element.querySelector('input');
  assert.equal(input.id, 'mine', 'the same element');
  assert.deepEqual([...element.children].map((child) => child.getAttribute('data-vera-part') ?? child.localName), ['prefix', 'input', 'suffix']);
  assert.equal(input.getAttribute('data-vera-part'), null, 'the user input is not marked as ours');
  await task();
  assert.deepEqual(codes(), [], 'a labelled input with no options says nothing');
});

test('with no input inside, a default one is made from the listed host attributes, and a later host change is not mirrored', async () => {
  const element = await mount('<label>Email <vera-input name="email" type="email" value="a@b.c" placeholder="you@" autocomplete="email" onclick="x()" style="color:red"></vera-input></label>');
  const input = part(element, 'input');
  assert.ok(input !== null && input.localName === 'input');
  for (const [name, value] of [['name', 'email'], ['type', 'email'], ['value', 'a@b.c'], ['placeholder', 'you@'], ['autocomplete', 'email']])
    assert.equal(input.getAttribute(name), value, name);
  assert.equal(input.getAttribute('onclick'), null, 'only listed attributes are copied');
  assert.equal(input.getAttribute('style'), null);
  element.setAttribute('placeholder', 'changed');
  await settle();
  await task();
  assert.equal(input.getAttribute('placeholder'), 'you@', 'the input keeps what it was made with');
  assert.deepEqual(codes(), isProduction ? [] : ['input-host-changed'], 'development says the host change went nowhere');
});

test('a hostile host value is an attribute value, never markup', async () => {
  const element = await mount('<label>x <vera-input value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"></vera-input></label>');
  assert.equal(element.querySelector('img'), null);
  assert.equal(part(element, 'input').value, '"><img src=x onerror=alert(1)>');
});

test('clearable: a named, out-of-tab-order button, shown only while there is something to clear', async () => {
  const element = await mount('<label>q <vera-input clearable><input></vera-input></label>');
  const input = element.querySelector('input');
  const clear = part(element, 'clear');
  assert.equal(clear.localName, 'button');
  assert.equal(clear.type, 'button', 'never a submit button');
  assert.equal(clear.tabIndex, -1);
  assert.equal(clear.getAttribute('aria-label'), 'Clear');
  assert.equal(input.nextElementSibling, clear, 'right after the input');
  assert.equal(clear.hidden, true, 'empty: nothing to clear');
  type(input, 'hello');
  assert.equal(clear.hidden, false);
  type(input, '');
  assert.equal(clear.hidden, true);
});

test('clear empties the input, fires input (deleteContentBackward) and change from its realm, and focuses the input', async () => {
  const element = await mount('<label>q <vera-input clearable><input value="hello"></vera-input></label>');
  const input = element.querySelector('input');
  const seen = [];
  input.addEventListener('input', (event) => seen.push(['input', event.inputType, event instanceof dom.window.InputEvent]));
  input.addEventListener('change', () => seen.push(['change']));
  part(element, 'clear').click();
  assert.equal(input.value, '');
  assert.deepEqual(seen, [['input', 'deleteContentBackward', true], ['change']]);
  assert.equal(document.activeElement, input);
  assert.equal(part(element, 'clear').hidden, true);
});

test('clear-label names the button; turning clearable off removes the button and its listeners', async () => {
  const element = await mount('<label>q <vera-input clearable clear-label="Effacer"><input value="x"></vera-input></label>');
  assert.equal(part(element, 'clear').getAttribute('aria-label'), 'Effacer');
  element.removeAttribute('clearable');
  await settle();
  assert.equal(part(element, 'clear'), null);
  element.setAttribute('clearable', '');
  await settle();
  assert.equal(element.querySelectorAll('[data-vera-part="clear"]').length, 1, 'one button, never two');
});

test('a disabled (or fieldset-disabled) or read-only input shows no clear', async () => {
  for (const markup of [
    '<label>q <vera-input clearable><input value="x" disabled></vera-input></label>',
    '<fieldset disabled><label>q <vera-input clearable><input value="x"></vera-input></label></fieldset>',
    '<label>q <vera-input clearable><input value="x" readonly></vera-input></label>',
  ]) {
    const element = await mount(markup);
    assert.equal(part(element, 'clear').hidden, true, markup);
  }
});

test('Escape clears a search input; a text input and an open composite list keep Escape', async () => {
  const escape = (input) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  };
  let element = await mount('<label>q <vera-input clearable><input type="search" value="hello"></vera-input></label>');
  assert.equal(escape(element.querySelector('input')), true);
  assert.equal(element.querySelector('input').value, '');
  element = await mount('<label>q <vera-input clearable><input type="text" value="hello"></vera-input></label>');
  assert.equal(escape(element.querySelector('input')), false);
  assert.equal(element.querySelector('input').value, 'hello');
  element = await mount('<label>q <vera-input clearable><input type="search" role="combobox" aria-expanded="true" value="hello"></vera-input></label>');
  assert.equal(escape(element.querySelector('input')), false, 'the composite closes its list');
  assert.equal(element.querySelector('input').value, 'hello');
  assert.equal(part(element, 'clear').hidden, true, 'and owns clearing while open');
});

test("a form's reset leaves clear's visibility right", async () => {
  const element = await mount('<form><label>q <vera-input clearable><input></vera-input></label></form>');
  const input = element.querySelector('input');
  type(input, 'typed');
  assert.equal(part(element, 'clear').hidden, false);
  document.querySelector('form').reset();
  await task();
  assert.equal(input.value, '');
  assert.equal(part(element, 'clear').hidden, true);
});

test('loading: aria-busy on the input, an aria-hidden mark, both gone when it ends; a user aria-busy is theirs', async () => {
  const element = await mount('<label>q <vera-input loading><input></vera-input></label>');
  const input = element.querySelector('input');
  assert.equal(input.getAttribute('aria-busy'), 'true');
  assert.equal(element.getAttribute('aria-busy'), null, 'never on the host');
  assert.equal(part(element, 'loading').getAttribute('aria-hidden'), 'true');
  element.removeAttribute('loading');
  await settle();
  assert.equal(input.getAttribute('aria-busy'), null);
  assert.equal(part(element, 'loading'), null);
  const theirs = await mount('<label>q <vera-input loading><input aria-busy="false"></vera-input></label>');
  theirs.removeAttribute('loading');
  await settle();
  assert.equal(theirs.querySelector('input').getAttribute('aria-busy'), 'false', 'left as the user wrote it');
});

test('no options: no part, no listener', async () => {
  const element = await mount('<label>q <vera-input><input></vera-input></label>');
  assert.equal(element.querySelector('[data-vera-part]'), null);
});

test('development warns once per cause: no name, reveal on a non-password, size on the host', async () => {
  await mount('<vera-input><input></vera-input>');
  await task();
  assert.deepEqual(codes(), isProduction ? [] : ['input-no-name']);
  await mount('<vera-input reveal size="20"><input aria-label="q" type="text"></vera-input>');
  await task();
  assert.deepEqual(codes(), isProduction ? [] : ['input-reveal-not-password', 'input-size-on-host']);
  await mount('<vera-input reveal><input aria-label="p" type="password"></vera-input>');
  await task();
  assert.deepEqual(codes(), [], 'reveal on a password input is its use');
});

test('an input the page swaps takes every part with it: one clear, on the new input, and the old one released', async () => {
  const element = await mount('<label>q <vera-input clearable loading><input id="old" value="a"></vera-input></label>');
  const old = element.querySelector('input');
  const fresh = document.createElement('input');
  fresh.id = 'new';
  fresh.value = 'b';
  old.replaceWith(fresh);
  await new Promise((resolve) => dom.window.queueMicrotask(resolve));
  await settle();
  assert.equal(element.querySelectorAll('[data-vera-part="clear"]').length, 1, 'one button, never two');
  const clear = part(element, 'clear');
  assert.ok(clear.parentNode === fresh.parentNode && (fresh.compareDocumentPosition(clear) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'beside the new input, after it');
  assert.equal(fresh.getAttribute('aria-busy'), 'true', 'loading follows the input');
  assert.equal(old.getAttribute('aria-busy'), null, 'and leaves the old one');
  part(element, 'clear').click();
  assert.equal(fresh.value, '', 'clear acts on the new input');
  assert.equal(old.value, 'a');
  old.value = 'typed';
  old.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  assert.equal(part(element, 'clear').hidden, true, "the old input's listener is gone");
});

test('a wrapper the page swaps around the input is followed too', async () => {
  const element = await mount('<label>q <vera-input clearable><span class="wrap"><input value="a"></span></vera-input></label>');
  const wrap = element.querySelector('.wrap');
  const next = document.createElement('span');
  next.innerHTML = '<input value="z">';
  wrap.replaceWith(next);
  await new Promise((resolve) => dom.window.queueMicrotask(resolve));
  await settle();
  assert.equal(next.querySelector('input').nextElementSibling?.getAttribute('data-vera-part'), 'clear');
  assert.equal(element.querySelectorAll('[data-vera-part="clear"]').length, 1);
});
