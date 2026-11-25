/**
 * **Every place the server DOM stores markup is accounted for** (2026-11-25). The render's instance marker is taken off
 * at the render's end wherever it was stored, which holds only if each store either records a stamped string
 * (`storeMarkup`), moves or copies one from a recorded holder (and records the target), or cannot hold one. A store
 * added later that skips all three would keep a marker past its render, with no read showing it in a test. So every
 * write to a container's `_entries` or a template's `_raw` in the ssr sources is listed here by its exact text, with
 * why it is safe, and the count of each must match: a new store fails until it is classified. Markup is stored only in
 * those two files (grep of the ssr sources, 2026-11-25: no other file writes `_entries` or `_raw`, and the server DOM
 * has no other way in, no `setHTMLUnsafe`, `parseHTMLUnsafe`, `createContextualFragment` or `parseFromString`), and
 * a third file gaining such a write fails too, so the scope cannot go stale. Planted: one unlisted store and one store
 * in a third file are refused by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SOURCES = ['packages/ssr/src/vera/nodes.ts', 'packages/ssr/src/vera/parse.ts'];
const STORE = /_entries\s*=[^=]|_entries\.(?:push|unshift|splice)\(|_raw\s*=[^=]/;

/** Each store's exact line, how many there are, and why it keeps no marker past a render. */
const KNOWN = new Map([
  // records what it stores
  ['this._entries = text === \'\' ? [] : [storeMarkup(this, text)];', [1, 'innerHTML: storeMarkup']],
  ['if (where === \'afterbegin\') this._entries.unshift(storeMarkup(this, `${markup}`));', [1, 'insertAdjacentHTML: storeMarkup']],
  ['else this._entries.push(storeMarkup(this, `${markup}`));', [1, 'insertAdjacentHTML: storeMarkup']],
  ['parent._entries.splice(where === \'beforebegin\' ? index : index + 1, 0, storeMarkup(parent, `${markup}`));', [1, 'insertAdjacentHTML outside: storeMarkup']],
  ['parent._entries.splice(parent._entries.indexOf(this), 1, storeMarkup(parent, `${markup}`));', [1, 'outerHTML: storeMarkup']],
  ['if (this._content === undefined) this._raw = storeMarkup(this, markup === null ? \'\' : `${markup}`);', [1, 'template innerHTML: storeMarkup']],
  // moves or copies from a holder, recording the target when the holder is recorded
  ['this._entries.splice(at, replace, ...incoming);', [1, '_place: a recorded fragment or shadow root records this container']],
  ['if (typeof entry === \'string\') to._entries.push(entry);', [1, 'cloneEntries: a recorded source records its copy']],
  ['if (this._content === undefined) copy._raw = this._raw;', [1, 'template cloneNode: the element clone\'s cloneEntries already recorded the copy of a recorded template']],
  ['if (this._raw) content._entries.push(this._raw);', [1, 'template content: a recorded template records its content']],
  ['if (gained) container._entries = entries;', [1, 'parseChunks: the nodes a recorded container parses into are recorded']],
  ['if (template && typeof child === \'string\') node.element._raw = child;', [1, 'parser output: recorded with its parse']],
  ['node.element._entries.push(child);', [1, 'parser output: recorded with its parse']],
  ['node.element._entries.push(child.element);', [1, 'parser output: a node']],
  // the same container's own entries, nodes, emptying, escaped text, the end strip itself
  ['this._entries = [];', [3, 'empties']],
  ['(node as FragmentShim)._entries = [];', [1, 'empties a fragment that handed its entries over']],
  ['this._entries.push(node);', [1, 'a node']],
  ['to._entries.push(child);', [1, 'a cloned node']],
  ['if (index !== -1) this._entries.splice(index, 1);', [1, 'removes']],
  ['this._entries.splice(index, 1);', [1, 'removes']],
  ['this._entries = merged as EntryShim[];', [1, 'normalize: this container\'s own text, merged']],
  ['if (typeof entry === \'string\' || !nodes.includes(entry)) this._entries.push(entry);', [1, 'this container\'s own entries, kept']],
  ['this._entries.push(escapeHtml(`${node}`));', [1, 'escaped text: no markup']],
  ['this._raw = undefined;', [1, 'empties']],
  ['if (typeof raw === \'string\' && raw.includes(INSTANCE_ATTRIBUTE)) (holder as unknown as { _raw: string })._raw = raw.replaceAll(MARKERS, \'\');', [1, 'the end strip']],
]);

