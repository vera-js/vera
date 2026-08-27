/**
 * A name that has been removed must not still be taught.
 *
 * This is the half of documentation drift that no other check reaches.
 * `tests/docs-imports.test.mjs` verifies every documented `import { … }` names a real export, and
 * `tests/docs-recipes.test.mjs` executes the blocks marked `<!-- recipe -->` — but most
 * instructional blocks are deliberately fragmentary, and API names live in **prose** as much as in
 * code. When `insert` became `wire` and `setRenderer` was deleted, 23 references stayed behind
 * across `llms.txt`, four package READMEs and `docs/ARCHITECTURE.md`, including two API-table rows
 * and the line "`setRenderer` is the only wiring". Every suite was green throughout.
 *
 * The list is the mechanism: **removing an API means adding its name here.** That is one line at the
 * moment the knowledge exists, and it converts "we remembered to grep the docs" into something the
 * gate refuses to let through.
 *
 * A removed name may still be *discussed* — release notes and design docs have to say what changed —
 * so a **paragraph** that also carries one of `HISTORICAL` is allowed. That is how every legitimate
 * mention in the tree currently reads, and it is deliberately narrow: it admits an explanation and
 * not an instruction.
 *
 * The unit is the paragraph rather than the line because prose wraps: "There is no repair function
 * for that any more. `connectInserts`, which replayed one registry's chains into another, **was
 * removed**…" carries its marker two lines below the name, and demanding they share a line would
 * push authors into contorted sentences to satisfy a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { walkFiles, readIfPresent } from './walk.mjs';

/** Name -> what to use instead, so the failure carries the fix rather than just the complaint. */
const REMOVED = {
  setRenderer: 'wire(renderer)',
  connectInserts: 'wire([router]) — the router is handed core’s registry',
  setAutoloader: 'wire(autoloader(…))',
  initAutoloader: 'autoloader(…)',
  domRender: 'renderer',
  /** The renderer's own `render` is `renderInto` — but `render` still exists in core, so the
   *  name cannot go on this list. `tests/docs-moved-render.test.mjs` covers it by specifier. */
  connectRouter: 'router',
  '@verajs/collections': '@verajs/reactivity/collections',
  'map-support': '@verajs/reactivity/collections',
};

/** A line explaining a removal, rather than teaching it. */
const HISTORICAL = /\b(was|were|used to|no longer|removed|replaced|previously|until|before|renamed|gone)\b/i;

const root = new URL('..', import.meta.url).pathname;
const docs = [];
/**
 * **Example source and fixture markup count as documentation**, because that is what they are for:
 * `CLAUDE.md` calls the examples the place to experiment by hand, and a page in
 * `tests/browser/fixtures` is the buildless recipe someone copies. A removed API taught in a `.js`
 * comment or an inline `<script>` teaches it just as effectively as one in a README, and nothing
 * read those. (The two live mentions of `connectInserts` are both in the past tense and exempt under
 * `HISTORICAL`, which is the rule working rather than an accident.)
 *
 * `internal/` is a different repository; changelogs describe releases, not the current API.
 */
docs.push(
  ...walkFiles(root, /\.(md|txt|html|js|jsx|mjs|ts)$/, {
    ignore: ['node_modules', 'dist', 'internal', '.changeset'],
    skipDotDirs: true,
  }).filter((file) => !/CHANGELOG/i.test(file))
);

test('no documentation teaches an API that was removed', () => {
  assert.ok(docs.length > 10, `expected to find the docs, found ${docs.length}`);
  const problems = [];
  for (const file of docs) {
    /**
     * **In source, only comments are read.** A removed name written in *code* either works — in
     * which case it is not removed — or fails a real test; it is not teaching anyone anything.
     * Scanning code as prose flagged `render as domRender` in the consumer fixture, which is a local
     * alias, and a guard that cries wolf is a guard somebody deletes. Markdown, text and HTML are
     * read whole, because there the prose *is* the file.
     */
    const isSource = /\.(js|jsx|mjs|ts)$/.test(file);
    const source = readIfPresent(file);
    /** Gone between the walk and the read; it cannot be teaching anything now. */
    if (source === null) continue;
    const lines = source
      .split('\n')
      .map((line) => (!isSource || /^\s*(\/\/|\/\*|\*)/.test(line) ? line : ''));
    /** Paragraph bounds, so a marker anywhere in the same block of prose counts. */
    let start = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '') continue;
      const paragraph = lines.slice(start, i);
      const first = start;
      start = i + 1;
      if (!paragraph.length || paragraph.some((line) => HISTORICAL.test(line))) continue;
      paragraph.forEach((line, offset) => {
        for (const [name, instead] of Object.entries(REMOVED)) {
          if (!line.includes(name)) continue;
          problems.push(
            `${relative(root, file)}:${first + offset + 1} still teaches \`${name}\` — use ${instead}\n` +
              `    ${line.trim().slice(0, 96)}`
          );
        }
      });
    }
  }
  assert.deepEqual(problems, [], `documentation teaches removed APIs:\n  ${problems.join('\n  ')}`);
});

/** The list is only worth having if it is honest, so nothing on it may still exist. */
test('nothing on the removed list is still exported', async () => {
  const { distUrl } = await import('./dist.mjs');
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
    globalThis[key] = dom.window[key];

  const surface = new Set();
  for (const bundle of ['core', 'renderer', 'router', 'autoloader', 'inserts', 'styles', 'reactivity'])
    for (const name of Object.keys(await import(distUrl(bundle)))) surface.add(name);

  const resurrected = Object.keys(REMOVED).filter((name) => surface.has(name));
  assert.deepEqual(resurrected, [], `on the removed list but still exported: ${resurrected.join(', ')}`);
});


/**
 * The guard is only worth having if it actually bites, and the paragraph rule is the part most
 * likely to be loosened by accident — so both halves are exercised directly rather than trusted.
 */
test('the guard rejects an instruction and admits an explanation', () => {
  const teaching = ['Wire it once at your app entry:', '', '  setRenderer(render);'];
  const explaining = ['`setRenderer` was removed in 0.2.0; wire the renderer instead.'];
  const flags = (lines) => {
    let start = 0;
    const hits = [];
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '') continue;
      const paragraph = lines.slice(start, i);
      start = i + 1;
      if (!paragraph.length || paragraph.some((line) => HISTORICAL.test(line))) continue;
      for (const line of paragraph) if (line.includes('setRenderer')) hits.push(line);
    }
    return hits;
  };
  assert.equal(flags(teaching).length, 1, 'an instruction must be caught');
  assert.equal(flags(explaining).length, 0, 'an explanation must be allowed');
});
