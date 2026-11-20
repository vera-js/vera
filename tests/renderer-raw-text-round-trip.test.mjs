/**
 * **A value in an HTML `<style>` or JSON data block stays text after the page is saved from the DOM and parsed again —
 * on the client, byte for byte as the server writes it** (2026-11-18). A style's and a script's text is serialized
 * VERBATIM (BROWSER-LEDGER), so the renderer once wrote `p{content:"</style><img onerror>"}` into a style live — inert
 * there — and a saved page (an editor's publish, `outerHTML`) served the img. Now one binding per element composes its
 * statics and values and writes the whole text closed (`closedRawText`: in a style each `</style` as `<\/style`, in a
 * JSON block every `<` as `\u003c`), the server's own rule. Held here:
 *
 * 1. **The server, core and lite write the same bytes** for the same source — closer spellings, a closer split across a
 *    static and a value or across two values, empty values, `<!--`, `</script`, emoji, a backslash.
 * 2. **Idempotence**: the written text, rendered again as a value, is written unchanged (the escape of an escape is
 *    itself), on the server and on the client.
 * 3. **Hydration adopts** a served text equal to the client's — the very text node stays, nothing is said — and a
 *    served text that differs is rewritten to the client's, the element itself adopted.
 * 4. **Every placement of up to three holes inside a closer**, generated, on core's client: the element whole live and
 *    after a round trip, its text the composed text closed — with a control showing the same corpus written as composed
 *    leaks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

import { IMG, SHAPES, literal } from './fixtures/raw-text-shapes.mjs';
import { fsPath } from '../scripts/fs-path.mjs';


/** The server's bytes per shape, from a child process (`@verajs/ssr` installs DOM globals jsdom's would fight). */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });
const shapes = JSON.parse(process.env.SHAPES);
process.stdout.write(JSON.stringify(shapes.map(([, strings, values]) => serializeTemplate({ strings: literal(strings), values }))));
`;
const served = JSON.parse(
  execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, SHAPES: JSON.stringify(SHAPES) },
  }),
);

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { hydration } = await load('renderer/hydration');
core.wire([renderer, hydration]);
const lite = await load('lite');

/** One parser for every round trip (jsdom's CSS parser complaining about generated sheets is its noise). */
const parser = new JSDOM('<!doctype html><body></body>', { virtualConsole: new VirtualConsole() }).window.document;
const reparsed = (markup) => {
  parser.body.innerHTML = markup;
  return parser.body;
};
const rawOf = (root) => root.querySelector('style, script');
let seq = 0;
/** Core's client render of a shape, into a fresh host. */
const coreRender = (strings, values) => {
  const host = document.createElement('div');
  renderInto(core.html(literal(strings), ...values), host);
  return host;
};
/** Lite's client render of a shape: a component's light DOM. */
const liteRender = (strings, values) => {
  const tag = `rt-lite-${seq++}`;
  const shape = literal(strings);
  lite.define(tag, () => () => lite.html(shape, ...values));
  const el = document.body.appendChild(document.createElement(tag));
  el.remove();
  return el;
};

test('the server, core and lite write the same bytes into a style or JSON block, and none of them leaks after a round trip', () => {
  for (const [i, [name, strings, values]] of SHAPES.entries()) {
    const server = rawOf(reparsed(served[i])).textContent;
    const host = coreRender(strings, values);
    const ours = rawOf(host).textContent;
    const theirs = rawOf(liteRender(strings, values)).textContent;
    assert.equal(ours, server, `${name}: core and the server differ`);
    assert.equal(theirs, server, `${name}: lite and the server differ`);
    for (const [side, markup] of [['server', served[i]], ['core', host.innerHTML]]) {
      const back = reparsed(markup);
      assert.equal(back.querySelector('img'), null, `${name}: ${side} leaked after a round trip: ${markup}`);
      assert.equal(back.querySelectorAll('style, script').length, 1, `${name}: ${side}'s element ended early`);
      assert.equal(rawOf(back).textContent, server, `${name}: ${side}'s text changed in a round trip`);
    }
    /** A JSON block is still the same JSON: written closed, read back lossless. */
    if (name.startsWith('json')) {
      /** A value as text: a list is its items' text, flattened (the rule every side follows). */
      const text = (v) => (Array.isArray(v) ? v.flat(Infinity).filter((x) => x != null).join('') : v);
      const composed = strings.reduce((out, s, p) => out + (p ? text(values[p - 1]) : '') + s, '').replace(/^<script[^>]*>|<\/script>$/g, '');
      assert.deepEqual(JSON.parse(ours), JSON.parse(composed), `${name}: lossless`);
    }
  }
});

