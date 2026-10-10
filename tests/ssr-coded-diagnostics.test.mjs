/**
 * **@verajs/ssr on codes** (code-system phase 4c, vera-5a's conditions, 2026-10-09).
 *
 * 1. Its formatters and its TWINS are shared-utils', word for word — compared as GENERATED text for the same
 *    arguments, never as source: `ssrMisuse`/`ssrWarning` against `misuse('ssr', …)`/`diagnostic('ssr', …)` in
 *    development, each twin against SHARED's entry of the same name.
 * 2. Every warning is said once per process per key — a server renders per request: the same component twice is one
 *    line, a second component is a second line.
 * 3. Text from outside never reaches a line raw: a refused `javascript:` URL is not printed at all, and a thrown
 *    message holding a forged log line and an ANSI erase arrives JSON-quoted.
 * 4. The `base` bound refuses by BEHAVIOR: the module outside it is never imported.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@verajs/ssr';
import { PROSE, TWINS } from '../packages/ssr/dist/vera/diagnostics.js';
import { ssrMisuse, ssrWarning, quoted, own, isOwn } from '../packages/ssr/dist/vera/report.js';
/** shared-utils' DEVELOPMENT build — the one where misuse()/diagnostic() carry prose (`__DEV__` true). */
import { SHARED, misuse, diagnostic, quoted as sharedQuoted, own as sharedOwn, isOwn as sharedIsOwn } from '../packages/shared-utils/dist/development/vera-shared-utils.js';

const MODULE = new URL('./fixtures/ssr/coded-ssr.js', import.meta.url);

/** The warnings one render prints. */
const warned = async (tag, options = {}) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    const result = await renderToString(MODULE, { tag, ...options });
    return { said, html: result.html };
  } finally {
    console.warn = warn;
  }
};

test("ssr's formatters say exactly what shared-utils' say in development", () => {
  const prose = ['a sentence.', 'Its fix.'];
  assert.equal(ssrMisuse('ssr-x', prose), misuse('ssr', 'ssr-x', prose));
  assert.equal(ssrWarning('<p-x>', 'ssr-x', prose), diagnostic('ssr', '<p-x>', 'ssr-x', prose));
  assert.equal(ssrMisuse('ssr-x', ['alone.']), misuse('ssr', 'ssr-x', ['alone.']), 'and with no fix');
  for (const text of ['plain', 'a\n[vera] fake\x1b[2K', 'x'.repeat(200)]) {
    assert.equal(quoted(text), sharedQuoted(text), 'quoted() is the twin of shared-utils\'');
    assert.equal(quoted(text, Infinity), sharedQuoted(text, Infinity), 'and so is its no-truncate mode');
  }
  /** own()/isOwn(): the same behavior on both sides (each keeps its own set, as each package's errors are its own). */
  for (const [mark, has] of [[own, isOwn], [sharedOwn, sharedIsOwn]]) {
    const error = new Error('x');
    assert.equal(mark(error), error, 'own() returns the error it marks');
    assert.equal(has(error), true);
    assert.equal(has(new Error('y')), false, 'an unmarked error is foreign');
    assert.equal(has(null), false);
    assert.equal(has('a string'), false);
  }
});

test('every TWIN generates its SHARED fact word for word, and none is one of ssr\'s own codes', () => {
  const names = Object.keys(TWINS);
  assert.ok(names.length >= 5, `CONTROL: ${names.length} twins`);
  const codeOf = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const name of names) {
    assert.equal(typeof SHARED[name], 'function', `${name} is a shared-utils fact`);
    const args = ['first', 'second'];
    assert.deepEqual([...TWINS[name](...args)], [...SHARED[name](...args)], `${name}: the same text for the same arguments`);
    assert.ok(!(codeOf(name) in PROSE), `${codeOf(name)} is shared-utils' code, never published as ssr's`);
  }
});

