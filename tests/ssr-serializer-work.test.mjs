/**
 * **Generalized:** the serializer must not repeat, per render, work that belongs to compile time.
 *
 * A timing test would be flaky and would not have caught this anyway: twenty commits of correctness
 * fixes made a 100-row table 36% slower one small step at a time, and no single step looked wrong.
 * What each step *did* was per-render work with a per-template answer — `new RegExp` built for every
 * attribute binding, a plan recomputed, a table rebuilt.
 *
 * So this counts work instead of measuring time, which is stable on any machine: after a warmup
 * render, a second render of the same template must construct **no** regular expressions and must
 * not recompile. Both are structural, and both are exactly what regressed.
 *
 * Note that regex *literals* do not call the constructor, so this only sees `new RegExp(...)` —
 * which is the thing that has a name in it and therefore cannot be a literal.
 */
import { load } from './dist.mjs';
import '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const { serializeTemplate } = await import('@verajs/ssr/vera');
const { html } = await load('core');
const { spread } = await load('renderer/spread');

const rows = Array.from({ length: 20 }, (_, i) => ({ id: i, label: `row ${i} <safe>` }));

/** Every binding kind that writes a name into a tag, which is where the per-render work was. */
const TEMPLATES = {
  'a table of rows': () =>
    html`<table>
      <tbody>
        ${rows.map((row) => html`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`)}
      </tbody>
    </table>`,
  'attributes, booleans and form properties': () =>
    html`<input title=${'t'} ?disabled=${true} .value=${'v'} class=${'c'} data-x=${'1'} />`,
  'a spread': () => html`<b ${spread({ title: 'one', '?hidden': false, '.value': 'v' })}>t</b>`,
  'duplicates, which are the case that needs the work': () =>
    html`<b title="static" title=${'dynamic'} hidden ?hidden=${false}>t</b>`,
};

const RealRegExp = globalThis.RegExp;
let constructed = 0;
/** A Proxy rather than a subclass: `new RegExp` and `RegExp()` both have to be seen. */
globalThis.RegExp = new Proxy(RealRegExp, {
  construct: (target, args) => (constructed++, new target(...args)),
  apply: (target, thisArg, args) => (constructed++, target(...args)),
});

let pass = 0;
const failures = [];
for (const [name, build] of Object.entries(TEMPLATES)) {
  /** Warmup: the first render is allowed to compile, and to build whatever it needs once. */
  const first = serializeTemplate(build());
  constructed = 0;
  const second = serializeTemplate(build());

  if (constructed === 0) pass++;
  else failures.push(`${name}: built ${constructed} RegExp(s) on a second render — that is compile-time work`);

  if (first === second) pass++;
  else failures.push(`${name}: two renders of the same template disagreed\n      ${first}\n      ${second}`);
}
globalThis.RegExp = RealRegExp;

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s):\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`serializer work: ${pass}/${Object.keys(TEMPLATES).length * 2} checks`);
assert.equal(failures.length, 0);
