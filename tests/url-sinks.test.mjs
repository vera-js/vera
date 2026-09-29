/**
 * **Bound values that would run as code: `javascript:` URLs and `srcdoc`.** Refused by the client
 * (`@verajs/renderer`) and by the server (`@verajs/ssr`) under ONE rule — a server that served what the
 * client refuses would ship a working exploit to every reader who never hydrates, and a hydration
 * mismatch to everyone else.
 *
 * The rule has two homes — `SCRIPT_URL`/`URL_ATTRIBUTE` in `@verajs/shared-utils` (the renderer) and
 * their twins in `@verajs/ssr`'s `escaping.js`, which cannot import it — so, as for the markup grammar,
 * **the spec is stated HERE and imported from neither**, and both homes are driven against it through
 * the packages' real entry points rather than their regexes.
 *
 * A URL counts as `javascript:` the way the URL Standard's parser reads a scheme: leading C0 controls
 * and spaces stripped, ASCII tab/LF/CR removed anywhere, case-insensitive. Statics are the author's
 * and are never refused on their own — but a BOUND attribute is judged on its JOINED value, statics
 * included, because that is the string the browser receives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

/** THE SPEC — values every engine navigates to as `javascript:`. */
const HOSTILE = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  ' javascript:alert(1)',
  '\u0001\u001fjavascript:alert(1)',
  'java\tscript:alert(1)',
  'jav\na\rscript:alert(1)',
  'javascript\t:alert(1)',
];
/** …and values that only look like it, which must never be refused. */
const BENIGN = ['/path?q=javascript:x', 'https://example.com', 'mailto:a@b.c', 'javascripts:x', 'java script:x', '\u00a0javascript:x', '#javascript:x'];

/**
 * Every position a bound value can reach a URL attribute through. Each case: the element's selector,
 * the attribute, template strings, and how the payload becomes the values.
 */
const POSITIONS = [
  { name: 'unquoted href', sel: 'a', attr: 'href', strings: ['<a href=', '>x</a>'], values: (v) => [v] },
  { name: 'quoted href', sel: 'a', attr: 'href', strings: ['<a href="', '">x</a>'], values: (v) => [v] },
  { name: 'split across two bindings', sel: 'a', attr: 'href', strings: ['<a href="', '', '">x</a>'], values: (v) => [v.slice(0, 5), v.slice(5)] },
  { name: 'iframe src', sel: 'iframe', attr: 'src', strings: ['<iframe src=', '></iframe>'], values: (v) => [v] },
  { name: 'form action', sel: 'form', attr: 'action', strings: ['<form action="', '"></form>'], values: (v) => [v] },
  { name: 'button formaction', sel: 'button', attr: 'formaction', strings: ['<button formaction=', '>b</button>'], values: (v) => [v] },
];

const cases = [];
for (const position of POSITIONS)
  for (const [kind, list] of [['hostile', HOSTILE], ['benign', BENIGN]])
    for (const payload of list)
      cases.push({ label: `${position.name} · ${kind} · ${JSON.stringify(payload)}`, kind, position, payload });
/** The author's static prefix joined to a bound remainder — judged whole, as the browser receives it. */
for (const payload of HOSTILE)
  cases.push({
    label: `static prefix joined to a binding · ${JSON.stringify(payload)}`,
    kind: 'hostile',
    position: { sel: 'a', attr: 'href', strings: [`<a href="${payload.slice(0, 3)}`, '">x</a>'], values: (v) => [v.slice(3)] },
    payload,
  });
/**
 * The author's static spelled with character references: the browser DECODES them before the client joins
 * the value, so the server has to read them the same way (`&#106;` is `j`, `&colon;` is `:`).
 */
cases.push(
  { label: 'a referenced static prefix (&#106;ava) joined to a binding', kind: 'hostile', payload: 'javascript:alert(1)',
    position: { sel: 'a', attr: 'href', strings: ['<a href="&#106;ava', '">x</a>'], values: () => ['script:alert(1)'] } },
  { label: 'a referenced scheme colon (&colon;) before a binding', kind: 'hostile', payload: 'javascript:alert(1)',
    position: { sel: 'a', attr: 'href', strings: ['<a href="javascript&colon;', '">x</a>'], values: () => ['alert(1)'] } }
);
/**
 * The same payloads through `spread` — the twin of the template rule — as an attribute key and as a
 * property key. The client applies the bag; the server serializes its `_$attrs$` half.
 */
