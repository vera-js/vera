/**
 * **The component scan renders a component exactly where the browser creates one it upgrades** — read off the
 * server's one tag scanner, against parse5. It used to walk the markup with its own copy of a tokenizer, and five of
 * thirteen shapes went wrong: `<svg><x-y>` and `<math><x-y>` were rendered (the browser never upgrades a foreign
 * element); `</textareax>` and `</scripts>` ended raw text, so a component was rendered into a textarea's value and a
 * script's source; `<b x"><x-y>` read the quote as opening a value and missed a live component; and `<x-y.z>` stopped
 * the name at the dot, rendered `x-y` and REWROTE the author's tag as `<x-y .z="">`.
 *
 * The oracle, on the SERVED page: every `<scan-kid>` the browser creates in HTML (outside inert `<template>`
 * content) carries the shadow root the server rendered, and every rendered shadow root sits on one. The one
 * exemption is a component with an SVG/MathML ancestor — the server does not model an end tag the parser ignores, so
 * there it can only under-render: a hydration mismatch, never markup in the wrong place. A static `<font color>`,
 * `face` or `size` breaks out here as in the browser; a BOUND one reads as static in the served markup this scan
 * reads, while the client's template parse never sees the attribute — that one difference is pinned below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { renderToString } from '@verajs/ssr';
import { extendSeeds } from './fuzz-seeds.mjs';

const PAGE = new URL('./fixtures/ssr/scan-ssr.js', import.meta.url);
const serve = async (markup) => {
  globalThis.__SCAN_MARKUP = markup;
  return (await renderToString(PAGE, {})).html;
};

const isShadow = (el) => el.tagName === 'template' && el.attrs.some((a) => a.name === 'shadowrootmode');
/** Disagreements between the served page and the browser's reading of it, as labels. */
const disagreements = (served) => {
  const found = [];
  const pageRoot = parse(`<!doctype html><body>${served}`).childNodes[1].childNodes[1].childNodes[0].childNodes.find(isShadow).content;
  const walk = (node, foreignAncestor) => {
    for (const child of node.childNodes ?? []) {
      if (child.tagName === undefined) continue;
      const html = child.namespaceURI.endsWith('xhtml');
      if (isShadow(child) && !(node.tagName === 'scan-kid' && node.namespaceURI.endsWith('xhtml'))) found.push(`rendered on a <${node.tagName}> the browser does not upgrade`);
      if (child.tagName === 'scan-kid' && html) {
        const rendered = child.childNodes.some((c) => c.tagName !== undefined && isShadow(c));
        if (!rendered && !foreignAncestor) found.push('a live <scan-kid> not rendered');
      }
      /** Inert template content is never walked; a rendered shadow root's content is the component's own. */
      if (child.tagName !== 'template') walk(child, foreignAncestor || !html);
    }
  };
  walk(pageRoot, false);
  return found;
};

const SHAPES = [
  '<scan-kid></scan-kid>', '<SCAN-KID></SCAN-KID>', '<scan-kid/>', '<scan-kid><scan-kid></scan-kid></scan-kid>',
  '<scan-kid a="</scan-kid>"><!-- </scan-kid> --></scan-kid>',
  '<svg><scan-kid></scan-kid></svg>', '<math><scan-kid></scan-kid></math>',
  '<svg><foreignObject><scan-kid></scan-kid></foreignObject></svg>', '<math><mtext><scan-kid></scan-kid></mtext></math>',
  '<svg><foreignObject/><scan-kid></scan-kid></svg>', '<math><svg><foreignObject><scan-kid></scan-kid></foreignObject></svg></math>',
  '<!-- <scan-kid></scan-kid> -->', '<!x <scan-kid></scan-kid> >', '<textarea><scan-kid></scan-kid></textarea>',
  '<textarea></textareax><scan-kid></scan-kid></textarea>', '<script type="text/x"></scripts><scan-kid></scan-kid></script>',
  '<template><scan-kid></scan-kid></template>', '<b x"><scan-kid></scan-kid>', '<b title="<scan-kid>"></b>',
];

test('every shape: rendered where the browser upgrades, and nowhere else', async () => {
  for (const shape of SHAPES) assert.deepEqual(disagreements(await serve(shape)), [], shape);
});

