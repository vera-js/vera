/**
 * **The raw-text fast paths, against the paths they skip** (2026-11-19). The server writes a `<style>` value straight
 * to the output when no closer can be formed across its hole (`styleTails`, `serializer.ts`), and skips both
 * `escapeRawText` and `styleHole`. That is exact only if the skipped calls would have answered `out + value`, so this
 * suite holds it to them. Over a seeded corpus of style templates, heavy in `<`, `/`, `style` in every case, `>`, quotes,
 * comments, short and empty statics, values ending in `<` and statics starting with `/`, the served page must be BYTE
 * FOR BYTE what 0.3.1's slow path writes from the same compiled statics. That slow path (`styleHole` and the style
 * escape) is kept here verbatim. Both must equal the composed text with every `</style` neutralized, the rule the
 * pipeline states, computed independently. The named rows are the four shapes the fast path must refuse, each a closer
 * the value takes part in, plus the short-static and empty-value cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeTemplate } from '@verajs/ssr';
import { extendSeeds } from './fuzz-seeds.mjs';

const { closedRawText } = await import(new URL('../packages/ssr/dist/vera/escaping.js', import.meta.url));

const SEEDS = extendSeeds([1, 7, 42, 2026, 31337]);
const CASES_PER_SEED = 3000;

const lcg = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x80000000);
/** A template as a tagged literal hands it over: its strings own `raw` (the server refuses anything else). */
const template = (statics, values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });
/** A row as written: a real tagged template. */
const html = (strings, ...values) => ({ ['_$litType$']: 1, strings, values });

/* ── 0.3.1's slow path, verbatim (serializer.ts, before the fast path) ───────────────────────────────────────────── */

const escapeStyle = (value) => `${value}`.replace(/<\/(style)/gi, '<\\/$1');
const rawTextOf = (value) => (value == null ? '' : Array.isArray(value) ? value.map(rawTextOf).join('') : `${value}`);
const styleHole = (out, value, before, next) => {
  const tail = before.length >= 6 ? before.slice(-6) : out.slice(-6);
  if (!value.includes('<') && !tail.includes('<')) return out + value;
  const head = next.slice(0, 6);
  const window = tail + value + head;
  const start = tail.length;
  const stop = start + value.length;
  const at = [];
  for (const match of window.matchAll(/<\/style/gi)) {
    const m = match.index;
    if (m < stop && m + 7 > start) at.push(m + 1);
  }
  if (at.length === 0) return out + value;
  let written = out.slice(0, out.length - tail.length);
  let from = 0;
  const marked = window.slice(0, stop);
  for (const p of at) {
    written += marked.slice(from, Math.min(p, stop)) + '\\';
    from = Math.min(p, stop);
  }
  return written + marked.slice(from);
};

/**
 * A style template's case: what precedes the style (`pre`), its start tag, the content statics around the holes, what
 * follows. The compiled statics are the author's with the style's content closed (`closedRawText`), as `compile` makes
 * them; the slow path writes from those, hole by hole.
 */
const slowPath = ({ pre, open, chunks, post }, values) => {
  const parts = chunks.map((chunk) => closedRawText(chunk, false));
  parts[0] = pre + open + parts[0];
  parts[parts.length - 1] += '</style>' + post;
  let out = '';
  for (let i = 0; i < values.length; i++) {
    out += parts[i];
    out = styleHole(out, escapeStyle(rawTextOf(values[i])), parts[i], parts[i + 1]);
  }
  return out + parts[parts.length - 1];
};
/** The rule, independently: the composed content with every `</style` (any case) written `<\/style`. */
const composedRule = ({ pre, open, chunks, post }, values) =>
  pre + open + chunks.map((chunk, i) => chunk + (i < values.length ? rawTextOf(values[i]) : '')).join('').replace(/<\/(style)/gi, '<\\/$1') + '</style>' + post;
const statics = ({ pre, open, chunks, post }) => chunks.map((chunk, i) => (i === 0 ? pre + open : '') + chunk + (i === chunks.length - 1 ? '</style>' + post : ''));

const TOKENS = ['<', '<', '/', '/', '</', '<\\/', 'style', 'STYLE', 'StYlE', 'styl', 'tyle', 'yle>', 'e>', 'e', '>', ' ', 'a', 'x{}', '"', "'", '<!--', '-->', 'script', '</script>', '<img src=x>', '\\', ';'];
const OPENS = ['<style>', '<STYLE>', '<style media="a>b">'];
/** A static that ENDS the element early (or is refused as a tag-name hole) is no style hole's: such chunks are drawn again. */
const ENDS = /<\/style(?=[\t\n\f\r />]|$)/i;

const chunkOf = (random, empty) => {
  for (;;) {
    if (random() < empty) return '';
    let chunk = '';
    const n = 1 + Math.floor(random() * 5);
    for (let i = 0; i < n; i++) chunk += TOKENS[Math.floor(random() * TOKENS.length)];
    if (!ENDS.test(chunk)) return chunk;
  }
};
const valueOf = (random) => {
  const r = random();
  if (r < 0.15) return '';
  if (r < 0.2) return [null, undefined, 0, 1.5][Math.floor(random() * 4)];
  if (r < 0.28) return [chunkOf(random, 0.3), chunkOf(random, 0.3)];
  let value = '';
  const n = Math.floor(random() * 4);
  for (let i = 0; i < n; i++) value += TOKENS[Math.floor(random() * TOKENS.length)];
  return value;
};

