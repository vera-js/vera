/**
 * **A suite that discovers its corpus must say how much it found.**
 *
 * The failure this prevents is the one that cannot announce itself: a pin walks the filesystem,
 * collects offenders, and asserts the list is empty. If the walk finds nothing, the list is empty
 * and the pin is green — indistinguishable from a clean run, forever, including through the edit
 * that breaks it. `[].every(…)` is true; a `for` over nothing runs no assertions; a glob that
 * matched no files reports zero stranded artifacts.
 *
 * Five suites here had exactly that shape, and the last one found is the argument for this file
 * existing: `minification-contracts` skips any package with no `dist`, so **before a build every
 * package is skipped** and its exhaustiveness check passes having examined nothing — on the guard
 * whose stated purpose is to stop a new package inheriting neither minification rule.
 *
 * **Why this is a lint and not a note.** The lesson was available before any of those five were
 * written. Prose in the file where a lesson is learned does not travel — its only enforcement is
 * whether the next person happens to read that file. A lint travels everywhere, and this fact is
 * mechanical enough to be one. (The observation is the omni engine's, from finding the identical
 * defect six weeks after documenting it thoroughly in the file where it was first hit.)
 *
 * A suite is satisfied by ANY floor: `x.length > 0`, a bare counter, an `assert.ok(x.length)`, or a
 * message naming the condition. The rule is that *something* must fail when the walk finds nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;

/** Reads a corpus out of the filesystem rather than stating one. */
const DISCOVERS = /readdirSync\(|globSync\(|\bglob\(/;

/** An assertion whose PASSING state is emptiness — the only kind this rule is about. */
const EMPTY_PASS =
  /assert\.deepEqual\(\s*\w+\s*,\s*\[\s*\]|assert\.deepStrictEqual\(\s*\w+\s*,\s*\[\s*\]|assert\.equal\(\s*\w+(?:\.length)?\s*,\s*0[\s,)]/;

/**
 * Every floor spelling this repo actually uses. It is deliberately generous: a detector expressed
 * as a pattern over source WILL miss a spelling — that is the base rate, not a defect — and the
 * cost of missing one here is a false failure that wastes someone's morning, while the cost of an
 * over-generous pattern is a suite this rule declines to police. Three separate blind spots were
 * found while writing it (`compared > 20` as a bare counter, an accumulator array filled by a
 * helper, a multi-line `assert.ok(`), and each one is a clause below.
 */
const FLOOR = new RegExp(
  [
    /** `assert.ok(<anything>.length > 0)` — the subject may be a call, a chain, or an arrow. */
    String.raw`(?:assert\.ok|expect)\(\s*[^;]{0,140}?\.(?:length|size)\s*(?:>=\s*[1-9]|>\s*[0-9])`,
    /** A bare counter: `assert.ok(compared > 20)`. */
    String.raw`(?:assert\.ok|expect)\(\s*\n?\s*[\w.()\[\]]+\s*(?:>=\s*[1-9]|>\s*[0-9])`,
    /** Outside an assertion entirely: `if (found.size > 0)` guarding a throw. */
    String.raw`[\w.()\[\]]+\.(?:length|size)\s*(?:>=\s*[1-9]|>\s*[0-9])`,
    /** Truthiness, which IS a floor: `assert.ok(sources.length, …)`. */
    String.raw`assert\.ok\(\s*\n?\s*[^;]{0,140}?\.(?:length|size)\s*[,)]`,
    String.raw`assert\.(?:equal|deepEqual)\(\s*[^;]{0,140}?\.(?:length|size),\s*[1-9]`,
    /** Or the condition named in words, which is the best form and the easiest to grep. */
    String.raw`NON-ZERO|found nothing|scanned nothing|expected to find|the walk found|the scan is broken`,
  ].join('|'),
  'i'
);

/**
 * Suites that discover a corpus, assert emptiness, and legitimately need no floor. Empty today.
 *
 * Driven, not merely listed: an entry the detector no longer flags fails below. An allowance that
 * outlives its subject is worse than none, because it waits to excuse something nobody looked at.
 */
const NO_FLOOR_NEEDED = new Map([]);

const suites = [
  ...readdirSync(`${root}tests`).filter((name) => name.endsWith('.test.mjs')).map((name) => `tests/${name}`),
  ...readdirSync(`${root}tests/browser`).filter((name) => name.endsWith('.test.js')).map((name) => `tests/browser/${name}`),
];

/**
 * A positive control on the INSTRUMENT, run against text rather than the tree — because a lint
 * reporting "0 problems" and a lint that cannot see anything produce the same output, and this file
 * exists precisely to say that those are different. Nothing here touches a real suite.
 */
test('the detector can tell a floored suite from an unfloored one', () => {
  const unfloored = `
    import { readdirSync } from 'node:fs';
    const files = readdirSync(dir);
    const bad = [];
    for (const f of files) if (broken(f)) bad.push(f);
    assert.deepEqual(bad, []);
  `;
  /**
   * **The floored sample carries NO floor PHRASE**, deliberately. The first draft said
   * `'the walk found nothing'` in its message, which the word clause matched — so the control
   * passed while the numeric clauses were blind to `> 0` entirely, the commonest floor spelling
   * there is. A positive control that can pass for the wrong reason is not a control.
   */
  const floored = `${unfloored}\n    assert.ok(files.length > 0, 'sources');`;

  assert.ok(DISCOVERS.test(unfloored) && EMPTY_PASS.test(unfloored), 'the sample must reach the rule at all');
  assert.equal(FLOOR.test(unfloored), false, 'an unfloored suite must NOT look floored');
  assert.equal(FLOOR.test(floored), true, 'a floored suite must look floored');

  /** And the spellings that were missed while writing this, so a narrowing rewrite fails loudly. */
  for (const spelling of [
    `assert.ok(compared > 20, 'only ${'${compared}'} fixtures were comparable');`,
    `assert.ok(files.length >= 4, 'CONTROL: expected the ui sources');`,
    `assert.ok(\n  references.length >= 15,\n  'the pattern has probably stopped matching'\n);`,
    `assert.ok(publishable.size > 5, 'expected to find the packages');`,
    `assert.ok(sources.length, 'found the sources');`,
    /**
     * A subject with PARENTHESES in it. The omni engine's equivalent lint was blind here on its
     * first run — its pattern stopped at the first `)` — and the subject of a floor is very often
     * a call, because the careful spelling is the unusual one. Each of these was a live miss in
     * this file's own detector before the control below was written.
     */
    `assert.ok(Object.keys(versions).length >= 8, 'found the published packages');`,
    `assert.ok(new Set([...a, ...b]).size > 0, 'the walk produced nothing');`,
    `assert.ok(files.filter((f) => f.ok).length > 0, 'nothing survived the filter');`,
  ])
    assert.ok(FLOOR.test(spelling), `a real floor spelling stopped being recognised:\n  ${spelling}`);

  /**
   * And the inverse, because "recognises every floor" is otherwise satisfied by a pattern matching
   * all source. These must NOT read as floors.
   */
  for (const notAFloor of [
    `assert.deepEqual(missing, []);`,
    `assert.equal(failures.length, 0);`,
    `const empty = items.length === 0;`,
    /** `>= 0` is vacuously true of every length, so it is not a floor however much it looks like one. */
    `assert.ok(files.length >= 0, 'this proves nothing');`,
  ])
    assert.equal(FLOOR.test(notAFloor), false, `this is not a floor and must not be read as one:\n  ${notAFloor}`);
});

/**
 * Splits a suite into its module preamble and one chunk per `test(...)` block.
 *
 * **The granularity took three attempts and the mutation control found each mistake.**
 *
 * Per FILE was too loose: it excused a walk on the strength of an unrelated `length > 0` in a
 * different test — the same file-keyed-allowance defect this audit found in the diagnostics
 * convention hours earlier, rebuilt here by the same reflex.
 *
 * Per TEST was too strict: it flagged thirty tests that iterate a corpus DISCOVERED ONCE AT MODULE
 * SCOPE and floored by a sibling test. The walk happened once; flooring it once is right, and
 * demanding a floor in every test that reads it would be noise people learn to silence.
 *
 * So the rule follows the DISCOVERY: a walk at module scope is covered by a floor anywhere in the
 * file, and a walk inside a test must be floored inside that test. That is where the risk actually
 * lives — a corpus built inside a test is one only that test can vouch for.
 */
const chunksOf = (text) => {
  const parts = text.split(/\ntest\(/);
  return { preamble: parts[0], blocks: parts.slice(1) };
};

test('every suite that discovers a corpus and asserts emptiness has a floor', () => {
  const unfloored = [];
  const excused = new Set();
  let discovering = 0;

  for (const file of suites) {
    const text = readFileSync(root + file, 'utf8');
    if (!DISCOVERS.test(text) || !EMPTY_PASS.test(text)) continue;
    const { preamble, blocks } = chunksOf(text);

    /** A corpus built once at module scope: any floor in the file vouches for that one walk. */
    if (DISCOVERS.test(preamble)) {
      discovering++;
      if (!FLOOR.test(text)) {
        if (NO_FLOOR_NEEDED.has(file)) excused.add(file);
        else unfloored.push(`${file}  — the module-scope walk`);
      }
    }

    /** A corpus built INSIDE a test: only that test can vouch for it. */
    for (const block of blocks) {
      if (!DISCOVERS.test(block) || !EMPTY_PASS.test(block)) continue;
      discovering++;
      if (FLOOR.test(block)) continue;
      if (NO_FLOOR_NEEDED.has(file)) {
        excused.add(file);
        continue;
      }
      unfloored.push(`${file}  — test(${/^([^\n]*)/.exec(block)?.[1]?.slice(0, 56) ?? ''}`);
    }
  }

  /** This rule walks a corpus and asserts emptiness, so it obeys itself. */
  assert.ok(
    discovering >= 20,
    `only ${discovering} walk(s) matched the rule at all — the scan is broken, not the suites`
  );
  assert.ok(suites.length > 100, `only ${suites.length} suite file(s) found — the walk found nothing`);

  assert.deepEqual(
    unfloored,
    [],
    `these walks discover a corpus and assert emptiness, so an empty walk is a green run:\n  ${unfloored.join('\n  ')}\n\n` +
      `Add a floor — \`assert.ok(found.length > 0, 'the scan is broken, not the list')\` — beside the ` +
      `walk itself, or list the suite in NO_FLOOR_NEEDED with the reason.`
  );

  const stale = [...NO_FLOOR_NEEDED.keys()].filter((file) => !excused.has(file));
  assert.deepEqual(
    stale,
    [],
    `excused from the floor rule, but no longer matching it — delete the entry rather than leave it ` +
      `waiting to excuse something nobody looked at:\n  ${stale.join('\n  ')}`
  );
});
