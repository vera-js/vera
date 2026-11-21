/**
 * **<vera-field> in jsdom: the chooser, the timing, the count, the swap and the listeners, through the element.** jsdom
 * is the regression net here, never the oracle for `:user-invalid`, the accessibility tree or the count's speech: those
 * are the browser rows. What jsdom does compute (ValidityState, `validationMessage`, the DOM the field writes) is
 * asserted directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
const GLOBALS = ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'InputEvent', 'FocusEvent'];
for (const key of GLOBALS) globalThis[key] = dom.window[key];
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/field');
const { document } = dom.window;

/** A field in a form, connected and settled. */
const field = async (inner, form = true) => {
  const host = document.createElement(form ? 'form' : 'div');
  host.innerHTML = `<vera-field>${inner}</vera-field>`;
  document.body.append(host);
  await flush();
  return { host, field: host.querySelector('vera-field'), control: host.querySelector('input,textarea,select') };
};
const type = (control, value) => {
  control.value = value;
  control.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, composed: true }));
};
const blur = (control) => control.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, composed: true }));
const shown = (f) => [...f.querySelectorAll('[data-vera-part="error"]')].filter((e) => !e.hidden).map((e) => e.textContent.trim());

test('the label names the control, the hint describes it, and no error shows on first render', async () => {
  const { host, field: f, control } = await field('<label>Email</label><input required><small data-vera-part="hint">Work address</small><small data-vera-part="error" data-when="valueMissing">Enter your email.</small>');
  const label = f.querySelector('label');
  assert.equal(label.htmlFor, control.id, 'label[for] names the control');
  assert.ok(control.getAttribute('aria-describedby').split(' ').includes(f.querySelector('[data-vera-part="hint"]').id));
  assert.deepEqual(shown(f), [], 'invalid from the start, but the user has not tried');
  assert.equal(control.hasAttribute('aria-invalid'), false);
  host.remove();
});

test('after an edit and a blur, the error whose data-when is true shows; fixing it clears it', async () => {
  const { host, field: f, control } = await field('<label>Code</label><input required pattern="[0-9]+"><small data-vera-part="error" data-when="valueMissing">Required.</small><small data-vera-part="error" data-when="patternMismatch">Digits only.</small>');
  type(control, 'ab');
  assert.deepEqual(shown(f), [], 'typing alone shows nothing yet');
  blur(control);
  assert.deepEqual(shown(f), ['Digits only.']);
  assert.equal(control.getAttribute('aria-invalid'), 'true');
  type(control, '12');
  assert.deepEqual(shown(f), [], 'fixed as they type');
  assert.equal(control.hasAttribute('aria-invalid'), false);
  host.remove();
});

test('a catch-all part left empty shows the browser\'s validationMessage; one with text keeps the user\'s words and markup', async () => {
  const { host, field: f, control } = await field('<label>Name</label><input required><small data-vera-part="error"></small>');
  control.dispatchEvent(new dom.window.Event('invalid', { cancelable: true }));
  assert.deepEqual(shown(f), [control.validationMessage]);
  assert.notEqual(control.validationMessage, '', 'CONTROL: jsdom gives a message');
  host.remove();
  const kept = await field('<label>Name</label><input required><small data-vera-part="error">Please <strong>enter</strong> a name.</small>');
  kept.control.dispatchEvent(new dom.window.Event('invalid', { cancelable: true }));
  assert.equal(kept.field.querySelector('[data-vera-part="error"] strong')?.textContent, 'enter', 'the user\'s markup is never replaced');
  kept.host.remove();
});

test('the invalid event is cancelled (no native bubble) unless the field asks for native-messages', async () => {
  const { host, control } = await field('<label>A</label><input required><small data-vera-part="error"></small>');
  const event = new dom.window.Event('invalid', { cancelable: true });
  control.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  host.remove();
  const native = await field('<label>A</label><input required><small data-vera-part="error"></small>');
  native.field.setAttribute('native-messages', '');
  const kept = new dom.window.Event('invalid', { cancelable: true });
  native.control.dispatchEvent(kept);
  assert.equal(kept.defaultPrevented, false);
  native.host.remove();
});

