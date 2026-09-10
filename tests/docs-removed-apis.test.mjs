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
  /** The JS easing-solver pack died with the inline write path (the sweep): the browser is the
   *  easing solver on every path, so `ease` works with nothing wired. The bare word 'easing(s)'
   *  is ordinary prose; the API NAME only ever appeared in wire arrays and import lists, which
   *  is what this pin greps for. */
  'wireDirectives([motion, easings])': 'ease just works — no module',
  "{ easings }": 'ease just works — no module',
  'map-support': '@verajs/reactivity/collections',
  /** A fossil of the multi-strategy SSR era; the plain specifier was always the same module. */
  '@verajs/ssr/vera': '@verajs/ssr',
  /** The phase-4 fold-in entry for '@verajs/motion' LEFT this list on 2026-09-10: the package
   *  cut brought the name back to life as motion's own home (./core ./ssr ./client), so the
   *  ledger teaching it as removed would itself have been the stale prose. */
  /** Renamed so "directive" means exactly one thing product-wide: the attribute system
   *  (`@verajs/directives`). The renderer's template-protocol extension is an APPLIER. */
  ChildDirective: 'Applier',
  /** The naming audit (2026-09-10). Machine-emitted names moved to the vm namespace: authors
   *  write data-vd-* and --vera-*, the machine writes data-vm-* and --vm-*. */
  'data-vd-a': 'data-vm-motion — machine markers are data-vm-*',
  'data-vera-sheet': 'data-vm-sheet="motion"',
  'data-vera-slotted': 'data-vm-slotted',
  /** The same audit's author-facing renames. */
  'data-vd-region': 'data-vd-list',
  'data-vd-measure': 'data-vd-size',
  'data-vd-motion-region': 'data-vd-motion-group',
  wireTicks: 'wireFunctions — the settings key is function:',
  tickFor: 'functionFor',
  TickModule: 'MotionFunctionModule ({ run, setup })',
};

/**
 * **A retired RULE, which is the half of drift the name list cannot see.**
 *
 * `REMOVED` catches an identifier that no longer exists, because an identifier is a token you can
 * grep. A retired *behaviour* leaves no token: when light-DOM slots stopped requiring a `slot`
 * attribute on post-render additions, three documents went on teaching the rule — `llms.txt`, the
 * renderer README's "Late children" section, and a sentence inside `slots.ts` — and every suite
 * stayed green, because nothing had been renamed. A reader following any of them would have added
 * attributes nothing requires and concluded bare text was unreachable.
 *
 * So the same discipline, one level up: **retiring a rule means adding the phrasing that taught it
 * here.** The key is a distinctive fragment of the old CLAIM, not of the subject — matching
 * "slot attribute" would fire on every legitimate mention of the feature, while matching the
 * sentence that made the demand fires only where the demand is still being made. History is
 * **The exemption is per LINE here, where the name guard's is per paragraph — and the difference
 * is the whole reason this one works.** Both extremes were measured against the drift that
 * prompted it, by reinstating yesterday's exact stale line:
 *
 * | exemption | on the real drift | on legitimate history |
 * | --- | --- | --- |
 * | paragraph (the name guard's) | **missed it** — stayed green | fine |
 * | none | caught it | **false positive** on a test comment saying "used to pin …" |
 * | the line | caught it | fine |
 *
 * Paragraph granularity is right for a NAME and wrong for a RULE, because a paragraph correcting
 * a rule says "used to" or "no longer" almost by definition — so exempting the block exempts
 * precisely where the old claim gets reintroduced, and the guard is ornamental in the way
 * `CLAUDE.md` warns a check that measures nothing always is. A rule's key is long and
 * self-contained, so a marker on its own line is enough to tell "this is what we used to demand"
 * from "this is what we demand", and prose does not have to contort to satisfy it.
 */
const RETIRED_RULES = {
  'joins a slot only if it carries':
    'post-render additions are native — bare text included, in document order (slots stamps ownership)',
  'only if it carries a `slot` attribute':
    'post-render additions are native — bare text included, in document order (slots stamps ownership)',
  'must name its slot':
    'post-render additions are native; `slot=""` still routes but is not required',
  'need to name their slot':
    'post-render additions are native; `slot=""` still routes but is not required',
  /**
   * The rank work overturned this one — every reachable position orders exactly as the platform
   * does; what light has fewer of is POSITIONS, never worse ordering — and the correction was
   * applied to slots.ts and the feature doc while a third copy stood in llms.txt for days. The
   * copies are the reason this table exists.
   */
  'order approximately':
    'every reachable position orders exactly; light has fewer POSITIONS to name, not worse ordering',
  'orders approximately':
    'every reachable position orders exactly; light has fewer POSITIONS to name, not worse ordering',
  /**
   * False since the text-merge separator: server output may carry a `<!---->` where two text runs
   * would merge, plus the unassigned-content `<template>` carrier. The honest sentence is the
   * three-part conditional handoff, consumed on adoption.
   */
  'no framework comments in server':
    'the handoff is one offset attribute, one inert carrier <template>, and a rare <!----> separator — each conditional, each consumed on adoption',
  'the only handoff is one':
    'three conditional handoff shapes — attribute, carrier template, merge separator — see docs/features/light-dom-slots.md',
};

