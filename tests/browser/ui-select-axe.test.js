/**
 * The accessibility claims, audited rather than asserted: axe-core over every interesting state
 * of <vera-select>, on all three engines. Zero violations is the gate — a finding here is a bug
 * with the same standing as a thrown exception. axe walks shadow trees natively.
 *
 * Loaded as a script tag: axe ships UMD, and the dev server serves node_modules as-is.
 */
import { expect } from '@esm-bundle/chai';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@verajs/ui';

wire([renderer, styles]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

await new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/node_modules/axe-core/axe.min.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b', description: 'the second one' },
  { label: 'Gamma', value: 'g', disabled: true, group: 'Late' },
];

/**
 * One helper for every state. The `settle` before measuring is load-bearing: the menu's opacity
 * transition is 140ms, and axe composites text through an in-flight opacity — measuring one frame
 * after open reads a washed-out effective foreground and reports FALSE color-contrast violations
 * (found while auditing barren/creatable states; the old inline cases measured mid-fade and were
 * one slow frame from flaking). `open`/`type`/`value` drive the interaction; `element.shadowRoot ??
 * element` covers light mode, where the parts live in the light DOM.
 */
const SETTLE_MS = 250;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const audit = async (name, { setup, value, open = false, type } = {}) => {
  const element = document.createElement('vera-select');
  element.setAttribute('aria-label', 'Flavor');
  setup?.(element);
  document.body.appendChild(element);
  element.options = OPTIONS;
  if (value !== undefined) element.value = value;
  await frame();
  const root = element.shadowRoot ?? element;
  if (open) {
    root.querySelector('[part="trigger"]').click();
    await settle();
  }
  if (type !== undefined) {
    const search = root.querySelector('[part="search"]');
    search.value = type;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }
  const results = await window.axe.run(element, { resultTypes: ['violations'] });
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
  expect(results.violations, `${name} — ${summary}`).to.have.length(0);
  element.remove();
};

it('axe: closed, default', () => audit('closed'));

it('axe: open with groups, description, disabled row', () => audit('open', { open: true }));

it('axe: multi with pills, menu open', () =>
  audit('multi pills', {
    setup: (el) => {
      el.setAttribute('multi', '');
      el.setAttribute('searchable', '');
    },
    value: ['a', 'b'],
    open: true,
  }));

it('axe: disabled', () => audit('disabled', { setup: (el) => el.setAttribute('disabled', '') }));

it('axe: light mode open', () => audit('light', { setup: (el) => el.setAttribute('light', ''), open: true }));

it('axe: loading, menu open', () =>
  audit('loading', {
    setup: (el) => {
      el.setAttribute('searchable', '');
      el.setAttribute('loading', '');
    },
    open: true,
  }));

it('axe: empty message on a barren search', () =>
  audit('barren', { setup: (el) => el.setAttribute('searchable', ''), open: true, type: 'zzzzz' }));

it('axe: creatable with the create row highlighted', () =>
  audit('creatable', { setup: (el) => el.setAttribute('creatable', ''), open: true, type: 'Gamma2' }));

it('axe: a selected row that is also the active row (checkmark on the highlight tint)', () =>
  audit('selected+active', { value: 'a', open: true }));

/**
 * Dark mode is consumer-set tokens (the sheet ships light fallbacks). The derived
 * --vera-accent-strong mixes toward --vera-fg, so it must stay above the contrast floor when a
 * consumer flips surface/fg dark and uses a light accent - a plain darken regressed this to
 * 3.7:1. The highlighted create row is the state that exercises accent-on-tint text.
 */
it('axe: dark tokens - highlighted create row keeps contrast', () =>
  audit('dark creatable', {
    setup: (el) => {
      el.setAttribute('creatable', '');
      el.style.setProperty('--vera-surface', '#1a1a1e');
      el.style.setProperty('--vera-fg', '#fafafa');
      el.style.setProperty('--vera-fg-muted', '#a1a1aa');
      el.style.setProperty('--vera-accent', '#a78bfa');
      el.style.setProperty('--vera-border', '#3f3f46');
    },
    open: true,
    type: 'Gamma2',
  }));
