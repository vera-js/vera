/**
 * **The server's tag scanner reads a tag where the HTML tokenizer does — and `.innerHTML`'s inertness scan is that
 * same scanner.** parse5, the standard's reference tokenizer, is the oracle; every row here was LIVE or wrong before.
 *
 * Two scanners read markup on the server: the template scan (where a hole is text, an attribute value or raw text)
 * and the trusted-markup scan that makes an `.innerHTML` value inert (its `<script>`s and `<template
 * shadowrootmode>`s). Each approximated the tokenizer, differently, and drifted:
 *
 * - the template scan stopped a tag NAME at the first character outside `[a-zA-Z0-9-]`, so `<script.x>` — an
 *   unknown element to the browser — read as a `<script>`, and a value inside it was written RAW: its
 *   `<img onerror>` ran (in the published 0.2.1 too). It also opened a tag at any `<` and a value at any `=`;
 * - the `.innerHTML` scan read a quote inside an attribute name as opening a value, so `<b x"><script>` served a
 *   live script, and skipped `<style>` content inside `<svg>`/`<math>`, where it is markup.
 *
 * They are one scanner now, modeled on the tokenizer's own states. The fuzz half of this pin — random statics,
 * every hole classified against parse5 — is `ssr-tokenizer-fuzz.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';

/** A template literal's shape, built by hand: a strings array that owns `raw`, as only a literal's does. */
const template = (statics, ...values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });
const content = (markup) => serializeTemplate(template(['<div .innerHTML=', '></div>'], markup));

/** Every element the browser builds, template contents included — where a script or shadow root would act. */
const elements = (node, out = []) => {
  for (const child of node.childNodes ?? []) {
    if (child.tagName) out.push(child);
    elements(child, out);
    if (child.content) elements(child.content, out);
  }
  return out;
};
const page = (markup) => elements(parse(`<!doctype html><body>${markup}`, { scriptingEnabled: true }));
const live = (served) =>
  page(served).filter(
    (el) =>
      (el.tagName === 'script' && el.attrs.find((a) => a.name === 'type')?.value !== 'text/x-vera-inert') ||
      (el.tagName === 'template' && el.attrs.some((a) => a.name === 'shadowrootmode' || a.name === 'shadowroot'))
  );

const SCRIPT = '<script>x</script>';
const SHADOW = '<template shadowrootmode=open></template>';
/** Each was served live: the scan saw no start tag where the tokenizer reads one. */
const WAS_LIVE = [
  `<svg><style>${SCRIPT}</style></svg>`,
  `<math><style>${SCRIPT}</style></math>`,
  `<b x">${SCRIPT}`,
  `<b x">${SHADOW}`,
  `<b =">${SCRIPT}">`,
  `<b=">${SCRIPT}">`,
  `<b a=x">${SCRIPT}`,
  '<template/shadowrootmode=open></template>',
  '<template a="x"shadowrootmode=open></template>',
];
/** Already inert, kept so the rewrite cannot trade one shape for another. */
const STAYED_INERT = [
  SCRIPT,
  `<!x=">${SCRIPT}`,
  `<?x=">${SCRIPT}`,
  `</ x=">${SCRIPT}`,
  `<1 a=">${SCRIPT}`,
  `<script.x a=">${SCRIPT}`,
  `<title.x a=">${SCRIPT}`,
  `<b a="x"y=">${SCRIPT}`,
  `<svg><foreignObject><style>${SCRIPT}</style></foreignObject></svg>`,
  `<svg></p><style>${SCRIPT}</style>`,
  `<textarea>${SCRIPT}</textarea>`,
  `<noscript>${SCRIPT}</noscript>`,
  `<template>${SCRIPT}</template>`,
  `<!-->${SCRIPT}`,
  `<!--->${SCRIPT}`,
  `<!-- --!>${SCRIPT}`,
  `<style></style >${SCRIPT}`,
  `<style></stylex>${SCRIPT}</style>`,
  '<SCRIPT>x</SCRIPT>',
  '<scRipt/>x',
  '<template ShadowRootMode=open></template>',
  '<template shadowrootmode=open/>',
  '<template\tshadowrootmode=open></template>',
];

test('.innerHTML: every start tag the tokenizer reads is made inert — the shapes that were served live', () => {
  for (const markup of WAS_LIVE) assert.deepEqual(live(content(markup)).map((el) => el.tagName), [], markup);
});

test('.innerHTML: and the shapes that were already inert stay so', () => {
  for (const markup of STAYED_INERT) assert.deepEqual(live(content(markup)).map((el) => el.tagName), [], markup);
});

/** The control: the oracle sees a live script and a live shadow root when nothing neutralizes them. */
test('control: the oracle reports the unneutralized shapes live', () => {
  assert.deepEqual(live(`<div>${SCRIPT}${SHADOW}</div>`).map((el) => el.tagName), ['script', 'template']);
  assert.deepEqual(live(`<div><b x">${SCRIPT}</div>`).map((el) => el.tagName), ['script']);
});