/** The unknown stores and the count mismatches in `texts`, one message each. */
const audit = (texts) => {
  const seen = new Map();
  for (const text of texts)
    for (const line of text.split('\n')) {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || !STORE.test(code)) continue;
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
  const problems = [];
  for (const [code, count] of seen) if (!KNOWN.has(code)) problems.push(`unlisted markup store: ${code} (×${count})`);
  for (const [code, [count]] of KNOWN) if ((seen.get(code) ?? 0) !== count) problems.push(`${code}: ${seen.get(code) ?? 0} in the sources, ${count} listed`);
  return { seen, problems };
};

const texts = SOURCES.map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

/** The store lines in each given file, by name: a file outside `SOURCES` must have none. */
const storesIn = (files) => {
  const found = [];
  for (const [name, text] of files)
    for (const line of text.split('\n')) {
      const code = line.trim();
      if (!code.startsWith('*') && !code.startsWith('//') && STORE.test(code)) found.push(`${name}: ${code}`);
    }
  return found;
};
const DIR = 'packages/ssr/src/vera/';
const others = readdirSync(new URL(`../${DIR}`, import.meta.url))
  .filter((name) => name.endsWith('.ts') && !SOURCES.includes(DIR + name))
  .map((name) => [name, readFileSync(new URL(`../${DIR}${name}`, import.meta.url), 'utf8')]);

test('every markup store in the ssr DOM is listed, at its exact count', () => {
  const { seen, problems } = audit(texts);
  assert.equal(seen.size, KNOWN.size, 'CONTROL: the scan found each listed store');
  assert.deepEqual(problems, []);
});

test('PLANTED: a store that skips storeMarkup is refused by name', () => {
  const planted = [texts[0].replace('  _place(node: InsertableShim', '  _bypass(markup: string): void {\n    this._entries.push(`${markup}`);\n  }\n  _place(node: InsertableShim'), texts[1]];
  assert.notEqual(planted[0], texts[0], 'CONTROL: the plant went in');
  assert.deepEqual(audit(planted).problems, ['unlisted markup store: this._entries.push(`${markup}`); (×1)']);
});

test('no ssr source outside nodes.ts and parse.ts stores markup', () => {
  assert.ok(others.length >= 15, `CONTROL: the other ssr sources were read (${others.length})`);
  assert.ok(others.some(([name]) => name === 'select.ts'), 'CONTROL: select.ts, which reads the entries, is among them');
  assert.deepEqual(storesIn(others), []);
});

test('PLANTED: a store in a third file is refused by name', () => {
  const planted = [...others, ['planted.ts', 'export const put = (node, markup) => {\n  node._raw = markup;\n};']];
  assert.deepEqual(storesIn(planted), ['planted.ts: node._raw = markup;']);
});

/**
 * **`marked` is never empty while an instance is pending**, which is what lets one size read answer whether a marker
 * is live. So the one place an instance becomes pending records it there when `marked` is empty, and no other place
 * may make one pending.
 */
const pendingSets = (files) => {
  const found = [];
  for (const [name, text] of files)
    for (const line of text.split('\n')) {
      const code = line.trim();
      if (!code.startsWith('*') && !code.startsWith('//') && code.includes('pendingInstances.set(')) found.push(`${name}: ${code}`);
    }
  return found;
};
const all = [...SOURCES.map((file, i) => [file.slice(DIR.length), texts[i]]), ...others];

test('an instance becomes pending in one place, and that place keeps marked non-empty', () => {
  assert.deepEqual(pendingSets(all), ['nodes.ts: pendingInstances.set(id, node);']);
  assert.match(texts[0], /pendingInstances\.set\(id, node\);\n {2}if \(marked\.size === 0\) marked\.add\(node\);/, 'the first pending instance is recorded as it is set');
});

test('PLANTED: a second place making an instance pending is refused by name', () => {
  const planted = [...all, ['planted.ts', 'export const pend = (id, node) => {\n  pendingInstances.set(id, node);\n};']];
  assert.deepEqual(pendingSets(planted), ['nodes.ts: pendingInstances.set(id, node);', 'planted.ts: pendingInstances.set(id, node);']);
});
