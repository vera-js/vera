/**
 * **The three position-dependent JSX rules, fuzzed together against INVARIANTS** — component tags
 * take bare props, `<svg>`/`<math>` change the namespace of expressions inside them, and a child
 * expression drops booleans. `./jsx-equivalence-fuzz.test.mjs` compares JSX to a hand-written twin;
 * this asks whether the transform's own output stays coherent when the three nest at random, which
 * is where no hand-written case reaches.
 *
 * **Every invariant here is mutation-controlled, and two of them were WRONG when first written** —
 * which is the reason this file exists in the repo rather than as a probe:
 *
 * - The svg check looked for `html\`<circle` in the output, and the corpus only ever wrote shapes
 *   as DIRECT children of `<svg>`. Those are inline statics of the same template, so they compile
 *   identically whether or not mode tracking exists: disabling the feature changed nothing the
 *   corpus could see, and the coverage counter said "230 trees containing <svg>" while exercising
 *   the rule in none of them. A coverage number can measure the wrong thing.
 * - The component-prop check looked for `date=` not followed by `$`. The attribute form is
 *   `date=${…}`, which satisfies that, so disabling the feature walked straight through. The
 *   difference in the emitted text is the leading DOT, and the check is anchored there now.
 *
 * Both were found by planting the defect and watching for silence, never by reading.
 */
import assert from 'node:assert/strict';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const { transformJsx } = await load('jsx');

const rng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x7fffffff);
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const HTML_TAGS = ['div', 'span', 'p', 'b'];
const COMP_TAGS = ['x-row', 'calendar-day', 'a-b-c'];
const SVG_TAGS = ['circle', 'rect', 'path'];
const EXPRS = ['s.str', 's.num', 's.f', 's.t', 'cond && <i>x</i>', 'rows.map((r) => <b>{r}</b>)', 's.arr'];
const PROPS = ['date={d}', 'count={3}', 'active', 'data-x="1"', 'aria-label="l"', 'className="c"', 'title={t}'];

/** `root` forbids a bare `{expr}`: that is not a JSX element, so it is invalid SOURCE and the
 *  transform passing it through unchanged is correct. Generating it tested the generator. */
const build = (r, depth, mode, root = false) => {
  const roll = r();
  if (!root && (depth >= 3 || roll < 0.2)) return `{${pick(r, EXPRS)}}`;
  if (mode === 'svg') {
    const tag = pick(r, SVG_TAGS);
    /**
     * **A shape inside an EXPRESSION is the shape the feature is about**, and the first version of
     * this generator never produced one: a shape written directly under `<svg>` is inline statics
     * of the same template, so it compiles identically whether or not mode tracking exists. The
     * corpus counted 230 trees "containing <svg>" and exercised the rule in none of them — a
     * coverage number measuring the wrong thing, which is how a mutation walked straight through.
     */
    if (r() < 0.5) return `{shapes.map((q) => <${tag} cx={q} />)}`;
    return r() < 0.6 ? `<${tag} />` : `<${tag}>{${pick(r, EXPRS)}}</${tag}>`;
  }
  if (roll < 0.45) {
    const tag = pick(r, COMP_TAGS);
    const props = Array.from({ length: Math.floor(r() * 3) }, () => pick(r, PROPS)).join(' ');
    return `<${tag} ${props}>${build(r, depth + 1, mode)}</${tag}>`;
  }
  if (roll < 0.6) return `<svg>${build(r, depth + 1, 'svg')}</svg>`;
  if (roll < 0.68) return `<svg><foreignObject>${build(r, depth + 1, 'html')}</foreignObject></svg>`;
  const tag = pick(r, HTML_TAGS);
  return `<${tag}>${build(r, depth + 1, mode)}${r() < 0.4 ? build(r, depth + 1, mode) : ''}</${tag}>`;
};

const SEEDS = extendSeeds([1, 7, 13, 29, 101, 404]);
const PER_SEED = 70;