test('.innerHTML: a text `<script` and a quoted one are left as written — only start tags are rewritten', () => {
  const served = content(`<p title="<script>">a &lt;script&gt;</p>`);
  assert.equal(served, `<div><p title="<script>">a &lt;script&gt;</p></div>`);
});

/**
 * **An unfinished tag is dropped, as an assignment's parser drops it at the end of input.** Served, it swallowed the
 * page after it: `<b title="` ran on into the host's end tag and every following element, up to the next `"` — where
 * escaped page TEXT (`onmouseover=…`) was then read as attributes of the swallowed tag.
 */
test('.innerHTML: an unfinished tag is dropped, and a stray `<` or `</` is text', () => {
  assert.equal(content('a<b title="x'), '<div>a</div>');
  assert.equal(content('a<b'), '<div>a</div>');
  assert.equal(content('a<script'), '<div>a</div>');
  assert.equal(content('a<'), '<div>a&lt;</div>');
  assert.equal(content('a</'), '<div>a&lt;/</div>');
  const after = serializeTemplate(template(['<div .innerHTML=', '></div><p>"', '</p>'], 'a<b title="', ' onmouseover=alert(1) '));
  const p = page(after).find((el) => el.tagName === 'p');
  assert.ok(p, after);
  assert.ok(!page(after).some((el) => el.attrs.some((a) => a.name === 'onmouseover')), after);
  /** An unfinished END tag of the raw-text element it was closing leaves it open — so it is closed. */
  assert.equal(content('<style>a</style'), '<div><style>a</style></div>');
});

/** The value is untrusted: whatever it holds, it must not become an element. */
const PAYLOAD = '<img id=pwn src=x>';
const injected = (served) => page(served).some((el) => el.attrs.some((a) => a.name === 'id' && a.value === 'pwn'));

test('a hole inside an element whose name only STARTS like a raw-text one is escaped text — `<script.x>`', () => {
  for (const name of ['script.x', 'style:x', 'script_x', 'style·x', 'title.x', 'textarea.x']) {
    const served = serializeTemplate(template([`<${name}>`, `</${name}>`], PAYLOAD));
    assert.ok(!injected(served), served);
    assert.ok(served.includes('&#60;img'), served);
    assert.ok(!/<\/(script|style|title|textarea)>$/.test(served), `no stray closer: ${served}`);
  }
});

test('control: a real JSON data block and <style> still carry their hole (raw, `<` as \\u003c in the block)', () => {
  assert.equal(serializeTemplate(template(['<script type="application/json">', '</script>'], 'a<b')), '<script type="application/json">a\\u003cb</script>');
  assert.equal(serializeTemplate(template(['<style>', '</style>'], '.a>.b{}')), '<style>.a>.b{}</style>');
});

/** A `<` the tokenizer reads as text, and a bogus comment, are not tags: a template holding one is not refused. */
test('a `<` before a non-letter, `<!x`, `<?x` and `</ x` open no tag', () => {
  for (const lead of ['<1 a="', '<!x="', '<?x="', '</ x="']) {
    const served = serializeTemplate(template([`${lead}><p>`, '</p>'], PAYLOAD));
    assert.ok(!injected(served), served);
    assert.ok(served.startsWith(lead), served);
  }
});

/** `=` inside a tag name, or first in an attribute name, opens no value — the markup is served as written. */
test('an `=` the tokenizer reads as a NAME character opens no value', () => {
  for (const lead of ['<b="', '<b ="']) {
    const served = serializeTemplate(template([`${lead}><p>`, '</p>">'], PAYLOAD));
    assert.ok(!injected(served), served);
    assert.ok(served.startsWith(`${lead}><p>&#60;img`), served);
  }
});

/** `\v` and U+00A0 are not whitespace to the tokenizer: `<b\vx="` is ONE tag name, so no value opens. */
test('only the tokenizer’s whitespace separates a tag name from its attributes', () => {
  for (const space of ['\v', ' ']) {
    const served = serializeTemplate(template([`<b${space}x="><p>`, '</p>'], PAYLOAD));
    assert.ok(!injected(served), JSON.stringify(served));
  }
});

/**
 * **Self-closing is the tokenizer's `/>` — never a `/` that ends an unquoted value.** `<svg a=x/>` OPENS the svg (its
 * value is `x/`), so a `<style>` after it is SVG and its content markup: read as closed, the hole was written raw.
 * And on an HTML element `/>` is ignored, so `<style/>` opens raw text exactly as `<style>` does.
 */
test('`<svg a=x/>` leaves the svg open, and `<style/>` opens raw text', () => {
  const svg = serializeTemplate(template(['<svg a=x/><style>', '</style></svg>'], PAYLOAD));
  assert.ok(!injected(svg), svg);
  assert.ok(svg.includes('&#60;img'), svg);
  assert.equal(serializeTemplate(template(['<style/>', '</style>'], '.a>.b{}')), '<style/>.a>.b{}</style>');
  assert.equal(serializeTemplate(template(['<svg/><style>', '</style>'], '.a>.b{}')), '<svg/><style>.a>.b{}</style>');
});