test('idempotence: the text as written, rendered again as the only value, is written unchanged (server and client)', () => {
  const again = [];
  for (const [i, [name, strings]] of SHAPES.entries()) {
    const text = rawOf(reparsed(served[i])).textContent;
    const open = strings[0].slice(0, strings[0].indexOf('>') + 1);
    const close = strings[0].startsWith('<style') ? '</style>' : '</script>';
    again.push([name, [open, close], [text]]);
    assert.equal(rawOf(coreRender([open, close], [text])).textContent, text, `${name}: the client escaped an escape`);
  }
  const twice = JSON.parse(
    execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', serverScript], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, SHAPES: JSON.stringify(again) },
    }),
  );
  for (const [i, [name, , [text]]] of again.entries()) assert.equal(rawOf(reparsed(twice[i])).textContent, text, `${name}: the server escaped an escape`);
});

test('hydration ADOPTS a served style or JSON text equal to the client\'s (the same text node, nothing said), and rewrites one that differs', () => {
  const said = [];
  const saved = [console.warn, console.error];
  console.warn = console.error = (...args) => said.push(args.map(String).join(' '));
  try {
    let adopted = 0;
    for (const [i, [name, strings, values]] of SHAPES.entries()) {
      for (const plant of [false, true]) {
        const host = document.createElement('div');
        host.innerHTML = `<p id="probe">x</p>${served[i]}`;
        const probe = host.querySelector('#probe');
        const element = rawOf(host);
        if (plant) element.textContent = 'tampered';
        const text = element.firstChild;
        renderInto(core.html(literal([`<p id="probe">x</p>${strings[0]}`, ...strings.slice(1)]), ...values), host);
        assert.equal(host.querySelector('#probe'), probe, `${name}: hydration fell back (the probe was replaced)`);
        assert.equal(rawOf(host), element, `${name}: the element was not adopted`);
        assert.equal(element.textContent, rawOf(reparsed(served[i])).textContent, `${name}: the text is not the client's`);
        /**
         * Adopted by identity, except a LIST: hydration converts only values whose conversion runs no user code, so a list
         * is rewritten to the same text (rare in a style; one write).
         */
        if (!plant && !values.some(Array.isArray)) {
          assert.equal(element.firstChild, text, `${name}: an equal served text was rewritten, not adopted`);
          adopted++;
        }
      }
    }
    assert.equal(adopted, SHAPES.filter(([, , values]) => !values.some(Array.isArray)).length, 'CONTROL: every shape was hydrated');
  } finally {
    [console.warn, console.error] = saved;
  }
  assert.deepEqual(said, [], 'hydration said something (a mismatch?)');
});

/** Every placement of 1..3 holes over `closer`: [start, end] per hole, in order, at least one cut strictly inside it. */
const placements = (length) => {
  const out = [];
  const place = (k, from, acc) => {
    if (acc.length > 0) out.push(acc);
    if (k === 0) return;
    for (let s = from; s <= length; s++) for (let e = s; e <= length; e++) place(k - 1, e, [...acc, [s, e]]);
  };
  place(3, 0, []);
  return out.filter((holes) => holes.some(([s, e]) => (s > 0 && s < length) || (e > 0 && e < length)));
};
const BEFORE = '<style>p{content:"';
const AFTER = `${IMG}"}</style><p id="after">ok</p>`;
const corpus = (closer) =>
  placements(closer.length).map((holes) => {
    const strings = [];
    const values = [];
    let last = 0;
    for (const [s, e] of holes) {
      strings.push((strings.length === 0 ? BEFORE : '') + closer.slice(last, s));
      values.push(closer.slice(s, e));
      last = e;
    }
    strings.push(closer.slice(last) + AFTER);
    return [strings, values];
  });

/**
 * A hole right after a WHOLE end-tag name (`</style${x}`) is a tag-name position: development refuses it, as the server
 * does, and production consumes its value (no marker), so the author's own statics end the element — the recorded
 * server/client difference (`tests/ssr-raw-text-closers.test.mjs`, the ssr README's known limits). Those shapes are told
 * apart exactly, and every other one is judged.
 */
const tagHole = (strings) => strings.slice(0, -1).some((s) => /<\/style$/i.test(s));

