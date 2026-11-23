/**
 * **A `define` element's props record is born a data record** (2026-11-22): core builds it, a plain object of data
 * properties nobody else writes, so the first write through its store skips `dataRecord`'s descriptor scan
 * (`Object.getOwnPropertyDescriptors` over every prop: 2.2 ms per 1000 `<vera-button>`s in a Chromium profile; the
 * change read −5.5% on that element's create in a headed three-engine race). Spied on the element's own `_$raw$`.
 * CONTROL: an accessor defined THROUGH the store clears the mark, and the next write scans exactly once, so the spy sees
 * the scan when it happens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { define, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);

define({ tag: 'record-props', attributes: ['variant', 'scale'] }, (host) => () => html`<p>${host.variant}</p>`);

/** Calls of `Object.getOwnPropertyDescriptors` whose argument is `target()`, while `run` runs. */
const scansOf = (target, run) => {
  const original = Object.getOwnPropertyDescriptors;
  let scans = 0;
  Object.getOwnPropertyDescriptors = function (obj) {
    if (obj === target()) scans++;
    return original.call(this, obj);
  };
  try {
    run();
  } finally {
    Object.getOwnPropertyDescriptors = original;
  }
  return scans;
};

test("a define element's first prop write does not scan its record's descriptors; an accessor defined through the store makes the next write scan", () => {
  const el = document.createElement('record-props');
  document.body.append(el);
  flush();
  const raw = () => el._$raw$;
  assert.equal(scansOf(raw, () => {
    el.setAttribute('variant', 'brand');
    el.setAttribute('scale', 'lg');
    flush();
  }), 0, 'the first writes through the props store skip the descriptor scan');
  assert.ok(raw() !== undefined && el.variant === 'brand', 'CONTROL: the writes landed on the record the spy watches');
  /** An accessor, the case that clears the mark: a writable data property keeps a record a data record, by design. */
  Object.defineProperty(el._$v$, 'extra', { get: () => 1, enumerable: true, configurable: true });
  assert.equal(scansOf(raw, () => {
    el.setAttribute('variant', 'danger');
    flush();
  }), 1, 'CONTROL: after an accessor defined through the store, the next write scans exactly once');
  el.remove();
});