/** `</scripts` ends nothing: the end tag needs the tokenizer's boundary after its name. */
test('a raw-text element ends only at its own end tag', () => {
  const served = serializeTemplate(template(['<script type="application/json">a</scripts>', '</script>'], 'b'));
  /** Every `<` of a JSON block's composed text is `\u003c`, statics too (2026-11-18): the block still ends only at `</script>`. */
  assert.equal(served, '<script type="application/json">a\\u003c/scripts>b</script>');
  const style = serializeTemplate(template(['<style>a</style\v>', '</style>'], '.a>.b{}'));
  /** `</style\v` ends nothing, and is written closed all the same, as the client writes the composed text (2026-11-18). */
  assert.equal(style, '<style>a<\\/style\v>.a>.b{}</style>');
});

/**
 * **A binding is classified by the same scan, so one inside a comment or text-only element is not a binding.** The
 * sigil, event and tag questions were answered by tests on the static's tail, which knew nothing of comments or raw
 * text: `<!-- <div .innerHTML=${v}> -->` honored the binding INSIDE the comment, so a `-->` in `v` ended it and the rest
 * was live; `<textarea><b .innerHTML=${v}>` broke out of the textarea the same way. The client drops all of these.
 */
test('a sigil or event binding inside a comment or a text-only element is no binding', () => {
  const breakout = '--></textarea></title></style></xmp><img id=pwn src=x>';
  for (const [open, close] of [['<!-- ', ' -->'], ['<textarea>', '</textarea>'], ['<title>', '</title>'], ['<style>', '</style>'], ['<xmp>', '</xmp>']])
    for (const binding of ['<div .innerHTML=', '<input .value=', '<b ?hidden=', '<b onClick=']) {
      const served = serializeTemplate(template([`${open}${binding}`, `>${close}`], breakout));
      assert.ok(!injected(served), served);
      assert.ok(served.startsWith(`${open}${binding}`), `the static is kept as text: ${served}`);
    }
});

test('a `<` the tokenizer reads as text opens no tag, so a sigil after it is text', () => {
  const served = serializeTemplate(template(['<p><1 .x=', '</p>'], 'v'));
  assert.equal(served, '<p><1 .x=v</p>');
});

test('a sigil or event name INSIDE an attribute value is part of that value', () => {
  assert.equal(serializeTemplate(template(['<b title="a .x=', '">t</b>'], 'v')), '<b title="a .x=v">t</b>');
  assert.equal(serializeTemplate(template(['<b title="a onClick=', '">t</b>'], 'v')), '<b title="a onClick=v">t</b>');
});

/**
 * The client ignores static text beside a sigil or event hole (`<a @click=${fn}x>` renders `<a>`), so the server drops
 * the rest of that value with the binding. Left in, it was glued to the tag — `<ax>`, and `<textareascript<style>` for
 * a textarea, whose content then parsed as live markup.
 */
test('the rest of a dropped binding’s value goes with it, quoted or not, and nothing after it', () => {
  const fn = () => {};
  assert.equal(serializeTemplate(template(['<a onClick=', 'x>1</a>'], fn)), '<a>1</a>');
  assert.equal(serializeTemplate(template(['<a onClick="', 'x">1</a>'], fn)), '<a>1</a>');
  assert.equal(serializeTemplate(template(['<a @click=', 'x title=b>1</a>'], fn)), '<a title=b>1</a>');
  assert.equal(serializeTemplate(template(['<a ?hidden=', 'x>1</a>'], true)), '<a hidden="">1</a>');
  assert.equal(serializeTemplate(template(['<textarea onA=', 'script<style>t</textarea>'], 'v')), '<textarea>t</textarea>');
  assert.equal(serializeTemplate(template(['<a @click=', '>abc ', ' def</a>'], fn, 'T')), '<a>abc T def</a>');
});

/**
 * A sigil or event binding owns every hole until its value ends: the client drops them all with the attribute. Before,
 * a second hole fell through to the attribute path with the binding's quote gone, and a value in it wrote attributes.
 */