let checked = 0;
const cover = { svg: 0, comp: 0, fo: 0, helper: 0 };
const problems = [];
for (const seed of SEEDS) {
  for (let i = 0; i < PER_SEED; i++) {
    const r = rng(seed * 1000 + i);
    const jsx = build(r, 0, 'html', true);
    const source = `export const v = (s, cond, rows, d, t, shapes) => (${jsx});`;
    let out;
    try { out = transformJsx(source, `f${seed}-${i}.jsx`, { inject: false }); }
    catch (error) { problems.push(`seed ${seed}.${i}: THREW ${error.message.slice(0, 60)}\n    ${jsx}`); continue; }
    checked++;
    if (/<svg>[^]*\{[^}]*<(?:circle|rect|path)/.test(jsx)) cover.svg++;
    if (/<(?:x-row|calendar-day|a-b-c)[ >]/.test(jsx)) cover.comp++;
    if (/foreignObject/.test(jsx)) cover.fo++;
    if (/\$veraChild\(/.test(out)) cover.helper++;

    /** 1. Valid JS. A transform that emits a syntax error takes the whole module with it. */
    const body = out.replace(/^export /gm, '');
    try { new Function(`const html=()=>{},svg=()=>{},mathml=()=>{},keyed=()=>{},spread=()=>{};${body}`); }
    catch (error) { problems.push(`seed ${seed}.${i}: INVALID JS — ${error.message.slice(0, 50)}\n    ${jsx}`); }

    /** 2. The child helper is declared if and only if it is called. */
    const calls = /\$veraChild\(/.test(out);
    const declared = /const \$veraChild\d* = /.test(out);
    if (calls !== declared) problems.push(`seed ${seed}.${i}: helper called=${calls} declared=${declared}\n    ${jsx}`);

    /** 3. No JSX survives — a leftover tag means the parser gave up without saying so. */
    if (/=\s*</.test(out.replace(/`[^`]*`/g, ''))) problems.push(`seed ${seed}.${i}: JSX survived\n    ${out.slice(0, 100)}`);

    /** 4. A shape reached through an expression inside `<svg>` never compiles with the html tag. */
    for (const tag of SVG_TAGS)
      if (new RegExp(`html\\\`<${tag}[ >]`).test(out))
        problems.push(`seed ${seed}.${i}: <${tag}> emitted as html\`\`\n    ${jsx}`);

    /** 5. An identifier-named attribute on a dashed tag is a property — the leading dot. */
    if (/<(?:x-row|calendar-day|a-b-c)[^>]*\s(?:date|count|title)=\$/.test(out))
      problems.push(`seed ${seed}.${i}: a component prop stayed an ATTRIBUTE\n    ${jsx}`);
  }
}

/**
 * **The floor.** Every invariant above passes vacuously over a corpus that does not contain its
 * subject, which is exactly how the first two were wrong and silent. These counts are the
 * assertion that the corpus reached each feature at all.
 */
assert.ok(checked >= SEEDS.length * PER_SEED * 0.9, `only ${checked} trees compiled — the generator is broken, not the transform`);
assert.ok(cover.svg >= 20, `only ${cover.svg} trees put a shape inside an <svg> EXPRESSION — the svg rule is untested`);
assert.ok(cover.comp >= 20, `only ${cover.comp} trees carried a component tag — the prop rule is untested`);
assert.ok(cover.fo >= 5, `only ${cover.fo} trees carried <foreignObject> — the mode flip is untested`);
assert.ok(cover.helper >= 20, `only ${cover.helper} trees emitted the child helper — the boolean rule is untested`);

assert.deepEqual(problems.slice(0, 5), [], `${problems.length} invariant violation(s):\n\n${problems.slice(0, 5).join('\n\n')}`);
console.log(`jsx features fuzz: ${checked} trees — svg ${cover.svg}, components ${cover.comp}, foreignObject ${cover.fo}, helper ${cover.helper}`);
