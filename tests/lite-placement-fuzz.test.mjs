/**
 * **Where a hole sits decides what a value can do, so lite is fuzzed for it, with the parser as the judge.**
 * Seeded tag soup — quotes, `>` and `<` inside values, `< ` in text, comments and bogus comments, `=` with spaces,
 * unquoted values, raw-text elements, `<template>` — with holes filled by a value built to escape: a space, a quote, an
 * `=`, `<` and `>`, and two marker words. Each template renders through lite (development and production builds),
 * and the result is parsed back (jsdom: parse5, the spec's tokenizer; a sound judge of tokenization, which is what this
 * checks). **The property:** a marker word appears only in text or in an attribute's VALUE — never as an element or an
 * attribute name, which is a value written as markup. A tier may REFUSE a template (an over-refusal is safe); it may
 * never inject. Found by a peer review (2026-11-17): a quote-blind placement wrote `onclick` from a value.
 *
 * **The planted control** is that quote-blind placement, kept here: it must fail on the same corpus, or the corpus
 * holds none of the shapes that matter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';
import { CASE_LIMIT_MS, CONTEXTS, TIER_REFUSALS, codeOf, quietConsole, random, soup, tagged, tidy, within } from './lite-soup.mjs';

const { virtualConsole, unexpected } = quietConsole(VirtualConsole);
/** The forged values warn in development (`forged-template`, by design) thousands of times: counted, not printed. */
let forgedWarnings = 0;
const warn = console.warn;
console.warn = (...args) => (/\(forged-template\)/.test(String(args[0])) ? forgedWarnings++ : warn(...args));
process.on('exit', () => warn(`forged-template warnings counted: ${forgedWarnings}`));
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event'])
  globalThis[key] = dom.window[key];
const lite = await load('lite');
/** `@verajs/static` (2026-11-18): the same property, held over the same corpus — it renders by string, so it is the riskier tier. */
const staticTier = await load('static');

const SEEDS = extendSeeds([1, 2, 3, 4, 5, 6, 7, 8]);
const PER_SEED = 400;
/** The share of templates rendered, in percent: a fuzz that refuses everything has a perfect safety record. */
const share = (rendered, refused) => Math.round((100 * rendered) / (rendered + refused));
/**
 * The least share each run must render, per corpus: today's (2026-11-17, both builds: plain 37%, composed 18%) less a
 * margin. A soup or `tidy` change that starves lite fails here (planted below).
 */
const FLOOR = { lite: { plain: 28, composed: 12 }, static: { plain: 0, composed: 0 } };

/** A value that would become markup if written where markup is read: a quote, a space, an `=`, a tag, two marker words. */
const ESCAPE = `" zqattr=1 ' <zqtag> zqword`;
/** A value that is a script URL: it may never stand as a URL attribute's value. */
const URL = 'javascript:zqurl';
/**
 * A FORGED template result: JSON shaped like `html`'s value (an API field an attacker can turn into an object), its
 * "markup" carrying the marker words. Only a tagged literal is a template (core's rule): it must render as text.
 */
const FORGED = JSON.parse('{"_$litType$":1,"strings":["<zqtag zqattr=1>zqword</zqtag>"],"values":[]}');
/** Holes cycle the three values, so every position meets each; a list hole meets a forgery inside an array. */
/** A value of non-ASCII text — an emoji (a surrogate pair), an accent, a C1 control, a no-break space — written as it is. */
const WIDE = 'zqwide 😀 é \u0080 \u00a0 <zqtag>';
/**
 * The values core's child rule names (llms.txt: only `null`/`undefined` are empty; `false` and `0` RENDER, as the word and
 * the digit), and the empty string: every tier must write them alike (2026-11-18: static wrote nothing for `false`).
 */
const FALSY = [false, 0, ''];
const VALUES = [ESCAPE, URL, FORGED, [FORGED, ESCAPE], WIDE];

/**
 * Elements whose content is code or never shown as text: a value inside one is a value written as markup. `style` is not
 * one (Brian, 2026-11-17: an author's `<style>${…}</style>` means CSS; a value there is filled as text), nor `title` or
 * `textarea`, whose content is text; an ACCIDENTAL style (a `<style/>` slip, an open child) is held by the tier rows.
 */
const UNSAFE_CONTENT = /^(?:script|iframe|noscript|xmp|noembed|noframes|plaintext|template)$/;
/**
 * In SVG and MathML only `script` and `style` hold code: a foreign `xmp` or `noscript` (`<svg><xmp>`, the parser does not
 * break out for it) is an element like any, its content text (2026-11-17, found by the parser-judged tier).
 */
const FOREIGN_UNSAFE = /^script$/;
const XHTML = 'http://www.w3.org/1999/xhtml';