test('a further hole in a sigil or event binding’s value is dropped with it, whatever it holds', () => {
  const fn = () => {};
  const hostile = '" onx=1 y="';
  assert.equal(serializeTemplate(template(['<a @click=', '', '>1</a>'], fn, ' onx=1 y=')), '<a>1</a>');
  assert.equal(serializeTemplate(template(['<a @click="', 'x', '">1</a>'], fn, hostile)), '<a>1</a>');
  assert.equal(serializeTemplate(template(['<a onClick="', ' ', '">1</a>'], fn, hostile)), '<a>1</a>');
  /**
   * A `?` or `.` value's holes are JOINED, as the client joins them (`"true " + hostile` is truthy; the control's value is
   * the whole text) — and the hostile second value is still never an attribute of its own: it stays inside the quotes.
   */
  const joinedBoolean = serializeTemplate(template(['<a ?hidden="', ' ', '">1</a>'], true, hostile));
  const joinedValue = serializeTemplate(template(['<input .value="', ' ', '">'], 'v', hostile));
  assert.equal(joinedBoolean, '<a hidden="">1</a>');
  assert.equal(joinedValue, '<input value="v &#34; onx=1 y=&#34;">');
  for (const served of [joinedBoolean, joinedValue]) {
    const element = parse(`<!doctype html><body>${served}`).childNodes[1].childNodes[1].childNodes[0];
    assert.deepEqual(element.attrs.map((a) => a.name).filter((name) => name !== 'hidden' && name !== 'value'), [], served);
  }
  assert.equal(serializeTemplate(template(['<a @click="', 'x', '">1</a>'], fn, 'v')), '<a>1</a>');
  assert.equal(serializeTemplate(template(['<a @click="', '', '', '">1</a>'], fn, hostile, hostile)), '<a>1</a>');
});

/**
 * Two shapes 0.3.4 also served as attributes: a second value that breaks out of the binding's quotes, and an unquoted
 * value a vertical tab continues (U+000B is not whitespace to the tokenizer, so the value runs on into the next hole).
 */
test('a quote-breaking second value, and an unquoted value a vertical tab continues, are dropped with the binding', () => {
  const fn = () => {};
  const rows = [
    [['<a @click="', '', '">1</a>'], '" onx=1 y="'],
    [["<a @click='", '', "'>1</a>"], "' onx=1 y='"],
    [['<a @click=', '\v', '>1</a>'], ' onx=1 y='],
  ];
  const wrong = rows.map(([statics, value]) => serializeTemplate(template(statics, fn, value))).filter((served) => served !== '<a>1</a>');
  assert.deepEqual(wrong, []);
});

/**
 * **A sigil binding is its attribute's name, whatever statics its value holds**, and a `?`, `.` or `!` value with
 * statics or several holes is one string, joined as the client joins it (its statics decoded first). Before, a static
 * before the hole wrote a literal attribute (`@click="x() => {}"`: the handler's source in the page), and several
 * holes were read as the first alone.
 */
test('a sigil binding with statics in its value is still the binding, and its value is joined as the client joins it', () => {
  const fn = () => {};
  const rows = [
    [['<a @click="x', '">1</a>'], [fn], '<a>1</a>'],
    [['<a @click=x', '>1</a>'], [fn], '<a>1</a>'],
    [['<a ?hidden="x', '">1</a>'], [false], '<a hidden="">1</a>'],
    [['<a ?hidden="', 'x">1</a>'], [false], '<a hidden="">1</a>'],
    [['<a ?hidden="', ' ', '">1</a>'], [false, ''], '<a hidden="">1</a>'],
    [['<a ?hidden="', '', '">1</a>'], ['', null], '<a>1</a>'],
    [['<input .value="&amp;', '">'], ['v'], '<input value="&#38;v">'],
    [['<input .value="', '-', '">'], ['a', null], '<input value="a-">'],
    [['<input type=checkbox .checked="', '', '">'], [0, ''], '<input type=checkbox checked="">'],
    /** Trusted markup is served as written, as a lone hole's is; `<p><i>b</p>` parses to the client's `<p><i>b</i></p>`. */
    [['<p .innerHTML="&lt;i&gt;', '"></p>'], ['b'], '<p><i>b</p>'],
    [['<p title=x title=', '>1</p>'], [null], '<p>1</p>'],
  ];
  const wrong = rows
    .map(([statics, values, expected]) => [serializeTemplate(template(statics, ...values)), expected, JSON.stringify(statics)])
    .filter(([served, expected]) => served !== expected);
  assert.deepEqual(wrong, []);
});

test('control: once the binding’s value closes, the next hole is an attribute again', () => {
  const fn = () => {};
  assert.equal(serializeTemplate(template(['<a @click="', '" title=', '>1</a>'], fn, 'v')), '<a title="v">1</a>');
  assert.equal(serializeTemplate(template(['<a @click=', ' title=', '>1</a>'], fn, 'v')), '<a title="v">1</a>');
});

test('control: a plain attribute keeps its static suffix', () => {
  assert.equal(serializeTemplate(template(['<a title=', 'x>1</a>'], 'v')), '<a title="vx">1</a>');
});

/** The tag a binding belongs to is the name the tokenizer reads — the element's `localName` — whatever its case. */
test('a form property on an upper-case tag is mirrored as on a lower-case one', () => {
  assert.equal(serializeTemplate(template(['<INPUT .value=', '>'], 'v')), serializeTemplate(template(['<input .value=', '>'], 'v')).replace('<input', '<INPUT'));
});

