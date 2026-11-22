/**
 * **The server reads markup with HTML's whitespace — tab, line feed, form feed, carriage return and space — never
 * JavaScript's** (2026-11-22). `\s` and `trim` also take U+000B, U+00A0 and the other Unicode spaces, which a browser's
 * tokenizer reads as NAME and unquoted-VALUE characters. A rotated fuzz seed found the cost: in
 * `<textarea onClick="${a}"=${b}` + U+000B + `=${c}x">`, the server read `=`, a space and `="…"` and quoted the value, where a
 * browser reads one unquoted value that ends at the payload's first space, so the rest became attributes. And
 * `<script type` + U+000B + `="application/json">` was judged a JSON block, where a browser sees no `type` at all and runs
 * the script, so a value reached code.
 *
 * Two guards: every markup-reading file of the server is held to zero `\s`, `\S` and `trim` outside a short list of
 * reasoned exceptions; and the found templates, with U+000B and with U+00A0, are rows whose served page, parsed as a
 * browser parses it, holds nothing the value made.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';

const FILES = ['serializer.ts', 'escaping.ts', 'parse.ts', 'scan.ts', 'tokenizer.ts'];
const JS_SPACE = /\\s|\\S|\.trim(?:Start|End)?\(/;
/** Every JS-whitespace test on a code line (comment lines skipped), as `file: line`. */
const jsSpaceIn = (file, source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(?:\*|\/\*\*|\/\/)/.test(line))
    .filter((line) => JS_SPACE.test(line))
    .map((line) => `${file}: ${line.trim()}`);

/**
 * The exceptions, each with its reason. `UNSAFE_ATTRIBUTE_NAME` refuses a name holding any space, `\s` included: it errs
 * toward refusing, and it is held equal to spread's client twin. `JSON_BLOCK`'s trailing `\s*` reads a `type` VALUE: a
 * type ending in U+000B is no JavaScript type, so a browser never runs that script either way.
 */
const EXCEPTIONS = [
  'serializer.ts: export const UNSAFE_ATTRIBUTE_NAME = /^$|[\\s"\'>/=<`]|[\\u0000-\\u001f\\u007f]/;',
  'escaping.ts: export const JSON_BLOCK = /json\\s*$/i;',
];

test('the matcher finds `\\s`, `\\S` and trim on a code line and skips a comment (CONTROL)', () => {
  assert.deepEqual(jsSpaceIn('a.ts', 'const a = /\\s+/;\nconst b = x.trim();\n * a comment with \\s\nconst c = /[^\\S]/;'), [
    'a.ts: const a = /\\s+/;',
    'a.ts: const b = x.trim();',
    'a.ts: const c = /[^\\S]/;',
  ]);
});

test("the server's markup-reading files test whitespace as HTML does, outside the listed exceptions", () => {
  const found = FILES.flatMap((file) => {
    const source = readFileSync(new URL(`../packages/ssr/src/vera/${file}`, import.meta.url), 'utf8');
    assert.ok(source.length > 1000, `CONTROL: ${file} was read`);
    return jsSpaceIn(file, source);
  });
  assert.deepEqual(found, EXCEPTIONS);
});

const PAYLOAD = '--></style></script></textarea></title></xmp></noscript>"\'><img id=pwn> pwn=1 x=x"';
const injected = (node) =>
  (node.childNodes ?? []).some(
    (child) =>
      (child.attrs ?? []).some((a) => (a.name === 'id' && a.value === 'pwn') || a.name === 'pwn') ||
      injected(child) ||
      (child.content !== undefined && injected(child.content))
  );
const strings = (list) => Object.assign([...list], { raw: [...list] });
/** The served page, or `refused` when the server refuses the template, as it may. */
const serve = (list, ...values) => {
  try {
    return serializeTemplate({ _$litType$: 1, strings: strings(list), values });
  } catch {
    return 'refused';
  }
};

test('a template holding U+000B or U+00A0 in a tag serves nothing a value made (the found fuzz cases)', () => {
  for (const space of ['\u000b', '\u00a0']) {
    for (const list of [
      ['<textarea onClick="', `"=`, `${space}=`, 'x">t</textarea>'],
      ['<input &ref=', '\f=', `${space}=`, '&amp;>t</input>'],
      [`<p title=x${space}`, `=1 class=`, '>t</p>'],
    ]) {
      const page = serve(list, 'a', 'b', PAYLOAD);
      assert.ok(!injected(parse(`<!doctype html><body>${page}`, { scriptingEnabled: true })), `${JSON.stringify(list)} -> ${JSON.stringify(page)}`);
    }
  }
});

test('a script whose `type` name is followed by U+000B is no JSON block: a value there is refused', () => {
  assert.equal(serve(['<script type\u000b="application/json">', '</script>'], 'alert(1)'), 'refused');
  assert.equal(serve(['<script type="application/json">', '</script>'], '{"a":1}'), '<script type="application/json">{"a":1}</script>', 'CONTROL: a JSON block takes its value');
});

test('CONTROL: the same payload in ordinary positions is served, and inert', () => {
  const page = serve(['<p title="', '" class=', '>', '</p>'], PAYLOAD, PAYLOAD, PAYLOAD);
  assert.notEqual(page, 'refused');
  const tree = parse(`<!doctype html><body>${page}`, { scriptingEnabled: true });
  assert.ok(!injected(tree), page);
  assert.ok(page.includes('title="'), 'the value was written');
});

/**
 * The static attribute names a duplicate check reads (`recordNames`) are read by a character loop that replaced a
 * pattern; the two are held equal here on the edges and on a seeded corpus, both in the order found. The pattern is the
 * one it replaced, with HTML's five spaces: a space, then a letter and `[\w:-]*`, followed by `=`, `>`, a space or the end.
 */
test('the static-name loop finds what the pattern it replaced finds, in order, on edges and a seeded corpus', async () => {
  const { recordNames } = await import('../packages/ssr/dist/vera/serializer.js');
  const PATTERN = /[\t\n\f\r ]([a-zA-Z][\w:-]*)(?==|[\t\n\f\r >]|$)/g;
  const byPattern = (text) => [...new Set([...text.matchAll(PATTERN)].map((m) => m[1].toLowerCase()))];
  const byLoop = (text) => {
    const into = new Set();
    recordNames(text, into);
    return [...into];
  };
  const EDGES = [
    '<b hidden', '<b hidden>', '<b a=1 B=2', '<b x:y=1 a_b-c9 z>', '<b\ta\nb\fc\rd e', '<b a"', '<b a/', '<b 9a 1 -a _a', '<b a\u000bb=1',
    '<b a b=1', ' a', ' ', '', 'a b', ' a  b ', ' A:B', ' a=', ' a>', ' a<', ' Ab ab AB', '<b  ', ' a-', ' a:',
  ];
  let seed = 20261122;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ALPHABET = ['a', 'Z', 'q', '0', '9', ':', '_', '-', '=', '>', '"', '/', '<', ' ', ' ', '\t', '\n', '\f', '\r', '\u000b', ' '];
  const corpus = Array.from({ length: 400 }, () => Array.from({ length: Math.floor(random() * 30) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join(''));
  let names = 0;
  for (const text of [...EDGES, ...corpus]) {
    const expected = byPattern(text);
    names += expected.length;
    assert.deepEqual(byLoop(text), expected, JSON.stringify(text));
  }
  assert.equal(names, 160, 'CONTROL: the seeded corpus holds exactly the names it held when written (2026-11-22)');
  assert.deepEqual(byLoop('<b x:y=1 a_b-c9 z>'), ['x:y', 'a_b-c9', 'z'], 'CONTROL: a known string');
});
