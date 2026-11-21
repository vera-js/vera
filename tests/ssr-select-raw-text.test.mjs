/**
 * **Inside an open `<select>`, and wherever a template cannot know its namespace, the server writes no value as raw
 * text or code** (2026-11-21). parse5 is the oracle, and it is the PRE-relaxation select parser: the standard before
 * customizable select, which jsdom implements and older browsers still in use run. That parser IGNORES a `<style>`
 * start tag (and `<svg>`, `<math>`, `<noscript>`) inside a select, so what follows is markup:
 * `<select><style>${v}</style></select>` with `v` = `</select><img onerror>` was served with the value raw, and the
 * `</select>` closed the select and the `<img>` ran. Current engines read that style as raw text
 * (`tests/browser/ssr-select-raw-text.test.js` is their half), so the one reading safe under both is the escaped one.
 *
 * The same scan decides a `<script>`: a template rendered inside `<svg>` starts at an inherited foreign depth and
 * cannot know its namespace, so its `<script>` was neither raw text nor a tracked foreign script, and a hole in it
 * was served as escaped TEXT — which does nothing to code: `<svg><script>alert(1)</script></svg>` ran in all three
 * engines. A hole in a script there is refused (`ssr-script-hole`), as in every other script that is no data block.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';
import { SELECT_CASES } from './browser/fixtures/ssr-select-served.js';

const template = (statics, ...values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });
const elements = (node, out = []) => {
  for (const child of node.childNodes ?? []) {
    if (child.tagName) out.push(child);
    elements(child, out);
    if (child.content) elements(child.content, out);
  }
  return out;
};
const page = (markup) => elements(parse(`<!doctype html><body>${markup}`, { scriptingEnabled: true }));
const PAYLOAD = '<img id=pwn src=x>';
const VALUE = `</select>${PAYLOAD}`;
const injected = (served) => page(served).some((el) => el.attrs.some((a) => a.name === 'id' && a.value === 'pwn'));
const refusal = (make) => {
  try {
    return `served ${make()}`;
  } catch (error) {
    return /ssr-script-hole/.test(String(error)) ? 'ssr-script-hole' : `threw ${error}`;
  }
};

test('control: the oracle is the pre-relaxation parser — the raw form injects, and a style outside a select is raw text', () => {
  assert.equal(injected(`<select><style>${VALUE}</style></select>`), true, 'parse5 reads a style inside a select as markup');
  assert.equal(serializeTemplate(template(['<select></select><style>', '</style>'], VALUE)), `<select></select><style>${VALUE}</style>`);
});

test('a style hole inside an open select is escaped, whatever stands between them', () => {
  for (const lead of ['<select>', '<select><option>', '<select><optgroup><option>', '<select><svg>', '<select><svg><foreignObject>', '<select><svg><title>', '<select><math><mi>', '<SELECT>', '<svg><foreignObject><select>', '<math><mi><select>']) {
    const served = serializeTemplate(template([`${lead}<style>`, '</style></select>'], VALUE));
    assert.ok(!injected(served), `${lead}: ${served}`);
    assert.ok(!served.includes(PAYLOAD) && served.includes('&#60;img'), `${lead}: escaped — ${served}`);
  }
});

test('a child template rendered inside a select starts inside it: its style hole is escaped', () => {
  const served = serializeTemplate(template(['<select>', '</select>'], template(['<style>', '</style>'], VALUE)));
  assert.ok(!injected(served) && served.includes('&#60;img'), served);
});

test('an .innerHTML on a host in a select, or on the select, is escaped text until hydration; a select in the markup is tracked', () => {
  const markup = `<style>${VALUE}</style><script>x</script>`;
  for (const statics of [['<select .innerHTML=', '></select>'], ['<select><option .innerHTML=', '></option></select>']]) {
    const served = serializeTemplate(template(statics, markup));
    assert.ok(!injected(served) && !page(served).some((el) => el.tagName === 'script'), `${statics[0]}: ${served}`);
  }
  const served = serializeTemplate(template(['<div .innerHTML=', '></div>'], `<select>${markup}</select>`));
  assert.ok(!page(served).some((el) => el.tagName === 'script' && !el.attrs.some((a) => a.value === 'text/x-vera-inert')), `the script in the select is inert: ${served}`);
});

test('a hole in a script whose namespace the scan cannot know is refused', () => {
  const code = 'alert(1)';
  const child = () => template(['<script>', '</script>'], code);
  assert.equal(refusal(() => serializeTemplate(template(['<svg>', '</svg>'], child()))), 'ssr-script-hole', 'a child in svg');
  assert.equal(refusal(() => serializeTemplate(template(['<math>', '</math>'], child()))), 'ssr-script-hole', 'a child in math');
  assert.equal(refusal(() => serializeTemplate(template(['<select>', '</select>'], child()))), 'ssr-script-hole', 'a child in a select');
  assert.equal(refusal(() => serializeTemplate(template(['<select><script>', '</script></select>'], code))), 'ssr-script-hole', 'a script in a select that is no data block, as anywhere');
  assert.equal(refusal(() => serializeTemplate(template(['<select><svg><script>', '</script></svg></select>'], code))), 'ssr-script-hole', 'an svg script in a select');
  /** The direct forms were already refused; pinned beside the child forms: an SVG script, a JSON-typed one (in SVG no data block), and HTML again in an integration point. */
  assert.equal(refusal(() => serializeTemplate(template(['<svg><script>', '</script></svg>'], code))), 'ssr-script-hole', 'an svg script');
  assert.equal(refusal(() => serializeTemplate(template(['<svg><script type="application/json">', '</script></svg>'], 'a<b'))), 'ssr-script-hole', 'a JSON-typed svg script');
  assert.equal(refusal(() => serializeTemplate(template(['<svg><foreignObject><script>', '</script></foreignObject></svg>'], code))), 'ssr-script-hole', 'an HTML script in foreignObject');
  /** Controls: a child at depth 0 still takes a data block, and one in an integration point is back in HTML. */
  const json = () => template(['<script type="application/json">', '</script>'], 'a<b');
  assert.equal(serializeTemplate(template(['<div>', '</div>'], json())), '<div><script type="application/json">a\\u003cb</script></div>');
  assert.equal(serializeTemplate(template(['<svg><foreignObject>', '</foreignObject></svg>'], json())), '<svg><foreignObject><script type="application/json">a\\u003cb</script></foreignObject></svg>');
});