test('a hole inside a tag name is refused, whatever the tokenizer counts as part of the name', () => {
  for (const lead of ['<', '</', '<a\v', '<a.b'])
    assert.throws(() => serializeTemplate(template([`${lead}`, '>x'], 'b')), /cannot be a tag name/, JSON.stringify(lead));
});

/**
 * **An event binding is an attribute whose name STARTS `on` + an upper-case letter, as the client reads it.** The tail
 * pattern this replaced was unanchored, so `<b data-onClick=${v}>` matched in the middle of the name and was served as
 * `<b data->` — half an attribute, the value gone.
 */
test('only a name that starts `on` + upper case is an event binding', () => {
  const one = (head, tail = '>x</b>') => serializeTemplate(template([head, tail], 'v'));
  assert.equal(one('<b data-onClick='), '<b data-onClick="v">x</b>');
  assert.equal(one('<b aria-onX='), '<b aria-onX="v">x</b>');
  assert.equal(one('<b xonY="', '">x</b>'), '<b xonY="v">x</b>');
  /** The event binding is the client's: dropped. A lower-case `onclick` is an inline handler, refused (see the URL suites). */
  assert.equal(one('<b onClick='), '<b>x</b>');
  assert.equal(one('<b onclick='), '<b>x</b>');
});

/**
 * **An HTML integration point reads its content as HTML** — SVG `foreignObject`/`desc`/`title`, MathML
 * `mi`/`mo`/`mn`/`ms`/`mtext`, and an `annotation-xml` with an HTML `encoding` — so a `<style>` there is raw text, as
 * the browser parses it, where it used to be escaped. Every trap is on the dangerous side, where reading MathML or SVG
 * as HTML would write a hole raw into markup: a self-closed point, `mglyph`/`malignmark` (foreign again inside a text
 * point), the wrong namespace (`<math><foreignObject>`, `<svg><mi>`, and `<math><svg>`, a MathML element named svg),
 * `annotation-xml` without the encoding, an `<svg>` inside `annotation-xml`, and `<noscript>`. parse5 decides each.
 */
const styleParent = (served) => {
  const style = page(served).find((el) => el.tagName === 'style');
  return style === undefined ? 'none' : style.namespaceURI.endsWith('xhtml') ? 'html' : 'foreign';
};
test('an HTML integration point reads its <style> as raw text; every foreign look-alike escapes it', () => {
  const RAW = [
    '<svg><foreignObject>', '<svg><foreignobject>', '<svg><FOREIGNOBJECT>', '<svg><desc>', '<svg><title>', '<svg><g><foreignObject>',
    '<math><mi>', '<math><mo>', '<math><mtext>', '<math><annotation-xml encoding="text/html">',
    '<math><annotation-xml encoding="TEXT/HTML">', '<math><annotation-xml encoding=application/xhtml+xml>',
    '<math><mi><svg><foreignObject>', '<math><annotation-xml><svg><foreignObject><b>',
  ];
  const ESCAPED = [
    '<svg>', '<svg><foreignObject/>', '<math><mi><mglyph>', '<math><mi><malignmark>', '<math><foreignObject>', '<svg><mi>',
    '<math><annotation-xml>', '<math><annotation-xml encoding="text/htmlx">', '<math><annotation-xml encoding="text/html"><svg>',
    '<math><svg><foreignObject>', '<noscript><svg><foreignObject>',
  ];
  for (const [lead, raw] of [...RAW.map((l) => [l, true]), ...ESCAPED.map((l) => [l, false])]) {
    const served = serializeTemplate(template([`${lead}<style>`, '</style>'], PAYLOAD));
    assert.ok(!injected(served), `${lead}: ${served}`);
    /** Raw only where the browser builds an HTML `<style>`; elsewhere it is MathML/SVG, or (`<noscript>`, scripting on) text. */
    assert.equal(styleParent(served) === 'html', raw, `the oracle agrees about ${lead}`);
    assert.equal(served.includes(PAYLOAD), raw, `${lead}: ${served}`);
  }
});

/**
 * A child starts in its parent's namespace (see `positionOf`), so a `<foreignObject>` in a child rendered into a parent's
 * `<svg>` is the integration point it is in the browser, and the `<style>` in it HTML raw text. At a bare depth the
 * namespace is unknown, and none is recognized: the style is escaped.
 */
test("a template ending inside an integration point closes it; a child recognizes one in its parent's namespace, a bare depth none", () => {
  assert.equal(serializeTemplate(template(['<svg><foreignObject><p>', '</p>'], 'x')), '<svg><foreignObject><p>x</p></foreignobject></svg>');
  const child = template(['<foreignObject><style>', '</style></foreignObject>'], PAYLOAD);
  const served = serializeTemplate(template(['<svg>', '</svg>'], child));
  assert.ok(!injected(served), served);
  assert.equal(styleParent(served), 'html', served);
  assert.ok(served.includes(PAYLOAD), `raw, as the browser reads it: ${served}`);
  const bare = serializeTemplate(child, 1);
  assert.ok(bare.includes('&#60;img'), `escaped: a bare depth cannot know its namespace — ${bare}`);
});