test('a form reset hides every error and forgets that the user tried', async () => {
  const { host, field: f, control } = await field('<label>A</label><input required><small data-vera-part="error">Required.</small>');
  control.dispatchEvent(new dom.window.Event('invalid', { cancelable: true }));
  assert.deepEqual(shown(f), ['Required.']);
  host.dispatchEvent(new dom.window.Event('reset', { bubbles: true }));
  assert.deepEqual(shown(f), []);
  type(control, '');
  assert.deepEqual(shown(f), [], 'an edit after a reset does not show it again until a blur');
  host.remove();
});

test('the count shows code units against maxlength, an emoji counting as JavaScript counts it', async () => {
  const { host, field: f, control } = await field('<label>Bio</label><textarea maxlength="10"></textarea><span data-vera-part="count"></span>');
  const count = f.querySelector('[data-vera-part="count"]');
  assert.equal(count.textContent, '0 / 10');
  type(control, 'hi 😀');
  assert.equal(count.textContent, `${'hi 😀'.length} / 10`, 'value.length, which is what maxlength counts');
  host.remove();
});

test('a control the page swaps is wired again; the old one is released', async () => {
  const { host, field: f, control } = await field('<label>A</label><input><small data-vera-part="hint">h</small>');
  const hint = f.querySelector('[data-vera-part="hint"]').id;
  const next = document.createElement('input');
  control.replaceWith(next);
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.querySelector('label').htmlFor, next.id, 'the label names the new control');
  assert.ok(next.getAttribute('aria-describedby').split(' ').includes(hint));
  assert.equal(control.hasAttribute('aria-describedby'), false, 'the old control is released');
  host.remove();
});

test('listeners are per root, not per field: 50 fields add one set; the last to leave removes it', async () => {
  const added = [];
  const removed = [];
  const { addEventListener, removeEventListener } = document;
  document.addEventListener = function (type, ...rest) {
    added.push(type);
    return addEventListener.call(this, type, ...rest);
  };
  document.removeEventListener = function (type, ...rest) {
    removed.push(type);
    return removeEventListener.call(this, type, ...rest);
  };
  try {
    const box = document.createElement('div');
    box.innerHTML = Array.from({ length: 50 }, (_, i) => `<vera-field><label>F${i}</label><input></vera-field>`).join('');
    document.body.append(box);
    await flush();
    const set = new Set(added);
    assert.ok(set.has('input') && set.has('invalid'), `CONTROL: the listeners reached the document (${[...set]})`);
    assert.equal(added.length, set.size, 'one set for fifty fields');
    box.remove();
    await flush();
    assert.deepEqual(removed.sort(), [...added].sort(), 'the last field to leave removed exactly that set');
  } finally {
    document.addEventListener = addEventListener;
    document.removeEventListener = removeEventListener;
  }
});

test('the silent check moves no focus: checkValidity() fires invalid on every control and focus stays put', async () => {
  const f = document.createElement('form');
  f.innerHTML = '<input id="here"><vera-field><label>A</label><input required><small data-vera-part="error"></small></vera-field>';
  document.body.append(f);
  await flush();
  f.querySelector('#here').focus();
  f.checkValidity();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'here', 'an app checking validity on every keystroke never has focus taken');
  f.remove();
});

