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
    String.raw`(?:assert\.ok|expect)\(\s*\n?\s*[\w.()\[\]]+\s*(?:>|>=)\s*[1-9]`,
    String.raw`[\w.()\[\]]+\.(?:length|size)\s*(?:>|>=)\s*[1-9]`,
    String.raw`assert\.ok\(\s*\n?\s*[\w.()\[\]]+\.(?:length|size)\s*[,)]`,
    String.raw`assert\.(?:equal|deepEqual)\(\s*[\w.()\[\]]+\.(?:length|size),\s*[1-9]`,
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
  const floored = `${unfloored}\n    assert.ok(files.length > 0, 'the walk found nothing');`;

  assert.ok(DISCOVERS.test(unfloored) && EMPTY_PASS.test(unfloored), 'the sample must reach the rule at all');
  assert.equal(FLOOR.test(unfloored), false, 'an unfloored suite must NOT look floored');
  assert.equal(FLOOR.test(floored), true, 'a floored suite must look floored');

  /** And the spellings that were missed while writing this, so a narrowing rewrite fails loudly. */
  for (const spelling of [
    `assert.ok(compared > 20, 'only ${'${compared}'} fixtures were comparable');`,
    `assert.ok(files.length >= 4, 'CONTROL: expected the ui sources');`,
    `assert.ok(\n  references.length >= 15,\n  'the pattern has probably stopped matching'\n);`,
    `assert.ok(publishable.size > 5, 'expected to find the packages');`,
  ])
    assert.ok(FLOOR.test(spelling), `a real floor spelling stopped being recognised:\n  ${spelling}`);
});

test('every suite that discovers a corpus and asserts emptiness has a floor', () => {
  const unfloored = [];
  const excused = new Set();
  let discovering = 0;

  for (const file of suites) {
    const text = readFileSync(root + file, 'utf8');
    if (!DISCOVERS.test(text) || !EMPTY_PASS.test(text)) continue;
    discovering++;
    if (FLOOR.test(text)) continue;
    if (NO_FLOOR_NEEDED.has(file)) {
      excused.add(file);
      continue;
    }
    unfloored.push(file);
  }

  /** This rule walks a corpus and asserts emptiness, so it obeys itself. */
  assert.ok(
    discovering >= 20,
    `only ${discovering} suite(s) matched the rule at all — the scan is broken, not the suites`
  );
  assert.ok(suites.length > 100, `only ${suites.length} suite file(s) found — the walk found nothing`);

  assert.deepEqual(
    unfloored,
    [],
    `these suites discover a corpus and assert emptiness, so an empty walk is a green run:\n  ${unfloored.join('\n  ')}\n\n` +
      `Add a floor — \`assert.ok(found.length >= n, 'the scan is broken, not the list')\` — or list the ` +
      `suite in NO_FLOOR_NEEDED with the reason.`
  );

  const stale = [...NO_FLOOR_NEEDED.keys()].filter((file) => !excused.has(file));
  assert.deepEqual(
    stale,
    [],
    `excused from the floor rule, but no longer matching it — delete the entry rather than leave it ` +
      `waiting to excuse something nobody looked at:\n  ${stale.join('\n  ')}`
  );
});