/**
 * **An end tag at an integration point may close a foreign element the scan does not track** (2026-11-22). With the point
 * current, the parser reads an end tag by the foreign-content rules, which pop at an SVG/MathML element of its name, so
 * `<svg><g><foreignObject></g>` is back in SVG, where a `<style>` is markup: written raw, its value's element was live.
 * The scan now leaves the point on such a tag; a breakout name (`</p>`) closes no foreign element and leaves it alone.
 */
test('an end tag that may close a foreign ancestor of an integration point leaves the point', () => {
  const LEAVES = [
    ['<svg><g><foreignObject></g><style>', '</style></svg>'],
    ['<svg><a><title></a><style>', '</style></svg>'],
    ['<svg><video><foreignObject></video><style>', '</style></svg>'],
    ['<svg><section><foreignObject></section><style>', '</style></svg>'],
    ['<svg><article><foreignObject></article><style>', '</style></svg>'],
    /** A `<font>` with no `color`, `face` or `size` is an SVG element, so its end tag may close one. */
    ['<svg><font><foreignObject></font><style>', '</style></svg>'],
    ['<math><mrow><mtext></mrow><style>', '</style></math>'],
    ['<math><mrow><annotation-xml encoding="text/html"></mrow><style>', '</style></math>'],
  ];
  const live = [];
  for (const statics of LEAVES) {
    const served = serializeTemplate(template(statics, PAYLOAD));
    if (injected(served) || styleParent(served) !== 'foreign') live.push(served);
  }
  /** A child rendered at a parent's point, starting with the point's own end tag or an untracked ancestor's. */
  for (const [outer, inner] of [
    [['<svg><foreignObject>', '</foreignObject></svg>'], ['</foreignObject><style>', '</style>']],
    [['<svg><title>', '</title></svg>'], ['</title><style>', '</style>']],
    [['<svg><g><desc>', '</desc></g></svg>'], ['</g><style>', '</style>']],
  ]) {
    const served = serializeTemplate(template(outer, template(inner, PAYLOAD)));
    if (injected(served)) live.push(served);
  }
  assert.deepEqual(live, []);
  /** CONTROL: a breakout end tag closes no foreign element, so the point stays HTML and its style raw text. */
  for (const lead of ['<svg><foreignObject><p>x</p>', '<svg><title><span>x</span>', '<svg><foreignObject><br>', '<svg><g><foreignObject></div>']) {
    const served = serializeTemplate(template([`${lead}<style>`, '</style>'], PAYLOAD));
    assert.equal(styleParent(served), 'html', served);
    assert.ok(served.includes(PAYLOAD), served);
  }
});

/** Two seams the fuzz found: what is left where a binding was must not change how its neighbors tokenize. */
test('a dropped comment binding cannot fuse its neighbors, and an unquoted value runs to the tokenizer’s whitespace', () => {
  /** `<!` + `--!>` would be `<!--!>`, a comment OPENING, which swallowed everything after it. */
  const bogus = serializeTemplate(template(['<!', '--!><p>', '</p>'], 'x', 'shown'));
  assert.ok(page(bogus).some((el) => el.tagName === 'p'), bogus);
  /** `-` + `->` would be `-->`, ending the comment early and showing its tail as text. */
  const early = serializeTemplate(template(['<!-- a -', '-> b --><p>', '</p>'], 'x', 'y'));
  assert.ok(!parse(`<!doctype html><body>${early}`).childNodes[1].childNodes[1].childNodes.some((n) => n.nodeName === '#text' && n.value.includes('b')), early);
  /** `\v` is value text: cutting the unquoted value there left `\vb="c` to open a quote that never closed — the element lost. */
  const tail = serializeTemplate(template(['<x title=', '\vb="c>kept</x>'], 'v'));
  assert.equal(page(tail).find((el) => el.tagName === 'x')?.attrs[0].value, 'v\vb="c', JSON.stringify(tail));
});

/**
 * **An end tag the scan never opened changes nothing.** It used to lower the foreign depth for `</svg>`, `</math>` and
 * `</noscript>`, guessing it closed something a parent opened — but the parser closes only what is open, and inside
 * `<math>` a `</svg>` is ignored. So the next `<style>` was read as HTML raw text while the browser parsed MathML
 * markup, and an untrusted value's `<img onerror>` ran.
 */
test('a stray foreign end tag does not leave foreign content', () => {
  for (const [lead, close] of [['<math></svg>', '</math>'], ['<svg></math>', '</svg>'], ['<math></noscript>', '</math>']]) {
    const served = serializeTemplate(template([`${lead}<style>`, `</style>${close}`], PAYLOAD));
    assert.ok(!injected(served), served);
  }
  /** The control: the same style straight inside <math> was always escaped. */
  assert.ok(!injected(serializeTemplate(template(['<math><style>', '</style></math>'], PAYLOAD))));
  const child = template(['</svg><style>', '</style>'], PAYLOAD);
  const nested = serializeTemplate(template(['<math>', '</math>'], child));
  assert.ok(!injected(nested), `a child at an inherited depth: ${nested}`);
});

