/**
 * **A spread key means what the written binding means.** Enforced, rather than checked case by case.
 *
 * That is the whole contract of `@verajs/renderer/spread`: `${spread({ '?hidden': v })}` must
 * produce exactly what `?hidden=${v}` produces, or a page and its hydration disagree about what the
 * markup meant. It is also the contract this audit has now seen broken **twice** — the boolean form
 * properties were fixed on the written side alone, and so was a `<textarea>`'s `.value` — because
 * each was fixed where it was found rather than on both paths.
 *
 * So this generates the pair for every binding kind against every awkward value and requires the two
 * to be byte-identical. A new coercion has to be got right in both places to pass, and one fixed on
 * a single side fails here rather than in someone's page.
 */
import { serializeTemplate } from '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const { html } = await import('@verajs/core');
const { spread } = await import('@verajs/renderer/spread');

/** Values chosen for the coercions that differ: nullish, falsy-but-present, and structural. */
const VALUES = {
  'a string': 'text',
  'an empty string': '',
  'zero': 0,
  'a number': 42,
  'true': true,
  'false': false,
  'null': null,
  'undefined': undefined,
  'NaN': NaN,
  'an array': [1, 2],
  'an empty array': [],
  'an object': { a: 1 },
  'a Set': new Set([1, 2]),
  'a Date': new Date(0),
};

/**
 * Each binding kind, as the written form and as the spread key that must mean the same thing.
 * The element differs per kind because a form property only serializes on a form control.
 */
const KINDS = [
  { name: 'attribute', written: (v) => html`<b title=${v}>x</b>`, spread: (v) => html`<b ${spread({ title: v })}>x</b>` },
  { name: 'boolean', written: (v) => html`<b ?hidden=${v}>x</b>`, spread: (v) => html`<b ${spread({ '?hidden': v })}>x</b>` },
  {
    name: 'input value',
    written: (v) => html`<input .value=${v} />`,
    spread: (v) => html`<input ${spread({ '.value': v })} />`,
  },
  {
    name: 'input checked',
    written: (v) => html`<input type="checkbox" .checked=${v} />`,
    spread: (v) => html`<input type="checkbox" ${spread({ '.checked': v })} />`,
  },
  {
    name: 'option selected',
    written: (v) => html`<select><option .selected=${v}>a</option></select>`,
    spread: (v) => html`<select><option ${spread({ '.selected': v })}>a</option></select>`,
  },
  {
    name: 'textarea value',
    written: (v) => html`<textarea .value=${v}></textarea>`,
    spread: (v) => html`<textarea ${spread({ '.value': v })}></textarea>`,
  },
  {
    name: 'a non-form property',
    written: (v) => html`<b .someProp=${v}>x</b>`,
    spread: (v) => html`<b ${spread({ '.someProp': v })}>x</b>`,
  },
  {
    name: 'an event',
    written: () => html`<b @click=${() => {}}>x</b>`,
    spread: () => html`<b ${spread({ '@click': () => {} })}>x</b>`,
  },
];

let pass = 0;
const failures = [];

for (const kind of KINDS) {
  for (const [label, value] of Object.entries(VALUES)) {
    const written = serializeTemplate(kind.written(value));
    const spreadForm = serializeTemplate(kind.spread(value));
    if (written === spreadForm) pass++;
    else
      failures.push(
        `${kind.name} with ${label}\n      written: ${written}\n      spread:  ${spreadForm}`
      );
  }
}

/** And a written binding and a spread key of the same name must not both survive — the last wins. */
{
  const both = serializeTemplate(html`<b title="static" ${spread({ title: 'from the spread' })}>x</b>`);
  if ((both.match(/title=/g) ?? []).length === 1 && both.includes('from the spread')) pass++;
  else failures.push(`a spread key did not replace the static of the same name: ${both}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} written/spread disagreement(s):\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`spread equivalence: ${pass} pairs identical across every binding kind and value`);
assert.equal(failures.length, 0);