test('a child of an svg <template> takes no script hole either: that content is live', () => {
  const served = refusal(() => serializeTemplate(template(['<svg><template>', '</template></svg>'], template(['<script>', '</script>'], 'pwn()'))));
  assert.equal(served, 'ssr-script-hole');
});

test('a hole the scan would place in a tag inside a script’s source is refused (svg, noscript, a select’s child)', () => {
  const V = '1;pwn();//';
  for (const statics of [
    ['<select><script>x=a<b c=', '></script></select>'],
    ["<select><script>x=a<b c='", "'></script></select>"],
    ['<select><script>x=a<b ', '></script></select>'],
    ['<svg><script>x=a<b c=', '></script></svg>'],
    ['<noscript><script>x=a<b c=', '></script></noscript>'],
  ])
    assert.equal(refusal(() => serializeTemplate(template(statics, V))), 'ssr-script-hole', statics[0]);
  assert.equal(refusal(() => serializeTemplate(template(['<select>', '</select>'], template(['<script>x=a<b c=', '></script>'], V)))), 'ssr-script-hole', 'a child in a select');
});

/**
 * Straight inside a select both parsers read a `<script>` as raw text and a `<textarea>` as text, so the server reads them
 * as it does at depth 0: each served form here is byte for byte what it served before a select was tracked (2026-11-21).
 */
test('a script or textarea straight inside a select is read as at depth 0 — its source is not markup', () => {
  const same = [
    [[`<select><script>var s="<b title='";</script>`, ` it's here</select><p id=after></p>`], 'v', `<select><script>var s="<b title='";</script>v it's here</select><p id=after></p>`],
    [['<select><script>if(a<b) go();</script>', '</select>'], 'v', '<select><script>if(a<b) go();</script>v</select>'],
    [['<select><script type="application/json">', '</script></select>'], 'a<b', '<select><script type="application/json">a\\u003cb</script></select>'],
    [[`<select><textarea>it's <b title='</textarea>`, ' x</select>'], '</textarea><img id=pwn src=x>', `<select><textarea>it's <b title='</textarea>&#60;/textarea&#62;&#60;img id=pwn src=x&#62; x</select>`],
    [['<select><textarea>', '</textarea></select>'], '</textarea><img id=pwn src=x>', '<select><textarea>\n&#60;/textarea&#62;&#60;img id=pwn src=x&#62;</textarea></select>'],
    [['<select><option>a</option><script>x=1</script><option>', '</option></select>'], 'b', '<select><option>a</option><script>x=1</script><option>b</option></select>'],
  ];
  for (const [statics, value, served] of same) {
    assert.equal(serializeTemplate(template(statics, value)), served, statics[0]);
    assert.ok(!injected(served), `${statics[0]}: ${served}`);
  }
});

test('a select a template leaves open is closed at its end, as the client closes it', () => {
  assert.equal(serializeTemplate(template(['<select><option>', ''], 'x')), '<select><option>x</select>');
  assert.equal(serializeTemplate(template(['<div .innerHTML=', '></div>'], '<select><option>a')), '<div><select><option>a</select></div>');
  assert.equal(serializeTemplate(template(['<select><option>', '</option></select><style>', '</style>'], 'x', '.a{}')), '<select><option>x</option></select><style>.a{}</style>');
});

test('the served forms the browser suite parses are what the server serves', () => {
  assert.ok(SELECT_CASES.length >= 4, `a floor on the cases (4 on 2026-11-21): ${SELECT_CASES.length}`);
  for (const { statics, value, served } of SELECT_CASES) assert.equal(serializeTemplate(template(statics, value)), served, statics.join('${…}'));
});