/** [code, first, the same key again, a second key, the subject the first names, options] */
for (const [code, one, same, two, subject, options] of [
  ['script-url', 'url-one', 'url-one', 'url-two', 'url-one', { attributes: { 'data-href': 'javascript:alert(1)\n[vera] fake\x1b[2K' } }],
  ['forged-template', 'forged-one', 'forged-one', 'forged-two', 'forged-one', {}],
  /** Keyed on the BOUND element's class and property: another component binding the same one is the same fact. */
  ['getter-only-prop', 'getter-one', 'getter-again', 'getter-two', 'getter-only', {}],
])
  test(`${code}: said once per process per key — the same key twice is one line, a second key a second`, async () => {
    const first = await warned(one, options);
    const lines = first.said.filter((line) => line.endsWith(`(${code})`));
    assert.equal(lines.length, 1, `CONTROL: the first render says it — ${first.said.join(' | ')}`);
    assert.ok(lines[0].startsWith(`[vera] ssr: <${subject}> — `), lines[0]);
    const again = await warned(same, options);
    assert.deepEqual(again.said.filter((line) => line.includes(code)), [], 'the same component again is silent');
    const other = await warned(two, options);
    assert.equal(other.said.filter((line) => line.endsWith(`(${code})`)).length, 1, 'a second component is a second line');
  });

test('a refused javascript: URL: the attribute is removed, and the value — attacker-shaped — is never printed', async () => {
  const href = 'javascript:alert(1)\n[vera] fake\x1b[2K';
  const { html, said } = await warned('url-two', { attributes: { 'data-href': href } });
  assert.match(html, /<a>x<\/a>/, `the link renders without its href: ${html}`);
  for (const line of said) {
    assert.ok(!line.includes('\n[vera] fake'), 'no forged log line');
    assert.ok(!line.includes('\x1b'), 'no ANSI sequence');
    assert.ok(!line.includes('alert(1)'), 'and not the value at all');
  }
});

test('a thrown message from outside arrives JSON-quoted: no forged line, no ANSI sequence', async () => {
  await assert.rejects(renderToString(MODULE, { tag: 'throws-text', props: { item: 'v' } }), (error) => {
    assert.ok(error.message.endsWith('(ssr-prop-refused)'), error.message);
    assert.ok(error.message.includes(quoted('bad v\n[vera] fake\x1b[2K')), `quoted: ${error.message}`);
    assert.ok(!error.message.includes('\n') && !error.message.includes('\x1b'), 'nothing raw');
    assert.ok(error.cause instanceof Error, "the component's own error is the cause");
    return true;
  });
});

test('the base bound refuses by BEHAVIOR: the module outside it is never imported', async () => {
  const outside = new URL('./fixtures/ssr/outside/imported-ssr.js', import.meta.url);
  const base = new URL('./fixtures/ssr/coded/', import.meta.url);
  delete globalThis.__veraOutsideImported;
  await assert.rejects(renderToString(outside, { base }), /resolves outside[\s\S]*\(ssr-url-refused\)$/);
  assert.equal(globalThis.__veraOutsideImported, undefined, 'nothing was imported');
  /** CONTROL: the same module, inside its own base, IS imported — so the silence above means refused. */
  await renderToString(outside, { base: new URL('./fixtures/ssr/outside/', import.meta.url) }).catch(() => {});
  assert.equal(globalThis.__veraOutsideImported, true, 'CONTROL: inside the bound it runs');
});

test('every code ssr raises has its entry, and every entry is raised', async () => {
  const { readFileSync, globSync } = await import('node:fs');
  const root = fileURLToPath(new URL('../packages/ssr/src/vera/', import.meta.url));
  const raised = new Set();
  for (const file of globSync('*.ts', { cwd: root })) {
    const text = readFileSync(root + file, 'utf8');
    for (const [, code] of text.matchAll(/(?:ssrMisuse|ssrWarning)\([^;]*?'([a-z][a-z0-9-]*)',\s*PROSE\['\1'\]/g)) raised.add(code);
  }
  assert.ok(raised.size >= 15, `CONTROL: ${raised.size} raised`);
  assert.deepEqual([...raised].sort(), Object.keys(PROSE).sort());
});
