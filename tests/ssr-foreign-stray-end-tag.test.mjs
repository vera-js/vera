/**
 * **An end tag in SVG or MathML that closes nothing the template opened can close an element OUTSIDE it.** The
 * parser's foreign-content rules walk up the open elements and hand such a tag to the HTML rules at the first HTML
 * one, which close an HTML element of that name anywhere above: the page's `<div id="host">` around
 * `<math></div><script>…` is closed, the `<math>` with it, and the `<script>` is HTML raw text, where a value's
 * `</script>` ended it (the browser fuzz, on a rotated seed, in Chromium and Firefox). The server cannot see the page,
 * so the namespace becomes unknown there, and what follows is escaped for both readings.
 *
 * Each row serves a template and parses the page with jsdom's parser (`new JSDOM`, never this process's globals,
 * which `@verajs/ssr` owns), with the template inside `<div id="host">` and bare: the hostile value must never become
 * an element, in either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { serializeTemplate } = await import('@verajs/ssr');

const literal = (strings) => Object.freeze(Object.assign([...strings], { raw: [...strings] }));
const HOSTILE = '</style></textarea></title></script></noscript><img id=pwn src=x onerror=1>';
/** Every element a value made, in the page as a browser parses it with the template inside a host div, and bare. */
const injected = (served) =>
  [`<div id="host">${served}</div>`, served].map((body) => {
    const doc = new JSDOM(`<!doctype html><body>${body}</body>`).window.document;
    return doc.querySelectorAll('#pwn, [onerror]').length;
  });
const serve = (strings, values = [HOSTILE]) => serializeTemplate({ _$litType$: 1, strings: literal(strings), values });
/**
 * What the server does with the hostile value: `'refused'` (a hole in what may be a `<script>` is refused at compile,
 * `ssr-script-hole`), or the elements it made in each reading, which must be none.
 */
const outcome = (strings) => {
  try {
    return injected(serve(strings));
  } catch (error) {
    if (/\(ssr-script-hole\)/.test(error.message)) return 'refused';
    throw error;
  }
};

test('CONTROL: the hostile value, written raw into a page, makes an element in both readings', () => {
  assert.deepEqual(injected(`<div>${HOSTILE}</div>`), [1, 1]);
});

test('the fuzz case: a stray `</div>` in MathML before `<script><b><style>${v}` injects nothing, inside a host div or bare', () => {
  /** The browser may be in HTML, where the `<script>` is raw text holding the style: a hole there is refused. */
  assert.equal(outcome(['<math><![CDATA[ x ]]></annotation-xml></a></div><script><b><style>', '</style>']), 'refused');
});

test('a stray end tag, then an element that is raw text in HTML, then a breakout, injects nothing in either reading', () => {
  /**
   * #940's shape: after the stray end tag the browser may be in HTML, where the element is raw text or RCDATA, while a
   * scan that stayed in foreign content read it as markup and let the `<b>` break it out, so the hole after it was
   * read as HTML. A script hole is refused; every other is served, escaped for both readings.
   */
  for (const space of ['math', 'svg']) assert.equal(outcome([`<${space}></div><script><b><style>`, `</style></${space}>`]), 'refused', space);
  const wrong = [];
  for (const space of ['math', 'svg'])
    for (const [end, element] of [['div', 'textarea'], ['section', 'title'], ['div', 'xmp'], ['a', 'iframe'], ['span', 'noembed'], ['div', 'noframes'], ['div', 'style']])
      for (const breakout of ['b', 'p']) {
        const strings = [`<${space}></${end}><${element}><${breakout}><style>`, `</style></${space}>`];
        const result = outcome(strings);
        if (result === 'refused') continue;
        for (const [i, count] of result.entries()) if (count !== 0) wrong.push(`${i ? 'bare' : 'in host'}: ${JSON.stringify(strings[0])} served ${JSON.stringify(serve(strings))}`);
        const anchored = new JSDOM(`<!doctype html><body><a href="#">${serve(strings)}</a></body>`).window.document.querySelectorAll('#pwn, [onerror]').length;
        if (anchored !== 0) wrong.push(`in an <a>: ${JSON.stringify(strings[0])}`);
      }
  assert.deepEqual(wrong, []);
});

test('CONTROL: a stray end tag before a plain style or script hole was already safe, and stays so', () => {
  assert.equal(outcome(['<math></div><script>', '</script></math>']), 'refused');
  assert.deepEqual(outcome(['<svg></p><style>', '</style></svg>']), [0, 0]);
  assert.deepEqual(outcome(['<math></span><textarea>', '</textarea></math>']), [0, 0]);
});

test('CONTROL: an end tag of an element the template opened keeps SVG known, so its style is markup, served as before', () => {
  const served = serve(['<svg><g></g><style>', '</style></svg>'], ['.a{fill:red}']);
  assert.equal(served, '<svg><g></g><style>.a{fill:red}</style></svg>');
  assert.deepEqual(injected(serve(['<svg><g></g><style>', '</style></svg>'])), [0, 0]);
  /** Known, a CDATA section after it compiles: at an unknown namespace one holding `>` reads two ways and is refused. */
  const cdata = serve(['<svg><defs><g></g></defs><style><![CDATA[ .a > .b {} ]]>', '</style></svg>'], ['.c{}']);
  assert.equal(cdata, '<svg><defs><g></g></defs><style><![CDATA[ .a > .b {} ]]>.c{}</style></svg>');
});

test('a breakout pops the foreign elements it leaves, so a later end tag is not matched against them', () => {
  const served = serve(['<svg><g><b>x</b></g><style>', '</style>']);
  assert.deepEqual(injected(served), [0, 0], `served ${JSON.stringify(served)}`);
});

test('a foreign end tag matches its element whatever its case', () => {
  const served = serve(['<svg><foreignObject><p></p></FOREIGNOBJECT><style>', '</style></svg>']);
  assert.deepEqual(injected(served), [0, 0], `served ${JSON.stringify(served)}`);
});

test('after a stray `</div>`, the `</math>` that closes the template\'s own `<math>` returns to HTML in both readings', () => {
  const served = serve(['<math></div></math><style>', '</style>'], ['.a > .b {}']);
  for (const body of [`<div id="host">${served}</div>`, served]) {
    const style = new JSDOM(`<!doctype html><body>${body}</body>`).window.document.querySelector('style');
    assert.equal(style?.namespaceURI, 'http://www.w3.org/1999/xhtml', `served ${JSON.stringify(served)}`);
    assert.equal(style.textContent, '.a > .b {}', 'HTML raw text, written raw as before');
  }
});

test('a child template that begins with an end tag of its PARENT\'s foreign element injects nothing, through a real render', () => {
  /** Its script form is refused, as at any stray end tag. */
  assert.throws(() => serializeTemplate({ _$litType$: 1, strings: literal(['<svg><g>', '</g></svg>']), values: [{ _$litType$: 1, strings: literal(['</g><script>', '</script>']), values: [HOSTILE] }] }), /\(ssr-script-hole\)/);
  const CHILD = literal(['</g><style>', '</style>']);
  const PARENT = literal(['<svg><g>', '</g></svg>']);
  const draw = (value) => ({ _$litType$: 1, strings: PARENT, values: [{ _$litType$: 1, strings: CHILD, values: [value] }] });
  const served = serializeTemplate(draw(HOSTILE));
  assert.deepEqual(injected(served), [0, 0], `served ${JSON.stringify(served)}`);
  assert.equal(serializeTemplate(draw(HOSTILE)), served, 'the same both renders');
});
