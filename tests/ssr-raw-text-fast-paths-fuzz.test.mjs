/**
 * **The raw-text fast paths, against the paths they skip** (2026-11-19). The server writes a `<style>` value straight
 * to the output when no closer can be formed across its hole (`styleTails`, `serializer.ts`), and skips both
 * `escapeRawText` and `styleHole`. That is exact only if the skipped calls would have answered `out + value`, so this
 * suite holds it to them. Over a seeded corpus of style templates, heavy in `<`, `/`, `style` in every case, `>`, quotes,
 * comments, short and empty statics, values ending in `<` and statics starting with `/`, the served page must be BYTE
 * FOR BYTE what 0.3.1's slow path writes from the same compiled statics. That slow path (`styleHole` and the style
 * escape) is kept here verbatim. Both must equal the composed text with every `</style` neutralized, the rule the
 * pipeline states, computed independently. The named rows are the four shapes the fast path must refuse, each a closer
 * the value takes part in, plus the short-static and empty-value cases. Below them, the compile-time half: the start tag
 * a script hole is judged by, read in one scan (`openingTags`), against the per-hole function it replaced.
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
  /** Not strings: the fast path skips the escape's own `${…}`, so `rawTextOf` must answer the string every value writes. */
  if (r < 0.2) return [null, undefined, 0, 1.5, { toString: () => 'a</style' }, { toString: () => 'a<' }][Math.floor(random() * 6)];
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

/**
 * **A raw-text static beside a JSON block's or a style's hole is written closed, and one with no `<` comes out as it
 * was** (2026-11-19). A static closer in any case (`</STYLEx` ends nothing, and is written `<\/STYLEx`) and a bare `<`
 * in a JSON block's static, before or after its hole, are still written closed.
 */
const ESCAPED_LT = String.fromCharCode(92, 117, 48, 48, 51, 99);
const CLOSED_STATIC_ROWS = [
  ['a style closer in mixed case, in the static before the hole', () => html`<style>p{}</STYLEx>${'v'}</style>`, '<style>p{}<\\/STYLEx>v</style>'],
  ['a style closer in mixed case, in the static after the hole', () => html`<style>${'v'}/*</StYlE-*/</style>`, '<style>v/*<\\/StYlE-*/</style>'],
  ["a `<` in a JSON block's static before the hole", () => html`<script type="application/json">"<${'x'}"</script>`, `<script type="application/json">"${ESCAPED_LT}x"</script>`],
  ["a `<` in a JSON block's static after the hole", () => html`<script type="application/json">"${'x'}<"</script>`, `<script type="application/json">"x${ESCAPED_LT}"</script>`],
  ["no `<` in a style's statics", () => html`<style>a{}${'v'}b{}</style>`, '<style>a{}vb{}</style>'],
];
for (const [name, draw, expected] of CLOSED_STATIC_ROWS)
  test(`raw-text statics: ${name}`, () => {
    assert.equal(serializeTemplate(draw()), expected, `raw-text statics: ${name} — written closed, exactly`);
  });

/* ── the opening tag of a script hole: one scan against the per-hole rescans ─────────────────────────────────────── */

/**
 * **`openingTags` against the function it replaced** (2026-11-19). `compile` judges a script hole by the start tag that
 * opened its script (`dataBlock`; a hole inside that tag refuses it). It took the tag from a scan of every static from
 * the template's start, repeated per script hole; one scan now gives every hole's. Kept here verbatim is the per-hole
 * function as fixed in the same release (the LAST script a static opens, by `rawFrom`), and the tag string must be
 * EXACTLY its answer at every hole of every template, in a script or not. The corpus: tags left open across holes (the
 * `￿` joins, several holes in one tag), quoted `>` in values, comments, `<script` inside style and textarea text and
 * inside attribute values, SVG and MathML scripts, mixed case, a literal `￿`, and scripts closed and reopened.
 */
