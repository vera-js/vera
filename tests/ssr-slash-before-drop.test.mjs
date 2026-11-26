/**
 * **A binding that writes nothing after a `/` leaves the tag as the client has it: not self-closing.** A binding takes
 * the space before its name, so `<g/ @click=${fn}>` was served `<g/>`, a self-closing tag in SVG and MathML: the
 * element's children were served after it, where the client keeps them inside. Found by the tokenizer fuzz on a rotated
 * seed (`<math>onA<onA/ onA=1${…}<b>${…}` served `<onA/>`, its text moved to `<math>`).
 *
 * Each row serves a template and reads the served markup with jsdom's parser (`new JSDOM`, never this process's
 * globals, which `@verajs/ssr` owns): the text must sit in the element the template wrote it in, and an attribute
 * written before the `/` keeps its value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { serializeTemplate } = await import('@verajs/ssr');

/** A literal's strings: frozen, with an own `raw` (what compile admits). */
const literal = (strings) => Object.freeze(Object.assign([...strings], { raw: [...strings] }));
const serve = (strings, values) => serializeTemplate({ _$litType$: 1, strings: literal(strings), values });
/** The served markup as a parser reads it: the parent of the text `T`, and the parsed body. */
const read = (markup) => {
  const body = new JSDOM(`<!doctype html><body>${markup}</body>`).window.document.body;
  const walker = body.ownerDocument.createTreeWalker(body, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.data.includes('T')) return { parent: node.parentNode, body };
  return { parent: null, body };
};

test('the fuzz case: the text stays in the MathML element whose event binding was dropped', () => {
  const served = serve(['<math>onA<onA/ onA=1', '<b>', '\u000b</math>'], ['x', 'zqTzq']);
  const { parent } = read(served);
  assert.equal(parent?.localName, 'ona', `served ${JSON.stringify(served)}`);
});

test('every binding that writes nothing, after a `/` in SVG: the text stays inside the element', () => {
  const rows = [
    [['<svg><g/ @click=', '>', '</g></svg>'], [() => {}, 'T']],
    [['<svg><g/ .foo=', '>', '</g></svg>'], [1, 'T']],
    [['<svg><g/ ?hidden=', '>', '</g></svg>'], [false, 'T']],
    [['<svg><g/ &ref=', '>', '</g></svg>'], [{}, 'T']],
    [['<svg><g/ onClick=', '>', '</g></svg>'], [() => {}, 'T']],
    [['<svg><g/ onclick=', '>', '</g></svg>'], ['alert(1)', 'T']],
    [['<svg><g/ title=', '>', '</g></svg>'], [null, 'T']],
    [['<svg><g/ ', '>', '</g></svg>'], [{}, 'T']],
    [['<svg><g / @click=', '>', '</g></svg>'], [() => {}, 'T']],
    [['<svg><g a/ @click=', '>', '</g></svg>'], [() => {}, 'T']],
    [['<math><mi/ @click="', '">', '</mi></math>'], [() => {}, 'T']],
  ];
  const wrong = [];
  for (const [strings, values] of rows) {
    const served = serve(strings, values);
    const { parent } = read(served);
    if (parent?.localName !== (strings[0].includes('<mi') ? 'mi' : 'g')) wrong.push(`${JSON.stringify(strings[0])} served ${JSON.stringify(served)}`);
  }
  assert.deepEqual(wrong, []);
});

test('an unquoted value ending in `/` keeps its `/`, and the element keeps its children', () => {
  const served = serve(['<svg><g a=x/ @click=', '>', '</g></svg>'], [() => {}, 'T']);
  const { parent } = read(served);
  assert.equal(parent?.localName, 'g', `served ${JSON.stringify(served)}`);
  assert.equal(parent.getAttribute('a'), 'x/');
});

test('a binding that IS written after a `/` is served as an attribute, and the element keeps its children', () => {
  const served = serve(['<svg><g/ title=', '>', '</g></svg>'], ['a', 'T']);
  const { parent } = read(served);
  assert.equal(parent?.localName, 'g', `served ${JSON.stringify(served)}`);
  assert.equal(parent.getAttribute('title'), 'a');
});

test('CONTROL: in HTML a `/` never closes a div, before the fix or after', () => {
  const served = serve(['<div/ @click=', '>', '</div>'], [() => {}, 'T']);
  assert.equal(read(served).parent?.localName, 'div', `served ${JSON.stringify(served)}`);
});

test('CONTROL: a tag the author wrote self-closing in SVG stays self-closing', () => {
  const served = serve(['<svg><g/>', '</svg>'], ['T']);
  assert.equal(read(served).parent?.localName, 'svg', `served ${JSON.stringify(served)}`);
});