for (const [kind, list] of [['hostile', HOSTILE], ['benign', BENIGN]])
  for (const payload of list)
    for (const bagKey of ['href', '.href'])
      cases.push({ label: `spread { ${bagKey} } · ${kind} · ${JSON.stringify(payload)}`, kind, payload, spreadKey: bagKey,
        position: { sel: 'a', attr: 'href', strings: ['<a ', '>x</a>'], values: (v) => [v] } });
/** A bound `srcdoc` attribute renders its value as a document: refused whatever it holds. */
for (const strings of [['<iframe srcdoc=', '></iframe>'], ['<iframe srcdoc="', '"></iframe>']])
  cases.push({ label: `bound srcdoc (${strings[0]})`, kind: 'hostile', position: { sel: 'iframe', attr: 'srcdoc', strings, values: (v) => [v] }, payload: '<b>x</b>' });

/* ── server, in its own process (the SSR DOM and jsdom cannot share one) ─────────────────────── */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
const { spread } = await import('@verajs/renderer/spread');
const cases = ${JSON.stringify(cases.map((c) => [c.position.strings, c.position.values(c.payload), c.spreadKey ?? null]))};
process.stdout.write(JSON.stringify(cases.map(([strings, values, spreadKey]) =>
  serializeTemplate({ _$litType$: 1, strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })),
    values: spreadKey === null ? values : [spread({ [spreadKey]: values[0] })] }))));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
);

/* ── client ──────────────────────────────────────────────────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
const { renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
const silence = console.warn;

const attributeOf = (host, { sel, attr }) => host.querySelector(sel)?.getAttribute(attr) ?? null;

test('the spec is exercised — every position, both lists, both sides', () => {
  assert.ok(cases.length >= POSITIONS.length * (HOSTILE.length + BENIGN.length), 'the case table is broken, not the rule');
  assert.equal(served.length, cases.length, 'the server rendered every case');
});

test('a javascript: URL bound where a browser navigates is refused by the client AND the server, in every spelling and position', () => {
  const wrong = [];
  console.warn = () => {};
  try {
    cases.forEach((c, i) => {
      const host = document.createElement('div');
      const values = c.position.values(c.payload);
      renderInto({ _$litType$: 1, strings: Object.freeze(Object.assign([...c.position.strings], { raw: [...c.position.strings] })),
        values: c.spreadKey === undefined ? values : [spread({ [c.spreadKey]: values[0] })] }, host);
      const client = attributeOf(host, c.position);
      const parsed = document.createElement('div');
      parsed.innerHTML = served[i];
      const server = attributeOf(parsed, c.position);
      /** A property key is the client's concern: `@verajs/ssr`'s serializer drops a `.prop` binding on an ordinary element. */
      const serverShows = c.spreadKey !== '.href';
      if (c.kind === 'hostile' ? client !== null || server !== null : client !== c.payload || (serverShows && server !== c.payload))
        wrong.push(`${c.label}: client ${JSON.stringify(client)}, server ${JSON.stringify(server)}`);
    });
  } finally {
    console.warn = silence;
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('a property binding is refused the same way — `.href=${…}` cannot set a javascript: URL either', () => {
  console.warn = () => {};
  try {
    for (const payload of HOSTILE) {
      const host = document.createElement('div');
      renderInto({ _$litType$: 1, strings: Object.freeze(Object.assign(['<a .href=', '>x</a>'], { raw: ['<a .href=', '>x</a>'] })), values: [payload] }, host);
      assert.equal(host.querySelector('a').getAttribute('href'), null, JSON.stringify(payload));
    }
  } finally {
    console.warn = silence;
  }
});

test('`.srcdoc` stays the deliberate spelling for trusted markup — refusing the attribute leaves the property', () => {
  const host = document.createElement('div');
  renderInto({ _$litType$: 1, strings: Object.freeze(Object.assign(['<iframe .srcdoc=', '></iframe>'], { raw: ['<iframe .srcdoc=', '></iframe>'] })), values: ['<b>trusted</b>'] }, host);
  assert.equal(host.querySelector('iframe').srcdoc, '<b>trusted</b>');
});

test('development names the refusal where it happens', { skip: isProduction && 'diagnostics are folded away' }, () => {
  const said = [];
  console.warn = (message) => said.push(String(message));
  try {
    const host = document.createElement('div');
    renderInto({ _$litType$: 1, strings: Object.freeze(Object.assign(['<a href=', '>x</a>'], { raw: ['<a href=', '>x</a>'] })), values: ['javascript:alert(1)'] }, host);
  } finally {
    console.warn = silence;
  }
  assert.ok(said.some((line) => /^\[vera\] renderer: `href` was given a javascript: URL/.test(line)), said.join('\n'));
});