test('core\'s client, every placement of up to three holes inside a style closer, every spelling: whole live and after a round trip, its text exact', () => {
  let cases = 0;
  let named = 0;
  const failures = [];
  for (const closer of ['</style>', '</STYLE>', '</sTyLe>', '</style ', '</style/', '</style\t'])
    for (const [strings, values] of corpus(closer)) {
      cases++;
      let host;
      let error;
      try {
        host = coreRender(strings, values);
      } catch (e) {
        error = e;
      }
      if (tagHole(strings)) {
        named++;
        if (!isProduction && !/tag-hole/.test(String(error?.message))) failures.push(`not refused in development: ${JSON.stringify(strings)}`);
        continue;
      }
      if (error !== undefined) {
        failures.push(`${JSON.stringify(strings)}: ${error.message}`);
        continue;
      }
      const composed = `p{content:"${closer}${IMG}"}`.replace(/<\/(style)/gi, '<\\/$1');
      for (const [when, root] of [['live', host], ['after a round trip', reparsed(host.innerHTML)]]) {
        const ok = root.querySelectorAll('style').length === 1 && root.querySelector('img') === null
          && root.querySelector('#after')?.textContent === 'ok' && root.querySelector('style').textContent === composed;
        if (!ok && failures.length < 5) failures.push(`${when}: ${JSON.stringify(strings)} ${JSON.stringify(values)} → ${host.innerHTML}`);
      }
    }
  assert.ok(cases > 5000, `CONTROL: ${cases} placements generated`);
  assert.ok(cases - named > cases / 2, `CONTROL: ${cases - named} of ${cases} judged: a row skipping everything would pass`);
  assert.ok(named > 0, 'CONTROL: the tag-name shapes were generated, and told apart');
  assert.deepEqual(failures, []);
});

test('CONTROL: the same corpus written as composed (the old client) leaks after a round trip — the row measures something', () => {
  let leaked = 0;
  for (const [strings, values] of corpus('</style>')) {
    const composed = strings.reduce((out, s, p) => out + (p ? values[p - 1] : '') + s, '');
    const style = parser.createElement('style');
    style.textContent = composed.slice('<style>'.length, composed.lastIndexOf('</style><p'));
    if (reparsed(style.outerHTML).querySelector('img')) leaked++;
  }
  assert.ok(leaked > 100, `only ${leaked} placements leak when written as composed`);
});

test('an update rewrites the text only when the composed text changed', () => {
  const host = document.createElement('div');
  const shape = literal(['<style>a{b:', '} c{d:', '}</style>']);
  renderInto(core.html(shape, '1', '</style>'), host);
  const style = host.querySelector('style');
  const first = style.firstChild;
  renderInto(core.html(shape, '1', '</style>'), host);
  assert.equal(style.firstChild, first, 'an unchanged text was written again');
  renderInto(core.html(shape, '2', '</STYLE>'), host);
  assert.equal(style.textContent, 'a{b:2} c{d:<\\/STYLE>}');
  assert.equal(host.querySelector('style'), style, 'the element stays');
});

/**
 * **A lite COMPONENT and a core component with the same source, both on the server, write the same bytes** — lite on the
 * server writes through the server's DOM (a text node it fills, which the DOM then serializes), core through the
 * serializer: a text lite already escaped must not be escaped again across that boundary, and both must equal what core
 * writes on the client.
 */
test('on the server, a lite component and a core component with the same source serve the same raw text, equal to the client\'s', () => {
  const pairs = JSON.parse(
    execFileSync(process.execPath, [...process.execArgv, fsPath(new URL('./fixtures/ssr/raw-text-parity-serve.mjs', import.meta.url))], {
      encoding: 'utf8',
      env: process.env,
    }),
  );
  assert.equal(pairs.length, SHAPES.length, 'CONTROL: every shape was served');
  for (const [i, [name, strings, values]] of SHAPES.entries()) {
    const { core: ours, lite: theirs } = pairs[i];
    /**
     * A static that only LOOKS like an end tag (`</stylex>`, `</style\v>`) is markup the server's DOM declines to parse
     * (it parses what it can reproduce exactly — the ssr README's known limits), so lite, which parses there, finds no
     * hole and refuses it, coded (`tier-hole-position`); the serializer serves it. Pinned, so the limit is seen rather
     * than taken for a pass.
     */
    if (/no closer/.test(name)) {
      assert.ok(ours.html, `${name}: core served (${ours.refused ?? ''})`);
      assert.match(String(theirs.refused), /\(tier-hole-position\)$|\/e\/tier-hole-position$/, `${name}: lite on the server, refused (coded)`);
      continue;
    }
    assert.ok(ours.html && theirs.html, `${name}: served (${ours.refused ?? ''} ${theirs.refused ?? ''})`);
    const client = rawOf(coreRender(strings, values)).textContent;
    const [a, b] = [reparsed(ours.html), reparsed(theirs.html)].map((root) => rawOf(root));
    assert.ok(a && b, `${name}: CONTROL: both served their element`);
    assert.equal(a.textContent, client, `${name}: core on the server differs from the client`);
    assert.equal(b.textContent, client, `${name}: lite on the server differs from the client (escaped twice?)`);
    for (const root of [reparsed(ours.html), reparsed(theirs.html)]) assert.equal(root.querySelector('img'), null, `${name}: leaked`);
  }
});

