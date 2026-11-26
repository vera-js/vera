/**
 * **Named character references in the server DOM: six built in, the HTML Standard's whole table wired**
 * (`@verajs/ssr/named-references`). The parser answers `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;` and every
 * numeric reference itself, and asks the `'reference'` chain for any other name; with nothing wired such a name reads
 * back as written and a name written with its `;` is said once. The rows run in order in one process (`node --test`
 * gives each file its own): unwired first, then the wire, then what the module reads. `String.prototype.split` is
 * wrapped before anything loads, so the file counts how often the table's string was split into a Map.
 *
 * jsdom is used only as a parser of its own (`new JSDOM`), never as the process's globals, which `@verajs/ssr` owns: it
 * is the independent reader the full-table row compares against (parse5's table, not this package's).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { printed } from './console-args.mjs';
import { spawnSync } from 'node:child_process';

const { ENTITIES } = await import('../packages/ssr/dist/vera/entities.js');
assert.ok(ENTITIES.length > 20_000, `CONTROL: the table's string was read (${ENTITIES.length} characters)`);
let built = 0;
const split = String.prototype.split;
String.prototype.split = function (...args) {
  if (this === ENTITIES || (typeof this === 'object' && String(this) === ENTITIES)) built++;
  return split.apply(this, args);
};
const { decode, decodeAttribute } = await import('../packages/ssr/dist/vera/parse.js');
const { serializeTemplate } = await import('@verajs/ssr');
const { wire } = await import('@verajs/core');

/** Every `ssr-named-reference-unwired` warning `run` printed, by the name it names. */
const heard = (run) => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => {
    const text = printed(args).join(' ');
    if (text.includes('(ssr-named-reference-unwired)')) said.push(text.match(/parsed (&[A-Za-z0-9;]+)/)?.[1]);
    else warn(...args);
  };
  try {
    run();
  } finally {
    console.warn = warn;
  }
  return said;
};

/** A literal's strings: frozen, with an own `raw`, ONE array per template, so it compiles once. */
const literal = (strings) => Object.freeze(Object.assign([...strings], { raw: [...strings] }));
/** The same markup as two templates (two literals are two templates): one rendered before the wire, one after. */
const BEFORE = literal(['<input .value="&hellip;', '">']);
const AFTER = literal(['<input .value="&hellip;', '"> ']);
const input = (strings) => serializeTemplate({ _$litType$: 1, strings, values: ['x'] });

const parsed = (markup) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host.firstChild;
};

test('unwired: the six and numeric references decode; any other name reads back as written, said once per name written with its `;`', () => {
  let p;
  const said = heard(() => {
    p = parsed('<p title="a&amp;b &copy;">x &lt; y &gt; z &apos;s&nbsp;&#169;&#xA9; &hellip;&hellip; &mdash; AT&T ?a=1&b=2 &copy</p>');
    parsed('<p>&hellip; &copy;</p>');
  });
  assert.equal(p.textContent, "x < y > z 's ©© &hellip;&hellip; &mdash; AT&T ?a=1&b=2 &copy", 'CONTROL: the six and numeric forms decoded, the rest as written');
  assert.equal(p.getAttribute('title'), 'a&b &copy;');
  assert.deepEqual(said, ['&copy;', '&hellip;', '&mdash;'], 'each name with its `;` once, in the order met; never `&T`, `&b` or `&copy`');
  assert.equal(built, 0, 'the table was built on a server that never wired it');
});

