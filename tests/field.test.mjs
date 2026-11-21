/**
 * **<vera-field> in jsdom: the chooser, the timing, the count, the swap and the listeners, through the element.** jsdom
 * is the regression net here, never the oracle for `:user-invalid`, the accessibility tree or the count's speech: those
 * are the browser rows. What jsdom does compute (ValidityState, `validationMessage`, the DOM the field writes) is
 * asserted directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

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

test('the invalid event is canceled (no native bubble) unless the field asks for native-messages', async () => {
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
  /** A submit button's click is the attempt, and its submission fires invalid on each control (jsdom focuses nothing). */
  const first = document.createElement('form');
  first.innerHTML = '<vera-field><label>A</label><input required id="in-field"><small data-vera-part="error"></small></vera-field><input required id="bare">';
  document.body.append(first);
  await flush();
  first.append(Object.assign(document.createElement('button'), { type: 'submit' }));
  /** The click submits: jsdom validates the form, firing invalid on each control, and an invalid form never submits. */
  first.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'in-field', "the field's control, first in tree order");
  first.remove();
  const second = document.createElement('form');
  second.innerHTML = '<input required id="bare2"><vera-field><label>A</label><input required id="in-field2"><small data-vera-part="error"></small></vera-field>';
  document.body.append(second);
  await flush();
  second.append(Object.assign(document.createElement('button'), { type: 'submit' }));
  /** The click submits: jsdom validates the form, firing invalid on each control, and an invalid form never submits. */
  second.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'bare2', 'the bare input before it keeps its native place');
  second.remove();
});

test('one report per attempt, as native: a field first cancels a later bare invalid; a bare control first keeps the browser\'s report', async () => {
  const canceled = (form, id) => {
    const seen = {};
    form.querySelector(`#${id}`).addEventListener('invalid', (event) => (seen.prevented = event.defaultPrevented));
    return seen;
  };
  const submit = (form) => {
    form.append(Object.assign(document.createElement('button'), { type: 'submit' }));
    form.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const first = document.createElement('form');
  first.innerHTML = '<vera-field><label>A</label><input required id="f1"><small data-vera-part="error"></small></vera-field><input required id="b1">';
  document.body.append(first);
  await flush();
  const silent = canceled(first, 'b1');
  first.checkValidity();
  assert.equal(silent.prevented, false, 'CONTROL: with no attempt, a bare invalid is left alone');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const later = canceled(first, 'b1');
  submit(first);
  assert.equal(later.prevented, true, 'the field reported the attempt, so the later bare control shows no bubble');
  first.remove();
  const second = document.createElement('form');
  second.innerHTML = '<input required id="b2"><vera-field><label>A</label><input required id="f2"><small data-vera-part="error"></small></vera-field>';
  document.body.append(second);
  await flush();
  const bare = canceled(second, 'b2');
  const field = canceled(second, 'f2');
  submit(second);
  assert.equal(bare.prevented, false, 'a bare control first: the browser reports it');
  assert.equal(field.prevented, true, 'the field still cancels its own');
  await new Promise((resolve) => setTimeout(resolve, 0));
  second.remove();
});

test('Enter marks an attempt only from the input types that submit implicitly', async () => {
  const f = document.createElement('form');
  f.innerHTML = '<input id="here"><input type="radio" id="radio"><vera-field><label>A</label><input required><small data-vera-part="error"></small></vera-field>';
  document.body.append(f);
  await flush();
  const enter = (control) => {
    control.focus();
    control.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
    f.checkValidity();
  };
  enter(f.querySelector('#radio'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'radio', 'Enter on a radio submits nothing: no focus moves');
  enter(f.querySelector('#here'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(document.activeElement?.id, 'here', 'CONTROL: Enter on a text input is an attempt, and focus moves');
  f.remove();
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

test('a part data-when="server" stands through connect with no aria-invalid, hides on the first edit, and reset clears it', async () => {
  const { host, field: f, control } = await field('<label>Email</label><input type="email" required value="a@b.c"><small data-vera-part="error" data-when="server">That email is taken.</small><small data-vera-part="error" data-when="valueMissing">Enter your email.</small>');
  assert.deepEqual(shown(f), ['That email is taken.'], 'the server said it; loading the script keeps it');
  type(control, '');
  blur(control);
  assert.deepEqual(shown(f), ['Enter your email.'], 'after an edit the chooser decides, and never picks the server part');
  host.remove();
  const again = await field('<label>Email</label><input><small data-vera-part="error" data-when="server">Taken.</small>');
  again.host.dispatchEvent(new dom.window.Event('reset', { bubbles: true }));
  assert.deepEqual(shown(again.field), [], 'a reset clears it');
  again.host.remove();
});

test('an Enter that confirms an IME candidate, or one the app canceled, is no submit attempt: no focus moves', async () => {
  const f = document.createElement('form');
  f.innerHTML = '<input id="here"><vera-field><label>A</label><input required><small data-vera-part="error"></small></vera-field>';
  document.body.append(f);
  await flush();
  const here = f.querySelector('#here');
  here.focus();
  here.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, composed: true }));
  f.checkValidity();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'here', 'composing: no attempt');
  await new Promise((resolve) => setTimeout(resolve, 0));
  here.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  here.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  f.checkValidity();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement?.id, 'here', 'canceled by the app: no attempt');
  await new Promise((resolve) => setTimeout(resolve, 0));
  here.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  f.checkValidity();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(document.activeElement?.id, 'here', 'CONTROL: a plain Enter is an attempt, and focus moves');
  f.remove();
});

/**
 * What the count says, in order: every message the announcer writes (a new node in a live region), read by an
 * observer, so a message a later one replaced is still counted once.
 */
const heard = () => {
  const said = [];
  const observer = new dom.window.MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === 1 && node.parentElement?.hasAttribute('data-vera-announce')) said.push(node.textContent);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { said, stop: () => observer.disconnect() };
};
/** A committed edit to `length` characters, then past the announcer's write window, so each step is heard alone. */
const typed = async (control, length, init = {}) => {
  control.value = 'x'.repeat(length);
  control.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, composed: true, ...init }));
  await new Promise((resolve) => setTimeout(resolve, 250));
};