test('a lone value (`<style>${css}</style>`) unchanged is not written again; a changed one is, closed', () => {
  const host = document.createElement('div');
  const shape = literal(['<style>', '</style>']);
  renderInto(core.html(shape, 'a{}'), host);
  const style = host.querySelector('style');
  const first = style.firstChild;
  renderInto(core.html(shape, 'a{}'), host);
  assert.equal(style.firstChild, first, 'an unchanged lone value was written again');
  renderInto(core.html(shape, 'b{}</style>'), host);
  assert.equal(style.textContent, 'b{}<\\/style>');
  renderInto(core.html(shape, null), host);
  assert.equal(style.textContent, '', 'null writes nothing');
});

/**
 * **A template in an HTML `<title>` or `<textarea>`: placed, as always, and said in DEVELOPMENT only** (Brian,
 * 2026-11-18: nothing unsafe happens, so production carries nothing). Said once per element name, not per list item.
 */
test('a template in a <textarea> or <title> renders its elements, and development says so once (template-in-text); production says nothing', () => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    for (const draw of [
      () => core.html`<textarea>${core.html`<b>x</b>`}</textarea>`,
      () => core.html`<textarea>${[core.html`<i>a</i>`, core.html`<i>b</i>`]}</textarea>`,
      () => core.html`<title>${core.html`<b>t</b>`}</title>`,
    ]) {
      const host = document.createElement('div');
      renderInto(draw(), host);
      assert.ok(host.querySelector('textarea b, textarea i, title b'), 'placed, as it always has been');
    }
  } finally {
    console.warn = warn;
  }
  const lines = said.filter((line) => /template-in-text/.test(line));
  if (isProduction) assert.deepEqual(lines, [], 'production says nothing');
  else assert.equal(lines.length, 2, `once per element name (textarea, title): ${lines.join(' | ')}`);
});

/**
 * **The recorded server/client difference: the server REFUSES a template in an HTML `<title>`/`<textarea>`** (Brian,
 * 2026-11-19: kept, documented in the renderer's and `@verajs/ssr`'s READMEs). The client places it (above); the server
 * cannot write elements a browser would keep there — it reads that content back as text — and such a template is a
 * mistake either way. Pinned so a change to either side is a decision, not drift. The control: a string there serves.
 */
test('the server refuses a template in a <textarea> or <title> (ssr-template-in-text) where the client places it; a string serves', () => {
  const out = JSON.parse(execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', `
import { serializeTemplate } from '@verajs/ssr';
const literal = (p) => Object.assign([...p], { raw: [...p] });
const t = (s, ...v) => ({ strings: literal(s), values: v });
const run = (f) => { try { return { html: f() }; } catch (e) { return { error: String(e.message) }; } };
process.stdout.write(JSON.stringify({
  textarea: run(() => serializeTemplate(t(['<textarea>', '</textarea>'], t(['<b>x</b>'])))),
  title: run(() => serializeTemplate(t(['<title>', '</title>'], t(['<b>t</b>'])))),
  control: run(() => serializeTemplate(t(['<textarea>', '</textarea>'], 'a<b'))),
}));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env }));
  /** The server's own textarea bytes: a leading newline (the parser drops one) and `<` as a reference. */
  assert.match(String(out.control.html), /^<textarea>\n?a&(?:lt|#60);b<\/textarea>$/, `CONTROL: a string serves: ${JSON.stringify(out.control)}`);
  for (const key of ['textarea', 'title']) assert.match(String(out[key].error), /ssr-template-in-text/, `${key}: ${JSON.stringify(out[key])}`);
});
