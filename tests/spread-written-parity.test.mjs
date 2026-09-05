/**
 * The sigil grammar has two client implementations — AttrPart commits written bindings, spread's
 * Binding commits runtime bags — and they are the drift-prone kind of deliberate duplication: one
 * grammar, two code paths, no shared code (spread exists precisely because template call sites
 * cannot hold runtime names). `tests/spread.test.mjs` pins spread's own behaviour case by case;
 * nothing compared the two paths on the SAME key and value until this file. The server halves have
 * their twin pinned the same way (`spread-ssr.test.mjs`: "written and spread serialize
 * identically", and the unsafe-name test beside it).
 *
 * A grid rather than seeds: the grammar's surface is small enough to enumerate — sigils × names ×
 * the value zoo — and a deterministic grid replays for free. Warning parity is part of the
 * comparison: a path that warns where its twin does not has already disagreed about what the key
 * means.
 *
 * Controls, because a comparison of two silences passes vacuously: the plain-attribute cases must
 * put a readable attribute on the element, every event case must actually fire the handler, and
 * `!value` must write through, before any agreement is believed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'Event',
  'CustomEvent', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[k] = dom.window[k];

const { wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
wire([renderer]);
const doc = dom.window.document;

/** The shape core's `html` tag produces, as the other renderer suites write it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

let warnings = 0;
const realWarn = console.warn;
console.warn = () => warnings++;

const NAMES = ['title', 'data-k', 'lang', 'tabindex'];
const VALUES = ['s', '', '0', 0, 5, true, false, null, undefined, { toString: () => 'T' }];
const EVENTS = ['click', 'custom-thing'];

const mount = () => { const h = doc.createElement('div'); doc.body.append(h); return h; };
/** A written call site built per case — creation behaviour is what is compared, so per-case
 *  template identity is correct here, not the two-templates trap. */
const written = (prefix, value, tag = 'i', close = '></i>') => {
  const strings = Object.assign([`<${tag} ${prefix}`, close], { raw: [`<${tag} ${prefix}`, close] });
  return { _$litType$: 1, strings, values: [value] };
};
const readEl = (el, name) => JSON.stringify({
  attrs: [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(),
  prop: name && typeof el[name] !== 'function' ? String(el[name]) : undefined,
});

test('attribute, property and boolean sigils: written and spread agree on every key and value', () => {
  const mismatches = [];
  let readable = 0;
  for (const sigil of ['', '.', '?'])
    for (const name of NAMES)
      for (const value of VALUES) {
        const key = sigil + name;
        const w0 = warnings;
        const hostA = mount();
        renderInto(written(`${key}=`, value), hostA);
        const writtenWarned = warnings > w0;
        const w1 = warnings;
        const hostB = mount();
        renderInto(html`<i ${spread({ [key]: value })}></i>`, hostB);
        const spreadWarned = warnings > w1;

        const a = readEl(hostA.querySelector('i'), name);
        const b = readEl(hostB.querySelector('i'), name);
        if (!a.includes('"attrs":[]')) readable++;
        if (a !== b || writtenWarned !== spreadWarned)
          mismatches.push({ key, value: String(value), written: a, spread: b, writtenWarned, spreadWarned });
        hostA.remove(); hostB.remove();
      }
  assert.ok(readable > 0, 'CONTROL: no case put a readable attribute on either element');
  assert.deepEqual(mismatches, []);
});

test('event sigils: @name and on+Capital fire identically through both paths', () => {
  const mismatches = [];
  let fired = 0;
  for (const evt of EVENTS)
    for (const form of ['@', 'on']) {
      const key = form === '@' ? `@${evt}` : `on${evt[0].toUpperCase()}${evt.slice(1)}`;
      let countA = 0, countB = 0;
      const hostA = mount();
      renderInto(written(`${key}=`, () => countA++), hostA);
      const hostB = mount();
      renderInto(html`<i ${spread({ [key]: () => countB++ })}></i>`, hostB);
      hostA.querySelector('i').dispatchEvent(new dom.window.Event(evt));
      hostB.querySelector('i').dispatchEvent(new dom.window.Event(evt));
      fired += countA;
      const attrsA = [...hostA.querySelector('i').attributes].map((x) => x.name).join();
      const attrsB = [...hostB.querySelector('i').attributes].map((x) => x.name).join();
      if (countA !== countB || attrsA !== attrsB) mismatches.push({ key, countA, countB, attrsA, attrsB });
      hostA.remove(); hostB.remove();
    }
  assert.equal(fired, EVENTS.length * 2, 'CONTROL: every written handler fired exactly once');
  assert.deepEqual(mismatches, []);
});

test('the live sigil on form elements: written and spread agree', () => {
  const read = (el) => JSON.stringify({
    value: el.value, checked: el.checked,
    attrs: [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(),
  });
  const mismatches = [];
  for (const [key, value] of [['!value', 'typed'], ['!checked', true], ['!checked', false], ['!value', '']]) {
    const hostA = mount();
    renderInto(written(`${key}=`, value, 'input', '>'), hostA);
    const hostB = mount();
    renderInto(html`<input ${spread({ [key]: value })} />`, hostB);
    const a = read(hostA.querySelector('input'));
    const b = read(hostB.querySelector('input'));
    if (a !== b) mismatches.push({ key, value: String(value), written: a, spread: b });
    hostA.remove(); hostB.remove();
  }
  const control = mount();
  renderInto(written('!value=', 'control', 'input', '>'), control);
  assert.equal(control.querySelector('input').value, 'control', 'CONTROL: !value writes through');
  assert.deepEqual(mismatches, []);
});

test('&ref: both paths hand over the element and leave no attribute behind', () => {
  let refA = null, refB = null;
  const hostA = mount();
  renderInto(written('&ref=', (n) => { refA = n; }), hostA);
  const hostB = mount();
  renderInto(html`<i ${spread({ '&ref': (n) => { refB = n; } })}></i>`, hostB);
  assert.equal(refA?.localName, 'i');
  assert.equal(refB?.localName, 'i');
  assert.equal(hostA.querySelector('i').attributes.length, hostB.querySelector('i').attributes.length);
  console.warn = realWarn;
});