/** Whether a hole is one the fast path takes — counted only, so the corpus is seen to reach both branches. */
const fastEligible = (before, text, next) =>
  before.length >= 6 && !before.slice(-6).includes('<') && !text.includes('</') && !(text.endsWith('<') && next.startsWith('/'));

test('style fast path: every served page is what the 0.3.1 slow path writes, and both follow the composed rule', () => {
  let cases = 0;
  let fast = 0;
  let slow = 0;
  let crossed = 0;
  let refused = 0;
  for (const seed of SEEDS) {
    const random = lcg(seed);
    for (let c = 0; c < CASES_PER_SEED; c++) {
      const holes = 1 + Math.floor(random() * 4);
      const shape = {
        pre: random() < 0.3 ? '<p>a</p>' : '',
        open: OPENS[Math.floor(random() * OPENS.length)],
        chunks: Array.from({ length: holes + 1 }, () => chunkOf(random, 0.35)),
        post: random() < 0.3 ? '<p>z</p>' : '',
      };
      const values = Array.from({ length: holes }, () => valueOf(random));
      let served;
      try {
        served = serializeTemplate(template(statics(shape), values));
      } catch {
        refused++;
        continue;
      }
      const expected = slowPath(shape, values);
      const label = `seed ${seed} case ${c}: ${JSON.stringify(statics(shape))} ${JSON.stringify(values)}`;
      assert.equal(expected, composedRule(shape, values), `CONTROL: the kept slow path follows the composed rule (${label})`);
      assert.equal(served, expected, `style fast path: the served page differs from the 0.3.1 slow path (${label})`);
      cases++;
      /** The compiled statics, for the branch count only. */
      const parts = shape.chunks.map((chunk) => closedRawText(chunk, false));
      parts[0] = shape.pre + shape.open + parts[0];
      parts[parts.length - 1] += '</style>' + shape.post;
      for (let i = 0; i < holes; i++) {
        if (fastEligible(parts[i], rawTextOf(values[i]), parts[i + 1])) fast++;
        else slow++;
      }
      /** Without the crossing step: the statics and each value escaped on its own. A page that differs had a closer formed across a hole. */
      const naive = parts.map((part, i) => part + (i < holes ? escapeStyle(rawTextOf(values[i])) : '')).join('');
      if (naive !== served) crossed++;
    }
  }
  console.log(`style fast path: ${cases} pages compared (${refused} refused), ${fast} holes on the fast path, ${slow} on the slow, ${crossed} pages with a closer formed across a hole`);
  /** Floors, never censuses: a corpus that stopped reaching either branch, or every crossing, would pass on nothing. */
  assert.ok(cases >= SEEDS.length * CASES_PER_SEED * 0.8, `the corpus is broken, not the fast path: ${cases} pages compared`);
  assert.ok(fast >= 1000, `the corpus reaches the fast path too rarely to mean anything: ${fast}`);
  assert.ok(slow >= 1000, `the corpus reaches the slow path too rarely to mean anything: ${slow}`);
  assert.ok(crossed >= 100, `the corpus forms too few closers across a hole to test the exclusions: ${crossed}`);
});

/**
 * Each shape the fast path must leave to `styleHole`: the closer's `<` in the static's last 6 characters, the static
 * ending in `<` before a value starting `/`, a `</` in the value, the value ending in `<` before a static starting
 * `/` — then several short statics in a row, and an empty value between a `<` and a `/`. Each serves `<\/style`.
 */
const ROWS = [
  ['a `<` in the static\'s last 6 characters', () => html`<style>a</styl${'e><img src=x onerror=alert(1)>'}</style>`, '<style>a<\\/style><img src=x onerror=alert(1)></style>'],
  ['the static ending in `<`, the value starting `/`', () => html`<style>aaaaa<${'/style><img src=x>'}</style>`, '<style>aaaaa<\\/style><img src=x></style>'],
  ['a `</` inside the value', () => html`<style>aaaaaa${'</style><img src=x>'}</style>`, '<style>aaaaaa<\\/style><img src=x></style>'],
  ['the value ending in `<`, the next static starting `/`', () => html`<style>aaaaaa${'a<'}/style><img src=x></style>`, '<style>aaaaaaa<\\/style><img src=x></style>'],
  ['short statics across holes', () => html`<style>${'<'}${'/style><img src=x>'}</style>`, '<style><\\/style><img src=x></style>'],
  ['an empty value between a `<` static and a `/` static', () => html`<style>aaaaa<${''}/style><img src=x></style>`, '<style>aaaaa<\\/style><img src=x></style>'],
];
for (const [name, draw, expected] of ROWS)
  test(`style fast path refuses: ${name}`, () => {
    assert.equal(serializeTemplate(draw()), expected, `style fast path: ${name} — the closer must be neutralized`);
  });