/**
 * **A breakout tag ends foreign content** — `<svg><p>` leaves SVG, so a `<style>` after it is an HTML style whose
 * content is raw text. This is the one rule that moves the scan from foreign toward HTML, the dangerous direction, so
 * each row is checked by both oracles: no injection, and raw exactly where the browser builds an HTML `<style>`. It
 * must never fire at an integration point, through `<noscript>`, or from a depth a parent gave. `<font>` breaks out
 * only with a static `color`, `face` or `size` (its own rows below); a bare one stays foreign.
 */
test('a breakout tag leaves foreign content exactly where the parser does', () => {
  const RAW = [
    '<svg><p>', '<math><b>', '<svg><g><div>', '<svg></p>', '<svg></br>', '<svg><br/>', '<svg><TABLE>', '<math><mi><mglyph><b>',
    '<svg><foreignObject><div><svg><p>', '<math><annotation-xml><b>', '<svg><mi><b>', '<math><svg><g><span>',
    '<svg><font color=red>',
  ];
  /**
   * `<svg><desc><svg><math><p></math>` breaks out to the `<desc>` point with the `<p>` current, so the parser ignores
   * the `</math>` after it; the scan does not track the `<p>` (an HTML element it tracked could close unseen, by an
   * implied end tag, and leave the point current again), so at the point `</math>` may close a foreign ancestor, and it
   * leaves the point: the browser builds an HTML `<style>` and the server escapes its value — over-escaped, the safe
   * direction (see the end-tag rows below).
   */
  const OVER_ESCAPED = '<svg><desc><svg><math><p></math>';
  const over = serializeTemplate(template([`${OVER_ESCAPED}<style>`, '</style>'], PAYLOAD));
  assert.ok(!injected(over) && styleParent(over) === 'html' && !over.includes(PAYLOAD), over);
  const ESCAPED = ['<svg><font>', '<svg><g><x-y>', '<svg><pre-x>', '<noscript><svg><p>'];
  for (const [lead, raw] of [...RAW.map((l) => [l, true]), ...ESCAPED.map((l) => [l, false])]) {
    const served = serializeTemplate(template([`${lead}<style>`, '</style>'], PAYLOAD));
    assert.ok(!injected(served), `${lead}: ${served}`);
    assert.equal(styleParent(served) === 'html', raw, `the oracle agrees about ${lead}`);
    assert.equal(served.includes(PAYLOAD), raw, `${lead}: ${served}`);
  }
  /** A template that starts at its parent's foreign depth cannot know where a breakout lands: it stays foreign. */
  const nested = serializeTemplate(template(['<svg>', '</svg>'], template(['<p><style>', '</style>'], PAYLOAD)));
  assert.ok(!injected(nested) && !nested.includes(PAYLOAD), nested);
});

/**
 * **A breakout pops EVERY foreign element it leaves**, the outermost `<svg>` or `<math>` included. One left on the scan's
 * open elements is invisible until its own end tag: inside the `<math>` opened after the breakout, `</svg>` closes
 * nothing for the parser, but the scan would find the stale `<svg>`, pop the `<math>` with it, and read the next
 * `<style>` as HTML raw text while the browser builds a MathML one, so an untrusted value's `<img>` breaks out and runs.
 * Found 2026-11-20: a plant keeping one more entry at breakOut's pop turned no row red. Both of breakOut's paths: from
 * the template's root (no HTML element open) and to an HTML element the template opened.
 */
test('a breakout pops every foreign element it leaves, so a later end tag for one of them closes nothing', () => {
  for (const lead of ['<svg><p><math></svg>', '<math><p><svg></math>', '<div><svg><g><p><math></svg>', '<div><math><b><svg></math>']) {
    const served = serializeTemplate(template([`${lead}<style>`, '</style>'], PAYLOAD));
    assert.ok(!injected(served), `${lead}: a foreign element the breakout left was closed by a later end tag — ${served}`);
    assert.equal(styleParent(served), 'foreign', `the oracle agrees about ${lead}`);
    assert.ok(!served.includes(PAYLOAD), `${lead}: ${served}`);
  }
});