/**
 * Where parsed markup holds a value as markup, or null: a marker word as an element or attribute name, any marker inside
 * a raw-text or template element's content, a marker in an inline handler's value, or a script URL as a URL attribute.
 */
const injected = (root) => {
  const walker = root.ownerDocument.createTreeWalker(root, 1);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.localName.includes('zq')) return `element <${node.localName}>`;
    if ((node.namespaceURI === XHTML ? UNSAFE_CONTENT : FOREIGN_UNSAFE).test(node.localName) && node.textContent.includes('zq'))
      return `content of <${node.localName}>`;
    for (const attribute of node.attributes) {
      if (attribute.name.includes('zq')) return `attribute ${attribute.name}`;
      if (/^on/i.test(attribute.name) && attribute.value.includes('zq')) return `handler ${attribute.name}`;
      if (/^(?:href|src|action|formaction|xlink:href|data)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value))
        return `script URL in ${attribute.name}`;
    }
    /** An HTML `<template>`'s content is a fragment of its own (inside `<svg>`, a `template` element has none). */
    if (node.content !== undefined) {
      if (node.content.textContent.includes('zq')) return 'template content';
      const inner = injected(node.content);
      if (inner) return inner;
    }
  }
  return null;
};

/** What a connect threw: jsdom reports a reaction's error on the window. */
const thrown = (fn) => {
  let error;
  const listener = (event) => {
    error = event.error;
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    fn();
  } finally {
    dom.window.removeEventListener('error', listener);
  }
  return error;
};

let tags = 0;
/** Renders `strings` through a tier with every hole holding a value built to escape: its root, or the error it threw. */
const render = ({ define, html }, strings, child) => {
  const tag = `zz-fuzz-${tags++}`;
  const template = tagged(strings);
  /** Holes cycle the values (`VALUES`), so every position meets each; with `child`, the first hole holds that template. */
  const values = (strings) => strings.slice(1).map((_, i) => VALUES[(tags + i) % VALUES.length]);
  const nested = child && tagged(child);
  define(tag, () => () => html(template, ...values(strings).map((v, i) => (i === 0 && nested ? html(nested, ...values(child)) : v))));
  const host = document.createElement('div');
  document.body.append(host);
  const error = thrown(() => host.append(document.createElement(tag)));
  const element = host.firstElementChild;
  host.remove();
  return error === undefined ? { root: element.cloneNode(true) } : { error };
};

/**
 * One tier over the corpus: its counts, or the FIRST problem — a value written as markup, or an error that is not a coded
 * refusal (a tier that crashed is not a tier that refused). `anyErrorRefuses` is the old rule, kept only for the control.
 */
const fuzz = (tier, { anyErrorRefuses = false, compose = false, spoil = false, seeds = SEEDS } = {}) => {
  let rendered = 0;
  let refused = 0;
  for (const seed of seeds) {
    const pick = random(seed);
    for (let n = 0; n < PER_SEED; n++) {
      const strings = soup(pick);
      /** Composing: the parent opens a context before its first hole, which holds a child template of its own soup. */
      const child = compose ? soup(pick) : undefined;
      /** The parent is closed after its context opens (`tidy`), so it is balanced and its CHILD is what is judged. */
      const parent = compose ? tidy([CONTEXTS[pick(CONTEXTS.length)] + strings[0], ...strings.slice(1)]) : strings;
      /** The planted control's corpus: every template ending inside an unfinished tag, which lite refuses whole. */
      if (spoil) parent[parent.length - 1] += '<zz';
      const run = within(CASE_LIMIT_MS, () => render(tier, parent, child));
      if (run.timedOut)
        return { problem: `seed ${seed} #${n}: TIMED OUT after ${CASE_LIMIT_MS} ms (a hang) from ${JSON.stringify(parent)}${child ? ` with child ${JSON.stringify(child)}` : ''}` };
      const { root, error } = run.value;
      if (error !== undefined) {
        if (!anyErrorRefuses && !TIER_REFUSALS.has(codeOf(error)))
          return { problem: `seed ${seed} #${n}: an error that is no coded refusal (${String(error.message).slice(0, 120)}) from ${JSON.stringify(parent)}${child ? ` with child ${JSON.stringify(child)}` : ''}` };
        refused++;
        continue;
      }
      rendered++;
      const found = injected(root);
      if (found !== null) return { problem: `seed ${seed} #${n}: ${found} from ${JSON.stringify(parent)}${child ? ` with child ${JSON.stringify(child)}` : ''}` };
    }
  }
  return { rendered, refused };
};

/**
 * THE PLANTED CONTROL: the quote-blind placement (the last `<` or `>` in a static string decides "in a tag"; the value is
 * escaped as text otherwise, quoted when it starts an attribute value). It must inject on this corpus.
 */