test('after a submit attempt the form\'s first invalid control in tree order gets focus, a bare input included', async () => {
  /** A submit button's click marks the attempt; checkValidity() then fires invalid on each control (jsdom focuses nothing). */
  const first = document.createElement('form');
  first.innerHTML = '<vera-field><label>A</label><input required id="in-field"><small data-vera-part="error"></small></vera-field><input required id="bare">';
  document.body.append(first);
  await flush();
  first.append(Object.assign(document.createElement('button'), { type: 'submit' }));
  /** Cancelled, so only checkValidity() below fires invalid (no jsdom submission of its own). */
  first.addEventListener('click', (event) => event.preventDefault());
  first.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  first.checkValidity();
  await Promise.resolve();
  assert.equal(document.activeElement?.id, 'in-field', "the field's control, first in tree order");
  first.remove();
  const second = document.createElement('form');
  second.innerHTML = '<input required id="bare2"><vera-field><label>A</label><input required id="in-field2"><small data-vera-part="error"></small></vera-field>';
  document.body.append(second);
  await flush();
  second.append(Object.assign(document.createElement('button'), { type: 'submit' }));
  /** Cancelled, so only checkValidity() below fires invalid (no jsdom submission of its own). */
  second.addEventListener('click', (event) => event.preventDefault());
  second.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  second.checkValidity();
  await Promise.resolve();
  assert.equal(document.activeElement?.id, 'bare2', 'the bare input before it keeps its native place');
  second.remove();
});

test('a field registered under the user\'s own tag (defineAs) still hears its control', async () => {
  const { defineAs } = await load('vera-components/field/element');
  defineAs('my-field');
  const form = document.createElement('form');
  form.innerHTML = '<my-field><label>A</label><input required><small data-vera-part="error">Required.</small></my-field>';
  document.body.append(form);
  await flush();
  const input = form.querySelector('input');
  type(input, 'x');
  type(input, '');
  blur(input);
  assert.deepEqual(shown(form.querySelector('my-field')), ['Required.']);
  form.remove();
});

test('a reset re-reads the count once the browser has restored the value', async () => {
  const { host, field: f, control } = await field('<label>Bio</label><textarea maxlength="40"></textarea><span data-vera-part="count"></span>');
  type(control, 'x'.repeat(30));
  assert.equal(f.querySelector('[data-vera-part="count"]').textContent, '30 / 40', 'CONTROL: the count followed the typing');
  host.reset();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.querySelector('[data-vera-part="count"]').textContent, '0 / 40');
  host.remove();
});

test('an error the server rendered shown stands through connect, and clears on the first edit', async () => {
  const { host, field: f, control } = await field('<label>Email</label><input type="email" value="taken@example.com" aria-invalid="true"><small data-vera-part="error">That email is taken.</small>');
  assert.deepEqual(shown(f), ['That email is taken.'], 'loading the script did not hide it');
  assert.equal(control.getAttribute('aria-invalid'), 'true', 'and it is the control\'s error');
  type(control, 'new@example.com');
  assert.deepEqual(shown(f), [], 'the user edited: the ordinary rules apply');
  host.remove();
});

test('the spoken count is the consumer\'s words: count-message and limit-message', async () => {
  const { host, field: f, control } = await field('<label>Bio</label><textarea maxlength="10"></textarea><span data-vera-part="count"></span>');
  f.setAttribute('count-message', 'noch {left} Zeichen');
  type(control, 'x'.repeat(9));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const region = document.querySelector('[data-vera-announce="polite"]');
  assert.ok(region, 'CONTROL: the count announced');
  assert.match(region.textContent, /noch 1 Zeichen/);
  host.remove();
});

test('a framework that replaces the control\'s wrapper is seen; the field re-wires the new control', async () => {
  const { host, field: f } = await field('<label>A</label><div class="wrap"><input></div><small data-vera-part="hint">h</small>');
  const wrap = f.querySelector('.wrap');
  const fresh = document.createElement('div');
  fresh.innerHTML = '<input>';
  wrap.replaceWith(fresh);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.querySelector('label').htmlFor, fresh.querySelector('input').id);
  host.remove();
});

test('a control removed and added back is wired again, and nothing is wired while it is gone', async () => {
  const { host, field: f, control } = await field('<label>A</label><input><small data-vera-part="hint">h</small>');
  control.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.querySelector('label').hasAttribute('for'), false, 'released while gone');
  const back = document.createElement('input');
  f.append(back);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.querySelector('label').htmlFor, back.id, 'wired again when it returns');
  host.remove();
});