/** `<svg><template>` is an SVG element, its content live markup — only an HTML `<template>`'s content is inert. */
test('a binding inside an SVG <template> is live; inside an HTML one it is dropped', () => {
  assert.equal(serializeTemplate(template(['<svg><template><text>', '</text></template></svg>'], 'v')), '<svg><template><text>v</text></template></svg>');
  assert.equal(serializeTemplate(template(['<template><b>', '</b></template>'], 'v')), '<template><b></b></template>');
  /** Inside template content an end tag closes nothing outside it: the `</svg>` is ignored, so the `<p>` is still inert. */
  const inside = serializeTemplate(template(['<svg><foreignObject><template></svg><p>', '</p>'], 'v'));
  assert.ok(!inside.includes('<p>v</p>'), inside);
  /**
   * The oracle for each: where the browser puts the value in the TEMPLATE's own markup (the statics joined around it) —
   * live in an SVG `<template>`, inert in an HTML one — is where the served page shows it, or the server drops it.
   */
  const where = (markup) => {
    const walk = (node, inert) => {
      for (const child of node.childNodes ?? []) {
        if (child.nodeName === '#text' && child.value.includes('zqv')) return inert ? 'inert' : 'live';
        const found = walk(child, inert) ?? (child.content ? walk(child.content, true) : undefined);
        if (found) return found;
      }
      return undefined;
    };
    return walk(parse(`<!doctype html><body>${markup}`), false) ?? 'absent';
  };
  for (const statics of [['<svg><template><text>', '</text></template></svg>'], ['<template><b>', '</b></template>'], ['<svg><foreignObject><template></svg><p>', '</p>']]) {
    const browser = where(statics.join('zqv'));
    const server = where(serializeTemplate(template(statics, 'zqv')));
    assert.ok(server === browser || (browser === 'inert' && server === 'absent'), `${statics.join('${…}')}: browser ${browser}, server ${server}`);
  }
});

/**
 * **`<font>` with `color`, `face` or `size` breaks out of foreign content** (the standard's conditional breakout): the
 * browser reads the `<style>` after it as an HTML style, its content raw text. The server's scan never applied the rule,
 * so it read an SVG style there, and a static `<!--` after it as a comment that swallowed the next value (found by a
 * rotated fuzz seed, 2026-11-21). parse5 is the oracle: the style's namespace, and the value as its whole text.
 */
const styleOf = (served) => {
  const find = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.tagName === 'style') return child;
      const inner = find(child);
      if (inner) return inner;
    }
    return undefined;
  };
  const style = find(parse(`<!doctype html><body>${served}`));
  return style && { ns: style.namespaceURI.endsWith('xhtml') ? 'html' : 'foreign', text: style.childNodes.map((n) => n.value ?? '').join('') };
};
test('a <font> with a static color, face or size breaks out of SVG or MathML, as the parser reads it', () => {
  const value = 'a<b>z';
  const rows = ['<svg><font color=x><style>', '<svg><font FACE="a"><style>', '<math><font size><style>', '<svg><font id=a color><style>', "<svg><font color='x' id=b><style>"];
  const wrong = rows
    .map((prefix) => [prefix, styleOf(serializeTemplate(template([prefix, '</style></font></svg>'], value)))])
    .filter(([, style]) => !(style?.ns === 'html' && style.text === value));
  assert.deepEqual(wrong, []);
});

test('the breakout runs only in foreign content, and stops at the nearest integration point', () => {
  /** Plain HTML: `<font color>` is an ordinary element, and the style after it an HTML one either way. */
  assert.deepEqual(styleOf(serializeTemplate(template(['<p><font color=x><style>', '</style></font></p>'], 'a<b>z'))), { ns: 'html', text: 'a<b>z' });
  /** Inside a foreignObject's own svg: the breakout lands in the foreignObject (HTML), where parse5 puts the style. */
  const nested = serializeTemplate(template(['<svg><foreignObject><svg><font color=x><style>', '</style></font></svg></foreignObject></svg>'], 'a<b>z'));
  assert.deepEqual(styleOf(nested), { ns: 'html', text: 'a<b>z' }, nested);
});

test('control: a <font> without them stays foreign, and a BOUND color keeps the no-breakout reading, which escapes every value', () => {
  assert.equal(styleOf(serializeTemplate(template(['<svg><font id=a><style>', '</style></font></svg>'], 'a<b>z')))?.ns, 'foreign');
  /** Bound: a nullish value would remove the attribute, so nothing is certain — and no value can make markup either way. */
  const payload = '</style><img src=x onerror=alert(1)>';
  for (const color of ['x', null, '']) {
    const served = serializeTemplate(template(['<svg><font color=', '><style>', '</style></font></svg>'], color, payload));
    assert.doesNotMatch(served, /<img/i, `color=${color}: ${served}`);
  }
});

test('the rotated seed shape: a value after <font color=x><style> and a static <!-- lands where the browser puts it', () => {
  const statics = ['<math><svg><font color=x><style></mi>', '- onA=<!--', 'textarea</p>\v<desc><mglyph>1svg</svg></math>'];
  const served = serializeTemplate(template(statics, 'zq1zq', 'zq2zq'));
  const tree = parse(`<!doctype html><body>${served}`);
  const texts = [];
  const walk = (node) => { for (const c of node.childNodes ?? []) { if (c.nodeName === '#text') texts.push(c.value); walk(c); } };
  walk(tree);
  assert.ok(texts.some((t) => t.includes('zq2zq')), `the second value is served: ${served}`);
});
