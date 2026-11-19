/**
 * **A raw-text closer formed ACROSS holes is neutralized on the server** (2026-11-18). `</style` (any case) ends a
 * `<style>` wherever it is formed, and the static before a value, the value and the static after can each hold part of
 * it: the server escaped per value and served `"</style><img onerror>` from `"<${'/style><img…>'}"`. Generated, not
 * hand-picked: every way to place up to three holes inside a closer (empty values included; at least one cut strictly
 * inside it — a closer wholly in a static is a template that ends its own element), in every spelling tested. Each must
 * be served with the element whole — no early end, nothing after the closer turned to markup — and its text the
 * composed text with each closer's `/` escaped (`<\/style`, the same CSS). Then a JSON block: every `<` of its composed
 * text as `<`, statics too, and the value exact after a parse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { serializeTemplate } from '@verajs/ssr';

/** One parser for every case (a JSDOM window per case ran out of memory over ~30 000): the markup as a body's content. */
/** jsdom's CSS parser complains about the generated stylesheets; that is its noise, not a finding. */
const parser = new JSDOM('<!doctype html><body></body>', { virtualConsole: new VirtualConsole() }).window.document;
const parsed = (markup) => {
  parser.body.innerHTML = markup;
  return parser.body;
};
/** A tagged literal's strings, built: an array OWNING `raw`, as the language makes one. */
const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });
const SPELLINGS = ['</style>', '</STYLE>', '</sTyLe>', '</style ', '</style/', '</style\t'];
const BEFORE = '<style>p{content:"';
const AFTER = '<img src=x onerror=zq()>"}</style><p id="after">ok</p>';

/** Every placement of 1..3 holes over `closer`: [start, end] per hole, in order, at least one cut strictly inside. */
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

test('a style closer split across up to three holes, every placement and spelling: served whole, its text exact', () => {
  let cases = 0;
  let refused = 0;
  const failures = [];
  for (const closer of SPELLINGS)
    for (const holes of placements(closer.length)) {
      const strings = [];
      const values = [];
      let last = 0;
      for (const [s, e] of holes) {
        strings.push((strings.length === 0 ? BEFORE : '') + closer.slice(last, s));
        values.push(closer.slice(s, e));
        last = e;
      }
      strings.push(closer.slice(last) + AFTER);
      /** A template the server REFUSES (a `</` right before a hole is a tag-name hole) is safe: counted, not judged. */
      let markup;
      try {
        markup = serializeTemplate({ strings: literal(strings), values });
      } catch (error) {
        if (!/tag-hole|unfinished-tag/.test(String(error.message))) failures.push(`an uncoded error: ${error.message}`);
        refused++;
        cases++;
        continue;
      }
      const body = parsed(markup);
      const style = body.querySelector('style');
      const composed = `p{content:"${closer}<img src=x onerror=zq()>"}`;
      const ok = body.querySelectorAll('style').length === 1 && body.querySelector('img') === null && body.querySelector('#after')?.textContent === 'ok'
        && style?.textContent === composed.replace(/<\/(style)/gi, '<\\/$1');
      if (!ok && failures.length < 5) failures.push(`${JSON.stringify(strings)} ${JSON.stringify(values)} → ${markup}`);
      cases++;
    }
  assert.ok(cases > 5000, `CONTROL: ${cases} placements generated`);
  assert.ok(cases - refused > cases / 2, `CONTROL: ${cases - refused} of ${cases} rendered (the rest refused): a row refusing everything would pass`);
  assert.deepEqual(failures, []);
});

test('CONTROL: per-value escaping alone (the old rule) fails the same generated corpus — it measures something', () => {
  /** The old rule: each value escaped on its own, the statics as written. */
  const old = (strings, values) => strings.reduce((out, s, i) => out + (i ? values[i - 1].replace(/<\/(style)/gi, '<\\/$1') : '') + s, '');
  let leaked = 0;
  for (const holes of placements(8)) {
    const strings = [];
    const values = [];
    let last = 0;
    for (const [s, e] of holes) {
      strings.push((strings.length === 0 ? BEFORE : '') + '</style>'.slice(last, s));
      values.push('</style>'.slice(s, e));
      last = e;
    }
    strings.push('</style>'.slice(last) + AFTER);
    if (parsed(old(strings, values)).querySelector('img')) leaked++;
  }
  assert.ok(leaked > 100, `only ${leaked} placements leak under the old rule`);
});

test('a JSON block: every < of its composed text is \\u003c, statics too, and the value is exact after a parse', () => {
  const value = '/script><img src=x onerror=zq()>';
  const shapes = [
    [['<script type="application/json">{"a":"<', '"}</script>'], [value]],
    [['<script type="application/json">{"a":"', '","b":"<b>', '"}</script>'], ['</script><!--<script>', 'x']],
    [['<script type="application/ld+json">{"d":"<p>', '</p>"}</script>'], ['<b>bold</b>']],
  ];
  for (const [strings, values] of shapes) {
    const markup = serializeTemplate({ strings: literal(strings), values });
    const body = new JSDOM(`<!doctype html><body>${markup}<p id="after">ok</p></body>`).window.document.body;
    const script = body.querySelector('script');
    assert.equal(body.querySelector('img'), null, markup);
    assert.equal(body.querySelector('#after')?.textContent, 'ok', `the block ended where it should: ${markup}`);
    assert.equal(script.textContent.includes('<'), false, `no < left: ${markup}`);
    const composed = strings.reduce((out, s, i) => out + (i ? values[i - 1] : '') + s, '').replace(/^<script[^>]*>|<\/script>$/g, '');
    assert.deepEqual(JSON.parse(script.textContent), JSON.parse(composed), `lossless: ${markup}`);
  }
});

test('a JSON block whose type holds a hole is no data block: a hole in its content is refused, as before', () => {
  assert.throws(() => serializeTemplate({ strings: literal(['<script type=', '>{"a":', '}</script>']), values: ['application/json', '1'] }), /script-hole/);
});

/**
 * **A recorded server/client difference** (2026-11-18): a hole right after the element's WHOLE end-tag name inside a
 * style (`<style>a</style${x}`) is refused HERE as a tag-name hole, while the clients render it (they neutralize the
 * closer the value completes — `tests/lite.test.mjs` holds that half). A shorter split renders on both sides. The
 * refusal is the safe direction; pinned so it is not taken for a new finding, and named in the README.
 */
test('server/client difference, recorded: `<style>a</style${x}` is refused on the server; `</sty${x}` renders', () => {
  assert.throws(() => serializeTemplate({ strings: literal(['<style>a</style', '</style>']), values: ['>'] }), /tag-hole/);
  assert.equal(serializeTemplate({ strings: literal(['<style>a</sty', '</style>']), values: ['le>'] }), '<style>a<\\/style></style>');
});
