/**
 * Size budget check. Principle #3: a size budget failure is a BUILD FAILURE,
 * not a warning. This package ships on every page of every site that uses it.
 *
 * The budget ratchets DOWN. Raising it is a deliberate decision that gets
 * recorded — below, with what bought the room — not a quiet edit. It said
 * "never up" for a long time while listing two raises three lines later, which
 * is the kind of absolute that teaches a reader to skim the rule.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireMotion, properties, settings, PRESETS } from '../src/modules/schema.ts';
import { paint } from '../src/paint.ts';
import { path } from '../src/path.ts';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';
import { easings } from '../src/easings.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each entry point gets its own budget, because each is something a consumer
 * can import on its own — `@verajs/motion` or `@verajs/motion/scroll-to`.
 *
 * The animation budget has been raised twice, both deliberately and both
 * recorded here:
 *
 * - 8192 -> 9216, for SVG path following and image-sequence scrubbing, which
 *   were re-ported after the baseline was set.
 * - 9216 -> 10000, for width ranges replacing the fixed tablet/mobile pair.
 *   That one paid for itself elsewhere: resolving ranges at measure time took
 *   the breakpoint lookup out of the frame loop and collapsed three
 *   per-breakpoint plans into one, which made a 5,000-element page 61% faster.
 *
 * - 10000 -> 10240, to contain the three crossings nobody had written down.
 *   `PropertyDef.apply`, `PropertyDef.parse` and `SettingDef.parse` are all
 *   authored by a module — third-party ones included, which the README invites
 *   — and all three were unguarded. A throw from `parse` left `init()` with
 *   **zero** elements adopted; a throw from `apply` left it too, and after init
 *   it froze every element *after* the offending one, on every frame, for the
 *   life of the page, while the instance still reported itself enabled.
 *
 *   This is a better argument than the second raise rather than the same one:
 *   that bought a capability and paid for itself in speed, this buys back a
 *   defect class the project had already decided its posture on — the
 *   audit's own table said "exactly six" crossings and listed six of nine. 38 bytes, and 24 of them are the per-frame one.
 *
 * - 10240 -> 10752, room to work in rather than a specific feature. The audit
 *   passes are finding a user-visible defect each, most of them costing bytes,
 *   and the alternative to headroom is shaving six bytes off a fix by inlining
 *   a two-line helper — which buys nothing and leaves the code worse. Brian's
 *   call, with a byte-cleanup sweep scheduled for when the passes come up
 *   clean ten times in a row, at which point this comes back down.
 *
 * - 10752 -> 11264, the same loan again and for the same reason. Nine audit
 *   passes since the last raise each found a user-visible defect, most of them
 *   diagnostics for failures that were previously silent, and the alternative
 *   to headroom is spending a pass shaving bytes off a fix rather than finding
 *   the next defect.
 *
 * - 11264 -> 11776, for the last three unchecked options. This one has an
 *   argument of its own, which the entry above says it must.
 *
 *   `ease`, `inertiaEase`, `inertia`, `delay`, `transformOrigin`, `onProgress`
 *   and `scrollElement` are each validated, and each is validated because the
 *   same mistake broke the feature it configures — the raise to 10240 is the
 *   same posture applied to module crossings. `breakpoints` was not: its
 *   entries were destructured as `[min, max]` without asking whether they were
 *   pairs, so `{ mobile: 640 }` threw `number 640 is not iterable` **out of
 *   `createMotion`**, taking the page down, from the one option a GUI is most
 *   likely to generate. A reversed or non-numeric pair was accepted and
 *   registered a name no viewport width can match. `scrollDirection` read
 *   anything that was not `'horizontal'` as vertical, so a typo animated the
 *   wrong axis in silence, and scroll-to's `offset` and `activeThreshold` fed
 *   arithmetic with no other guard.
 *
 *   A half-validated options object is worse than either extreme, because it
 *   invites the next reader to assume the rest are checked — which is the
 *   argument the `transformOrigin` check already makes, in a comment, about
 *   itself. This is the end of that list rather than a down payment on more.
 *
 * - 11776 -> 12288, the fourth loan, and the one that says the sweep is now
 *   overdue rather than scheduled.
 *
 *   What the 512 before it bought, all of it diagnostics: refusals about a
 *   split container reaching `rejected` at all — every one of them was
 *   recorded and read by nobody, because a container is in neither of the
 *   lists the instance builds that list from; an unknown `split` mode, which
 *   was skipped in silence; a `pin` on a split container, which lands on every
 *   word; a `when` element repainted after a resize; and `run-once` surviving
 *   a re-parse. Each is a defect a user would hit and could not diagnose.
 *
 *   The alarm has now gone off four times, which is the argument *against*
 *   another loan as much as for one: a budget that moves every few hours is
 *   working as an alarm and not as a budget. It is raised rather than paid
 *   because the passes are still finding a defect each, and Brian's standing
 *   call is that shaving bytes off a fix is the worse use of a pass. **The
 *   sweep is the next thing this file should record**, not an eighth raise.
 *   Seven so far, of which these last four are loans; the counts elsewhere said
 *   five and six and seven for the same list until 2026-08-31, because two of
 *   them — 10000 and 10752 — carry no decision number in the design spec.
 *
 * - 12288 -> 13312, the eighth, and the fifth loan. **The sentence above was
 *   mine and not Brian's**, which is the whole of why this one is here.
 *
 *   His standing call is the opposite and has been all along: raise it rather
 *   than contort a fix, and do the byte-cleanup sweep once ten consecutive
 *   audit passes find nothing. The streak is still zero — every pass on
 *   2026-08-31 found something, including three quadratics costing between two
 *   and three orders of magnitude — so by that plan the sweep is not due and
 *   shaving bytes off a fix is the worse use of a pass.
 *
 *   What the previous 512 bought, and what took the headroom to **7 bytes**:
 *   the diagnostics that made `observe()` refuse a value instead of adding it
 *   to `roots` and then throwing, which left an instance no later `collect()`
 *   or `destroy()` could touch; and `disable()` no longer writing styles back
 *   onto elements it had just released. Both are defects a user hits and
 *   cannot diagnose, which is the same argument as the raise before it.
 *
 *   What is owed is unchanged and now measurably larger. The sweep is what
 *   should be recorded after the streak, not a ninth raise.
 *
 * - 13312 -> 14336, the ninth, and the sixth loan. The note above says a raise
 *   past the eighth needs an argument of its own; this is it.
 *
 *   Two diagnostics and one refusal, all of the same shape and all found in one
 *   afternoon by asking a single question — *where does this library accept
 *   something it knows does nothing?* `translate-z` with no perspective, which
 *   `docs/ATTRIBUTE-REFERENCE.md` has called measured fact for as long as the
 *   attribute has existed while the runtime wrote `translateZ()` in silence; an
 *   option name that does not exist, on both entry points, where an unknown
 *   *attribute* has always been reported by name; and a descriptor carrying
 *   both a `type` and a `category`, which installed as a setting and left the
 *   property never existing at all.
 *
 *   Every one is a case where the documentation and the code disagreed about
 *   whether something works, and the code was the quiet one. Shaving bytes off
 *   that is the worse use of a pass, which is Brian's standing call and not
 *   mine.
 *
 *   The scroll-to budget is **not** raised with it: the same option check cost
 *   61 bytes there and fits, at 32 bytes of headroom. That is uncomfortable and
 *   deliberate — a budget that is raised because the next change might need it
 *   is not a budget.
 *
 * **Seven of the ten are on loan**, and six is more than the two this note
 * used to admit. The first three raises each bought something and kept it;
 * these bought time, and the cleanup sweep — scheduled for when the passes come
 * up clean ten times running — is the repayment. All seven come back down then.
 * A raise past this one needs an argument of its own, and "the last seven were
 * fine" is not it.
 *
 * - 14336 -> 15360, the tenth, and the seventh loan.
 *
 *   One class of defect, found four times in one afternoon by asking a single
 *   question: *which values does this library validate and then hand to CSS
 *   verbatim?* Every answer was a declaration the engine drops whole, silently,
 *   with the attribute looking correct in devtools.
 *
 *   A `cubic-bezier` whose `x` leaves 0-1 — no transition at all, inertia off.
 *   Seven `transform-origin` forms, including `top bottom` and
 *   `center center center` — every rotation and scale pivoting somewhere else.
 *   Path data that passed an *alphabet* check and no grammar — `path` following
 *   nothing. And a `perspective` that is negative or a percentage, which is the
 *   worst of them: `perspective()` composes at the front of the transform, so
 *   an invalid one drops the element's translate, rotate and scale with it and
 *   the element does not animate at all.
 *
 *   Three of the four are now checked by harnesses that ask an engine rather
 *   than a specification — `steps-validity`, `origin-validity`,
 *   `path-validity` — because `CSS.supports` always answers true in happy-dom
 *   and the unit suite structurally cannot see any of it.
 *
 *   The budget did its job on the way here: it sat at 57 bytes and then 21
 *   across two of these fixes, each recorded as a decision rather than a slide,
 *   and this is the one that went over.
 *
 * **The scroll-to budget, 4096 -> 4608 — its first raise ever.** The note two
 * entries up said this one was deliberately held at 32 bytes of headroom
 * because "a budget raised because the next change might need it is not a
 * budget". The next change needed it, on the same day: `scrollDirection` was
 * the one option here still read **as** vertical in silence when it was
 * anything else, so a typo scrolled the wrong axis with nothing anywhere to
 * find. `createMotion` has refused that since 2026-08-30 and this entry point
 * never did — the asymmetry between the two, which one GUI reads.
 *
 * Seventeen bytes over. Shaving them off a diagnostic is the worse use of a
 * pass, which is the same standing call as every raise above, and the 32 bytes
 * did their job: they made this a decision instead of a slide.
 *
 * **The module budgets move on the same terms.** `sequence` went 2048 -> 2560
 * on 2026-08-31, for a factory that refuses `allowedOrigins: 'https://cdn'` —
 * one origin written as the thing it is rather than as a list of one — instead
 * of throwing `flatMap is not a function` at module scope, on the option that
 * governs its **security boundary**. Fourteen bytes over, and shaving them off
 * a security diagnostic is the worse use of a pass. It is the first raise any
 * module budget has had.
 */
