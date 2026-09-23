/**
 * HTML's element grammar has more than one home in this repo, and this is what stops them drifting.
 *
 * `@verajs/shared-utils` owns the canonical sets. Two packages cannot import them and keep copies
 * for reasons that are architectural rather than lazy:
 *
 * - **`@verajs/ssr`** publishes its `src` with NO dependencies at all, so importing a package that
 *   is never published would break the published tarball. (The `escapeStyleText` twin is there for
 *   the same reason, pinned the same way.)
 * - **`@verajs/renderer`** keeps a REGEX, because an imported `new Set([...])` survives the
 *   production build — neither rollup nor terser can prove the constructor is side-effect-free —
 *   and it measured **62 B gzipped on the base bundle** for a diagnostic production never runs.
 *
 * So the rule this suite enforces is the one the audit of 2026-09-12 settled on: *one source if the
 * architecture permits it, otherwise N copies and a differential that drives every one — never N
 * copies and a promise.*
 *
 * **The spec is stated HERE and imported from nothing.** A suite that reads its expectation out of
 * one of the homes it is comparing pins only that the others match whichever home it happened to
 * read. The companion browser suite asks three real ENGINES the same question, which is the only
 * check that can catch every home in this repo agreeing and all of them being wrong.
 *
 * Development-only: the renderer half drives a `__DEV__` diagnostic that production folds away.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** THE SPEC. HTML's void elements — the complete set, stated as this suite's own expectation. */
const VOID = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
];

/** THE SPEC. Elements a parser reads the children of as text. See the canonical file for why
 *  `iframe` and `noscript` are here and why jsdom is not the oracle for either. */
const RAW_TEXT = ['style', 'script', 'textarea', 'title', 'iframe', 'noscript'];

/**
 * Every element HTML defines, so the checks below are over a UNIVERSE rather than over a handful
 * of names someone thought of. Completeness cannot be tested any other way: `document.createElement`
 * will answer whether a given name is void, but nothing enumerates the set, so a probe can only ask
 * about names it already holds. An element added to HTML after this list was written is the one gap,
 * and it is named here rather than left implicit.
 */
const ALL_ELEMENTS = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote',
  'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist',
  'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr',
  'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
  'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'u', 'ul', 'var', 'video', 'wbr',
];

test('the canonical home says exactly what the spec says', async () => {
  const { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } = await import('@verajs/shared-utils');
  assert.deepEqual([...VOID_ELEMENTS].sort(), [...VOID].sort(), 'VOID_ELEMENTS');
  assert.deepEqual([...RAW_TEXT_ELEMENTS].sort(), [...RAW_TEXT].sort(), 'RAW_TEXT_ELEMENTS');
});

/** The eight hyphenated names SVG and MathML define, reserved by the custom-elements spec. */
const RESERVED = [
  'annotation-xml', 'color-profile', 'font-face', 'font-face-src',
  'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph',
];

test('the reserved element names are the spec\'s eight, in the home and in ssr\'s copy', async () => {
  const { RESERVED_ELEMENT_NAMES } = await import('@verajs/shared-utils');
  assert.deepEqual([...RESERVED_ELEMENT_NAMES].sort(), [...RESERVED].sort(), 'RESERVED_ELEMENT_NAMES');
  const shim = read('packages/ssr/src/vera/shim.js');
  const copy = /const RESERVED_NAMES = new Set\(\[([^\]]*)\]\)/.exec(shim);
  assert.ok(copy, 'the ssr shim still spells its copy as a Set literal this suite can read');
  const names = [...copy[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), [...RESERVED].sort(), 'a name ssr treats as a custom element is one the client does not');
});

test("@verajs/ssr's copies agree — it cannot import, so this is what keeps them together", async () => {
  const { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } = await import('../packages/ssr/src/vera/escaping.js');
  assert.deepEqual([...VOID_ELEMENTS].sort(), [...VOID].sort(),
    'a void element ssr does not know gets an end tag it must not have, and the client reads that as a second element');
  assert.deepEqual([...RAW_TEXT_ELEMENTS].sort(), [...RAW_TEXT].sort(),
    'a raw-text element ssr does not know gets its content entity-escaped, which corrupts CSS and JS');
});

test("the renderer's regexes agree, read from its source", () => {
  const source = read('packages/renderer/src/renderer.ts');
  const voidTags = /const VOID_TAGS = \/\^\(\?:([a-z|]+)\)\$\/i;/.exec(source);
  assert.ok(voidTags, 'VOID_TAGS is still a single anchored alternation this suite can read');
  assert.deepEqual(voidTags[1].split('|').sort(), [...VOID].sort(), 'VOID_TAGS');

  const rawTags = /const RAW_TEXT_TAGS = \/\^\(\?:([a-z|]+)\)\$\/i;/.exec(source);
  assert.ok(rawTags, 'RAW_TEXT_TAGS is still a single anchored alternation');
  assert.deepEqual(rawTags[1].split('|').sort(), [...RAW_TEXT].sort(), 'RAW_TEXT_TAGS');
});