test('the count speaks once per crossing: the warning from 80%, the limit, and again only after falling back to the re-arm line', async () => {
  /** maxlength 40: warned from 32, re-armed at or below 28; between the lines (29 to 31) nothing changes. */
  const { host, control } = await field('<label>Bio</label><textarea maxlength="40"></textarea><span data-vera-part="count"></span>');
  const ear = heard();
  for (const length of [31, 32, 30, 32, 39, 40, 39, 40]) await typed(control, length);
  assert.deepEqual(ear.said, ['8 characters left', 'Limit reached'], 'deleting below the warning line but above the re-arm line, and back, says nothing new');
  await typed(control, 28);
  await typed(control, 32);
  assert.deepEqual(ear.said.slice(2), ['8 characters left'], 'back at the re-arm line, the warning is due again');
  ear.stop();
  host.remove();
});

test('a short limit has no separate warning: maxlength 3 speaks only at the limit, maxlength 5 warns at 4', async () => {
  const short = await field('<label>Code</label><input maxlength="3"><span data-vera-part="count"></span>');
  const ear = heard();
  for (const length of [1, 2, 3]) await typed(short.control, length);
  assert.deepEqual(ear.said, ['Limit reached'], 'the warning line (ceil 80% = 3) is the limit itself');
  short.host.remove();
  const five = await field('<label>Code</label><input maxlength="5"><span data-vera-part="count"></span>');
  for (const length of [3, 4, 5]) await typed(five.control, length);
  assert.deepEqual(ear.said.slice(1), ['1 character left', 'Limit reached'], 'maxlength 5: warned from 4');
  ear.stop();
  five.host.remove();
});

test('a paste and an undo are committed input; a value the page sets is not judged', async () => {
  const { host, control, field: f } = await field('<label>Bio</label><textarea maxlength="10"></textarea><span data-vera-part="count"></span>');
  const ear = heard();
  control.value = 'x'.repeat(9);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(ear.said, [], 'a value the page sets says nothing');
  assert.equal(f.querySelector('[data-vera-part="count"]').textContent, '0 / 10', 'and is not counted until committed input');
  await typed(control, 10, { inputType: 'insertFromPaste' });
  assert.deepEqual(ear.said, ['Limit reached'], 'CONTROL: a paste is judged from its own length');
  await typed(control, 3, { inputType: 'historyUndo' });
  await typed(control, 9, { inputType: 'historyRedo' });
  assert.deepEqual(ear.said.slice(1), ['1 character left'], 'an undo re-armed it; the redo warns again');
  ear.stop();
  host.remove();
});