test('control: the oracle sees a rendered shadow root, and a missing one', async () => {
  assert.equal((await serve('<scan-kid></scan-kid>')).includes('<i>kid</i>'), true);
  assert.deepEqual(disagreements('<scan-page><template shadowrootmode="open"><div><scan-kid></scan-kid></div></template></scan-page>'), ['a live <scan-kid> not rendered']);
  assert.deepEqual(disagreements('<scan-page><template shadowrootmode="open"><div><svg><scan-kid><template shadowrootmode="open"></template></scan-kid></svg></div></template></scan-page>'), ['rendered on a <scan-kid> the browser does not upgrade']);
});

/**
 * **A `<font>` with a static `color`, `face` or `size` breaks out of SVG or MathML** — the parser pops the foreign
 * elements, so a component after it is an HTML element the definition upgrades: rendered on the server, as the
 * client's template parse (which sees the same static attribute) renders it.
 */
test('a component after a static <font color|face|size> in SVG or MathML is rendered, as the browser upgrades it', async () => {
  for (const shape of ['<svg><font color=x><scan-kid></scan-kid></font></svg>', '<svg><font face=x><scan-kid></scan-kid></svg>',
    '<math><font size=1><scan-kid></scan-kid></math>', '<svg><font id=a COLOR><scan-kid></scan-kid></svg>', '<svg><g><font size="2"><scan-kid></scan-kid></svg>']) {
    const served = await serve(shape);
    assert.deepEqual(disagreements(served), [], shape);
    assert.ok(served.includes('<i>kid</i>'), `rendered: ${shape} -> ${served}`);
  }
});

test('control: a <font> without them stays foreign, and its component is not rendered', async () => {
  for (const shape of ['<svg><font><scan-kid></scan-kid></svg>', '<svg><font id=a colorx=1><scan-kid></scan-kid></svg>', '<svg><font id="color"><scan-kid></scan-kid></svg>']) {
    const served = await serve(shape);
    assert.deepEqual(disagreements(served), [], shape);
    assert.ok(!served.includes('<i>kid</i>'), `not rendered: ${shape} -> ${served}`);
  }
});

/**
 * **A BOUND `<font color>` is the one place the scan and the client differ** (pinned, not endorsed): the scan reads the
 * served markup, where the bound value is static text, so it breaks out and renders the component, as the browser
 * reads that page; the client's template parse sees the attribute renamed to its binding's address, keeps `<font>`
 * foreign, and never upgrades it. No markup lands in the wrong place, but the trees differ: a hydration mismatch.
 */
test('pinned: after a BOUND <font color> in SVG the server renders the component, as the browser reads the served page', async () => {
  const served = (await renderToString(new URL('./fixtures/ssr/scan-bound-ssr.js', import.meta.url), {})).html;
  assert.ok(served.includes('<font color="red">') && served.includes('<i>kid</i>'), served);
});

/** A name that only STARTS like a registered one is another element — never rendered, and never rewritten. */
test('an unregistered name that starts like a registered one is left exactly as written', async () => {
  const served = await serve('<scan-kid.y a=b></scan-kid.y>');
  assert.ok(served.includes('<div><scan-kid.y a=b></scan-kid.y></div>'), served);
  assert.ok(!served.includes('<i>kid</i>'), served);
});

/**
 * **A `<noscript>` is HTML's only where HTML rules read its start tag** (2026-11-19, a rotated-seed find:
 * `<svg><scan-kid></math><noscript><p> a=<scan-kid></p>`). Inside `<svg>`/`<math>` proper it is a foreign element
 * like any — raw text exists only for HTML elements — so a breakout tag after it (`<p>`) pops it with the foreign
 * content and the component after it is live HTML, rendered. At an HTML integration point (`foreignObject`, `desc`,
 * `title`, `mi`, `mtext`, an HTML `annotation-xml`) HTML rules read it: an HTML `<noscript>`, raw text to parse5
 * (scripting on, as a browser running this page), so nothing inside is a component and nothing is rendered into it.
 * The element-walking oracle cannot see a component rendered into raw TEXT, so those rows also read every text node.
 */
