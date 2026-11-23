/**
 * **A comment inside a text element the scan holds is a comment in one reading only.** Where the namespace is unknown
 * (an end tag at an integration point that the browser may ignore), or in `<noscript>`/`<select>` markup, the server
 * holds a text-only element or `<style>` until its own end tag and scans its content as markup. A `<!`, `<!--` or `<?`
 * there opens a comment in that reading, but in the other the browser is in the element's text, and the client
 * renderer places the value there: `<math><mi></foreignObject><style><!${v}` puts it in an HTML `<style>` in Chromium,
 * Firefox and WebKit. The server dropped it, so a served page lacked a value client rendering shows (a rotated fuzz seed
 * found it). Now the value is written as text, escaped, so neither reading lets it end the comment or the element early,
 * and a template there is refused as in a text-only element. An ordinary comment still drops its value, as the client
 * does. Planted red by restoring the drop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';

const template = (statics, values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });
const PAYLOAD = '--></style></script></textarea></title></noscript>"\'><img id=pwn> pwn=1 x=';
const SENTINEL = 'zq0zq';

/** Whether the parsed page holds an element the payload made. */
const injected = (html) => {
  let found = false;
  const walk = (node) => {
    if (node.nodeName === 'img' || node.attrs?.some((attribute) => attribute.name === 'pwn')) found = true;
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(`<!doctype html><body>${html}`, { scriptingEnabled: true }));
  return found;
};
const codeOf = (run) => {
  try {
    run();
    return 'served';
  } catch (error) {
    return /\(([a-z-]+)\)\s*$/.exec(error.message)?.[1] ?? error.message;
  }
};

/** Each held text element with a comment opener before the hole. */
const HELD = [
  ['<math><mi></foreignObject><style><!', '></style></mi></math>'],
  ['<math><mi></foreignObject><style><!--', '--></style></mi></math>'],
  ['<math><mi></foreignObject><style><?', '></style></mi></math>'],
  ['<svg><title></g><style><!', '></style></title></svg>'],
  ['<svg><desc></foreignObject><textarea><!', '></textarea></desc></svg>'],
  ['<noscript><style><!', '></style></noscript>'],
];

test('a hole in a comment inside a held text element is written as text: never markup, never dropped', () => {
  assert.equal(injected('<p></p><img id=pwn>'), true, 'CONTROL: the check finds a planted element');
  for (const statics of HELD) {
    const label = JSON.stringify(statics);
    const attack = serializeTemplate(template(statics, [PAYLOAD]));
    assert.equal(injected(attack), false, `${label}: the payload made markup -> ${attack}`);
    const served = serializeTemplate(template(statics, [SENTINEL]));
    assert.ok(served.includes(SENTINEL), `${label}: the value was dropped -> ${served}`);
  }
});

/**
 * **A value's dashes cannot end the comment in the other reading.** Where the held element's content is MARKUP, a value
 * `--` before a static `>` (or `-` before `->`) closes the comment, and the statics after it are markup the scan still
 * reads as comment text — so a later hole, served as text, would sit in an unquoted attribute there. Each shape is
 * parsed both ways: as the page (the parser's reading) and with the held element re-read inside `<svg>`, where its
 * content is markup and comments close as written.
 */
const hasHandler = (html) => {
  let found = false;
  const walk = (node) => {
    if (node.attrs?.some((attribute) => attribute.name.startsWith('on'))) found = true;
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(`<!doctype html><body>${html}`, { scriptingEnabled: true }));
  return found;
};
/** The served markup from the held element's own start tag on, read as foreign content (comments are real there). */
const markupReading = (served, element) => `<svg>${served.slice(served.lastIndexOf(`<${element}>`))}`;
const DASHES = [['--', '>'], ['-', '->']];
/**
 * Shapes whose PAGE reading is the markup one: at an integration point an end tag is read by the foreign-content rules
 * and pops to a foreign element of its name, so the `<style>`/`<textarea>` after it is SVG or MathML (BROWSER-LEDGER,
 * the three engines). Whether the scan holds these or knows them, no value may make a handler.
 */
const POPPED = [
  ['<svg><g><title></g><style><!--', '--></style></svg>'],
  ['<svg><a><title></a><style><!--', '--></style></svg>'],
  ['<math><mrow><mtext></mrow><style><!--', '--></style></math>'],
  ['<svg><g><desc></g><textarea><!--', '--></textarea></svg>'],
];
const ATTACK = 'x onerror=alert(1)';

test('a value cannot end the held comment in the reading where it is markup, so a later hole stays text', () => {
  assert.equal(hasHandler(`<svg><style><!----><img title=${ATTACK}></style></svg>`), true, 'CONTROL: raw dashes end the comment in the markup reading');
  let rows = 0;
  for (const [lead, tail] of [...HELD, ...POPPED]) {
    const element = /<(style|textarea)>/.exec(lead)[1];
    for (const [dashes, close] of DASHES) {
      const served = serializeTemplate(template([lead, `${close}<img title=`, `>${tail}`], [dashes, ATTACK]));
      assert.equal(hasHandler(served), false, `${lead} + ${dashes}: the page reading made a handler -> ${served}`);
      assert.equal(hasHandler(markupReading(served, element)), false, `${lead} + ${dashes}: the markup reading made a handler -> ${served}`);
      rows++;
    }
  }
  assert.equal(rows, (HELD.length + POPPED.length) * DASHES.length);
  /** The whole element, not only its comments: a plain hole in each popped element makes no markup either. */
  for (const [lead] of POPPED) {
    const open = lead.replace(/<!--$/, '');
    const element = /<(style|textarea)>$/.exec(open)[1];
    const served = serializeTemplate(template([open, `</${element}>`], [`</${element}><img src=x onerror=alert(1)>`]));
    assert.equal(hasHandler(served), false, `${open}: a plain hole made a handler -> ${served}`);
  }
});

test('a template in that hole is refused, as in a text-only element', () => {
  const inner = template(['<b>', '</b>'], ['x']);
  for (const statics of HELD) assert.equal(codeOf(() => serializeTemplate(template(statics, [inner]))), 'ssr-template-in-text', JSON.stringify(statics));
});

test('an ordinary comment still drops its value, as the client does', () => {
  for (const statics of [['<div><!--', '--></div>'], ['<p><!', '></p>'], ['<svg><!--', '--></svg>']]) {
    const served = serializeTemplate(template(statics, [SENTINEL]));
    assert.equal(served.includes(SENTINEL), false, `${JSON.stringify(statics)} -> ${served}`);
  }
  /** CONTROL: the same value outside any comment is served, so its absence above is the drop, not the template. */
  assert.ok(serializeTemplate(template(['<div>', '</div>'], [SENTINEL])).includes(SENTINEL));
});
