/**
 * **Bound values that would run as code: `javascript:` URLs (an SVG animation's values among them) and `srcdoc`.**
 * Refused by the client
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
  /** Space around `=`, both quotings — the tokenizer allows it, so the value is the same sink. */
  { name: 'spaced =', sel: 'a', attr: 'href', strings: ['<a href = ', '>x</a>'], values: (v) => [v] },
  { name: 'spaced =, quoted', sel: 'a', attr: 'href', strings: ['<a href = "', '">x</a>'], values: (v) => [v] },
  { name: 'single-quoted', sel: 'a', attr: 'href', strings: ["<a href='", "'>x</a>"], values: (v) => [v] },
  { name: 'unquoted, split across two bindings', sel: 'a', attr: 'href', strings: ['<a href=', '', '>x</a>'], values: (v) => [v.slice(0, 5), v.slice(5)] },
  /**
   * **An SVG animation's values.** `<animate>`/`<set>` write `to`/`from`/`values` onto the attribute they animate —
   * `href` included — and clicking the link then runs it, in Chromium, Firefox and WebKit (measured 2026-09-30). Every
   * element × attribute; `by` is refused too, since no legitimate value starts with `javascript:`.
   */
  ...['animate', 'set'].flatMap((el) =>
    ['to', 'from', 'by', 'values'].map((attr) => ({
      name: `<${el} ${attr}>`, sel: el, attr,
      strings: [`<svg><a href="#x"><${el} attributeName="href" ${attr}=`, `></${el}></a></svg>`], values: (v) => [v],
    }))
  ),
];

const cases = [];
for (const position of POSITIONS)
  for (const [kind, list] of [['hostile', HOSTILE], ['benign', BENIGN]])
    for (const payload of list)
      cases.push({ label: `${position.name} · ${kind} · ${JSON.stringify(payload)}`, kind, position, payload });
/**
 * The rule is the attribute's NAME, not its spelling: capitals are refused on both sides. Hostile only — on an SVG
 * element the client still writes a capitalized bound name as written (`TO`, `HREF`) where the parser and the
 * server lowercase it, a separate divergence tracked on its own.
 */
for (const payload of HOSTILE)
  cases.push({ label: `<SET TO> in capitals · ${JSON.stringify(payload)}`, kind: 'hostile', payload,
    position: { sel: 'set', attr: 'to', strings: ['<SVG><A href="#x"><SET attributeName="href" TO=', '></SET></A></SVG>'], values: (v) => [v] } });
/** The author's static prefix joined to a bound remainder — judged whole, as the browser receives it. */
for (const payload of HOSTILE)
  cases.push({
    label: `static prefix joined to a binding · ${JSON.stringify(payload)}`,
    kind: 'hostile',
    position: { sel: 'a', attr: 'href', strings: [`<a href="${payload.slice(0, 3)}`, '">x</a>'], values: (v) => [v.slice(3)] },
    payload,
  });
/** The same, unquoted: the static prefix and the binding are one value however the author quoted it. */
for (const payload of HOSTILE)
  cases.push({
    label: `unquoted static prefix joined to a binding · ${JSON.stringify(payload)}`,
    kind: 'hostile',
    position: { sel: 'a', attr: 'href', strings: [`<a href=${payload.slice(0, 3).replace(/[\s]/g, '')}`, '>x</a>'], values: (v) => [v.slice(3)] },
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
    position: { sel: 'a', attr: 'href', strings: ['<a href="javascript&colon;', '">x</a>'], values: () => ['alert(1)'] } },
  { label: 'a referenced UNQUOTED static prefix (&#106;ava) joined to a binding', kind: 'hostile', payload: 'javascript:alert(1)',
    position: { sel: 'a', attr: 'href', strings: ['<a href=&#106;ava', '>x</a>'], values: () => ['script:alert(1)'] } },
  /** The scheme can also be completed by the static AFTER the value — the joined value is what the browser reads. */
  { label: 'a static suffix completing the scheme (quoted)', kind: 'hostile', payload: 'javascript:alert(1)',
    position: { sel: 'a', attr: 'href', strings: ['<a href="', ':alert(1)">x</a>'], values: () => ['javascript'] } },
  { label: 'a static suffix completing the scheme (unquoted)', kind: 'hostile', payload: 'javascript:alert(1)',
    position: { sel: 'a', attr: 'href', strings: ['<a href=', ':alert(1)>x</a>'], values: () => ['javascript'] } }
);
/**
 * **`values` is a `;`-separated list, and every item is applied in turn**: the payload as the SECOND item is as
 * hostile as the first. A `;` in an `href` is a path character — `/p;javascript:x` is a working link, never refused.
 */
