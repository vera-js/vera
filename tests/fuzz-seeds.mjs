/**
 * Seed rotation for the fuzz suites — fresh territory in CI, determinism everywhere else.
 *
 * Three audit runs found that the seeded fuzzes only ever certify ground already walked: every
 * SEEDS array was chosen once, verified clean, and frozen, so a defect reachable one seed over
 * sat unfound until someone reseeded by hand (which is how the same-parent `prepend` duplication
 * was caught — a virgin-seed sweep, run 3 pass 6). This helper makes that sweep continuous
 * without giving up the property the recorded lessons insist on: a failure must REPLAY on demand,
 * never flicker.
 *
 * The contract:
 *
 * - **Local, no env: nothing changes.** `extendSeeds(base)` returns `base` untouched, byte for
 *   byte. A doc edit cannot go red on a seed nobody chose; the standing arrays remain the
 *   regression net for every defect they ever caught.
 * - **Extras are ADDITIVE, never replacing.** Volume controls written against `SEEDS.length`
 *   scale with the array, and the walked ground stays certified on every run. (Replacing the
 *   base is how a run-3 probe tripped four volume controls at once.)
 * - **`VERA_FUZZ_ROTATE=1` derives extras from a run key** — `VERA_FUZZ_KEY`, else
 *   `GITHUB_RUN_ID`, else today's UTC date — expanded through the same LCG the suites use. CI
 *   sets it; every run of the suites walks seeds no run has walked before.
 * - **`VERA_FUZZ_SEEDS=123,456` adds exactly those seeds**, which is the replay path: a red
 *   rotated run prints its extras below, and pasting them into this variable reproduces the run
 *   anywhere, gate and all. Explicit seeds win over rotation.
 * - **The extras are printed once per process** (each test file is its own process), so the log
 *   of any CI run carries the replay key even after the runner is gone. The banner also says the
 *   one thing a red rotated run needs said: the defect a fresh seed finds usually PREDATES the
 *   commit under test — it is a find, not a regression. Investigate it as run-3 pass 6 did;
 *   never re-run until green.
 *
 * `rotateScalar(base)` is the same contract for the two suites that thread one mutable seed
 * through the whole run instead of iterating an array: it returns `base` untouched unless
 * rotation or explicit seeds are active, in which case the run starts from the first extra —
 * printed the same way.
 */

const parsed = (process.env.VERA_FUZZ_SEEDS ?? '')
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n > 0);

/** FNV-1a over the key, then LCG expansion — cheap, stable, and collision-free enough for seeds. */
const derive = (key, count) => {
  let h = 0x811c9dc5;
  for (const ch of String(key)) h = ((h ^ ch.codePointAt(0)) * 0x01000193) >>> 0;
  const out = [];
  let s = (h & 0x7fffffff) || 1;
  while (out.length < count) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if (s > 0) out.push(s);
  }
  return out;
};

const extras = (() => {
  if (parsed.length > 0) return parsed;
  if (!process.env.VERA_FUZZ_ROTATE) return [];
  const key = process.env.VERA_FUZZ_KEY ?? process.env.GITHUB_RUN_ID ?? new Date().toISOString().slice(0, 10);
  const count = Number.parseInt(process.env.VERA_FUZZ_EXTRA ?? '3', 10) || 3;
  return derive(key, count);
})();

if (extras.length > 0) {
  console.log(
    `[fuzz] rotated seeds +[${extras.join(', ')}] — replay with VERA_FUZZ_SEEDS=${extras.join(',')}. ` +
      `A failure on a rotated seed is usually a FIND that predates this commit, not a regression: ` +
      `investigate it, never re-run until green.`
  );
}

/** The standing array plus this run's extras (minus duplicates). Order keeps base first, so the
 *  regression net runs before the fresh territory and a base failure is never misread as a find. */
export const extendSeeds = (base) => [...base, ...extras.filter((seed) => !base.includes(seed))];

/** The single-threaded-seed variant: the run's starting point, rotated only when rotation is on. */
export const rotateScalar = (base) => (extras.length > 0 ? extras[0] : base);