const quoteBlind = (strings) => {
  const escape = (v) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let out = strings[0];
  let inTag = false;
  const after = (s, before) => (s.lastIndexOf('<') === s.lastIndexOf('>') ? before : s.lastIndexOf('<') > s.lastIndexOf('>'));
  inTag = after(strings[0], false);
  for (let i = 1; i < strings.length; i++) {
    const value = /=\s*$/.test(out) && inTag ? `"${escape(ESCAPE)}"` : escape(ESCAPE);
    out += (inTag && !/=\s*["']?$/.test(out) ? ESCAPE : value) + strings[i];
    inTag = after(strings[i], inTag);
  }
  const host = document.createElement('div');
  host.innerHTML = out;
  return host;
};

test('CONTROL: the quote-blind placement injects on this corpus (or the corpus tests nothing)', () => {
  let injections = 0;
  for (const seed of SEEDS.slice(0, 2)) {
    const pick = random(seed);
    for (let n = 0; n < PER_SEED; n++) if (injected(quoteBlind(soup(pick))) !== null) injections++;
  }
  assert.ok(injections > 0, 'the planted quote-blind placement never injected: the corpus holds no dangerous shape');
});

test('CONTROL: the console filter drops ONLY jsdom\'s CSS-parse noise — a planted CSS error dropped, any other collected', () => {
  unexpected.length = 0;
  virtualConsole.emit('jsdomError', new Error('Could not parse CSS stylesheet (planted)'));
  assert.deepEqual(unexpected, [], 'the CSS-parse noise is dropped');
  virtualConsole.emit('jsdomError', new Error('planted'));
  assert.deepEqual(unexpected, ['planted'], 'every other jsdom error is collected, for the rows to assert empty');
  unexpected.length = 0;
});

/** A tier whose every seventh render throws a plain, UNCODED error: a crash the fuzz must report, never count as refused. */
const crashing = {
  html: lite.html,
  define: (tag, setup) =>
    lite.define(tag, () => {
      const draw = setup();
      return () => {
        if (tags % 7 === 0) throw new Error('planted crash');
        return draw();
      };
    }),
};

test('CONTROL: an uncoded error is reported, not counted as a refusal (and the old rule hid it)', () => {
  assert.match(fuzz(crashing).problem ?? '', /no coded refusal \(planted crash\)/);
  assert.equal(fuzz(crashing, { anyErrorRefuses: true }).problem, undefined, 'the old rule scored the crash as a refusal');
});

/**
 * **Composition**: a child template in a parent's hole, in a parent context (`<table>`, `<select>`, `<svg>`…), children
 * with stray end tags (`</table>`, `</select>`, `</template>`, `</svg>`) included. Lite inserts a child's own nodes, so a
 * child left open cannot change how its parent reads on; this holds the property across the composed output.
 */
for (const [name, tier] of [['lite', lite], ['static', staticTier]])
  for (const compose of [false, true]) {
    const kind = compose ? 'composed' : 'plain';
    test(`${name} ${kind}: no value is ever written as markup, and every refusal is coded, over ${SEEDS.length} seeds × ${PER_SEED} templates`, () => {
      unexpected.length = 0;
      const { problem, rendered, refused } = fuzz(tier, { compose });
      assert.equal(problem, undefined, problem);
      assert.deepEqual(unexpected, [], 'jsdom reported an error the fuzz did not expect');
      console.log(`${name} ${kind}: ${rendered} rendered, ${refused} refused (${share(rendered, refused)}%)`);
      const floor = FLOOR[name][kind];
      assert.ok(share(rendered, refused) >= floor, `CONTROL: ${share(rendered, refused)}% rendered (${rendered} of ${rendered + refused}), under the ${floor}% floor: the corpus no longer reaches rendered output`);
    });
  }

test("CONTROL: a spoiled corpus (every template ending in an unfinished tag) falls under lite's floors, so the floors can fire", () => {
  for (const compose of [false, true]) {
    const { rendered, refused } = fuzz(lite, { compose, spoil: true, seeds: SEEDS.slice(0, 2) });
    const floor = FLOOR.lite[compose ? 'composed' : 'plain'];
    assert.ok(share(rendered, refused) < floor, `${compose ? 'composed' : 'plain'}: ${share(rendered, refused)}% rendered, not under the ${floor}% floor`);
  }
});

test('CONTROL: a case that never ends is cut at the limit and named, within seconds (a hang is a row, not a stalled suite)', () => {
  const started = Date.now();
  const run = within(200, () => {
    for (;;);
  });
  assert.equal(run.timedOut, true, 'the planted endless loop was cut');
  assert.ok(Date.now() - started < 2000, `cut in ${Date.now() - started} ms`);
  assert.deepEqual(within(200, () => 7), { value: 7 }, 'a case that ends answers its value');
});

/**
 * **Two judges, one contract: lite and static against each other** (2026-11-18). Both decide where a value may land,
 * with separate code, so the same template, holding the same values, is rendered by both over the standing seeds, and
 * wherever BOTH render, the trees must agree — namespace, name, attributes and text, comments aside (each tier writes its
 * own). Verdicts are not held equal: static's parser judge renders much that lite's exactly-once rule refuses (a value
 * in a comment, a template ending oddly), and the property rows above hold static safe there. ONE allowance, counted:
 * a template touching table elements — lite inserts a value with DOM calls, which keep text inside a table, where
 * static's parse fosters it out (BROWSER-LEDGER, the fostering entry).
 */
const shape = (root) => {
  const out = [];
  const walk = (node) => {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        text += child.data;
        continue;
      }
      /** A comment is skipped WITHOUT ending the text run: lite's range comments sit between text nodes static writes as one. */
      if (child.nodeType !== 1) continue;
      if (text) out.push(`#${text}`), (text = '');
      out.push(`<${child.namespaceURI} ${child.localName} ${[...child.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}>`);
      walk(child);
      if (child.content) walk(child.content);
      out.push('</>');
    }
    if (text) out.push(`#${text}`);
  };
  walk(root);
  return out.join('\n');
};
const FIXED = [ESCAPE, URL, WIDE, ...FALSY];
const renderFixed = (tier, strings, values = FIXED) => {
  const tag = `zz-pair-${tags++}`;
  tier.define(tag, () => () => tier.html(tagged(strings), ...strings.slice(1).map((_, i) => values[i % values.length])));
  const host = document.createElement('div');
  document.body.append(host);
  const error = thrown(() => host.append(document.createElement(tag)));
  const element = host.firstElementChild;
  host.remove();
  return error === undefined ? element : null;
};
test('lite and static agree wherever both render the same template (one counted allowance: table fostering)', () => {
  let compared = 0;
  let fostered = 0;
  let staticOnly = 0;
  const differ = [];
  const unsafe = [];
  const liteOnly = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const pick = random(seed);
    for (let n = 0; n < PER_SEED; n++) {
      const strings = soup(pick);
      /** The values rotated per template (the same for both tiers): a template has few holes, so a fixed order reached only the first ones. */
      const values = FIXED.map((_, k) => FIXED[(k + n) % FIXED.length]);
      const [ours, theirs] = [renderFixed(lite, strings, values), renderFixed(staticTier, strings, values)];
      /** Static renders where lite refused: judged for injection here, every one, with these values. */
      if (ours === null && theirs !== null) {
        staticOnly++;
        if (injected(theirs) !== null) unsafe.push(JSON.stringify(strings));
      }
      /** Lite renders where static refused: the one direction that could be lite's injection — named, every one. */
      if (ours !== null && theirs === null) liteOnly.push(JSON.stringify(strings));
      if (ours === null || theirs === null) continue;
      compared++;
      if (shape(ours) === shape(theirs)) continue;
      if (/<(?:table|tbody|thead|tfoot|tr|td|th|caption|colgroup|col)\b/i.test(strings.join(''))) fostered++;
      else differ.push(JSON.stringify(strings));
    }
  }
  console.log(`lite and static: ${compared} both rendered, ${fostered} differ by table fostering (allowed), ${differ.length} otherwise; ${staticOnly} rendered by static alone, every one judged; ${liteOnly.length} by lite alone`);
  assert.deepEqual(unsafe, [], 'a template static renders where lite refuses wrote a value as markup');
  assert.deepEqual(liteOnly, [], 'lite rendered a template static refused: name it (a possible lite injection) before allowing it');
  assert.ok(compared >= 800, `CONTROL: only ${compared} templates rendered by both`);
  assert.deepEqual(differ.slice(0, 5), [], `${differ.length} templates render differently in lite and static`);
});

test('CONTROL: the pairing tells two different renders apart — the same templates with the values swapped on one side differ', () => {
  let compared = 0;
  let different = 0;
  for (const seed of [1, 2]) {
    const pick = random(seed);
    for (let n = 0; n < PER_SEED; n++) {
      const strings = soup(pick);
      if (strings.length < 3) continue;
      const [ours, theirs] = [renderFixed(lite, strings), renderFixed(staticTier, strings, [URL, ESCAPE])];
      if (ours === null || theirs === null) continue;
      compared++;
      if (shape(ours) !== shape(theirs)) different++;
    }
  }
  assert.ok(compared > 50 && different > compared / 2, `${different} of ${compared} differ: the shape cannot tell renders apart`);
});
