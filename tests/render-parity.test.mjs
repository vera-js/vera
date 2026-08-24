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
 * Comparison is on normalized DOM, not on markup text — see `./canonical.mjs` for the rules and why.
 *
 * The sibling suite `./lifecycle-parity.test.mjs` asks the same question one level up, about a whole
 * component rather than one template.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { canonical } from './canonical.mjs';

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
  /**
   * A `<textarea>`'s value is its **text content**, not an attribute — `<textarea value="x">` is
   * ignored by every parser. So is `<select>`'s: the selected `<option>` carries it.
   */
  'form property .value on a textarea': 'html`<textarea .value=${state.text}></textarea>`',
  'form property .value on a textarea, with whitespace': 'html`<textarea .value=${state.text}>\n</textarea>`',
  'a textarea with static content and no binding': 'html`<textarea>plain</textarea>`',

  'form property on a non-form element': 'html`<b .value=${state.text}>t</b>`',
  'form property on a div': 'html`<div .selected=${true}>t</div>`',
  'dropped: plain property': 'html`<b .someProp=${state.text}>t</b>`',
  'dropped: event': 'html`<b @click=${() => {}}>t</b>`',
  'dropped: event, single-quoted': "html`<b @click='${() => {}}'>t</b>`",
  'dropped: onClick': 'html`<b onClick=${() => {}}>t</b>`',
  'dropped: onClick, single-quoted': "html`<b onClick='${() => {}}'>t</b>`",

  'nested template': 'html`<p>${html`<em>${state.text}</em>`}</p>`',
  'list': 'html`<ul>${state.rows.map((row) => html`<li>${row}</li>`)}</ul>`',
  'empty list': 'html`<ul>${[]}</ul>`',
  'list of primitives': 'html`<p>${[1, 2, 3]}</p>`',

  'duplicate attribute, last wins': 'html`<b title="a" title=${state.text}>t</b>`',
  'duplicate boolean, last wins': 'html`<b hidden ?hidden=${false}>t</b>`',
  'duplicate form property, last wins': 'html`<input value="a" .value=${state.text} />`',
  'text: Infinity': 'html`<p>${Infinity}</p>`',
  'text: float precision': 'html`<p>${0.1 + 0.2}</p>`',
  'text: true': 'html`<p>${true}</p>`',
  'text: empty string': 'html`<p>[${""}]</p>`',
  'text: whitespace only': 'html`<p>[${"   "}]</p>`',
  'attribute: value with a quote': 'html`<b title=${String.fromCharCode(97, 34, 98)}>t</b>`',
  'attribute: value with a single quote': 'html`<b title=${String.fromCharCode(97, 39, 98)}>t</b>`',
  'attribute: value that looks like a tag': 'html`<b title=${"<script>"}>t</b>`',
  'attribute: negative zero': 'html`<b n=${-0}>t</b>`',
  /** `@verajs/renderer/spread` has its own code path on both sides. */
  'spread: empty': 'html`<b ${spread({})}>t</b>`',
  'spread: replaces a static': 'html`<b title="static" ${spread({ title: "spread" })}>t</b>`',
  'spread: static after it': 'html`<b ${spread({ title: "a" })} id="after">t</b>`',
  'spread: two with the same key': 'html`<b ${spread({ title: "one" })} ${spread({ title: "two" })}>t</b>`',
  'spread: nullish removes': 'html`<b title="keep" ${spread({ title: null })}>t</b>`',
  'spread: false boolean removes': 'html`<b hidden ${spread({ "?hidden": false })}>t</b>`',
  'spread: form property': 'html`<input ${spread({ ".value": "v" })} />`',
  'spread: event dropped': 'html`<b ${spread({ onClick: () => {} })}>t</b>`',
  'spread: escaping value': 'html`<b ${spread({ title: "<x>&" })}>t</b>`',
  'void element with bindings': 'html`<img src=${"a.png"} alt=${state.text} />`',
  /** `keyed` mutates the template it is given; `hold` wraps one, and the wrapper is client-only. */
  'keyed template': 'html`<ul>${state.rows.map((row) => keyed(row, html`<li>${row}</li>`))}</ul>`',
  'hold, a template': 'html`<div>${hold(html`<em>${state.text}</em>`)}</div>`',
  'hold, a nested list': 'html`<div>${hold(html`<ul>${state.rows.map((r) => html`<li>${r}</li>`)}</ul>`)}</div>`',
  /** An element-position ref is client state — a function or an object the renderer writes into. */
  'ref, an object': 'html`<input ${{ value: null }} />`',
  'ref, a function': 'html`<input ${() => {}} />`',
  'ref beside a static attribute': 'html`<input id="kept" ${() => {}} />`',
  'ref before an attribute binding': 'html`<input ${() => {}} title=${state.text} />`',
  /**
   * A single-quoted binding is where the scanner that finds element positions loses its place: the
   * opening quote is trimmed off the static, so the closing one has to be read from the author's
   * text or everything after it looks like one long attribute value.
   */
  'a ref after a single-quoted boolean': "html`<b ?hidden='${true}'>x</b><input ${() => {}} />`",
  'a ref after a single-quoted attribute': "html`<b title='${state.text}'>x</b><input ${() => {}} />`",
  'a ref after a single-quoted form property': "html`<input .value='${state.text}' /><input ${() => {}} />`",
  'a ref after an unquoted attribute': 'html`<b title=${state.text}>x</b><input ${() => {}} />`',
  'a spread after a single-quoted boolean': "html`<b ?hidden='${true}'>x</b><i ${spread({ title: 'z' })}>y</i>`",
  'several elements': 'html`<div><b title=${state.text}>a</b><i>${state.count}</i></div>`',

  /**
   * **Hostile values, in every position a value can reach.**
   *
   * A rendering library is an XSS engine if this is wrong (#8), and the two sides must agree: a
   * value that is text on the client and markup on the server is an injection, and the reverse is a
   * page that renders differently once hydrated. Escaping belongs at the render boundary, so it is
   * the boundary that is tested — one hostile string through every kind of binding.
   */
  'hostile: a script tag as text': 'html`<p>${"<script>alert(1)</script>"}</p>`',
  'hostile: a script tag in an attribute': 'html`<b title=${"<script>alert(1)</script>"}>x</b>`',
  'hostile: breaking out of a quoted attribute': 'html`<b title="${String.fromCharCode(34) + " onmouseover=alert(1) x=" + String.fromCharCode(34)}">x</b>`',
  'hostile: breaking out of an unquoted attribute': 'html`<b title=${"x onmouseover=alert(1)"}>x</b>`',
  'hostile: breaking out of a single-quoted attribute': "html`<b title='${String.fromCharCode(39) + \" onmouseover=alert(1) x=\" + String.fromCharCode(39)}'>x</b>`",
  'hostile: closing the tag from a multipart attribute': 'html`<b class="a ${String.fromCharCode(34) + "><script>alert(1)</script>"} c">x</b>`',
  'hostile: an entity that decodes to a tag': 'html`<p>${"&lt;script&gt;alert(1)&lt;/script&gt;"}</p>`',
  'hostile: a javascript: URL': 'html`<a href=${"javascript:alert(1)"}>x</a>`',
  'hostile: an event-handler attribute name is still static': 'html`<b onclick=${"alert(1)"}>x</b>`',
  'hostile: a form property': 'html`<input .value=${"</script><script>alert(1)</script>"} />`',
  'hostile: a spread value': 'html`<b ${spread({ title: "><script>alert(1)</script>" })}>x</b>`',
  'hostile: a spread key that looks like a sigil': 'html`<b ${spread({ "?hidden": "><img src=x onerror=alert(1)>" })}>x</b>`',
  'hostile: a textarea value closing its own tag': 'html`<textarea .value=${"</textarea><script>alert(1)</script>"}></textarea>`',
  'hostile: a comment sequence': 'html`<p>${"<!--<script>alert(1)</script>-->"}</p>`',
  'hostile: a newline in an attribute': 'html`<b title=${"a" + String.fromCharCode(10) + "c"}>x</b>`',
};

