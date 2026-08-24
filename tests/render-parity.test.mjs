/**
 * **Generalized:** the server and the client must produce the same DOM for the same template.
 *
 * Every server/client defect found in this package's audit was one instance of that single
 * invariant — `${false}` rendering on one side only, text ending in `=` becoming an attribute,
 * single-quoted bindings leaking their sigils, `title=${null}` writing an empty attribute, a `Date`
 * or a `Set` vanishing, a colon splitting an attribute name. Each was fixed and pinned individually;
 * this asserts the rule they were all violating, so the *next* one fails here without anybody having
 * thought of it first.
 *
 * Adding a case is one line. Prefer adding to this over a bespoke test whenever the question is
 * "do the two sides agree".
 *
 * Comparison is on normalized DOM, not on markup text, because two legitimate differences are not
 * defects: the author's quote characters travel in the statics (`class='v'` server, `class="v"`
 * client), and the renderer leaves marker comments. Form properties are compared as **properties**
 * on both sides — the server mirrors `.value`/`.checked` to attributes precisely so hydration can
 * read them back, so the attribute is an implementation detail and the property is the truth.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

/** Every case is a template source, evaluated identically on both sides. */
const CASES = {
  'text': 'html`<p>${state.text}</p>`',
  'text, several slots': 'html`<p>${state.text} and ${state.count}</p>`',
  'text: zero': 'html`<p>[${0}]</p>`',
  'text: false': 'html`<p>[${false}]</p>`',
  'text: null': 'html`<p>[${null}]</p>`',
  'text: undefined': 'html`<p>[${undefined}]</p>`',
  'text: NaN': 'html`<p>[${NaN}]</p>`',
  'text: a Date': 'html`<p>${new Date(0)}</p>`',
  'text: an object with toString': 'html`<p>${{ toString: () => "T" }}</p>`',
  'text: a plain object': 'html`<p>${{ a: 1 }}</p>`',
  'text: a Set': 'html`<p>${new Set([1, 2])}</p>`',
  'text: a Map': 'html`<p>${new Map([[1, 2]])}</p>`',
  'text: nested arrays': 'html`<p>${[1, [2, [3]]]}</p>`',
  'text that looks like an attribute': 'html`<p>total=${state.count}</p>`',
  'text with sigils in it': 'html`<p>set ?open=${1} and .value=${2}</p>`',
  'text needing escapes': 'html`<p>${"<b>&\\"\'"}</p>`',

  'attribute, quoted': 'html`<b title="${state.text}">t</b>`',
  'attribute, single-quoted': "html`<b title='${state.text}'>t</b>`",
  'attribute, unquoted': 'html`<b title=${state.text}>t</b>`',
  'attribute, several slots': 'html`<b class="a ${state.text} c">t</b>`',
  'attribute, null removes': 'html`<b title=${null}>t</b>`',
  'attribute, undefined removes': 'html`<b title=${undefined}>t</b>`',
  'attribute, false renders': 'html`<b title=${false}>t</b>`',
  'attribute, zero renders': 'html`<b title=${0}>t</b>`',
  'attribute with a colon': 'html`<b xml:lang=${"en"}>t</b>`',
  'attribute, data and aria': 'html`<b data-x=${"1"} aria-label=${"l"}>t</b>`',

  'boolean, true': 'html`<b ?hidden=${true}>t</b>`',
  'boolean, false': 'html`<b ?hidden=${false}>t</b>`',
  'boolean, single-quoted': "html`<b ?hidden='${true}'>t</b>`",
  'boolean, truthy string': 'html`<b ?hidden=${"y"}>t</b>`',
  'boolean, zero is falsy': 'html`<b ?hidden=${0}>t</b>`',

  'form property .value': 'html`<input .value=${state.text} />`',
  'form property .value, single-quoted': "html`<input .value='${state.text}' />`",
  'form property .checked': 'html`<input type="checkbox" .checked=${true} />`',
  'form property .checked false': 'html`<input type="checkbox" .checked=${false} />`',

  'dropped: plain property': 'html`<b .someProp=${state.text}>t</b>`',
  'dropped: event': 'html`<b @click=${() => {}}>t</b>`',
  'dropped: event, single-quoted': "html`<b @click='${() => {}}'>t</b>`",
  'dropped: onClick': 'html`<b onClick=${() => {}}>t</b>`',
  'dropped: onClick, single-quoted': "html`<b onClick='${() => {}}'>t</b>`",

  'nested template': 'html`<p>${html`<em>${state.text}</em>`}</p>`',
  'list': 'html`<ul>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>`',
  'empty list': 'html`<ul>${[]}</ul>`',
  'list of primitives': 'html`<p>${[1, 2, 3]}</p>`',

  'void element with bindings': 'html`<img src=${"a.png"} alt=${state.text} />`',
  'several elements': 'html`<div><b title=${state.text}>a</b><i>${state.count}</i></div>`',
};

const STATE = "{ text: 'hello & <world>', count: 3, rows: ['a', 'b'] }";

/* ── server ──────────────────────────────────────────────────────────────────────────────────── */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const state = ${STATE};
const out = {};
${Object.entries(CASES).map(([name, tpl]) => `out[${JSON.stringify(name)}] = serializeTemplate(${tpl});`).join('\n')}
process.stdout.write(JSON.stringify(out));
`;
const server = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

/* ── client ──────────────────────────────────────────────────────────────────────────────────── */
const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
const { render } = await load('renderer');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const state = { text: 'hello & <world>', count: 3, rows: ['a', 'b'] };
const clientTemplates = new Function(
  'html',
  'state',
  `return { ${Object.entries(CASES).map(([n, t]) => `${JSON.stringify(n)}: () => ${t}`).join(',\n')} };`
)(html, state);

/** Form state lives on the property; the server mirrors it to an attribute so hydration can read it. */
const FORM_PROPERTIES = { input: ['value', 'checked'], option: ['value', 'selected'], textarea: ['value'] };

/** A canonical string for a subtree: tags, sorted attributes, merged text, no comments. */
const canonical = (node) => {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      out += child.data;
      continue;
    }
    const mirrored = FORM_PROPERTIES[child.localName] ?? [];
    const attributes = [...child.attributes]
      .filter((attribute) => !mirrored.includes(attribute.name))
      .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort();
    const properties = mirrored.map((name) => `${name}:${JSON.stringify(child[name])}`);
    out += `<${child.localName} ${[...attributes, ...properties].join(' ')}>${canonical(child)}</${child.localName}>`;
  }
  return out;
};

const parse = (markup) => {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  return canonical(container);
};

let pass = 0;
const failures = [];
for (const name of Object.keys(CASES)) {
  const container = dom.window.document.createElement('div');
  render(clientTemplates[name](), container);

  const fromClient = canonical(container);
  const fromServer = parse(server[name]);
  if (fromClient === fromServer) pass++;
  else failures.push(`${name}\n      server: ${fromServer}\n      client: ${fromClient}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} template(s) render differently on the two sides:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`render parity: ${pass}/${Object.keys(CASES).length} templates identical on server and client`);
if (failures.length) process.exit(1);