export const PACKAGES = [
  { file: 'vera-motion.min.js', name: '@verajs/motion', budget: 15360 },
  { file: 'vera-motion-scroll-to.min.js', name: '@verajs/motion/scroll-to', budget: 4608 },
  /**
   * A property module, and the first of them. Budgeted like the others even
   * though nobody downloads it unless they ask for it — a module that quietly
   * doubled would still be a page's bytes, and "optional" is not "free".
   */
  { file: 'vera-motion-paint.min.js', name: '@verajs/motion/paint', budget: 1024 },
  { file: 'vera-motion-path.min.js', name: '@verajs/motion/path', budget: 1536 },
  { file: 'vera-motion-easings.min.js', name: '@verajs/motion/easings', budget: 1024 },
  { file: 'vera-motion-sequence.min.js', name: '@verajs/motion/sequence', budget: 2560 },
  { file: 'vera-motion-split.min.js', name: '@verajs/motion/split', budget: 2048 },
  /**
   * The Vera integration: three property reads and two calls, wired into a
   * framework insert. It imports one *type* and nothing else, which is what
   * keeps it this size — a runtime import of the schema would drag the whole
   * animation table in, the same trap `rejections.ts` exists to avoid.
   */
  { file: 'vera-motion-vera.min.js', name: '@verajs/motion/vera', budget: 512 },
];

