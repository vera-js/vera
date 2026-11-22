/**
 * **The client reads template markup with HTML's whitespace — tab, line feed, form feed, carriage return and space —
 * never JavaScript's** (2026-11-22), as the server does (`ssr-html-whitespace.test.mjs`). `\s` also takes U+000B, U+00A0
 * and the other Unicode spaces, which a browser's tokenizer reads as NAME and unquoted-VALUE characters. Values reach the
 * DOM through its API on the client, so this is parity, not an injection: the development scan accepted a hole touching
 * U+000B or U+00A0 inside an attribute name (`<p ${…}` + U+000B + `=y>`) that the server refuses, and the production
 * scanner split names and tag names where a browser does not.
 *
 * Two guards: every markup-reading client file is held to zero `\s`, `\S` and `trim` outside a short list of reasoned
 * exceptions; and a hole that U+000B or U+00A0 joins to an attribute name is refused by the client's development scan
 * exactly as by the server, in every build there. Production does not scan for name holes (development refuses them,
 * the check cost 101 B): there such a hole renders as an ordinary name hole does — measured on these shapes, its value
 * is written nowhere, and the only residue is an attribute whose name is the renderer's marker, as for any name hole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const FILES = [
  'renderer/src/renderer.ts',
  'renderer/src/namespaces.ts',
  'lite/src/markup.ts',
  'lite/src/patch.ts',
  'static/src/render.ts',
  'shared-utils/src/markup-grammar.ts',
];
const JS_SPACE = /\\s|\\S|\.trim(?:Start|End)?\(/;
/** Every JS-whitespace test on a code line (comment lines skipped), as `file: line`. */
const jsSpaceIn = (file, source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(?:\*|\/\*\*|\/\/)/.test(line))
    .filter((line) => JS_SPACE.test(line))
    .map((line) => `${file}: ${line.trim()}`);

/**
 * The exceptions, each with its reason. `[\s\S]` is "any character" (a comment's body), not a whitespace test.
 * `JSON_BLOCK`'s trailing `\s*` reads a `type` VALUE — a type ending in U+000B is no JavaScript type, so a browser never
 * runs that script either way — and it is the server's own exception, word for word.
 */
const EXCEPTIONS = [
  "renderer/src/namespaces.ts: const tag = /<([a-zA-Z][^\\t\\n\\f\\r />]*)/.exec(result.strings.join('').replace(/<!--(?:-?>|[\\s\\S]*?--!?>)/g, ''))?.[1] ?? 'x';",
  'shared-utils/src/markup-grammar.ts: export const JSON_BLOCK = /json\\s*$/i;',
];
/** `[\s\S]` in the renderer's development shape scan: the line is long, so it is matched by its start. */
const SHAPE_LINE = 'renderer/src/renderer.ts: const SHAPE = /<!--(?:-?>|[\\s\\S]*?(?:--!?>|$))|<(\\/?)([a-zA-Z][^\\t\\n\\f\\r />]*)';

test('the matcher finds `\\s`, `\\S` and trim on a code line and skips a comment (CONTROL)', () => {
  assert.deepEqual(jsSpaceIn('a.ts', 'const a = /\\s+/;\nconst b = x.trim();\n * a comment with \\s\nconst c = /[^\\S]/;\nconst d = y.trimEnd();'), [
    'a.ts: const a = /\\s+/;',
    'a.ts: const b = x.trim();',
    'a.ts: const c = /[^\\S]/;',
    'a.ts: const d = y.trimEnd();',
  ]);
});

test("the client's markup-reading files test whitespace as HTML does, outside the listed exceptions", () => {
  const found = FILES.flatMap((file) => {
    const source = readFileSync(new URL(`../packages/${file}`, import.meta.url), 'utf8');
    assert.ok(source.length > 2000, `CONTROL: ${file} was read`);
    return jsSpaceIn(file, source);
  });
  const shape = found.filter((line) => line.startsWith(SHAPE_LINE));
  assert.equal(shape.length, 1, `the shape scan's any-character class, once: ${JSON.stringify(found)}`);
  assert.deepEqual(found.filter((line) => !line.startsWith(SHAPE_LINE)), EXCEPTIONS);
});

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
core.wire([renderer]);

const strings = (list) => Object.assign([...list], { raw: [...list] });
/** The code a refusal carries, or `null` when the template renders. */
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return /\(([a-z-]+)\)/.exec(String(error?.message))?.[1] ?? `threw: ${error?.message}`;
  }
};
/** Development refuses these shapes; production writes the value nowhere (the row below, every shape, both characters). */
const CHARS = { VT: '\u000b', NBSP: '\u00a0' };
/** A hole that the character joins to an attribute name: after the hole, and before it. */
const NAME_HOLES = (C) => [
  ['<p ', `${C}=y>t</p>`],
  ['<p ', `${C}title=y>t</p>`],
  [`<p a${C}`, '=y>t</p>'],
  [`<p data-x${C}`, '>t</p>'],
];

test('CONTROL: a value hole beside U+000B and U+00A0 in a static value renders on the client', () => {
  for (const C of Object.values(CHARS)) {
    const root = document.createElement('div');
    renderInto(core.html(strings([`<p data-a="x${C}y" title=`, '>t</p>']), 'v'), root);
    assert.equal(root.querySelector('p').getAttribute('title'), 'v');
    assert.equal(root.querySelector('p').getAttribute('data-a'), `x${C}y`);
  }
});

test('production: a hole joined to an attribute name by U+000B or U+00A0 writes its value nowhere', () => {
  let rows = 0;
  for (const [cname, C] of Object.entries(CHARS))
    for (const list of [...NAME_HOLES(C), [`<div a${C}`, '>t</div>']]) {
      const root = document.createElement('div');
      const code = codeOf(() => renderInto(core.html(strings(list), 'zq9'), root));
      if (isProduction) assert.equal(code, null, `${cname} ${JSON.stringify(list)}: production renders it`);
      assert.ok(!root.innerHTML.includes('zq9'), `${cname} ${JSON.stringify(list)}: the value is written nowhere (${root.innerHTML})`);
      rows++;
    }
  assert.equal(rows, 10);
  const control = document.createElement('div');
  renderInto(core.html(strings(['<p title=', '>t</p>']), 'zq9'), control);
  assert.ok(control.innerHTML.includes('zq9'), 'CONTROL: a value hole writes its value, and this check sees it');
});

test('a hole joined to an attribute name by U+000B or U+00A0 is refused by the client (development) as by the server', async () => {
  let rows = 0;
  for (const [cname, C] of Object.entries(CHARS)) {
    for (const list of NAME_HOLES(C)) {
      const label = `${cname} ${JSON.stringify(list)}`;
      const client = codeOf(() => renderInto(core.html(strings(list), 'v'), document.createElement('div')));
      if (!isProduction) assert.equal(client, 'name-expression', `${label}: the client's development scan`);
      rows++;
    }
  }
  assert.equal(rows, 8);
  /** Last, and imported here: the server installs its own DOM globals over jsdom's. */
  const { serializeTemplate } = await import('@verajs/ssr');
  for (const [cname, C] of Object.entries(CHARS))
    for (const list of NAME_HOLES(C))
      assert.equal(codeOf(() => serializeTemplate({ _$litType$: 1, strings: strings(list), values: ['v'] })), 'name-expression', `${cname} ${JSON.stringify(list)}: the server`);
  assert.equal(codeOf(() => serializeTemplate({ _$litType$: 1, strings: strings(['<p title=', '>t</p>']), values: ['v'] })), null, 'CONTROL: a value hole is served');
});