const { openingTags } = await import(new URL('../packages/ssr/dist/vera/serializer.js', import.meta.url));
const { scanTag, freshScan } = await import(new URL('../packages/ssr/dist/vera/tokenizer.js', import.meta.url));

const copyScan = (state) => ({ ...state, opens: [...state.opens] });
/** 0.3.1's `openingTag`, as fixed on 2026-11-19 (`serializer.ts`), verbatim but for its types. */
const openingTag = (strings, hole, depth) => {
  let state = freshScan(depth);
  let open = [0, 0];
  let found = '';
  for (let j = 0; j <= hole; j++) {
    const text = strings[j];
    const after = scanTag(text, copyScan(state));
    if (after.rawTag === 'script' && after.rawFrom !== -1) {
      const end = after.rawFrom;
      const before = scanTag(text.slice(0, end - 1), copyScan(state));
      const [from, at] = before.tagAt >= 0 ? [j, before.tagAt] : open;
      found = from === j ? text.slice(at, end) : strings[from].slice(at) + '￿' + strings.slice(from + 1, j).map((t) => `${t}￿`).join('') + text.slice(0, end);
    }
    if (after.inTag && after.tagAt >= 0) open = [j, after.tagAt];
    state = after;
  }
  return found;
};

const SCRIPT_TOKENS = [
  '<script>', '<SCRIPT>', '<script type="application/json">', "<script type='application/ld+json'>", '<script type=application/json>',
  '<Script Type="module">', '<script ', '<script', ' type=', ' type="application/json"', 'application/json', ' data-x=">"', " data-y='>'", '>', '/>',
  '</script>', '</SCRIPT >', '</scripts>', '<style>', '</style>', '<textarea>', '</textarea>', '<!--', '-->', '<!-- <script type=application/json> -->',
  '<p title="<script type=application/json>">', '<p title="', '">', '"', "'", ' ', 'x', '{}', '<svg>', '</svg>', '<math>', '</math>',
  '<svg><script>', '<math><mi>', '</mi>', '<foreignObject>', '￿', '=',
];
/** The start tags a script can be opened with (some left open, so a hole can fall inside one). */
const SCRIPT_OPENS = SCRIPT_TOKENS.filter((token) => /^<script/i.test(token));
const pick = (random, list) => list[Math.floor(random() * list.length)];
const drawStatics = (random, tokens, count, length) =>
  Array.from({ length: count }, () => {
    let text = '';
    const n = Math.floor(random() * length);
    for (let i = 0; i < n; i++) text += tokens[Math.floor(random() * tokens.length)];
    return text;
  });