/**
 * Everything the entry pulls in **statically**, transitively.
 *
 * This exists because the naive version — measure one filename, call every
 * other file in `dist` on-demand — is wrong in a way that fails open. Rollup
 * emits a shared chunk whenever a module is reachable from both the entry and
 * a dynamic import, and when that happened the entry became a 446-byte
 * re-export shell in front of a 25 KB chunk. The gate measured the shell,
 * reported **296 bytes gzipped**, and passed.
 *
 * A static import is a file every page downloads. It is budgeted.
 *
 * Minified ESM distinguishes the two syntactically: a static import is
 * `from"./x.js"` or a bare `import"./x.js"`; a dynamic one is `import("./x.js")`
 * — the parenthesis is the tell.
 */
const STATIC_IMPORT = /(?:from|^import|[;}]import)\s*["']([^"']+)["']/g;

const staticClosure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  const path = resolve(root, 'dist', file);
  if (!existsSync(path)) return seen;
  const source = readFileSync(path, 'utf8');
  for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
    if (specifier.startsWith('./')) staticClosure(specifier.slice(2), seen);
  }
  return seen;
};

/**
 * Chunks loaded on demand are reported but not budgeted: a page that never
 * scrubs an image sequence never fetches that module, so charging it against
 * every page would be measuring the wrong thing.
 */
const entryFiles = new Set(PACKAGES.map((p) => p.file));
const budgeted = new Set();
let failed = false;

