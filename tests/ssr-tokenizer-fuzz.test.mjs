/**
 * **Random statics, every hole classified against parse5 — the fuzz half of `ssr-tokenizer-states.test.mjs`.** A hand
 * list proves the shapes someone thought of; this proves the state machine. Each case is a template built from the
 * tokenizer's own alphabet (`<`, `</`, `<!`, `<?`, `<!--`, `-->`, names that start like raw-text elements, `=`, quotes,
 * `/`, `>`, whitespace including `\v`) inside a random context (HTML, `<svg>`, `<math>`, `<style>`, `<textarea>`, a
 * comment, a `<template>`), with one or two holes, and two questions are asked of it:
 *
 * 1. **Injection.** With a payload in every hole that tries every way out — `-->`, every raw-text end tag, both quotes,
 *    a space, `>` — the served page, parsed as a browser parses it, holds no element and no attribute the payload made.
 * 2. **Placement.** With a plain sentinel in each hole, the server puts it where the browser puts it in the template's
 *    own markup (the statics joined around the sentinel): the same text parent, the same attribute, the same comment.
 *    A difference is allowed only where the server drops a value on purpose — in a comment, in `<template>` content, as
 *    a sigil binding, as a name — or where the browser itself discards it (a duplicate attribute, an unfinished tag).
 *
 * A template the server refuses (a tag-name or attribute-name hole, a template ending inside a tag) is counted, not
 * failed: the refusals have their own suites. The volume control asserts enough cases were PLACED for a silence here to
 * mean something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';
import { extendSeeds } from './fuzz-seeds.mjs';

const SEEDS = extendSeeds([1, 7, 42, 1009, 31337, 271828]);
const CASES_PER_SEED = 1500;

const template = (statics, values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });

const TOKENS = [
  '<', '</', '<!', '<?', '<!--', '-->', '--!>', '>', '/>', '/', '=', '"', "'", ' ', ' ', ' ', '\n', '\v',
  'a', 'b', 'x', '1', '-', '.', ':', 'p', 'b ', 'a=', 'x="', "x='", 'a=x', 'svg', 'math', 'style', 'script',
  'textarea', 'title', 'template', 'noscript', 'xmp', 'style.x', 'script:x', 'foreignObject', '?a=', '.a=',
];
const CONTEXTS = [['', ''], ['<svg>', '</svg>'], ['<math>', '</math>'], ['<style>', '</style>'], ['<textarea>', '</textarea>'], ['<!--', '-->'], ['<template>', '</template>'], ['<p>', '</p>']];

const lcg = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x80000000);

const PAYLOAD = '--></style></script></textarea></title></xmp></noscript>"\'><img id=pwn> pwn=1 x=';
const injected = (node) =>
  (node.childNodes ?? []).some(
    (child) =>
      (child.attrs ?? []).some((a) => (a.name === 'id' && a.value === 'pwn') || a.name === 'pwn') ||
      injected(child) ||
      (child.content !== undefined && injected(child.content))
  );

/** Where a sentinel sits in a parsed tree — the first place it appears, or `absent`. */
const locate = (root, sentinel) => {
  const walk = (node, inert) => {
    for (const child of node.childNodes ?? []) {
      const where = inert ? 'inert:' : '';
      if (child.nodeName === '#text' && child.value.includes(sentinel)) return `${where}text:${node.tagName ?? node.nodeName}:${node.namespaceURI ?? ''}`;
      if (child.nodeName === '#comment' && child.data.includes(sentinel)) return `${where}comment`;
      if (child.tagName !== undefined) {
        if (child.tagName.includes(sentinel)) return `${where}tag-name`;
        for (const a of child.attrs) {
          if (a.name.includes(sentinel)) return `${where}attr-name`;
          if (a.value.includes(sentinel)) return `${where}value:${child.tagName}:${a.name}`;
        }
      }
      const inner = walk(child, inert) ?? (child.content !== undefined ? walk(child.content, true) : undefined);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return walk(root, false) ?? 'absent';
};

/** Where the server may leave a value out although the browser shows it: its deliberate drops. */
const mayDrop = (browser) =>
  browser === 'absent' || browser.startsWith('inert:') || browser === 'comment' || browser === 'attr-name' || browser === 'tag-name' ||
  /^value:[^:]*:[.?@&!]/.test(browser);

test('random statics: no hole lets a value make markup, and every placed value sits where the browser puts it', () => {
  let placed = 0;
  let refused = 0;
  const failures = [];
  for (const seed of SEEDS) {
    const random = lcg(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];
    for (let n = 0; n < CASES_PER_SEED; n++) {
      const [open, close] = pick(CONTEXTS);
      const holes = random() < 0.25 ? 2 : 1;
      const statics = [];
      for (let s = 0; s <= holes; s++) {
        let text = s === 0 ? open : '';
        const length = 1 + Math.floor(random() * 7);
        for (let t = 0; t < length; t++) text += pick(TOKENS);
        statics.push(s === holes ? text + close : text);
      }
      const sentinels = statics.slice(1).map((_, i) => `zq${i}zq`);
      let served;
      try {
        served = serializeTemplate(template(statics, sentinels));
      } catch {
        refused++;
        continue;
      }
      const attack = serializeTemplate(template(statics, sentinels.map(() => PAYLOAD)));
      const label = JSON.stringify(statics);
      if (injected(parse(`<!doctype html><body>${attack}`, { scriptingEnabled: true }))) failures.push(`INJECTED ${label} -> ${JSON.stringify(attack)}`);
      const browserTree = parse(`<!doctype html><body>${statics.reduce((joined, s, i) => joined + sentinels[i - 1] + s)}`, { scriptingEnabled: true });
      const serverTree = parse(`<!doctype html><body>${served}`, { scriptingEnabled: true });
      for (const sentinel of sentinels) {
        const browser = locate(browserTree, sentinel);
        const server = locate(serverTree, sentinel);
        if (server === browser) {
          if (server !== 'absent') placed++;
        } else if (!(server === 'absent' && mayDrop(browser)) && browser !== 'absent')
          failures.push(`MOVED ${sentinel}: browser ${browser}, server ${server} — ${label} -> ${JSON.stringify(served)}`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 12), [], `${failures.length} failures`);
  /** The volume control: a fuzz whose every case is refused, or whose every value vanishes, proves nothing. */
  assert.ok(placed > SEEDS.length * CASES_PER_SEED * 0.3, `only ${placed} placed (${refused} refused)`);
});