/**
 * A line explaining a removal, rather than teaching it.
 *
 * **Exempting the whole paragraph is deliberate, and both tighter rules were tried.** The exemption
 * costs coverage — measured, **15% of the 1234 paragraphs** in the documentation contain one of these
 * words somewhere, and a live mention inside one is missed. That is real: the same
 * `setRenderer(renderInto)` line is caught in an ordinary paragraph and not in an exempt one.
 *
 * It is still the right granularity, because history here spans lines:
 *
 * | rule | false positives on the current corpus |
 * | --- | --- |
 * | the line itself | **5** |
 * | the line ± one | **5** |
 * | the paragraph | 0 |
 *
 * Both tighter rules flag `CLAUDE.md`'s own account of this defect — *"`setRenderer` survived its own
 * deletion in 23 places"* — and the `connectInserts` explanations in two READMEs, where the sentence
 * establishing the past tense is two lines above the mention. A guard that fires on the document
 * explaining the removal is worse than one that misses a mention, because the first gets switched off.
 *
 * The exemption rate is asserted below, so this trade stays where it was measured rather than drifting.
 */
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

/**
 * The rule half of the same guard. Shares the corpus, the paragraph unit and the `HISTORICAL`
 * exemption, because it is the same failure with a phrase in place of a name — see `RETIRED_RULES`.
 */
test('no documentation teaches a rule that was retired', () => {
  const problems = [];
  for (const file of docs) {
    /**
     * **This file is the one document that must quote the retired claims**, since the list and
     * its rationale are written here — so it is the corpus's single exemption. The name guard
     * needs no equivalent: its keys are bare identifiers, which the source rule blanks along with
     * the rest of the code. A phrase lives in prose, and prose in a `.mjs` file is a comment,
     * which is exactly what gets read.
     */
    if (/docs-removed-apis\.test\.mjs$/.test(file)) continue;
    const isSource = /\.(js|jsx|mjs|ts)$/.test(file);
    const source = readIfPresent(file);
    if (source === null) continue;
    const lines = source
      .split('\n')
      .map((line) => (!isSource || /^\s*(\/\/|\/\*|\*)/.test(line) ? line : ''));
    let start = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '') continue;
      const paragraph = lines.slice(start, i);
      const first = start;
      start = i + 1;
      if (!paragraph.length) continue;
      paragraph.forEach((line, offset) => {
        /** Per LINE, not per paragraph — see `RETIRED_RULES` for the measurement behind that. */
        if (HISTORICAL.test(line)) return;
        /** One report per line: several phrasings of one retired rule describe one mistake. */
        const claim = Object.keys(RETIRED_RULES).find((key) => line.includes(key));
        if (claim !== undefined)
          problems.push(
            `${relative(root, file)}:${first + offset + 1} still teaches a retired rule — ` +
              `${RETIRED_RULES[claim]}\n    ${line.trim().slice(0, 96)}`
          );
      });
    }
  }
  assert.deepEqual(problems, [], `documentation teaches retired rules:\n  ${problems.join('\n  ')}`);
});

/**
 * **What the exemption costs, held where it was measured.**
 *
 * `HISTORICAL` exempts a whole paragraph, and that is the right granularity — see the table above. But
 * the cost is invisible from inside the guard: every exempt paragraph is a place a live mention would
 * be missed, and nothing says how many there are. Widening the word list, or the documentation drifting
 * further toward explaining itself, weakens the check silently and by exactly the amount nobody sees.
 *
 * So the rate is a number with a bound on it. It is not a target — the docs are meant to explain
 * history — it is a tripwire for the guard quietly becoming ornamental.
 */
test('the historical exemption still covers a small share of the documentation', () => {
  let paragraphs = 0;
  let exempt = 0;

  for (const file of docs) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const lines = text.split('\n');
    let start = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '') continue;
      const paragraph = lines.slice(start, i);
      start = i + 1;
      if (!paragraph.length || paragraph.every((line) => line.trim() === '')) continue;
      paragraphs++;
      if (paragraph.some((line) => HISTORICAL.test(line))) exempt++;
    }
  }

  assert.ok(paragraphs > 500, `only ${paragraphs} paragraphs were read — the document list has shrunk`);
  const share = exempt / paragraphs;
  assert.ok(
    share < 0.3,
    `${Math.round(share * 100)}% of paragraphs (${exempt}/${paragraphs}) are exempt from the removed-API ` +
      `check, up from the 15% this was tuned at. Either HISTORICAL has grown, or the prose has — and ` +
      `either way the guard now sees less of the documentation than it was measured to.`
  );
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