for (const pkg of PACKAGES) {
  const target = resolve(root, 'dist', pkg.file);
  if (!existsSync(target)) {
    console.error(`size: dist/${pkg.file} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  /** Gzipped per file, because that is how the browser fetches them. */
  const files = [...staticClosure(pkg.file)];
  for (const f of files) budgeted.add(f);
  const raw = { length: files.reduce((n, f) => n + readFileSync(resolve(root, 'dist', f)).length, 0) };
  const gzipped = files.reduce(
    (n, f) => n + gzipSync(readFileSync(resolve(root, 'dist', f)), { level: 9 }).length,
    0
  );
  const pct = Math.round((gzipped / pkg.budget) * 100);
  const bar = '█'.repeat(Math.min(30, Math.round((pct / 100) * 30))).padEnd(30, '·');

  console.log(`\n  ${pkg.name}  (${files.join(' + ')})`);
  if (files.length > 1) {
    console.log(`  NOTE: ${files.length} files, all fetched by every page — ${files.length - 1} extra round trip(s).`);
  }
  console.log(`  raw     ${raw.length.toLocaleString().padStart(8)} bytes`);
  console.log(`  gzip    ${gzipped.toLocaleString().padStart(8)} bytes`);
  console.log(`  budget  ${pkg.budget.toLocaleString().padStart(8)} bytes`);
  console.log(`  [${bar}] ${pct}%`);

  if (gzipped > pkg.budget) {
    console.error(`  FAIL: over budget by ${(gzipped - pkg.budget).toLocaleString()} bytes.`);
    failed = true;
  } else {
    console.log(`  OK: ${(pkg.budget - gzipped).toLocaleString()} bytes of headroom.`);
  }
}

/**
 * And what must not be *in* an artifact, which a budget cannot express.
 *
 * `namespace.ts` exists as its own file because importing the attribute prefix
 * from `schema.ts` dragged the whole animation table into `scroll-to.js` —
 * every property name, every setting, every preset — for one string.
 * **706 bytes, 20% of that artifact.** Rollup could not shake them, because
 * `schema.ts` builds its lookup maps at module scope and `new Map(...)` is not
 * provably side-effect free.
 *
 * The budget cannot catch that regression happening again. `scroll-to.js` is
 * 3,316 gzipped against a budget of 4,096, so the same 706-byte leak would land
 * at 4,022, print OK with 74 bytes of headroom, and ship. A budget answers "how
 * big", and this is a question about *what is inside*.
 *
 * Names taken from the live registry rather than listed here, so a property
 * added to core or to a module is covered without editing this file.
 */
/**
 * Words that are in the vocabulary and also in `scroll-to`'s own code, each
 * checked rather than assumed:
 *
 *   blur  a real `removeEventListener('blur', …)` — focus handling
 *   ease  the CSS keyword table its inlined solver carries — `ease`, `ease-in`, `ease-out`
 *   pin   the letters inside `sourceMappingURL`, which is not a word at all
 *
 * Three, listed with reasons. A fourth appearing fails this check, which is the
 * right friction: someone has to look at it and say why, exactly as I did here.
 */
const INNOCENT = new Set(['blur', 'ease', 'pin']);

wireMotion([paint, path, split, sequence, easings]);
const vocabulary = [
  ...properties().map((property) => property.attribute),
  ...settings().map((setting) => setting.attribute),
  ...Object.keys(PRESETS),
].filter((name) => !INNOCENT.has(name));

const FOREIGN = { 'scroll-to.js': vocabulary };

const leakage = [];
for (const [file, forbidden] of Object.entries(FOREIGN)) {
  const path = resolve(root, 'dist', file);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  const found = forbidden.filter((name) => source.includes(name));
  if (found.length) leakage.push(`  ${file}: ${found.join(', ')}`);
}

if (leakage.length) {
  console.error('\n  vocabulary that does not belong in this artifact:');
  for (const line of leakage) console.error(line);
  console.error('\n  FAIL: an import has dragged the schema across an entry-point boundary.');
  failed = true;
} else {
  console.log('  no artifact carries another entry point\'s vocabulary.\n');
}

const chunks = readdirSync(resolve(root, 'dist'))
  .filter((f) => f.endsWith('.js') && !entryFiles.has(f) && !budgeted.has(f));

if (chunks.length) {
  console.log('\n  loaded on demand (not budgeted)');
  for (const file of chunks) {
    const size = gzipSync(readFileSync(resolve(root, 'dist', file)), { level: 9 }).length;
    console.log(`    ${file.padEnd(28)} ${size.toLocaleString().padStart(6)} bytes gzip`);
  }
}
console.log();

if (failed) process.exit(1);