test('a parse with no server connected (the parser alone, no `@verajs/ssr`) reads a name as written and throws nothing', () => {
  /** Its own process: here the server is connected before any row runs. */
  const parse = new URL('../packages/ssr/dist/vera/parse.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `const { decode, decodeAttribute } = await import(${JSON.stringify(parse)}); console.log(JSON.stringify([decode('a&hellip;b &amp; &#169;'), decodeAttribute('&copy;&ampx=1')]));`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['a&hellip;b & ©', '&copy;&ampx=1'], 'CONTROL: the six and numeric forms decoded, the rest as written');
  assert.equal(child.stderr, '', 'nothing is said without a server');
});

test('unwired: a template rendered before the wire is compiled with the name as written', () => {
  const said = heard(() => assert.equal(input(BEFORE), '<input value="&#38;hellip;x">'));
  assert.deepEqual(said, [], '`&hellip;` was already said once by the row before');
});

test('unwired: a bound <select> reads its options with the server DOM\'s decoder, `&nbsp;` included', () => {
  const ROW = literal(['<select .value=', '><option value="a">a</option><option value="a&nbsp;b">c</option></select>']);
  assert.equal(
    serializeTemplate({ _$litType$: 1, strings: ROW, values: ['a b'] }),
    '<select><option value="a">a</option><option value="a&nbsp;b" selected>c</option></select>'
  );
});

test('wired: the table is built once, when the module loads; a name outside the six decodes, and nothing is said', async () => {
  const { namedReferences } = await import('@verajs/ssr/named-references');
  assert.equal(built, 1, 'CONTROL: importing the module builds the table');
  wire([namedReferences]);
  let p;
  const said = heard(() => (p = parsed('<p title="&copy;&ampx=1">a&hellip;b &notin c&amp;d AT&T</p>')));
  assert.equal(p.textContent, 'a…b ¬in c&d AT&T');
  assert.equal(p.getAttribute('title'), '©&ampx=1');
  assert.deepEqual(said, []);
  assert.equal(decode('&hellip; &mdash;'), '… —');
  assert.equal(built, 1, 'the table is built once, not per reference');
});

test('wired: a template compiled before the wire keeps the name as written; one compiled after decodes it', () => {
  assert.equal(input(BEFORE), '<input value="&#38;hellip;x">', 'the compiled template is kept, as the warning and the README say');
  assert.equal(input(AFTER), '<input value="…x"> ', 'CONTROL: the same markup compiled after the wire decodes');
});

test('wired: a bound <select> matches an option written with any name', () => {
  const ROW = literal(['<select .value="&hellip;', '"><option value="a">a</option><option value="&hellip;b">c</option></select>']);
  assert.equal(
    serializeTemplate({ _$litType$: 1, strings: ROW, values: ['b'] }),
    '<select><option value="a">a</option><option value="&hellip;b" selected>c</option></select>'
  );
});

test('wired: the longest name wins, counting the `;`, and the rest of the run stays text', () => {
  assert.equal(decode('&notin;'), '∉');
  assert.equal(decode('&notin'), '¬in');
  assert.equal(decode('&notit;'), '¬it;');
  assert.equal(decode('&amp'), '&');
  assert.equal(decode('&ampere'), '&ere');
  assert.equal(decode('&CounterClockwiseContourIntegral;'), '∳');
  assert.equal(decode('&unknown; &'), '&unknown; &');
});

test('wired: in an attribute value a legacy name before `=` or a letter or digit is no reference; before anything else it is', () => {
  assert.equal(decodeAttribute('?a=1&ampx=2'), '?a=1&ampx=2');
  assert.equal(decodeAttribute('&amp=1'), '&amp=1');
  assert.equal(decodeAttribute('&amp1'), '&amp1');
  assert.equal(decodeAttribute('&amp b'), '& b');
  assert.equal(decodeAttribute('&amp;x=1'), '&x=1');
  assert.equal(decodeAttribute('&notin'), '&notin', 'a shorter legacy name followed by a letter stays as written');
  assert.equal(decode('&ampx=2'), '&x=2', 'CONTROL: in text the same run decodes');
});

test('wired: a run past the longest name is tried at most that long, and stays text when no prefix is a name', () => {
  assert.equal(decode('&CounterClockwiseContourIntegralX;'), '&CounterClockwiseContourIntegralX;');
  const long = `&${'q'.repeat(200_000)};`;
  const started = performance.now();
  assert.equal(decode(long), long);
  /** A slice per possible length would be quadratic: 200,000 letters took seconds that way, under a millisecond capped. */
  assert.ok(performance.now() - started < 200, 'a long run was not capped');
});

test("wired: a name `Object.prototype` holds is no reference, in text and in an attribute value", () => {
  const names = '&constructor; &valueOf; &hasOwnProperty; &toString; &__proto__; &constructor';
  assert.equal(decode(names), names, 'decode read a prototype name as a reference');
  assert.equal(decodeAttribute(names), names, 'decode read a prototype name as a reference in an attribute value');
  assert.equal(decode('&amp;'), '&', 'CONTROL: a real name still decodes');
  const p = parsed(`<p title="x${names}">${names}</p>`);
  assert.equal(p.textContent, names, 'parsed text read a prototype name as a reference');
  assert.equal(p.getAttribute('title'), `x${names}`, 'a parsed attribute read a prototype name as a reference');
});

/**
 * **Every name of the table, read as jsdom's parser reads it**, in text and in an attribute value, each followed by a
 * space, a letter and `=`: the three contexts the legacy-name rules tell apart. One element per name and context.
 */
test('wired: every name of the table, in text and in an attribute value, reads as an independent parser reads it', () => {
  const names = ENTITIES.split(',').map((entry) => entry.slice(0, entry.indexOf(':')));
  assert.equal(names.length, 2231, `the table holds ${names.length} names`);
  const tails = [' ', 'x', '='];
  let markup = '';
  for (const name of names) for (const tail of tails) markup += `<p title="&${name}${tail}">&${name}${tail}</p>`;
  const host = document.createElement('div');
  host.innerHTML = markup;
  const theirs = new JSDOM(`<!doctype html><body>${markup}</body>`).window.document.body.children;
  const ours = host.children;
  assert.equal(ours.length, names.length * tails.length, 'every element parsed');
  assert.equal(theirs.length, ours.length);
  const hellip = names.indexOf('hellip;') * tails.length;
  assert.equal(ours[hellip].textContent, '… ', 'CONTROL: `&hellip;` decoded here');
  assert.equal(theirs[hellip].textContent, '… ', 'CONTROL: and in jsdom');
  const wrong = [];
  for (let i = 0; i < ours.length; i++) {
    const at = `&${names[Math.floor(i / tails.length)]}${tails[i % tails.length]}`;
    if (ours[i].textContent !== theirs[i].textContent) wrong.push(`text ${JSON.stringify(at)}: ${JSON.stringify(ours[i].textContent)} vs ${JSON.stringify(theirs[i].textContent)}`);
    if (ours[i].getAttribute('title') !== theirs[i].getAttribute('title'))
      wrong.push(`attribute ${JSON.stringify(at)}: ${JSON.stringify(ours[i].getAttribute('title'))} vs ${JSON.stringify(theirs[i].getAttribute('title'))}`);
  }
  assert.deepEqual(wrong.slice(0, 10), [], `${wrong.length} readings disagree with jsdom`);
});
