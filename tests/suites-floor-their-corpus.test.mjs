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
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;

/** Reads a corpus out of the filesystem rather than stating one. */
const DISCOVERS = /readdirSync\(|globSync\(|\bglob\(/;

/** An assertion whose PASSING state is emptiness — the only kind this rule is about. */
const EMPTY_PASS =
  /assert\.deepEqual\(\s*\w+\s*,\s*\[\s*\]|assert\.deepStrictEqual\(\s*\w+\s*,\s*\[\s*\]|assert\.equal\(\s*\w+(?:\.length)?\s*,\s*0[\s,)]/;

/**
 * Every floor spelling this repo actually uses, as NAMED clauses rather than one joined pattern.
 *
 * Named, because the control below pairs each sample with THE CLAUSE IT EXERCISES and checks it
 * against that clause alone. Against a joined pattern a sample can be carried by a different clause
 * than the one it exists to test — which is not hypothetical: the first version of this file had a
 * floored sample whose MESSAGE matched the word clause, so the control passed green while the
 * numeric clause was blind to `x.length > 0`, the commonest floor there is.
 *
 * Deliberately generous, because a detector expressed as a pattern over source WILL miss a
 * spelling — that is the base rate, not a defect. But generous is not the same as careless: a
 * clause must read the PREDICATE, never merely the assertion around it. `assert.ok(…count(…)…)`
 * treated as a floor would accept `count(x) >= 0` and `count(x) < 5` alike. (That distinction is
 * the omni engine's, from finding the identical shape in their own lint.)
 */
const FLOOR_CLAUSES = {
  /** `assert.ok(<anything>.length > 0)` — the subject may be a call, a chain, or an arrow. */
  comparison: /(?:assert\.ok|expect)\(\s*[^;]{0,140}?\.(?:length|size)\s*(?:>=\s*[1-9]|>\s*[0-9])/,
  /** A bare counter: `assert.ok(compared > 20)`. */
  counter: /(?:assert\.ok|expect)\(\s*\n?\s*[\w.()[\]]+\s*(?:>=\s*[1-9]|>\s*[0-9])/,
  /** Outside an assertion entirely: `if (found.size > 0)` guarding a throw. */
  bare: /[\w.()[\]]+\.(?:length|size)\s*(?:>=\s*[1-9]|>\s*[0-9])/,
  /**
   * Truthiness, which IS a floor: `assert.ok(sources.length, …)`.
   *
   * A PLAIN identifier chain only — no `!`, no nested call. The permissive form read
   * `assert.ok(!list.length)` as a floor, which asserts the list is EMPTY: the exact inverse,
   * excusing a walk on the strength of an assertion that nothing was found.
   */
  truthiness: /assert\.ok\(\s*[\w$]+(?:\.[\w$]+)*\.(?:length|size)\s*[,)]/,
  /** A pinned count: `assert.equal(rows.length, 7)`. */
  pinned: /assert\.(?:equal|deepEqual)\(\s*[^;]{0,140}?\.(?:length|size),\s*[1-9]/,
  /** Or the condition named in words, which is the best form and the easiest to grep. */
  worded: /NON-ZERO|found nothing|scanned nothing|expected to find|the walk found|the scan is broken/i,
};

const FLOOR = { test: (text) => Object.values(FLOOR_CLAUSES).some((clause) => clause.test(text)) };

/**
 * Suites that discover a corpus, assert emptiness, and legitimately need no floor. **Empty today**,
 * and it has stayed empty through every finding — which is worth knowing before anyone adds to it.
 *
 * Driven, not merely listed: an entry the detector no longer flags fails below. An allowance that
 * outlives its subject is worse than none, because it waits to excuse something nobody looked at.
 *
 * There are exactly three verdicts a walk can have, and the third is the one that belongs here:
 *
 * - **FLOORED** — something fails when the walk finds nothing. Nothing to do.
 * - **NAKED** — nothing does. Add a floor; that is the whole point of this rule.
 * - **SUBJECT IS THE DISCOVERY** — the emptiness IS the behaviour being pinned, as in
 *   *"listing a directory that does not exist returns `[]`"*. Demanding a floor there would
 *   demand a non-empty result from an assertion whose entire claim is that the result is empty.
 *   This tree holds no such case today (checked), but the category is named so the next person
 *   meets a decision rather than a puzzle. That third verdict is the omni engine's — their lint
 *   found one and a naive two-way rule would have mangled it.
 */
const NO_FLOOR_NEEDED = new Map([]);

const suites = [
  ...readdirSync(`${root}tests`).filter((name) => name.endsWith('.test.mjs')).map((name) => `tests/${name}`),
  ...readdirSync(`${root}tests/browser`).filter((name) => name.endsWith('.test.js')).map((name) => `tests/browser/${name}`),
];

/**
 * **ONE definition of "test-shaped", shared by both frame layers.**
 *
 * They were written separately and did not agree: the recursive walk matched `.test.` only while
 * the git census matched `.test.` and `.spec.`. A `.spec.` file under `tests/` was therefore
 * invisible to BOTH — the walk did not consider it a test, and the census saw it inside the frame —
 * so an unfloored one passed every layer in silence. Verified by planting exactly that and watching
 * four green checks.
 *
 * WHEN TWO LAYERS CROSS-CHECK EACH OTHER THEY MUST SHARE THE DEFINITION OF THE THING BEING
 * COUNTED, or the cross-check is satisfiable by the two disagreeing about the subject — and a
 * disagreement about the subject looks exactly like agreement about the answer. (The omni engine's,
 * from hitting the same split between their own two layers.)
 */
const TEST_SHAPED = /\.(test|spec)\.[cm]?[jt]s$/;

/**
 * Every test file under `tests/`, found RECURSIVELY and without knowing the shape of the tree —
 * the independent enumeration the frame check below compares against.
 */
const everyTestFile = (dir, prefix = 'tests') => {
  const out = [];
  for (const entry of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...everyTestFile(`${dir}/${entry.name}`, `${prefix}/${entry.name}`));
    else if (TEST_SHAPED.test(entry.name)) out.push(`${dir}/${entry.name}`);
  }
  return out;
};

/**
 * A positive control on the INSTRUMENT, run against text rather than the tree — because a lint
 * reporting "0 problems" and a lint that cannot see anything produce the same output, and this file
 * exists precisely to say that those are different. Nothing here touches a real suite.
 */
/**
 * **THE FRAME CHECK — a floor validates the SAMPLE and says nothing about the SPACE.**
 *
 * Every assertion in this file is a claim about EVERY suite, and the two `readdirSync` calls above
 * are non-recursive and extension-specific. Add `tests/unit/thing.test.mjs` tomorrow and this rule
 * silently narrows to a smaller tree and goes on reporting a clean sweep — and the floors it
 * already carries CANNOT NOTICE, because a floor asks "did I find enough of what I looked at",
 * never "did I look at the right things".
 *
 * So the space is checked against an independent enumeration rather than against itself. The move
 * is the one that settled a failed second-preimage search elsewhere in this audit: ASK SOMETHING
 * ELSE HOW BIG THE SPACE IS. There, counting collisions against n²/2m revealed a candidate
 * generator covering a subset of the hash space; here, a recursive walk reveals a frame covering a
 * subset of the tree. Same defect, and no floor substitutes for it.
 *
 * (The omni engine found exactly this in their equivalent lint — 69 browser specs outside its walk,
 * with its own count-and-identity floors passing honestly throughout.)
 */
test('the rule looks at every test file that exists, not merely at the ones it knows about', () => {
  const framed = new Set(suites);
  const unseen = everyTestFile('tests').filter((file) => !framed.has(file));
  assert.ok(suites.length > 100, `only ${suites.length} suite(s) framed — the walk itself found nothing`);
  assert.deepEqual(
    unseen,
    [],
    `these test files exist and this rule never looked at them, so every "clean sweep" above was ` +
      `over a smaller tree than the one that ships:\n  ${unseen.join('\n  ')}\n\n` +
      `Widen the two walks at the top of this file — do not add an exemption.`
  );
});

/**
 * **The frame's OWN boundary re-earns its reason, instead of resting on a comment.**
 *
 * The walk above covers `tests/` and nothing else. That is correct today for a reason nobody
 * wrote down in executable form: everything test-shaped outside it is either scratch or the Studio
 * repo cloned in, both gitignored, both with their own gates. An exclusion whose justification is
 * a sentence in a comment is the allowance that never has to be re-earned — so this asks GIT, which
 * is the authority on what this repository actually contains, and fails the moment a tracked test
 * file appears anywhere else.
 *
 * (The move is the omni engine's, from discovering a fourth suite family one message after
 * declaring their frame complete: a frame is not fixed by widening it once, only by deriving it.)
 */
test('nothing test-shaped is tracked outside the frame, and that is checked rather than assumed', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((path) => TEST_SHAPED.test(path));
  assert.ok(tracked.length > 100, `git reports only ${tracked.length} test file(s) — the question was not asked properly`);

  const outside = tracked.filter((path) => !path.startsWith('tests/'));
  assert.deepEqual(
    outside,
    [],
    `these test files are TRACKED and live outside this rule's frame, so nothing here has ever ` +
      `looked at them:\n  ${outside.join('\n  ')}\n\n` +
      `Widen the walks — do not add an exemption.`
  );
});

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

  /**
   * **Each sample is checked against THE CLAUSE IT EXERCISES, not against the union.** Against the
   * union a sample can pass carried by a clause it was not written for, which is how this file's
   * first version stayed green while blind to `x.length > 0`. Every row is a spelling that was once
   * a live miss here; a narrowing rewrite now fails naming both the spelling and the clause.
   */
  const RECOGNISED = [
    ['counter', `assert.ok(compared > 20, 'only N fixtures were comparable');`],
    ['comparison', `assert.ok(files.length >= 4, 'expected the ui sources');`],
    ['comparison', `assert.ok(\n  references.length >= 15,\n  'the pattern stopped matching'\n);`],
    ['comparison', `assert.ok(publishable.size > 5, 'expected the packages');`],
    ['truthiness', `assert.ok(sources.length, 'found the sources');`],
    /**
     * Subjects containing PARENTHESES. The omni engine's equivalent lint stopped at the first `)`,
     * and the subject of a floor is very often a call — the careful spelling is the unusual one.
     */
    ['comparison', `assert.ok(Object.keys(versions).length >= 8, 'found the packages');`],
    ['comparison', `assert.ok(new Set([...a, ...b]).size > 0, 'the walk produced nothing');`],
    ['comparison', `assert.ok(files.filter((f) => f.ok).length > 0, 'nothing survived');`],
    ['bare', `if (maps.length > 0) report(maps);`],
    ['pinned', `assert.equal(rows.length, 7);`],
    ['worded', `assert.ok(ok, 'NON-ZERO CONTROL: the scan is broken, not the list');`],
  ];
  for (const [clause, spelling] of RECOGNISED)
    assert.ok(
      FLOOR_CLAUSES[clause].test(spelling),
      `the \`${clause}\` clause stopped recognising a real floor spelling:\n  ${spelling}`
    );

  /**
   * And the inverse, because "recognises every floor" is otherwise satisfied by a pattern matching
   * all source. Two of these were LIVE false floors before the clauses were tightened — a negated
   * length asserts the set is EMPTY, and a nested call carried a `=== 0` past the truthiness form.
   */
  for (const notAFloor of [
    `assert.deepEqual(missing, []);`,
    `assert.equal(failures.length, 0);`,
    `const empty = items.length === 0;`,
    /** Vacuously true of every length — it looks like a floor and proves nothing. */
    `assert.ok(files.length >= 0, 'this proves nothing');`,
    /** The inverse of a floor: an assertion that nothing was found. */
    `assert.ok(!list.length, 'nothing should be here');`,
    `assert.ok(check(bar.length) === 0);`,
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
  /**
   * **Identity, not only quantity** — and most of all here, since a rule that polices floors while
   * holding only a count is the joke writing itself. A count is satisfied by any corpus of the
   * right size; repoint the root at a sibling directory and it stays green. Two known members, one
   * per directory, so a walk reading the wrong tree fails by name.
   */
  assert.ok(suites.includes('tests/dropped-element-bindings.test.mjs') && suites.includes('tests/browser/markup-grammar.test.js'),
    `found ${suites.length} suite(s) but not the ones this rule was written against — it is reading the wrong tree`);

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