test('text still being composed is counted but not judged; compositionend judges it once', async () => {
  const { host, control, field: f } = await field('<label>Bio</label><textarea maxlength="10"></textarea><span data-vera-part="count"></span>');
  const ear = heard();
  await typed(control, 9, { isComposing: true });
  assert.equal(f.querySelector('[data-vera-part="count"]').textContent, '9 / 10', 'the count follows the composition');
  assert.deepEqual(ear.said, [], 'nothing is said mid-composition');
  control.dispatchEvent(new dom.window.Event('compositionend', { bubbles: true, composed: true }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(ear.said, ['1 character left'], 'the committed text is judged once');
  ear.stop();
  host.remove();
});

test('development warns for a data-when no key matches, and labeled for a control nothing names; production says nothing', async () => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(String(args[0]));
  try {
    const named = await field('<input aria-label="Search"><small data-vera-part="error" data-when="server">Taken</small><small data-vera-part="error" data-when="valueMissing">Enter it.</small>');
    assert.deepEqual(said, [], 'CONTROL: aria-label names it, and "server" and a ValidityState key are known');
    named.host.remove();
    const bad = await field('<input required><small data-vera-part="error" data-when="tooShrot">Too short.</small>');
    if (isProduction) assert.deepEqual(said, [], 'production prints no development prose');
    else {
      assert.equal(said.length, 2, said.join('\n'));
      assert.ok(said.some((line) => /^\[vera\] field: .*"tooShrot".*\(field-unknown-when\)$/s.test(line)), said.join('\n'));
      assert.ok(said.some((line) => /^\[vera\] labeled: .*\(labeled-unnamed\)$/s.test(line)), 'one name warning, labeled\'s');
    }
    bad.host.remove();
  } finally {
    console.warn = warn;
  }
});

test('the spoken count takes the language\'s plural form: count-message-<category> by Intl.PluralRules, then count-message', async () => {
  /** Polish: 2 to 4 are "few", 5 and up "many". maxlength 20 warns from 16 (4 left), 40 from 32 (8 left). */
  const { host, control, field: f } = await field('<label>Opis</label><textarea maxlength="20"></textarea><span data-vera-part="count"></span>');
  host.setAttribute('lang', 'pl');
  f.setAttribute('count-message-few', 'zostały {left} znaki');
  f.setAttribute('count-message-many', 'zostało {left} znaków');
  f.setAttribute('count-message', 'pozostało: {left}');
  const ear = heard();
  await typed(control, 16);
  assert.deepEqual(ear.said, ['zostały 4 znaki'], '4 is "few" in Polish');
  await typed(control, 0);
  control.maxLength = 40;
  await typed(control, 32);
  assert.deepEqual(ear.said.slice(1), ['zostało 8 znaków'], '8 is "many" in Polish');
  f.removeAttribute('count-message-many');
  await typed(control, 0);
  await typed(control, 32);
  assert.deepEqual(ear.said.slice(2), ['pozostało: 8'], 'no attribute for the category: count-message');
  ear.stop();
  host.remove();
});

/**
 * **The surface stays true**, as the scaffolded drift row asks, for a component that renders nothing: every part
 * name and field attribute the source reads is declared (a scan of the source, with a floor), every declared part
 * acts when written, and no attribute is observed that is not declared (none is: all are read when used).
 */
test('the declared surface is the one the field reads: parts and attributes, both ways', async () => {
  const { fieldSurface } = await import('../packages/components/field/src/field/surface.ts');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../packages/components/field/src/element.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const declaredParts = fieldSurface.parts.map((part) => part.name).sort();
  const readParts = [...new Set([...source.matchAll(/data-vera-part="([a-z-]+)"|part\(field, '([a-z-]+)'\)/g)].map((m) => m[1] ?? m[2]))].sort();
  assert.ok(readParts.length >= 4, `CONTROL: the scan found the parts the source reads: ${readParts.join(', ')}`);
  assert.deepEqual(readParts, declaredParts, 'a part read and not declared, or declared and never read: change surface.ts with the element');
  const declaredAttributes = fieldSurface.attributes.map((attribute) => attribute.name);
  const readAttributes = [...new Set([...source.matchAll(/(?:field|found\[0\])\.(?:get|has)Attribute\('([a-z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(readAttributes.length >= 3, `CONTROL: the scan found the field's attribute reads: ${readAttributes.join(', ')}`);
  for (const name of readAttributes) assert.ok(declaredAttributes.includes(name), `${name} is read and not declared`);
  if (source.includes('`count-message-${plural('))
    for (const category of ['zero', 'one', 'two', 'few', 'many', 'other'])
      assert.ok(declaredAttributes.includes(`count-message-${category}`), `count-message-${category} is read and not declared`);
  const observed = customElements.get('vera-field').observedAttributes ?? [];
  for (const name of observed) assert.ok(declaredAttributes.includes(name), `${name} is observed and not declared`);
  /** Each declared part acts when written: the control is wired, the hint describes it, the count counts, an error shows. */
  const { host, field: f } = await field('<label>Name</label><input id="decoy"><input data-vera-part="control" required maxlength="10"><small data-vera-part="hint">h</small><span data-vera-part="count"></span><small data-vera-part="error" data-when="valueMissing">Enter it.</small>');
  const control = f.querySelector('[data-vera-part="control"]');
  assert.equal(f.querySelector('label').htmlFor, control.id, 'control: the label names the marked control, not the first input');
  assert.ok(control.getAttribute('aria-describedby').split(' ').includes(f.querySelector('[data-vera-part="hint"]').id), 'hint');
  assert.equal(f.querySelector('[data-vera-part="count"]').textContent, '0 / 10', 'count');
  type(control, '');
  blur(control);
  assert.deepEqual(shown(f), ['Enter it.'], 'error');
  host.remove();
});