const FOREIGN_NOSCRIPT = [
  '<svg><noscript><p><scan-kid></scan-kid></p>', '<svg><g><noscript><p><scan-kid></scan-kid></p>',
  '<math><noscript><p><scan-kid></scan-kid></p>', '<math><mrow><noscript><p><scan-kid></scan-kid></p>',
  '<svg><scan-kid></math><noscript><p> a=<scan-kid></p>',
];
const POINT_NOSCRIPT = [
  '<svg><foreignObject><noscript><scan-kid></scan-kid></noscript></foreignObject></svg>',
  '<svg><desc><noscript><scan-kid></scan-kid></noscript></desc></svg>',
  '<svg><title><noscript><scan-kid></scan-kid></noscript></title></svg>',
  '<math><mi><noscript><scan-kid></scan-kid></noscript></mi></math>',
  '<math><mtext><noscript><scan-kid></scan-kid></noscript></mtext></math>',
  '<math><annotation-xml encoding="text/html"><noscript><scan-kid></scan-kid></noscript></annotation-xml></math>',
];
/** Every text node's data in the served page, inert template content included. */
const texts = (served) => {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') out.push(child.value);
      walk(child.tagName === 'template' ? child.content : child);
    }
  };
  walk(parse(`<!doctype html><body>${served}`));
  return out;
};

test('a <noscript> in SVG/MathML content is foreign (a breakout after it reaches HTML); at an integration point it is HTML raw text, nothing rendered in it', async () => {
  for (const shape of FOREIGN_NOSCRIPT) {
    const served = await serve(shape);
    assert.deepEqual(disagreements(served), [], `${shape} -> ${served}`);
    assert.ok(served.includes('<scan-kid><template shadowrootmode'), `CONTROL: the live component is rendered: ${shape} -> ${served}`);
  }
  for (const shape of POINT_NOSCRIPT) {
    const served = await serve(shape);
    assert.deepEqual(disagreements(served), [], `${shape} -> ${served}`);
    assert.deepEqual(texts(served).filter((t) => t.includes('shadowrootmode')), [], `rendered into raw text: ${shape} -> ${served}`);
    /** CONTROL: parse5 does read this noscript as raw text — its `<scan-kid>` is text, never an element. */
    assert.ok(texts(served).some((t) => t.includes('<scan-kid>')), `the noscript's content is text: ${shape} -> ${served}`);
  }
});

const SEEDS = extendSeeds([3, 17, 404, 8086]);
const CASES_PER_SEED = 250;
/** Breakout tags are in (`<p>`, `<b>`, `</p>`…), `<font color>` and its look-alikes too. */
const TOKENS = [
  '<scan-kid>', '</scan-kid>', '<scan-kid/>', '<SCAN-KID>', '<scan-kid.y>', '<', '</', '<!', '<?', '<!--', '-->', '>', '/>', '"', "'", '=', ' ', '\v',
  'a', 'x', '<a>', '<svg>', '</svg>', '<math>', '</math>', '<foreignObject>', '</foreignObject>', '<foreignObject/>', '<mi>', '<mtext>',
  '<mglyph>', '<desc>', '<style>', '</style>', '<textarea>', '</textarea>', '</textareax>', '<title>', '<template>', '</template>',
  '<script>', '</script>', '</scripts>', '<noscript>', ' x="', "<a x'", ' a=<scan-kid>',
  '<p>', '<b>', '</p>', '<div>', "<b x'", '<font color=x>', '<font face>', '<font id=size>', '<font>',
];
const lcg = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x80000000);

test('random markup: no component rendered where the browser would not upgrade it, none missed in HTML', async () => {
  let live = 0;
  const failures = [];
  for (const seed of SEEDS) {
    const random = lcg(seed);
    for (let n = 0; n < CASES_PER_SEED; n++) {
      let markup = '';
      const length = 2 + Math.floor(random() * 9);
      for (let t = 0; t < length; t++) markup += TOKENS[Math.floor(random() * TOKENS.length)];
      const served = await serve(markup);
      live += served.split('<i>kid</i>').length - 1;
      const found = disagreements(served);
      if (found.length) failures.push(`${found.join('; ')} — ${JSON.stringify(markup)} -> ${JSON.stringify(served)}`);
    }
  }
  assert.deepEqual(failures.slice(0, 8), [], `${failures.length} failures`);
  /** The volume control: a fuzz that never renders a component proves nothing about where it renders one. */
  assert.ok(live > SEEDS.length * CASES_PER_SEED * 0.2, `only ${live} rendered`);
});