/**
 * Differences that are **the platform's**, not this framework's. Listed so they stay known.
 *
 * A `U+0000` cannot travel through markup: the HTML parser replaces it with `U+FFFD` in an attribute
 * value, and a numeric character reference to it is replaced too, so no encoding round-trips. The
 * client sets the attribute through `setAttribute` and keeps the byte. Nothing a serializer can do
 * changes that, and a renderer that sanitised the author's string to match would be worse.
 */
const KNOWN_DIVERGENCES = {
  'a null byte in an attribute':
    'html`<b title=${"a" + String.fromCharCode(0) + "b"}>x</b>`',
};

const STATE = "{ text: 'hello & <world>', count: 3, rows: ['a', 'b'] }";

/* ── server ──────────────────────────────────────────────────────────────────────────────────── */
const ALL = { ...CASES, ...KNOWN_DIVERGENCES };

const serverScript = `
import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const { spread } = await import('@verajs/renderer/spread');
const { keyed, hold } = await import('@verajs/renderer');
const state = ${STATE};
const out = {};
${Object.entries(ALL).map(([name, tpl]) => `out[${JSON.stringify(name)}] = serializeTemplate(${tpl});`).join('\n')}
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
const { spread } = await load('renderer/spread');
const { keyed, hold } = await load('renderer');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const state = { text: 'hello & <world>', count: 3, rows: ['a', 'b'] };
const clientTemplates = new Function(
  'html',
  'state',
  'spread',
  'keyed',
  'hold',
  `return { ${Object.entries(ALL).map(([n, t]) => `${JSON.stringify(n)}: () => ${t}`).join(',\n')} };`
)(html, state, spread, keyed, hold);

const parse = (markup) => {
  const container = dom.window.document.createElement('div');
  container.innerHTML = markup;
  return canonical(container);
};

let pass = 0;
const failures = [];
for (const name of Object.keys(ALL)) {
  const container = dom.window.document.createElement('div');
  render(clientTemplates[name](), container);

  const fromClient = canonical(container);
  const fromServer = parse(server[name]);
  const agree = fromClient === fromServer;
  /** A known divergence must still *be* one: if it starts agreeing, the note above is stale. */
  if (KNOWN_DIVERGENCES[name] ? !agree : agree) pass++;
  else if (KNOWN_DIVERGENCES[name])
    failures.push(`${name} — listed as a known divergence and the two sides now agree; delete the entry`);
  else failures.push(`${name}\n      server: ${fromServer}\n      client: ${fromClient}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} template(s) render differently on the two sides:\n`);
  for (const failure of failures) console.log('    ' + failure + '\n');
}
console.log(`render parity: ${pass}/${Object.keys(ALL).length} templates as expected on server and client`);
if (failures.length) process.exit(1);
