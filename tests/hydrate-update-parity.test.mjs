/**
 * Hydrate, then change something.
 *
 * `hydrate-bindings.test.mjs` proves adoption keeps the server's nodes; `render-update-parity`
 * proves an update equals a fresh render. Neither covers the composition, which is the path a real
 * page takes and the one where a defect hides best: adoption can wire a part to the wrong node, or
 * to the right node with the wrong idea of what is in it, and **nothing shows until the value
 * changes**. The markup is the server's, so the first frame looks perfect either way.
 *
 * The invariant is the same one that works everywhere else: after the update, the hydrated
 * container must equal a container that only ever rendered the new value.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { canonical } from './canonical.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

/** Used verbatim on both sides, so the call sites cannot drift. */
const CASES = {
  'text': 'html`<p><b>x</b>${state.text}</p>`',
  'text, two slots': 'html`<p>${state.text} and ${state.count}</p>`',
  'text beside elements': 'html`<p><i>a</i>${state.text}<u>b</u></p>`',
  'text that empties': 'html`<p>${state.empty}</p>`',
  'text that arrives': 'html`<p>${state.filled}</p>`',
  'an attribute': 'html`<p title=${state.text}>x</p>`',
  'an attribute among statics': 'html`<p id="i" title=${state.text} lang="en">x</p>`',
  'a multipart attribute': 'html`<p class="a ${state.text} c">x</p>`',
  'an attribute that is removed': 'html`<p title=${state.nullable}>x</p>`',
  'an attribute that appears': 'html`<p title=${state.appearing}>x</p>`',
  'two attributes on one element': 'html`<p title=${state.text} lang=${state.text}>x</p>`',
  'a boolean': 'html`<p ?hidden=${state.flag}>x</p>`',
  'a value property': 'html`<input .value=${state.text} />`',
  'a checked property': 'html`<input type="checkbox" .checked=${state.flag} />`',
  'a nested template': 'html`<p>${html`<em>${state.text}</em>`}</p>`',
  'a nested template beside text': 'html`<p>${state.count}${html`<em>${state.text}</em>`}</p>`',
  'a list': 'html`<ul>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>`',
  'a list with an attribute': 'html`<ul>${state.rows.map((row) => html`<li data-r=${row}>${row}</li>`)}</ul>`',
  'a list that grows': 'html`<ul>${state.growing.map((row) => html`<li>${row}</li>`)}</ul>`',
  'a list that empties': 'html`<ul>${state.shrinking.map((row) => html`<li>${row}</li>`)}</ul>`',
  'a list with a static sibling': 'html`<ul><li>head</li>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>`',
  'text after a list': 'html`<div><ul>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>${state.text}</div>`',
  'a deep nest': 'html`<div><section><p><b>${state.text}</b></p></section></div>`',
  'an attribute and a child': 'html`<p title=${state.text}>${state.text}</p>`',
  'a textarea value': 'html`<textarea .value=${state.text}></textarea>`',
  'text needing escapes': 'html`<p>${state.hostile}</p>`',
  'an attribute needing escapes': 'html`<p title=${state.hostile}>x</p>`',
};

const STATE_A = `{
  text: 'hello & <world>', count: 3, rows: ['a', 'b'],
  empty: 'gone soon', filled: '', nullable: 'here', appearing: null,
  flag: true, growing: ['a'], shrinking: ['a', 'b', 'c'],
  hostile: 'a & b < c',
}`;
const STATE_B = `{
  text: 'second "value"', count: 12, rows: ['b', 'c', 'd'],
  empty: '', filled: 'now here', nullable: null, appearing: 'arrived',
  flag: false, growing: ['a', 'b', 'c'], shrinking: [],
  hostile: '<script>x</script>',
}`;

const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
const { html } = await import('@verajs/core');
const state = ${STATE_A};
const out = {};
${Object.entries(CASES).map(([name, tpl]) => `out[${JSON.stringify(name)}] = serializeTemplate(${tpl});`).join('\n')}
process.stdout.write(JSON.stringify(out));
`;
const serverMarkup = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const { renderInto: hydrateRender } = await load('renderer/hydrate');
const { renderInto } = await load('renderer');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

const build = (stateSource) =>
  new Function(
    'html',
    'state',
    `return { ${Object.entries(CASES).map(([n, t]) => `${JSON.stringify(n)}: () => ${t}`).join(',\n')} };`
  )(html, eval(`(${stateSource})`));

const withA = build(STATE_A);
const withB = build(STATE_B);

let pass = 0;
const failures = [];

for (const name of Object.keys(CASES)) {
  const hydrated = dom.window.document.createElement('div');
  hydrated.innerHTML = serverMarkup[name];
  /** A node from the server's markup, to prove adoption happened rather than a silent re-render. */
  const adopted = hydrated.firstElementChild;

  hydrateRender(withA[name](), hydrated);
  const kept = adopted !== null && hydrated.contains(adopted);

  hydrateRender(withB[name](), hydrated);

  const direct = dom.window.document.createElement('div');
  renderInto(withB[name](), direct);

  const updated = canonical(hydrated);
  const fresh = canonical(direct);

  if (!kept) failures.push(`${name}\n      the server's nodes were replaced — adoption did not happen`);
  else if (updated !== fresh) failures.push(`${name}\n      hydrated+updated: ${updated}\n      fresh:            ${fresh}`);
  else pass++;
}

if (failures.length) {
  console.log(`\n  ${failures.length} case(s) where hydrating then updating differs from rendering:\n`);
  for (const failure of failures) console.log(`    ${failure}\n`);
  process.exit(1);
}
console.log(`hydrate-update parity: ${pass} cases adopt the server's DOM and then update like a fresh render`);
