/**
 * Generated JSX trees against the templates they claim to compile to.
 *
 * `jsx-equivalence` states the invariant with a hand-written table: one JSX call site is one `html`
 * call site, and the two spellings must serialise identically. Its own header notes that "the
 * transform's table has twenty entries and its tests had nine" — a table is exactly the shape that
 * gets extended without its cases being extended.
 *
 * This generates the trees instead: nesting, sibling expressions, static and bound attributes,
 * boolean bindings, text interleaved with holes, at depths and in orders nobody chose.
 *
 * ## The oracle is a second implementation, not a self-comparison
 *
 * The generator emits **both** spellings from one tree — the JSX, and the template a person would
 * have written for the same thing. That second emitter is an independent statement of the notation's
 * contract, so a disagreement means one of the two is wrong and neither can hide behind the other.
 * `render-update-fuzz` records the opposite arrangement and its blind spot; this does not have that
 * one.
 *
 * Both spellings are then rendered through the **same** serializer, so nothing here depends on how
 * the transform formats its output — only on what it produces.
 *
 * Mutation: making `BOOLEAN_ATTRIBUTES` never apply — so `hidden={s.f}` compiles to a plain attribute
 * instead of `?hidden=${s.f}` — fails immediately, with `hidden="false"` present where the attribute
 * should be absent entirely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transformJsx } from '../packages/jsx/src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

const TAGS = ['div', 'span', 'p', 'b', 'em', 'section'];
const EXPRESSIONS = ['s.str', 's.num', 's.t', 's.f', 's.arr'];
/**
 * Static text carries the characters that mean something inside a **template literal** — a backtick, a
 * backslash, a bare `$` — because JSX text is not a template literal and the transform has to escape
 * them on the way in. Without them, weakening `escapeStatic` survived this suite untouched.
 *
 * **No braces.** `{` opens an expression container in JSX, so `cost ${n} more` is not the text it
 * looks like: it is a literal `$` followed by an interpolation of `n`, exactly as React reads it, and
 * the transform is right to emit `$${n}`. A first version of this list included it and produced a
 * confident false finding about the escaper.
 */
const STATIC_TEXT = ['hello', 'a b', '', 'x', 'a `tick` b', 'back\\slash', 'a $ sign'];

/**
 * Attribute values get their own list, because a **quoted** attribute value is literal text where
 * braces are not expressions — `title="cost ${n} more"` really does contain `${`, and is the only way
 * `escapeStatic`'s `${` branch can be reached at all. With children-only text, removing that branch
 * survived this suite untouched, since JSX text can never produce the sequence.
 */
const ATTRIBUTE_TEXT = [...STATIC_TEXT, 'cost ${n} more', '${}'];

/**
 * One generated node, in both spellings.
 *
 * Attribute names are used at most once per element: repeating `title` would be a question about
 * duplicate-attribute handling rather than about the notation, and the two spellings would diverge
 * for a reason that has nothing to do with the transform.
 */
/**
 * A second implementation of `escapeStatic`, arrived at independently rather than imported — that is
 * the point of the comparison. Attribute values need it as much as children do: both land inside the
 * same template literal.
 */