test('the consolidation held — no package that CAN import keeps a private copy', () => {
  for (const path of ['packages/cms/src/dom.ts', 'packages/jsx/src/transform.ts']) {
    const source = read(path);
    assert.doesNotMatch(source, /new Set\(\[\s*'area'/,
      `${path} must read the shared list, not re-state it`);
    /**
     * **Matched by CONTENT, not by the first name.** The VOID check above anchors on `'area'`, so a
     * private copy of a DIFFERENT shared list was invisible to it — `packages/jsx/src/transform.ts`
     * grew one of the raw-text names under this very suite, and drifted on case within the hour.
     * A re-statement is a `new Set` holding EVERY name of a shared list. Not "three or more": these
     * lists overlap legitimately — `SVG_WITH_SIBLING` names `title`, `style` and `script` because a
     * sibling can vouch for them, which has nothing to do with raw text — and a guard that cried
     * wolf there would be turned off.
     */
    /**
     * **Every bracketed literal, not `new Set([` alone.** The narrower pattern missed
     * `new Set<string>([…])` — the TypeScript spelling `transform.ts` itself already uses twice — as
     * well as a double-quoted copy and a plain array. A re-statement is a re-statement whatever
     * syntax carries it, and the CONTENT test below is specific enough that widening the net costs
     * nothing: it fires only on a literal holding EVERY name of a shared list.
     */
    const { literals, restated } = restatedLists(source);
    /** A file whose literals this never read would pass by examining nothing. */
    assert.ok(literals > 0, `${path} yielded no bracketed literals, so the content check read nothing`);
    assert.deepEqual(restated, [], `${path} re-states ${restated.join(', ')} — import it instead`);
  }
});

/**
 * The content check, as ONE function both tests call. The floor below used to carry its own copy of
 * this loop, so it proved the copy recognised every spelling while the real check could be narrowed
 * back to `new Set([` — the exact defect it was written against — and stay green.
 */
function restatedLists(source) {
  const literals = [...source.matchAll(/\[([^\][]*)\]/g)];
  const restated = [];
  for (const [name, shared] of [['VOID_ELEMENTS', VOID], ['RAW_TEXT_ELEMENTS', RAW_TEXT], ['RESERVED_ELEMENT_NAMES', RESERVED]])
    for (const [, body] of literals) {
      const named = new Set([...body.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]));
      if (shared.every((n) => named.has(n))) restated.push(name);
    }
  return { literals: literals.length, restated };
}

/**
 * The floor for the check above: it reads real files, so if the spellings it recognises ever stop
 * appearing there it would pass by matching nothing. These are synthetic sources, so the assertion is
 * about the PATTERN rather than about today's tree.
 */
test('and that content check recognises every spelling a copy could use', () => {
  const names = [...RAW_TEXT];
  const detects = (src) => restatedLists(src).restated.includes('RAW_TEXT_ELEMENTS');
  const list = (q) => names.map((n) => `${q}${n}${q}`).join(', ');
  for (const [label, src] of [
    ['a plain Set', `const A = new Set([${list("'")}]);`],
    ['a TYPED Set', `const A = new Set<string>([${list("'")}]);`],
    ['a double-quoted Set', `const A = new Set([${list('"')}]);`],
    ['a plain array', `const A = [${list("'")}];`],
    ['a readonly array', `const A = [${list("'")}] as const;`]
  ])
    assert.ok(detects(src), `a private copy written as ${label} must be caught`);
  /** And the negative control, or the pattern above would "detect" anything at all. */
  assert.ok(!detects(`const A = new Set(['title', 'style', 'script']);`), 'an overlapping SUBSET is not a copy');
  assert.ok(!detects('const A = [1, 2, 3];'), 'an unrelated literal is not a copy');
});

/**
 * The half that a source read cannot do: drive the renderer's OWN copy through its OWN consumer,
 * over every element HTML defines. A regex can agree with the spec name-for-name and still be
 * wrong — a dropped anchor, a stray alternation — and only the behaviour shows it.
 *
 * This is the shape the audit settled on after `tests/jsx-equivalence.test.mjs` was found to have
 * written the defect into both halves of five of its own pairs: a pin has to reach the home where
 * the drift lives, not a representation of it.
 */
test('the renderer warns on a self-closed element if and only if it is NOT void', { skip: isProduction && 'diagnostics are folded away' }, async () => {
  const dom = new JSDOM('<!doctype html><body><div id="a"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
    'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
    globalThis[key] = key === 'window' ? dom.window : dom.window[key];

  const { renderer } = await load('renderer');
  const core = await load('core');
  core.wire([renderer]);
  const { renderInto } = await load('renderer/hydrate');
  const target = dom.window.document.getElementById('a');

  const real = console.warn;
  const warned = [];
  console.warn = (message) => warned.push(String(message));

  const openTag = [];
  const endTag = [];
  try {
    for (const tag of ALL_ELEMENTS) {
      /**
       * Each case is its own call site, so each gets its own Template and its own scan — two
       * literals with identical text are still two templates, and a shared one would be built once
       * and warn once however many tags were pushed through it.
       */
      warned.length = 0;
      renderInto({ ['_$litType$']: 1, strings: Object.assign([`<${tag} /><span>after</span>`], { raw: [] }), values: [] }, target);
      if (warned.some((m) => m.includes('is left OPEN'))) openTag.push(tag);

      warned.length = 0;
      renderInto({ ['_$litType$']: 1, strings: Object.assign([`<${tag}></${tag}>`], { raw: [] }), values: [] }, target);
      if (warned.some((m) => m.includes('read by the parser as ANOTHER'))) endTag.push(tag);
    }
  } finally {
    console.warn = real;
  }

  const nonVoid = ALL_ELEMENTS.filter((t) => !VOID.includes(t));
  assert.ok(openTag.length > 0, 'NON-ZERO CONTROL: a silent run means the diagnostic never ran at all');
  assert.deepEqual(openTag.sort(), [...nonVoid].sort(),
    'every non-void element self-closed must warn, and no void element may');
  assert.deepEqual(endTag.sort(), [...VOID].sort(),
    'every void element written with an end tag must warn, and no other element may');
});
