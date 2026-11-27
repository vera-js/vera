/**
 * **`<html>`, `<head>` and `<body>` tags are declined, and so is an `<html>` element's content** (2026-11-27). In a
 * fragment every engine drops those tags and their attributes and keeps their children; the server's DOM kept them, a
 * tree no browser builds (`<div>` holding `<html>`), and a tree that drops them cannot write the assigned bytes back.
 * In an `<html>` element the engines run the before-head and after-head modes instead (an implied `<head>`, text moved
 * into `<body>`), which a fragment parse got wrong on 7 of 12 rows. Declined markup is served as assigned and warns.
 * Each row is compared with jsdom's parser (parse5), which Chromium 159, Firefox 159 and WebKit 27.2 agree with here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

await import('@verajs/ssr');
const real = new JSDOM('<!doctype html><body></body>').window.document;
const shim = globalThis.document;

const describe = (n) => n.nodeType === 3 ? JSON.stringify(n.data) : `${n.localName}(${[...n.childNodes].map(describe).join(',')})`;

/** Every warning a block prints, so a decline is seen as one rather than inferred from an empty answer. */
const warnings = (run) => {
  const seen = [];
  const warn = console.warn;
  console.warn = (message) => seen.push(String(message));
  try {
    run();
  } finally {
    console.warn = warn;
  }
  return seen;
};

const SHELL = [
  '<html><head><title>t</title></head><body>x</body></html>', '<html><head><title>t</title></head><body>x',
  '<body>x</body>', '<body>x', '<head><meta charset="utf-8"></head>x', '<html lang="fr"><body class="c">z</body></html>',
  'a</body>b</html>c', '<div><body><p>y</p></body></div>', '<HTML><BODY>u</BODY></HTML>',
  '<p>a</p><head><style>s{}</style></head><p>b</p>',
];

test('a fragment holding html, head or body tags is declined, served as assigned, and warns', () => {
  /** The decline warning prints once per process per component (the page, here): one across all the rows. */
  let declined = 0;
  for (const markup of SHELL) {
    const theirs = real.createElement('div');
    theirs.innerHTML = markup;
    assert.ok(theirs.childNodes.length > 0, `CONTROL: the parser read ${markup}`);
    assert.ok(!/(html|head|body)\(/.test(describe(theirs)), `CONTROL: the parser drops the tags of ${markup}`);
    const host = shim.createElement('div');
    host.innerHTML = markup;
    const seen = warnings(() => assert.equal(host.childNodes.length, 0, `${markup}: declined`));
    declined += seen.filter((message) => message.includes('ssr-markup-declined')).length;
    assert.equal(host.innerHTML, markup, `${markup}: served as assigned`);
  }
  assert.equal(declined, 1, 'the decline warned, once');
});

test('markup without those tags still parses (the decline is by name, not by everything)', () => {
  const markup = '<ul><li>a<li>b</ul><p>x<b>y</b></p>';
  const theirs = real.createElement('div');
  theirs.innerHTML = markup;
  const host = shim.createElement('div');
  host.innerHTML = markup;
  assert.equal(describe(host), describe(theirs));
  assert.equal(host.innerHTML, markup);
});

test('an html element\'s content is declined, and the document still answers body and title', () => {
  for (const markup of ['<head><title>t</title></head><body>x</body>', '<div>a</div>']) {
    const theirs = real.createElement('html');
    theirs.innerHTML = markup;
    assert.equal(describe(theirs).startsWith('html(head('), true, `CONTROL: the parser implies a head for ${markup}`);
    shim.documentElement.innerHTML = markup;
    assert.equal(shim.documentElement.childNodes.length, 0, `${markup}: declined`);
    assert.equal(shim.documentElement.innerHTML, markup, `${markup}: served as assigned`);
    assert.equal(shim.body.localName, 'body');
    assert.equal(shim.title, '');
  }
});