for (const payload of HOSTILE)
  for (const el of ['animate', 'set'])
    cases.push({ label: `<${el} values> with the payload as the second item · ${JSON.stringify(payload)}`, kind: 'hostile', payload: `#a;${payload}`,
      position: { sel: el, attr: 'values', strings: [`<svg><a href="#x"><${el} attributeName="href" values=`, `></${el}></a></svg>`], values: (v) => [v] } });
cases.push(
  { label: 'a static first item joined to a bound second', kind: 'hostile', payload: '#a;javascript:alert(1)',
    position: { sel: 'animate', attr: 'values', strings: ['<svg><a href="#x"><animate attributeName="href" values="#a;', '"></animate></a></svg>'], values: () => ['javascript:alert(1)'] } },
  { label: 'a values list of plain items stays', kind: 'benign', payload: '#a;#b;https://example.com',
    position: { sel: 'animate', attr: 'values', strings: ['<svg><a href="#x"><animate attributeName="href" values=', '></animate></a></svg>'], values: (v) => [v] } },
  { label: 'an href with ;javascript: inside its path stays — a link, never a script', kind: 'benign', payload: '/p;javascript:x',
    position: { sel: 'a', attr: 'href', strings: ['<a href=', '>x</a>'], values: (v) => [v] } }
);
/** A spread's `to` on `<set>` — the key a runtime bag delivers, judged like the written attribute, on both sides. */
for (const [kind, list] of [['hostile', HOSTILE], ['benign', BENIGN]])
  for (const payload of list)
    cases.push({ label: `spread { to } on <set> · ${kind} · ${JSON.stringify(payload)}`, kind, payload, spreadKey: 'to',
      position: { sel: 'set', attr: 'to', strings: ['<svg><a href="#x"><set attributeName="href" ', '></set></a></svg>'], values: (v) => [v] } });
/** …and a spread's `values` list with the payload second: the bag is judged item by item too. */
for (const payload of HOSTILE)
  for (const el of ['animate', 'set'])
    cases.push({ label: `spread { values } on <${el}>, payload second · ${JSON.stringify(payload)}`, kind: 'hostile', payload: `#a;${payload}`, spreadKey: 'values',
      position: { sel: el, attr: 'values', strings: [`<svg><a href="#x"><${el} attributeName="href" `, `></${el}></a></svg>`], values: (v) => [v] } });
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
  assert.ok(said.some((line) => /^\[vera\] renderer: <a> — `href` was given a javascript: URL[\s\S]*\(script-url\)$/.test(line)), said.join('\n'));
});

/**
 * **A value is converted once: what is checked is what is written.** Checking a value and then handing it to
 * `setAttribute` converted it twice, so an object whose `toString` answered `https:` first and `javascript:`
 * after passed the check and was written as the second. Every path converts once now — the template attribute
 * and property, spread's attribute and property keys, and the server — and writes the string it checked.
 */
const turncoat = () => {
  let calls = 0;
  return { toString: () => (calls++ ? 'javascript:alert(1)' : 'https://example.com/') };
};
const T = (strings, values) => ({ _$litType$: 1, strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })), values });