const escapeForTemplate = (text) => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const build = (random, depth) => {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const tag = pick(TAGS);

  const attributesJsx = [];
  const attributesTpl = [];
  const used = new Set();
  const attributeCount = Math.floor(random() * 3);
  for (let i = 0; i < attributeCount; i++) {
    const kind = random();
    if (kind < 0.35 && !used.has('title')) {
      used.add('title');
      const value = ATTRIBUTE_TEXT[Math.floor(random() * ATTRIBUTE_TEXT.length)] || 'v';
      attributesJsx.push(`title="${value}"`);
      attributesTpl.push(`title="${escapeForTemplate(value)}"`);
    } else if (kind < 0.7 && !used.has('id')) {
      used.add('id');
      const expression = pick(EXPRESSIONS);
      attributesJsx.push(`id={${expression}}`);
      attributesTpl.push(`id=\${${expression}}`);
    } else if (!used.has('hidden')) {
      used.add('hidden');
      const expression = pick(['s.t', 's.f']);
      attributesJsx.push(`hidden={${expression}}`);
      attributesTpl.push(`?hidden=\${${expression}}`);
    }
  }

  const openJsx = attributesJsx.length ? `<${tag} ${attributesJsx.join(' ')}>` : `<${tag}>`;
  const openTpl = attributesTpl.length ? `<${tag} ${attributesTpl.join(' ')}>` : `<${tag}>`;

  const childrenJsx = [];
  const childrenTpl = [];
  /** Which kind each child is: the whitespace rule depends on what sits either side of the newline. */
  const kinds = [];
  const childCount = depth >= 2 ? Math.floor(random() * 2) : 1 + Math.floor(random() * 3);
  for (let i = 0; i < childCount; i++) {
    const kind = random();
    if (kind < 0.35) {
      const text = pick(STATIC_TEXT);
      if (!text) continue;
      childrenJsx.push(text);
      /**
       * The same characters, spelled for a template literal. This is a second implementation of
       * `escapeStatic` rather than a call to it — the point is for the two to be arrived at
       * independently.
       */
      childrenTpl.push(escapeForTemplate(text));
      kinds.push('text');
    } else if (kind < 0.7 || depth >= 2) {
      const expression = pick(EXPRESSIONS);
      childrenJsx.push(`{${expression}}`);
      childrenTpl.push(`\${${expression}}`);
      kinds.push('expr');
    } else {
      const child = build(random, depth + 1);
      childrenJsx.push(child.jsx);
      childrenTpl.push(child.tpl);
      kinds.push('element');
    }
  }

  /**
   * A third of the trees are written across lines, which is how JSX is normally written and a
   * different code path. The rule is stricter than "collapse to a space": a whitespace run that
   * *contains a newline and nothing else* disappears completely, so children each on their own line
   * concatenate with **nothing** between them. Joining them with a space instead put 17 of 72 trees
   * wrong, all in the same direction, which is what a mis-modelled rule looks like from outside.
   *
   * One exception the first correction missed: **two text children on consecutive lines are one text
   * node**, not two, and its interior newline collapses to a single space rather than vanishing. So
   * the join is a space between text and text, and nothing anywhere else. That left 2 of 72 wrong
   * until it was modelled.
   *
   * The template spelling therefore carries the collapsed result directly, and the two agree only if
   * the transform applies the same rule. Removing that rule survived this suite while every tree was
   * a single line.
   */
  const multiline = random() < 0.33 && childrenJsx.length > 1;

  /** On one line the children are already adjacent, so nothing separates them in either spelling. */
  if (!multiline)
    return {
      jsx: `${openJsx}${childrenJsx.join('')}</${tag}>`,
      tpl: `${openTpl}${childrenTpl.join('')}</${tag}>`,
    };

  /**
   * Across lines, the separator depends on what sits either side of the newline: between two text
   * children it is one text node with an interior newline, which collapses to a single space;
   * everywhere else the whitespace run is newline-only and disappears.
   */
  const indent = '  '.repeat(depth + 1);
  return {
    jsx: `${openJsx}\n${childrenJsx.map((child) => indent + child).join('\n')}\n${'  '.repeat(depth)}</${tag}>`,
    tpl: `${openTpl}${childrenTpl
      .map((child, i) => (i && kinds[i] === 'text' && kinds[i - 1] === 'text' ? ' ' : '') + child)
      .join('')}</${tag}>`,
  };
};

const SEEDS = [11, 22, 33, 44, 55, 606];
const ROUNDS = 12;

const cases = {};
for (const seed of SEEDS) {
  const random = rng(seed);
  for (let round = 0; round < ROUNDS; round++) {
    const { jsx, tpl } = build(random, 0);
    cases[`s${seed}r${round}`] = [jsx, `html\`${tpl}\``];
  }
}

test('every generated JSX tree compiles to the template it claims', () => {
  /**
   * Compiled as one module so the transform sees the shape a real file gives it, then run from the
   * repo root — the emitted code imports bare specifiers, which only resolve there.
   */
  const jsxModule = `export const VIEWS = {\n${Object.entries(cases)
    .map(([name, [jsx]]) => `  ${JSON.stringify(name)}: (s) => (${jsx}),`)
    .join('\n')}\n};\n`;
  const compiled = transformJsx(jsxModule, 'generated.jsx', { inject: false });

  const script = `
import { serializeTemplate } from '@verajs/ssr';
const { html } = await import('@verajs/core');

${compiled}

const s = { str: 'v', num: 3, t: true, f: false, arr: [1, 2] };

const TEMPLATES = {
${Object.entries(cases).map(([name, [, tpl]]) => `  ${JSON.stringify(name)}: (s) => (${tpl}),`).join('\n')}
};

const out = {};
for (const name of Object.keys(TEMPLATES)) {
  try {
    out[name] = { jsx: serializeTemplate(VIEWS[name](s)), tpl: serializeTemplate(TEMPLATES[name](s)) };
  } catch (error) {
    out[name] = { error: String(error.message).slice(0, 140) };
  }
}
process.stdout.write(JSON.stringify(out));
`;

  const results = JSON.parse(
    execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  );

  const failures = [];
  for (const [name, result] of Object.entries(results)) {
    if (result.error) failures.push(`${name}: ${result.error}\n      jsx: ${cases[name][0]}`);
    else if (result.jsx !== result.tpl)
      failures.push(
        `${name}\n      jsx:     ${cases[name][0]}\n      tpl:     ${cases[name][1]}\n      jsx out: ${result.jsx}\n      tpl out: ${result.tpl}`
      );
  }

  assert.equal(Object.keys(results).length, SEEDS.length * ROUNDS, 'not every generated case was evaluated');
  assert.deepEqual(
    failures.slice(0, 6),
    [],
    `${failures.length} of ${Object.keys(cases).length} generated trees disagree:\n\n  ${failures.slice(0, 6).join('\n\n  ')}`
  );
});