test("openingTags: the tag at every hole is exactly the per-hole function's", () => {
  let holes = 0;
  let scriptHoles = 0;
  let joined = 0;
  let twoScripts = 0;
  for (const seed of SEEDS) {
    const random = lcg(seed ^ 0x5eed);
    for (let c = 0; c < CASES_PER_SEED; c++) {
      const strings = drawStatics(random, SCRIPT_TOKENS, 2 + Math.floor(random() * 5), 5);
      /**
       * Half the templates always hold two scripts, a hole in each — the shape the per-hole function judged wrongly
       * before its fix (2026-11-19): one script opened in a static, closed in a later one, and another opened after it,
       * in that static (`</script><script>`) or the next. The rest are drawn freely.
       */
      if (random() < 0.5) {
        strings[0] += pick(random, SCRIPT_OPENS);
        const reopen = random() < 0.5 || strings.length < 3 ? 1 : 2;
        strings[1] = pick(random, ['', 'x', '{}']) + '</script>' + strings[1].slice(0, Math.floor(random() * 4)) + (reopen === 1 ? pick(random, SCRIPT_OPENS) : '');
        if (reopen === 2) strings[2] = pick(random, ['', '<!-- -->', '<p>']) + pick(random, SCRIPT_OPENS) + strings[2];
      }
      const depth = random() < 0.15 ? 1 : 0;
      const tags = openingTags(strings, depth);
      assert.equal(tags.length, strings.length - 1, `openingTags: one tag per hole (${JSON.stringify(strings)})`);
      let state = freshScan(depth);
      const seen = new Set();
      for (let h = 0; h < strings.length - 1; h++) {
        const expected = openingTag(strings, h, depth);
        assert.equal(tags[h], expected, `openingTags: the tag at hole ${h} differs from the per-hole function's (seed ${seed} case ${c}, depth ${depth}): ${JSON.stringify(strings)}`);
        holes++;
        state = scanTag(strings[h], state);
        if (state.rawTag === 'script') {
          scriptHoles++;
          if (expected.includes('￿')) joined++;
          seen.add(expected);
        }
      }
      if (seen.size > 1) twoScripts++;
    }
  }
  console.log(`openingTags: ${holes} holes compared, ${scriptHoles} in a script, ${joined} of those in a script whose tag held a hole, ${twoScripts} templates with holes in two different scripts`);
  assert.ok(scriptHoles >= 2000, `the corpus is broken, not openingTags: ${scriptHoles} script holes`);
  assert.ok(joined >= 200, `the corpus leaves too few tags open across a hole to test the joins: ${joined}`);
  assert.ok(twoScripts >= 200, `the corpus has too few templates with two scripts to test which one is judged: ${twoScripts}`);
});

/**
 * **What a hole boundary does to the scan** (the property `openingTags` and `compile` share). Both carry `scanTag`'s state
 * static by static, and neither assumes it equals one scan of the concatenation — it does not, by design: a hole is a
 * token boundary (a `<!` and a `--` in two statics are no comment, a raw closer split by a hole ends nothing, an
 * `encoding` is read whole within one static). Where a split falls just after a `>`, the carried scan IS the whole
 * one, every carried field but `encoding`, and that too unless the split falls inside an attribute value; and but a
 * split inside a script's text after a `<!--` (2026-11-23): each static starts in plain script data, as a hole is a token
 * boundary there too (a hole in a script is refused unless it is a JSON block, whose statics are served with `<` as
 * `\u003c`, so the page itself never enters an escape state). Held here, so a change to the tokenizer that makes a
 * boundary matter somewhere new is seen.
 */
/**
 * What makes a split inside a script's escaped text safe to read from plain script data, asserted for each one: a hole
 * there is refused (a classic script's), or it is a JSON block's, served with no raw `<` in the block before the value,
 * so the page itself never enters an escape state.
 */