test('a value whose toString changes its answer is checked and written as ONE string — client', () => {
  const ways = {
    'attribute': (v) => T(['<a href=', '>x</a>'], [v]),
    'quoted attribute with a static prefix': (v) => T(['<a href="', '">x</a>'], [v]),
    'property': (v) => T(['<a .href=', '>x</a>'], [v]),
    'spread attribute key': (v) => T(['<a ', '>x</a>'], [spread({ href: v })]),
    'spread property key': (v) => T(['<a ', '>x</a>'], [spread({ '.href': v })]),
  };
  const wrong = [];
  for (const [way, build] of Object.entries(ways)) {
    const host = document.createElement('div');
    renderInto(build(turncoat()), host);
    const href = host.querySelector('a').getAttribute('href');
    if (href !== 'https://example.com/') wrong.push(`${way}: ${JSON.stringify(href)}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('a value whose toString changes its answer is checked and written as ONE string — server', () => {
  const script = `
import { serializeTemplate } from '@verajs/ssr';
const { spread } = await import('@verajs/renderer/spread');
const turncoat = ${turncoat.toString()};
const T = (strings, values) => ({ _$litType$: 1, strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })), values });
process.stdout.write(JSON.stringify([
  serializeTemplate(T(['<a href=', '>x</a>'], [turncoat()])),
  serializeTemplate(T(['<a href="', '">x</a>'], [turncoat()])),
  serializeTemplate(T(['<a ', '>x</a>'], [spread({ href: turncoat() })])),
]));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
  for (const markup of out) {
    const parsed = document.createElement('div');
    parsed.innerHTML = markup;
    assert.equal(parsed.querySelector('a').getAttribute('href'), 'https://example.com/', markup);
  }
});

/** An object that is ALWAYS `javascript:` when converted is refused like the string — the check must not skip non-strings. */
test('a non-string value that converts to a javascript: URL is refused on every path', () => {
  console.warn = () => {};
  try {
    const hostile = () => ({ toString: () => 'javascript:alert(1)' });
    const builds = [
      (v) => T(['<a href=', '>x</a>'], [v]),
      (v) => T(['<a .href=', '>x</a>'], [v]),
      (v) => T(['<a ', '>x</a>'], [spread({ href: v })]),
      (v) => T(['<a ', '>x</a>'], [spread({ '.href': v })]),
    ];
    for (const build of builds) {
      const host = document.createElement('div');
      renderInto(build(hostile()), host);
      assert.equal(host.querySelector('a').getAttribute('href'), null, build.toString());
    }
  } finally {
    console.warn = silence;
  }
});

/**
 * A custom element's `src`/`data` PROPERTY is its own business — the commonest custom-element binding there is
 * is `.data=${rows}` — so it is never converted: an object arrives as the object. Only a STRING is checked there.
 */
test('a custom element receives an object at a URL-named property untouched; a javascript: string is still refused', () => {
  console.warn = () => {};
  try {
    const rows = [{ a: 1 }];
    const host = document.createElement('div');
    renderInto(T(['<x-chart .data=', '></x-chart><x-chart ', '></x-chart>'], [rows, spread({ '.data': rows })]), host);
    const [written, spreadTo] = host.querySelectorAll('x-chart');
    assert.equal(written.data, rows, 'a template property delivered the object');
    assert.equal(spreadTo.data, rows, 'a spread property key delivered the object');
    const hostile = document.createElement('div');
    renderInto(T(['<x-link .href=', '></x-link><x-link ', '></x-link>'], ['javascript:alert(1)', spread({ '.href': 'javascript:alert(1)' })]), hostile);
    for (const el of hostile.querySelectorAll('x-link')) assert.notEqual(el.href, 'javascript:alert(1)');
  } finally {
    console.warn = silence;
  }
});

/**
 * **Through an `svg` template too** — content built in the SVG namespace from the start, not parsed inside an inline
 * `<svg>`: the rule is the attribute's name, so the build path cannot matter. Client and server.
 */
test('an animation value bound through an svg`` template is refused, client and server', () => {
  const S = (strings, values) => ({ _$litType$: 2, strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })), values });
  const strings = ['<a href="#x"><set attributeName="href" to=', '></set></a>'];
  const svgHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  console.warn = () => {};
  try {
    renderInto(S(strings, ['javascript:alert(1)']), svgHost);
  } finally {
    console.warn = silence;
  }
  const set = svgHost.querySelector('set');
  assert.equal(set?.namespaceURI, 'http://www.w3.org/2000/svg', 'CONTROL: built in the SVG namespace');
  assert.equal(set.getAttribute('to'), null);
  const script = `
import { serializeTemplate } from '@verajs/ssr';
process.stdout.write(serializeTemplate({ _$litType$: 2, strings: Object.freeze(Object.assign(${JSON.stringify(strings)}, { raw: ${JSON.stringify(strings)} })), values: ['javascript:alert(1)'] }));
`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(out, /<set attributeName="href"/, 'CONTROL: the server rendered the element');
  assert.doesNotMatch(out, /javascript/i);
});
