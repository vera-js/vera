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

const audit = async (name, setup) => {
  const element = document.createElement('vera-select');
  element.setAttribute('aria-label', 'Flavor');
  setup?.(element);
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();
  const results = await window.axe.run(element, { resultTypes: ['violations'] });
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
  expect(results.violations, `${name} — ${summary}`).to.have.length(0);
  element.remove();
};

it('axe: closed, default', () => audit('closed'));

it('axe: open with groups, description, disabled row', async () => {
  const element = document.createElement('vera-select');
  element.setAttribute('aria-label', 'Flavor');
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  const results = await window.axe.run(element, { resultTypes: ['violations'] });
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
  expect(results.violations, `open — ${summary}`).to.have.length(0);
  element.remove();
});

it('axe: multi with pills, menu open', async () => {
  const element = document.createElement('vera-select');
  element.setAttribute('aria-label', 'Flavors');
  element.setAttribute('multi', '');
  element.setAttribute('searchable', '');
  document.body.appendChild(element);
  element.options = OPTIONS;
  element.value = ['a', 'b'];
  await frame();
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  const results = await window.axe.run(element, { resultTypes: ['violations'] });
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
  expect(results.violations, `pills — ${summary}`).to.have.length(0);
  element.remove();
});

it('axe: disabled, and light mode open', async () => {
  await audit('disabled', (element) => element.setAttribute('disabled', ''));
  const element = document.createElement('vera-select');
  element.setAttribute('aria-label', 'Flavor');
  element.setAttribute('light', '');
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();
  element.querySelector('[part="trigger"]').click();
  await frame();
  const results = await window.axe.run(element, { resultTypes: ['violations'] });
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ');
  expect(results.violations, `light — ${summary}`).to.have.length(0);
  element.remove();
});