const MARK = 'VALUEMARK';
const escapeCuts = { refused: 0, served: 0 };
const servedWithoutEscape = (text, cut, label) => {
  const strings = Object.assign([text.slice(0, cut), text.slice(cut)], { raw: [text.slice(0, cut), text.slice(cut)] });
  let html;
  try {
    html = serializeTemplate({ _$litType$: 1, strings, values: [MARK] });
  } catch (error) {
    assert.match(String(error?.message), /\((?:ssr-[a-z-]+|tag-hole|script-hole)\)/, `refused, by a code (${label})`);
    escapeCuts.refused++;
    return;
  }
  const at = html.indexOf(MARK);
  if (at === -1) return;
  const opener = [...html.slice(0, at).matchAll(/<script\b[^>]*>/gi)].pop();
  assert.ok(opener, `a value served in script text has its script (${label}): ${html}`);
  const before = html.slice(opener.index + opener[0].length, at);
  assert.equal(before.includes('<'), false, `served in a script, with no raw < before it in the block (${label}): ${html}`);
  escapeCuts.served++;
};
const FIELDS = ['inTag', 'phase', 'inValue', 'quote', 'rawTag', 'tagName', 'attrName', 'closing', 'inert', 'comment', 'textTag', 'foreign', 'attrRaw'];
test('scanTag: carried across splits after a `>`, the state is the whole text\'s', () => {
  let compared = 0;
  let inValue = 0;
  let inEscape = 0;
  let anywhere = 0;
  for (const seed of SEEDS) {
    const random = lcg(seed ^ 0xc4a7);
    for (let c = 0; c < CASES_PER_SEED; c++) {
      const text = drawStatics(random, [...SCRIPT_TOKENS, ' encoding="a>b"', '<annotation-xml encoding=text/html>', '<noscript>', '</noscript>'], 1, 14)[0];
      const whole = scanTag(text, freshScan(0));
      const cuts = [...text.matchAll(/>/g)].map((m) => m.index + 1).filter(() => random() < 0.5);
      let state = freshScan(0);
      let from = 0;
      let cutInValue = false;
      let escapeCut = -1;
      for (const cut of [...cuts, text.length]) {
        state = scanTag(text.slice(from, cut), state);
        if (cut < text.length && state.inValue) cutInValue = true;
        if (cut < text.length && escapeCut === -1 && state.rawTag === 'script' && text.slice(0, cut).includes('<!--')) escapeCut = cut;
        from = cut;
      }
      if (escapeCut !== -1) {
        inEscape++;
        servedWithoutEscape(text, escapeCut, `seed ${seed} case ${c}: ${JSON.stringify(text)} cut at ${escapeCut}`);
        continue;
      }
      const label = `seed ${seed} case ${c}: ${JSON.stringify(text)} cut at ${cuts}`;
      for (const field of FIELDS) assert.equal(state[field], whole[field], `scanTag: ${field} differs carried across splits after a \`>\` (${label})`);
      assert.deepEqual(state.opens, whole.opens, `scanTag: opens differ carried across splits after a \`>\` (${label})`);
      if (cutInValue) inValue++;
      else assert.equal(state.encoding, whole.encoding, `scanTag: encoding differs carried across splits after a \`>\` outside any value (${label})`);
      if (cuts.length > 0) compared++;
      /** Information only: an arbitrary split, the boundary a hole is. */
      const at = Math.floor(random() * (text.length + 1));
      const split = scanTag(text.slice(at), scanTag(text.slice(0, at), freshScan(0)));
      if (FIELDS.some((field) => split[field] !== whole[field])) anywhere++;
    }
  }
  console.log(`scanTag: ${compared} texts split after a \`>\` (${inValue} with a split inside a value; ${inEscape} inside a script's escaped text, checked instead: ${escapeCuts.refused} refused, ${escapeCuts.served} served with no raw < in the block); a split anywhere changed the state of ${anywhere}`);
  assert.ok(compared >= 5000, `the corpus is broken, not the property: ${compared} texts split`);
  assert.ok(escapeCuts.refused >= 100, `CONTROL: splits inside escaped script text were checked (${escapeCuts.refused} refused)`);
});

/**
 * **A JSON data block's value, with and without a `<`** (2026-11-19): the exact output, whatever form the escape takes
 * (`rawTextOf` answers a string as itself). Every `<` is written `\u003c`, a value without one as it is, and a
 * value that is no string as its text.
 */
const JSON_ROWS = [
  ['no `<`', '{"a":1}', '{"a":1}'],
  ['a `<`', '{"a":"</script><b>"}', '{"a":"\\u003c/script>\\u003cb>"}'],
  ['only `<`', '<<', '\\u003c\\u003c'],
  ['empty', '', ''],
  ['a number', 5, '5'],
  ['an object whose text holds a `<`', { toString: () => '"<!--"' }, '"\\u003c!--"'],
  ['an array', ['[1,', '"<"]'], '[1,"\\u003c"]'],
];
for (const [name, value, written] of JSON_ROWS)
  test(`JSON data block value: ${name}`, () => {
    const page = serializeTemplate(html`<script type="application/json">${value}</script>`);
    assert.equal(page, `<script type="application/json">${written}</script>`, `JSON data block value: ${name} — written wrong`);
  });
