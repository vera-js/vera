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
import { serializeTemplate } from '@verajs/ssr';
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
  /**
   * `!name` is a **live** property: the sigil changes only when the *client* re-writes it, so a
   * server has nothing to re-read and it must serialize exactly as `.name` does.
   */
  {
    name: 'a live checked',
    written: (v) => html`<input type="checkbox" !checked=${v} />`,
    spread: (v) => html`<input type="checkbox" ${spread({ '!checked': v })} />`,
  },
  {
    name: 'a live value',
    written: (v) => html`<input !value=${v} />`,
    spread: (v) => html`<input ${spread({ '!value': v })} />`,
  },
  /**
   * `&name` is an element ref. It was the one written kind a spread could not express: the key fell
   * through to a plain attribute, so the client threw from `setAttribute` and the server wrote
   * `&r="[object Object]"` into the markup.
   */
  {
    name: 'a ref',
    written: (v) => html`<b &r=${v ?? {}}>x</b>`,
    spread: (v) => html`<b ${spread({ '&r': v ?? {} })}>x</b>`,
  },
];

/**
 * **Names, not values.** The matrix above varies what a binding is *given* and never what it is
 * *called*, which is exactly why a spread key reached the open tag with nothing checking it: every
 * value around it was escaped, and the name was interpolated raw.
 *
 * A key is runtime data — that is the entire point of the module — so a key sourced from a request
 * or a record could close the attribute, or the element, and put a live `<script>` in the response.
 * The client refused the same input by throwing from `setAttribute`, which is the usual asymmetry:
 * the half with a real DOM validates, the half building a string does not.
 *
 * Each of these must produce **exactly the same markup as the written binding that cannot express
 * it at all** — which is to say nothing. The written form is a static in the template, so a name
 * like these is not something an author can write; the comparison is therefore against an element
 * with no binding on it.
 */
const HOSTILE_NAMES = {
  'a name that closes the element': 'x><script>alert(1)</script',
  'a name that adds a handler': 'x onmouseover=alert(1) y',
  'a name that breaks the quoting': 'x" onload="alert(1)',
  'a name that breaks single quoting': "x' onload='alert(1)",
  'a name holding a space': 'a b',
  'a name holding a tab': 'a\tb',
  'a name holding a newline': 'a\nb',
  'a name holding a slash': 'a/b',
  'a name holding an equals': 'a=b',
  'a name holding a backtick': 'a`b',
  'a name holding a less-than': 'a<b',
  'a name holding a NUL': 'a\u0000b',
  'an empty name': '',
};

/**
 * And these are legal names that happen to be regular-expression metacharacters. A spread key
 * replaces a static of the same name, and the replacement compiled the name into a pattern — so
 * `a|title` became an alternation and removed an attribute it never named.
 */
const LEGAL_AWKWARD_NAMES = ['a|b', 'a.b', 'a*b', 'a+b', 'a(b)', 'a[b]', 'a{b}', 'a?b', 'a$b', 'a^b'];

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

for (const [label, name] of Object.entries(HOSTILE_NAMES)) {
  const bare = serializeTemplate(html`<b>x</b>`);
  const spreadForm = serializeTemplate(html`<b ${spread({ [name]: '1' })}>x</b>`);
  if (spreadForm === bare) pass++;
  else failures.push(`${label}\n      expected: ${bare}\n      got:      ${spreadForm}`);
}

for (const name of LEGAL_AWKWARD_NAMES) {
  /** It serializes, it carries its own value, and it does not disturb the static beside it. */
  const out = serializeTemplate(html`<b title="keep" ${spread({ [name]: '1' })}>x</b>`);
  if (out.includes('title="keep"') && out.includes(`${name}="1"`)) pass++;
  else failures.push(`a legal name with metacharacters (${name})\n      got: ${out}`);
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
