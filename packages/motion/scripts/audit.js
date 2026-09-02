/**
 * The standing audit checks.
 *
 * Every rule here exists because the corresponding mistake was actually made
 * in this repository, usually more than once. They are cheap, they run in a
 * second, and they catch the classes that reading does not: a comment naming a
 * function deleted three commits ago reads perfectly well.
 *
 * `npm run audit` runs these; `npm run check` runs them with the other gates.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir, match = /\.(ts|js)$/) =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? walk(path, match) : match.test(e.name) ? [path] : [];
  });

/**
 * The library only. `index.ts` and `lab.ts` are the demo and the inertia lab —
 * they are excluded from the build and from `files`, and auditing them
 * produced four findings about code that does not ship. A rule that cries wolf
 * gets switched off, which costs more than the rule was worth.
 */
const SRC = walk(resolve(root, 'src')).filter(
  (f) => !/src\/(demo|lab)\.ts$/.test(f)
);
const findings = [];
const report = (rule, where, detail) => findings.push({ rule, where, detail });

/* ── 1 ─ Comments naming code that no longer exists ──────────────────────────
 * A stale `BREAKPOINTS` import survived a whole redesign with the suite green.
 * Prose rots silently, and a docblock describing a deleted function is worse
 * than no docblock: it is confidently wrong. */
{
  const identifiers = new Set();
  for (const file of SRC) {
    for (const [, name] of readFileSync(file, 'utf8')
      .matchAll(/(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      identifiers.add(name);
    }
  }
  /** Names retired from this codebase. A mention now is a stale comment. */
  const RETIRED = [
    'getScreenType', 'hasTablet', 'hasMobile', 'ScreenMotions', 'ScreenType',
    'tabletScreenWidth', 'mobileScreenWidth', 'isTouchScreen', 'PositionSubject',
    'getElementPosition', 'isAfterScrollWindow', 'isBeforeScrollWindow',
    'DEFAULT_START', 'DEFAULT_END', 'parseValue', 'parseUnit', 'startPer', 'endPer',
    'createAnimation', 'AnimationOptions', 'AnimationInstance', 'AnimationEventDetail',
    'ScreenAnimations', 'data-motion', 'data-anim', 'motion:active', 'anim:active',
    /** Pre-redesign keyframe shape, replaced by RawKeyframe when positions gained units. */
    'percent:',
    /**
     * Retired by the module refactor. Sequence and split stopped being chunks
     * fetched on demand and became modules the page wires, which deleted the
     * loaders, their in-flight guards and their catches. Nothing had been
     * added here for that change, so `src/` could have gone on describing
     * `attachSplit` indefinitely — and eight harnesses and five documents did
     * exactly that elsewhere.
     */
    'attachSplit', 'attachSequence', 'attachPath', 'splitModes', 'BREAKPOINTS',
  ];
  /**
   * `src/` and the README.
   *
   * Docs under `docs/` are deliberately out: they record what things used to
   * be, on purpose, and flagging that is how a rule starts crying wolf. The
   * README is the opposite — it is what a consumer reads as current, and it
   * spent the whole module refactor telling people that text splitting was
   * "loaded on demand".
   */
  for (const file of [...SRC, resolve(root, 'README.md')]) {
    const source = readFileSync(file, 'utf8');
    for (const name of RETIRED) {
      if (identifiers.has(name)) continue;
      const lines = source.split('\n');
      /**
       * Bounded on both sides, because a retired name is often a *prefix* of
       * its replacement: `motion:active` sits inside `vera-motion:active`, and
       * a plain `includes` reports every correct line as a stale one. A rule
       * that fires for the wrong reason is as useless as one that cannot fire.
       */
      const bounded = new RegExp(`(?<![\\w:-])${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![\\w-])`);
      const line = lines.findIndex((l) => bounded.test(l));
      if (line < 0) continue;
      /**
       * A comment saying what something *used to* be is the good kind of
       * mention — this codebase deliberately records why a thing changed. Only
       * flag a name used as though it were still live.
       *
       * "chosen over" and "rejected" are here for the *other* historical
       * shape, which the first list missed: a name that was considered and
       * **never adopted**. A cost is only a cost against something, so pricing
       * a decision means naming the alternative — `data-motion` is what
       * `data-vera-motion` was chosen over, and saying so is the opposite of
       * describing it as live. A repository whose decision log is half
       * rejected alternatives needs that shape allowed.
       */
      const context = lines.slice(Math.max(0, line - 6), line + 3).join(' ');
      if (/used to|the old|no longer|replaced|has since|formerly|used by the|which is how|chosen over|rejected/i.test(context)) continue;
      report('stale-reference', `${file}:${line + 1}`, `mentions retired "${name}"`);
    }
  }
}

/* ── 2 ─ Exported functions with no docblock ─────────────────────────────────
 * The package convention: a docblock on every export. Inserting a constant between a
 * docblock and its function silently orphans it, which is how `parseKeyframeList`
 * lost its documentation to a function added above it. */
for (const file of SRC) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/^export (const \w+ = (\(|<|async)|function )/.test(line)) return;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    if (j < 0 || !lines[j].trim().endsWith('*/')) {
      report('undocumented-export', `${file}:${i + 1}`, line.trim().slice(0, 60));
    }
  });
}

/* ── 3 ─ Listeners and observers without a teardown ──────────────────────────
 * "Everything is destroyable" is principle #2, and two teardown races shipped
 * anyway: an uncancellable `fonts.ready` and a deferred frame with no canceller. */
/**
 * Comments are stripped first. A docblock explaining what a consumer's
 * `addEventListener` call will see is not a listener this module registered,
 * and counting it reported a teardown leak in `events.ts`, a file that
 * registers nothing at all.
 */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

for (const file of SRC) {
  const source = withoutComments(readFileSync(file, 'utf8'));
  const added = (source.match(/\.addEventListener\(/g) ?? []).length;
  const removed = (source.match(/\.removeEventListener\(/g) ?? []).length;
  if (added > removed) {
    report('teardown', file, `${added} addEventListener, ${removed} removeEventListener`);
  }
  for (const observer of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
    if (!source.includes(`new ${observer}`)) continue;
    /**
     * Returning the observer hands teardown to the caller, which is what
     * `observer.ts` does — its consumer disconnects it. Only a module that
     * both creates and keeps one owes a disconnect.
     */
    const handsItBack = new RegExp(`(return|=>)\\s*\\n?\\s*new ${observer}`).test(source);
    if (!handsItBack && !source.includes('disconnect()')) {
      report('teardown', file, `creates a ${observer} and never disconnects it`);
    }
  }
}

/* ── 4 ─ Unbounded work driven by attribute input ────────────────────────────
 * Values were range-checked long before counts were. 200,000 keyframes in one
 * attribute parsed in 92ms and built a curve the frame loop then scanned. */
{
  const schema = readFileSync(resolve(root, 'src/modules/schema.ts'), 'utf8');
  for (const [, call] of schema.matchAll(/raw\.split\((['"/][^)]*)\)/g)) {
    const near = schema.slice(schema.indexOf(`raw.split(${call})`) - 400, schema.indexOf(`raw.split(${call})`) + 400);
    if (!/MAX_|\.length >= |slice\(0,/.test(near)) {
      report('unbounded-input', 'schema.ts', `raw.split(${call}) with no cap nearby`);
    }
  }
  for (const setting of schema.matchAll(/\{ attribute: '([a-z-]+)', type: '(number|string)'([^}]*)\}/g)) {
    const [, name, type, rest] = setting;
    if (!/min:|max:|allowed:/.test(rest)) {
      report('unbounded-input', 'schema.ts', `setting "${name}" (${type}) has no bounds`);
    }
  }
}

/* ── 5 ─ Debug leftovers ─────────────────────────────────────────────────────*/
for (const file of SRC) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of [/console\.log\(/, /\bdebugger\b/, /\bTODO\b/, /\bFIXME\b/]) {
    if (pattern.test(source)) report('leftover', file, String(pattern));
  }
}

/* ── 6 ─ Hard-coded attribute namespace ──────────────────────────────────────
 * Convention: the namespace comes from the constant, never inline. */
for (const file of SRC) {
  if (file.endsWith('schema.ts')) continue;
  const source = readFileSync(file, 'utf8');
  source.split('\n').forEach((line, i) => {
    if (/['"`]data-vera-motion/.test(line) && !line.trim().startsWith('*')) {
      report('hard-coded-prefix', `${file}:${i + 1}`, line.trim().slice(0, 60));
    }
  });
}

/* ── 7 ─ Size claims in the README that have drifted from the build ──────────
 * Every one of these was stale at the moment it was checked: the README said
 * 8.7 KB for a 9.0 KB bundle and 0.9 for a 1.0 KB chunk. Numbers in prose rot
 * faster than prose does, and nobody re-reads them. Skipped when `dist` is
 * missing, so this does not force a build to lint. */
{
  const dist = resolve(root, 'dist');
  if (existsSync(dist)) {
    const { gzipSync } = await import('node:zlib');
    const kb = (file) => (gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024).toFixed(1);
    const built = readdirSync(dist).filter((f) => f.endsWith('.js'));
    const find = (prefix) => built.find((f) => f.startsWith(prefix));
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const claims = [
      ['@verajs/motion`', find('vera-motion.min')],
      ['scroll-to`', find('vera-motion-scroll-to')],
      ['/sequence`', find('vera-motion-sequence')],
      ['/split`', find('vera-motion-split')],
      ['/easings`', find('vera-motion-easings')],
      ['/paint`', find('vera-motion-paint')],
    ];
    for (const [marker, file] of claims) {
      if (!file) continue;
      /**
       * Every row that names it, not the first. The README had two module
       * tables; `find` matched the earlier one and the later one's three
       * stale figures were invisible to this rule for as long as both existed.
       */
      const rows = readme.split('\n').filter((l) => l.includes(marker) && l.includes('KB gzip'));
      const actual = kb(file);
      for (const row of rows) {
        const claimed = /(\d+\.\d) KB gzip/.exec(row)?.[1];
        if (claimed !== actual) {
          report('stale-size-claim', 'README.md', `${marker} says ${claimed} KB, build is ${actual} KB`);
        }
      }
    }

    /**
     * And every *other* KB figure in the README, wherever it is phrased.
     *
     * The rows above are matched by package marker plus the exact words "KB
     * gzip", which the first line of the README is not: it read
     * "**6.5 KB** gzipped" while the build was 9.1, and had done since long
     * before this rule existed. The headline is the single most-read size
     * claim in the project and was the one nothing checked. Two rows above
     * were dead as well — they looked for `sequence-` and `split-` hashed
     * chunk names that stopped being emitted when those became modules, so they
     * matched no file and skipped silently.
     *
     * A figure that is not the size of something in `dist` is either stale or
     * about something else; if it is about something else, do not write it in
     * kilobytes.
     */
    {
      const sizes = new Set(built.map(kb));
      readme.split('\n').forEach((line, i) => {
        for (const [, figure] of line.matchAll(/(\d+\.\d)\s*KB/g)) {
          if (!sizes.has(figure)) {
            report('stale-size-claim', `README.md:${i + 1}`,
              `"${figure} KB" matches no built artifact (${[...sizes].sort().join(', ')})`);
          }
        }
      });
    }

    /**
     * The CLAUDE.md and HANDOFF.md halves of this rule left with the 2026-09-01 monorepo
     * migration: both documents moved to the private portal, where they are historical
     * snapshots rather than live claims, and a public gate cannot read a private path.
     * If operational lore returns as a public `CLAUDE.md`, its byte-claim checks come
     * back with it — the pre-migration `scripts/audit.js` in the archived repo has them.
     */
    {
      const bytes = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
      const withCommas = (n) => n.toLocaleString('en-US');

      /**
       * And the same figures wherever `docs/` writes them.
       *
       * On 2026-08-31 two audit documents quoted split's size as two different
       * stale values, in two directions — in the documents whose subject *was*
       * what each module costs.
       *
       * Keyed on the package specifier, which is how a document names a module
       * when it is quoting its size, and bounded to the rest of that line. A
       * bare module word is not enough: "split" and "sequence" are ordinary
       * English in these files, and a rule that fires on prose gets switched
       * off.
       */
      for (const file of walk(resolve(root, 'docs'), /\.md$/)) {
        const text = readFileSync(file, 'utf8');
        const where = file.replace(`${root}/`, '');
        text.split('\n').forEach((line, i) => {
          for (const name of ['sequence', 'split', 'easings', 'paint']) {
            if (!line.includes(`@verajs/motion/${name}`)) continue;
            const built = find(`vera-motion-${name}`);
            if (!built) continue;
            const actual = withCommas(bytes(built));
            /**
             * Up to the next cell boundary. A figure on the far side of a `|`
             * is in another column and is about something else: the modularity
             * audit's table has a row for *the hook into* `@verajs/motion/easings`
             * costing 168 B of core, which is not the module's 713 and never
             * was. That row is the reason this rule stops at the pipe.
             */
            const after = line.slice(line.indexOf(`@verajs/motion/${name}`)).split('|')[0];
            for (const [, figure] of after.matchAll(/\b(\d{3}|\d,\d{3})\b(?=[\s,.]*(?:B\b|bytes\b)|\s{2,})/g)) {
              if (figure !== actual) {
                report('stale-size-claim', `${where}:${i + 1}`, `says ${name} is ${figure}, build is ${actual}`);
              }
            }
          }
        });

        /**
         * And the other shape a document writes them in: the bare list,
         * `sequence 2,062, split 1,615, easings 713, paint 552`, which names no
         * package specifier and so was invisible to the loop above.
         * The modularity audit carried it with sequence 67 bytes stale — in
         * the sentence directing the reader to `scripts/size.js` for the
         * authoritative figure.
         *
         * **Per paragraph, not per line.** Two names together is the signal —
         * `split 1,615` alone could be prose, `split 1,615, easings 713` is a
         * size list and nothing else — and the first attempt asked for both on
         * one line. That exact sentence wraps between `split` and its number,
         * so the line carrying the stale figure held one name, the rule
         * skipped it, and the check reported clean on the defect it had just
         * been written for. A markdown paragraph is the unit the author wrote;
         * a line is where it happened to break.
         */
        const paragraphs = text.split(/\n[ \t]*\n/);
        let line = 1;
        for (const paragraph of paragraphs) {
          const at = line;
          line += paragraph.split('\n').length + 1;
          const pairs = [...paragraph.matchAll(/\b(sequence|split|easings|paint)\s+(\d{3}|\d,\d{3})\b/g)];
          if (new Set(pairs.map(([, name]) => name)).size < 2) continue;
          for (const [, name, figure] of pairs) {
            const built = find(`vera-motion-${name}`);
            if (!built) continue;
            const actual = withCommas(bytes(built));
            if (figure !== actual) {
              report('stale-size-claim', `${where}:${at}`, `says ${name} is ${figure}, build is ${actual}`);
            }
          }
        }
      }
    }

    /**
     * The README is not the only place a size gets written down. A docblock in
     * `src/` said "3.2 KB gzipped, against 6.5 KB" long after the two were 3.3
     * and 9.0 — invisible to the check above, which matched only the README's
     * "KB gzip" phrasing. Any hard KB figure in shipped source now has to name
     * a size something in `dist` actually is.
     *
     * Docs are deliberately excluded where they record historical
     * measurements on purpose, and flagging those is how a rule starts crying
     * wolf.
     */
    /**
     * package.json's own description carries a size, and it is what npm shows
     * on the package page. It said 6.5 KB for a 9.4 KB build — invisible to
     * the README check above and to every other gate here.
     */
    {
      const pkg = readFileSync(resolve(root, 'package.json'), 'utf8');
      const claimed = /(\d+\.\d)\s*KB/.exec(JSON.parse(pkg).description ?? '')?.[1];
      const main = find('vera-motion.min');
      if (claimed && main && claimed !== kb(main)) {
        report('stale-size-claim', 'package.json',
          `description says ${claimed} KB, build is ${kb(main)} KB`);
      }
    }

    /**
     * The demo pages carry sizes too, and nothing checked them.
     * `preview.html` announced `@verajs/motion/paint — 414 bytes` while the
     * module was 544, having grown when its slot table gained a count cap.
     *
     * Matched by package name on the same line, deliberately: `preview.html`
     * also says "two schema rows, 18 bytes", which is a *delta* — what adding
     * something cost — not the size of an artifact. A rule that flagged every
     * byte figure would be wrong about that one, and a rule that is wrong
     * gets switched off.
     */
    {
      const byName = {
        '@verajs/motion/paint': find('vera-motion-paint'),
        '@verajs/motion/easings': find('vera-motion-easings'),
        '@verajs/motion/sequence': find('vera-motion-sequence'),
        '@verajs/motion/split': find('vera-motion-split'),
        '@verajs/motion/scroll-to': find('vera-motion-scroll-to'),
      };
      for (const page of ['preview.html', 'index.html']) {
        const file = resolve(root, page);
        if (!existsSync(file)) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const [name, built] of Object.entries(byName)) {
            if (!built || !line.includes(name)) continue;
            const claimed = /([\d,]+)\s*bytes/.exec(line)?.[1];
            if (!claimed) continue;
            const actual = gzipSync(readFileSync(join(dist, built)), { level: 9 }).length;
            if (Number(claimed.replace(/,/g, '')) !== actual) {
              report('stale-size-claim', `${page}:${i + 1}`,
                `${name} says ${claimed} bytes, build is ${actual}`);
            }
          }
        });
      }
    }

    /**
     * A module doc's headline size is its *own* module's, so it is checked
     * against that artifact rather than against "some artifact in dist" —
     * `paint.md` claiming 1.5 KB would otherwise pass, 1.5 being real.
     *
     * Keyed on the words "KB gzip", the same marker the README rows use, so an
     * ordinary sentence mentioning a kilobyte is not caught by this half; it
     * still has to match something under the generic sweep below.
     */
    {
      const dir = resolve(root, 'docs/modules');
      if (existsSync(dir)) {
        for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
          const artifact = `vera-motion-${name.replace(/\.md$/, '')}`;
          const file = find(artifact);
          if (!file) continue;
          const actual = kb(file);
          readFileSync(join(dir, name), 'utf8').split('\n').forEach((line, i) => {
            for (const [, claimed] of line.matchAll(/(\d+\.\d)\s*KB gzip/g)) {
              if (claimed !== actual) {
                report('stale-size-claim', `docs/modules/${name}:${i + 1}`,
                  `says ${claimed} KB gzip, build is ${actual} KB`);
              }
            }
          });
        }
      }
    }

    const real = new Set(built.map(kb));
    const moduleDocs = existsSync(resolve(root, 'docs/modules'))
      ? readdirSync(resolve(root, 'docs/modules')).filter((f) => f.endsWith('.md'))
          .map((f) => resolve(root, 'docs/modules', f))
      : [];
    for (const file of [...SRC, ...moduleDocs]) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bKB\b/.test(line)) return;
        for (const [, n] of line.matchAll(/(\d+\.\d)\s*KB/g)) {
          if (!real.has(n)) {
            report('stale-size-claim', `${file}:${i + 1}`,
              `claims ${n} KB; dist has ${[...real].sort().join(', ')} KB`);
          }
        }
      });
    }
  }
}

/* ── 8 ─ A docblock with nothing after it ────────────────────────────────────
 * `dom.ts` ended with a docblock describing `getScreenType` — a function
 * deleted some time earlier — and, worse, describing the fixed tablet/mobile
 * breakpoint model that the width-band redesign removed entirely. Rule 1 could
 * not see it: the comment never names a retired identifier, it only describes
 * one, so there was no string to match.
 *
 * Only the end-of-file case is flagged. Two docblocks in a row is a shape this
 * codebase uses deliberately (see `focusTarget`), and flagging it would make
 * the rule cry wolf. */
{
  for (const file of SRC) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let lastClose = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '*/') lastClose = i;
      else if (lines[i].trim() !== '') lastClose = -1;
    }
    if (lastClose >= 0) {
      const opens = lines.slice(0, lastClose + 1).reduce((n, l) => n + (l.trim().startsWith('/**') ? 1 : 0), 0);
      if (opens) report('orphaned-docblock', `${file}:${lastClose + 1}`, 'docblock documents nothing — no declaration follows it');
    }
  }
}

/* ── 9 ─ Every published entry must be importable outside a browser ─────────
 * `DEFAULTS` held `scrollElement: window` in a module-scope object literal, so
 * `dist/motion.js` threw `ReferenceError: window is not defined` the moment it
 * was imported — not when used, on *import*, which is what an SSR framework
 * does while rendering on the server. `scroll-to` never had it, because it
 * resolves `?? window` inside its factory: one entry safe, its twin not.
 *
 * Node has no DOM, so importing the built files here is the check. Skipped
 * when `dist` is missing, like rule 7. */
{
  const dist = resolve(root, 'dist');
  if (existsSync(dist)) {
    /**
     * By **specifier**, and all six of them.
     *
     * This imported `dist/motion.js` and `dist/scroll-to.js` by path, which is
     * neither what a consumer writes nor all of what they can import: the four
     * module artifacts were never import-checked at all, and a module is the
     * likeliest place for this failure — `paint` reaches for `CSS` and
     * `sequence` for `Image`. Resolving `@verajs/motion/paint` through the
     * package's own `exports` map also checks the map, self-referencing being
     * exactly how a consumer reaches it.
     */
    const { name, exports: map } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    /**
     * And self-contained: no artifact may import another.
     *
     * A shared chunk was measured and rejected early on,
     * and `namespace.ts` exists because one string taken from `schema.ts`
     * dragged the whole animation table into `scroll-to`. If a refactor ever
     * produced a common chunk, every one of those decisions would quietly
     * reverse: a page importing `scroll-to` would fetch the animation table
     * again.
     *
     * Nothing in `npm run check` said so. The size budgets would not — an
     * emitted chunk is *reported* by `size.js` as "loaded on demand (not
     * budgeted)" and fails nothing — and `chunk-loading.mjs` needs a browser
     * and a dev server.
     *
     * What is allowed is the package's own `name` and nothing else. Four of the
     * seven artifacts name it: `vera` for `createMotion`, and `split`,
     * `sequence` and `paint` for `reject`/`pageProblem` — the registry
     * `instance.rejected` is read from, which is module-level state, so a
     * bundled copy is a private one nobody reads. This line used to end "all
     * six artifacts import nothing at all today", which was true and was also
     * the bug: every one of them was inlining that registry.
     */
    for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(resolve(dist, file), 'utf8');
      /**
       * All three spellings. The first version matched only `import … from`,
       * and a bare side-effect `import "./motion.js"` — which is what a
       * bundler emits for a shared chunk with no named exports, and what my
       * own controlled test planted — has no `from` in it at all. The rule
       * reported nothing against a deliberately broken artifact.
       */
      const specifiers = [
        ...[...source.matchAll(/(?:^|[;\n])\s*import[^;'"]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ];
      for (const specifier of specifiers) {
        /**
         * **The main entry, by name, is the one allowed import.**
         *
         * The invariant here is that no artifact contains a *copy* of another,
         * and an external import by package name is the opposite of that — it
         * is the thing that prevents one. `@verajs/motion/vera` calls
         * `createMotion`, so it needs the runtime; bundling it would put a
         * second copy of the whole library in that artifact, and a second copy
         * means **a second registry**: `wireMotion(split)` on the page's copy
         * would be invisible to the copy inside `vera.js`, whose
         * `createMotion` would then run against an empty one. Two registries
         * is a worse failure than the shared chunk this rule was written for.
         *
         * A page reaching for `@verajs/motion/vera` has necessarily imported
         * `@verajs/motion` already — it is the thing being extended — so this
         * costs no request that was not already being made. Read from
         * `package.json`'s own `name` rather than written out, and it is the
         * *only* specifier allowed: an artifact importing a sibling module, or
         * a bare relative path, is still the shared chunk and still fails.
         */
        if (specifier === name) continue;
        report('artifact-not-self-contained', `dist/${file}`,
          `imports "${specifier}" — each entry point ships alone, by measured decision`);
      }
    }
    for (const subpath of Object.keys(map ?? {})) {
      const specifier = subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`;
      try {
        await import(specifier);
      } catch (error) {
        report('not-import-safe', specifier,
          `throws on import outside a browser: ${error.message}`);
      }
    }
  }
}

/* ── 10 ─ Every mutation anchor still exists in the source ───────────────────
 * Two failure modes, one check. A refactor moves the line a mutation targets
 * and the mutation quietly reports SKIP forever — a test of the tests that
 * stopped testing anything. And a mutation run killed part-way through leaves
 * its edit in `src/`, which is how a deliberately broken `runOnce` guard came
 * within one commit of being committed: the suite was green because the run
 * that would have caught it was the run that got killed. */
{
  const { MUTATIONS } = await import(pathToFileURL(resolve(root, 'scripts/mutate.js')).href);
  for (const [name, path, from] of MUTATIONS) {
    const target = resolve(root, path);
    if (!existsSync(target)) { report('mutation-anchor', path, `missing file, for "${name}"`); continue; }
    /**
     * Exactly once, not merely present. Two things ride on that.
     *
     * `mutate.js` uses `String.replace`, which edits the *first* match — so an
     * anchor appearing twice may be testing a line nobody chose. And a
     * presence check cannot see residue behind a duplicate: a killed run left
     * `active.add(element)` mutated in `visibility.ts` and this rule passed,
     * because the second, untouched occurrence still satisfied `includes`.
     * That is the exact failure this rule was written for, surviving inside
     * the rule itself.
     */
    const body = readFileSync(target, 'utf8');
    const count = body.split(from).length - 1;
    if (count === 0) {
      report('mutation-anchor', path,
        `anchor for "${name}" is gone — the line moved, or a killed run left its mutation behind`);
    } else if (count > 1) {
      report('mutation-anchor', path,
        `anchor for "${name}" appears ${count} times — it must be unique, or it mutates ` +
        'whichever line comes first and hides residue behind the others');
    }
  }
}

/* ── 11 ─ Every in-README anchor resolves to a heading ───────────────────────
 * A dead `](#anchor)` is silent: GitHub renders it as an ordinary link and
 * scrolls nowhere. `[data-vera-motion-frame](#properties)` pointed at a
 * heading that had been renamed, and a link added while consolidating two
 * module tables pointed at `#modules` when the heading is "Property modules". Both
 * were invisible to every other gate. */
{
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const slug = (text) =>
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  const headings = new Set(
    readme.split('\n')
      .map((line) => /^#{1,6}\s+(.*?)\s*$/.exec(line)?.[1])
      .filter(Boolean)
      .map(slug)
  );
  for (const [, anchor] of readme.matchAll(/\]\(#([a-z0-9-]+)\)/g)) {
    if (!headings.has(anchor)) {
      report('dead-anchor', 'README.md', `](#${anchor}) matches no heading`);
    }
  }

  /**
   * And the links that leave the file, against what npm actually publishes.
   *
   * README.md ships. Its relative links do not, unless `files` says so, and
   * **all seven of them were broken for anyone who installed the package** —
   * including `docs/ATTRIBUTE-REFERENCE.md`, which the README names three
   * times and once instructs the reader to paste into an agent's context.
   *
   * On GitHub every one of them resolved, which is why it survived: the file
   * is read far more often in the place where it works.
   */
  const shipped = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).files ?? [];
  for (const [, target] of readme.matchAll(/\]\(([^)#][^)]*)\)/g)) {
    if (/^https?:/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue;
    if (!existsSync(resolve(root, path))) {
      report('dead-link', 'README.md', `](${target}) is not a file in the repository`);
      continue;
    }
    /** `files` entries are paths or directories; a link is covered by either. */
    if (!shipped.some((entry) => path === entry || path.startsWith(`${entry}/`))) {
      report('unshipped-link', 'README.md', `](${target}) is not in package.json "files" — broken for anyone who installs`);
    }
  }
}

/* ── 12 ─ Every shipped module is documented, and the generator knows it ─────
 * `docs/ATTRIBUTE-REFERENCE.md` is generated, and `check:reference` verifies
 * it is not stale — but stale and *complete* are different claims. The
 * generator read `PROPERTIES`, `SETTINGS` and `CATEGORIES`, all three the
 * built-in tables, so when `frame` and the paint properties moved out to
 * modules the reference silently lost six properties and five settings and
 * went on saying "23 properties". `check:reference` regenerated from the same
 * tables and agreed with itself.
 *
 * The generator now wires the modules and reads the live registry, which makes
 * coverage automatic — for the modules it wires. This is the rule that says it
 * wires all of them. The list comes from `package.json` exports, because that
 * is what actually ships: a module published without a generator entry, or
 * without its own doc, fails here rather than being noticed. */
/**
 * And every option a consumer can pass is named in the README.
 *
 * The attribute vocabulary is generated and checked from end to end; the
 * *options* object beside it is hand-documented, and an option nobody wrote
 * down is invisible to all three of the authors this library has — a GUI reads
 * the README, an AI is handed it, and a person searches it. It cannot be
 * generated, because what each option means is the part worth writing.
 *
 * All 28 are mentioned today. This is what keeps the next one from not being.
 * Read from the built declarations rather than the source, so it is the
 * published surface being asked about.
 */
{
  const dist = resolve(root, 'dist');
  if (existsSync(dist)) {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const body = (file, name) => {
      /**
       * Absent counts as unreadable, not as a crash. The first version called
       * `readFileSync` straight out, so a missing declaration file took the
       * whole audit down with an ENOENT stack instead of reporting that this
       * rule had stopped checking anything — which is the failure the empty
       * guard below exists for, arriving one line too early to be caught by it.
       */
      const path = resolve(dist, file);
      if (!existsSync(path)) return '';
      const text = readFileSync(path, 'utf8');
      const start = text.indexOf(`interface ${name} {`);
      return start < 0 ? '' : text.slice(start, text.indexOf('\n}', start));
    };
    /**
     * The instances too, not only the options.
     *
     * This read the two options objects and stopped, so a published *member*
     * could go unmentioned — and one had: `ScrollToInstance.rejected` appears
     * nowhere in the scroll-to instance table, while the README tells readers
     * six times that a bad option is "reported in `rejected`". A reader of
     * that table could not learn the member exists, let alone that its entries
     * are shaped `{ node, reason }` where the animation runtime's are
     * `{ node, rejected }`.
     */
    const options = [
      ['MotionOptions', body('development/vera-motion.d.ts', 'MotionOptions')],
      ['ScrollToOptions', body('development/vera-motion-scroll-to.d.ts', 'ScrollToOptions')],
      ['MotionInstance', body('development/vera-motion.d.ts', 'MotionInstance')],
      ['ScrollToInstance', body('development/vera-motion-scroll-to.d.ts', 'ScrollToInstance')],
    ];
    for (const [name, text] of options) {
      /** An empty read means the shape moved, which would pass silently. */
      if (!text) {
        report('undocumented-option', 'README.md', `${name} could not be read from dist — this rule is not checking it`);
        continue;
      }
      for (const [, key] of text.matchAll(/^\s+(?:readonly\s+)?([A-Za-z][\w]*)\??:/gm)) {
        if (!readme.includes(`\`${key}\``)) {
          report('undocumented-option', 'README.md', `${name}.${key} is published and never mentioned`);
        }
      }
    }
  }
}

{
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const generator = readFileSync(resolve(root, 'scripts/generate-reference.js'), 'utf8');
  const reference = readFileSync(resolve(root, 'docs/ATTRIBUTE-REFERENCE.md'), 'utf8');

  /**
   * `.` is the library and `./scroll-to` is a second entry point, not a
   * property module — it registers no attributes and has nothing to appear in
   * an attribute reference.
   */
  const NOT_A_MODULE = new Set(['.', './scroll-to']);

  /**
   * And an export that **registers no attributes** still needs its own doc, but
   * has nothing to contribute to the attribute reference. `./vera` is the
   * integration for a different framework's insert system — it hands shadow
   * roots to `observe()` and registers nothing with `wireMotion` — so wiring it
   * into the generator would add an empty section, and the generator's own
   * coverage claim would be about a module with no vocabulary.
   *
   * A hand-held list, and it is the second one in this rule. The distinction it
   * encodes is "does this export a `Wirable`", which cannot be derived here:
   * `audit.js` runs under plain node and the registry is TypeScript. A new
   * export belongs in this set if, and only if, `wireMotion` would have nothing
   * to do with it.
   */
  const REGISTERS_NOTHING = new Set(['./vera']);

  for (const entry of Object.keys(pkg.exports ?? {})) {
    if (NOT_A_MODULE.has(entry)) continue;
    const name = entry.replace(/^\.\//, '');
    const specifier = `@verajs/motion/${name}`;

    if (!existsSync(resolve(root, `docs/modules/${name}.md`)))
      report('undocumented-module', 'package.json', `exports "${entry}" with no docs/modules/${name}.md`);

    if (REGISTERS_NOTHING.has(entry)) continue;

    if (!generator.includes(specifier))
      report('undocumented-module', 'scripts/generate-reference.js',
        `"${specifier}" is exported but not wired here — its attributes cannot reach the reference`);

    if (!reference.includes(`modules/${name}.md`))
      report('undocumented-module', 'docs/ATTRIBUTE-REFERENCE.md',
        `nothing links to modules/${name}.md — regenerate with \`npm run reference\``);
  }
}

/**
 * Counted from the rule banners, not typed here. It said "9 rules" for three
 * rules' worth of drift, which is the failure the size rules exist to prevent
 * happening inside the tool that enforces them.
 */
const RULE_COUNT = (readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/── \d+ ─/g) ?? []).length;

/*
 * Rules 13, 16, 17, 20, 21 and 24 left with the 2026-09-01 monorepo migration. Each one
 * checked a document that moved to the private portal — CLAUDE.md's counts, the audit
 * findings' state marks, ROADMAP phase marks, DESIGN-SPEC's module map and gate counts,
 * the index documents' cross-counts, and ATTRIBUTE-API's grammar sketch. A public gate
 * cannot read a private path, and an existsSync guard here would be a rule that silently
 * checks nothing. If any of those documents returns to this package, its rule comes back
 * with it — the pre-migration `scripts/audit.js` in the archived repo has them all.
 */

/**
 * And a count *about* a document, quoted somewhere else, against what that
 * document says about itself. One audit document opened with "Result: 16
 * findings" while its two indexes said 16 and 15 — disagreeing with each
 * other in the same repository. Whichever a reader opened first was the one they believed.
 *
 * The document's own summary is the authority, because it is the thing being
 * described. One subject today — a doc has to state `**Result: N findings**`
 * to be checked at all — and the rule costs nothing until a second one does. */
{
  for (const file of walk(resolve(root, 'docs'), /\.md$/)) {
    const stated = /\*\*Result: (\d+) findings/.exec(readFileSync(file, 'utf8'))?.[1];
    if (stated === undefined) continue;
    const name = file.replace(`${root}/`, '').replace('docs/', '');

    for (const other of walk(resolve(root, 'docs'), /\.md$/)) {
      if (other === file) continue;
      readFileSync(other, 'utf8').split('\n').forEach((line, i) => {
        if (!line.includes(name)) return;
        const quoted = /(\d+) findings/.exec(line)?.[1];
        if (quoted === undefined || quoted === stated) return;
        report(
          'stale-count',
          `${other.replace(`${root}/`, '')}:${i + 1}`,
          `says ${name} has ${quoted} findings; it says ${stated}`
        );
      });
    }
  }
}

/* ── 14 ─ One name for an idea ───────────────────────────────────────────────
 * "There is exactly one name for that idea" is the standing rule here — and
 * nothing enforced it, so one idea carried two names: *pack* / *module*,
 * 81 uses against 89, in one repository. A README heading said "Property
 * packs" while the folder under it was called `modules/` — pack, module. Both
 * words were load-bearing and neither was wrong, which is why it survived: no
 * reader of either half saw an inconsistency.
 *
 * A synonym is allowed on a line that also names the canonical term, because
 * the passage that *teaches* the rule has to spell out what it is replacing.
 * The inertia synonyms are not in this table yet for exactly that reason —
 * they appear in prose whose whole job is to list them, and a rule that fires
 * on its own documentation is a rule someone switches off. */
{
  const CANONICAL = [
    { wrong: /\bpacks?\b/i, right: /\bmodules?\b/i, say: '"pack" — the word for a separate import is "module"' },
    /**
     * The attribute `inertia` was called `speed` first, and the old name
     * outlived the rename in four spike fixtures and two documents — one
     * told a reader the opt-out was
     * `data-vera-motion-speed="0"`, which does nothing but take the default inertia.
     * The fixtures are caught structurally by `check-examples`, which reads
     * the registry; prose is not, because a document may legitimately name an
     * attribute that was never built. A line teaching the rename names
     * `inertia` and is allowed.
     */
    {
      wrong: /data-vera-motion-speed\b/, /* the attribute is `inertia` */
      right: /\binertia\b/,
      say: '`data-vera-motion-speed` — the attribute is `inertia`; the old name silently takes the default',
    },
    /**
     * The option pair went the same way and lasted longer. The design log
     * described **the current runtime** as transitioning over
     * `transformSpeed` / `filterSpeed` seconds — the inertia names are
     * `transform-inertia` / `filter-inertia` — and §3 argued about whether to
     * build a second engine on the strength of an inertia of `1` written as
     * `transformSpeed: 1` — the pre-rewrite spelling of inertia, and the
     * pre-rewrite value, in the passage a reader uses to decide.
     *
     * Naming the canonical term on the same line is the escape, as above, and
     * it is what the passages *about* the old library legitimately do.
     */
    {
      wrong: /\b(transformSpeed|filterSpeed)\b/, /* the names are per-category inertia */
      right: /\binertia\b/i,
      say: '`transformSpeed` / `filterSpeed` — the names are `transform-inertia` / `filter-inertia`',
    },
  ];
  const files = [
    ...SRC,
    ...walk(resolve(root, 'docs'), /\.md$/),
    ...walk(resolve(root, 'scripts')),
    ...walk(resolve(root, 'test')),
    resolve(root, 'README.md'),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const { wrong, right, say } of CANONICAL) {
        if (wrong.test(line) && !right.test(line)) {
          report('two-names', `${file.replace(`${root}/`, '')}:${i + 1}`, say);
        }
      }
    });
  }
}

/*
 * Rules 15 and 26 (the spike index, and harnesses that conclude must exit) moved to the
 * private portal with `spikes/` itself on 2026-09-01 — the harnesses are the audit's
 * instruments, and one is a security probe. The portal's copy of this file enforces them.
 */

/* ── 18 ─ No test file is a copy of another ─────────────────────────────
 * A restore from a mis-named backup replaced `schema.test.js` with a copy of
 * `curve.test.js` and it was committed. 149 tests — every schema invariant,
 * both enforcement sweeps, the settings bounds — vanished, and **the suite
 * stayed green**: 107 files, 107 passing, because what landed was a valid
 * duplicate of another file's tests.
 *
 * Nothing could see it. `check:imports` counts files and the count did not
 * change; the suite reports passes and they all passed; only the *total*
 * moved, and no gate reads that. A file that is byte-identical to another is
 * the one signature that failure leaves.
 *
 * It catches the ordinary version too — a test file copied as a starting
 * point and committed before anything in it was changed. */
{
  const seen = new Map();
  for (const file of readdirSync(resolve(root, 'test'))) {
    if (!file.endsWith('.test.js')) continue;
    const body = readFileSync(resolve(root, 'test', file), 'utf8').trim();
    const twin = seen.get(body);
    if (twin) {
      report('duplicate-test', `test/${file}`, `identical to test/${twin} — one of them replaced the other`);
    } else {
      seen.set(body, file);
    }
  }
}

/* ── 19 ─ Every build config is one something runs ──────────────────────────
 * `tsconfig.test.json` sat in the root referenced by nothing. Its docblock
 * said it typechecked the tests for dangling imports, and it read entirely
 * plausibly — it was the approach `check-imports.js` was written to replace,
 * left behind when that decision was made. A config nobody runs is worse than
 * no config: it answers "are the tests typechecked?" with yes.
 *
 * Re-measured before deleting, in case it had become viable: 524 errors,
 * worse than the 253 that got it rejected.
 *
 * `tsconfig.json` and `vite.config.ts` are exempt because the tools pick them
 * up by name — `tsc --noEmit` and a bare `vite build` take no argument. Every
 * other one has to be named by a script.
 *
 * Only these two families. A rule over every dotfile would fire on `.gitignore`
 * and everything else a tool finds implicitly, and a rule that cries wolf is
 * one someone switches off. */
{
  const IMPLICIT = new Set(['tsconfig.json', 'vite.config.ts']);
  const scripts = JSON.stringify(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {});
  for (const file of readdirSync(root)) {
    if (!/^tsconfig.*\.json$|^vite\..*\.ts$/.test(file)) continue;
    if (IMPLICIT.has(file)) continue;
    if (scripts.includes(file)) continue;
    report('unused-config', file, 'no npm script runs it — either wire it up or delete it');
  }
}

/* ── 26 ─ Every mangled name still names something ──────────────────────────
 * `INTERNAL_PROPS` in rollup.config.js is a hand-maintained list of property
 * names the production build renames. It drifts in silence in both
 * directions, and only one of them is mechanically checkable: an entry whose
 * identifier no longer exists in `src` is a leftover from a refactor, and a
 * leftover teaches the next reader that the list tolerates junk — which is
 * how the *other* direction (an internal that should be on the list and is
 * not, shipping verbatim) eventually happens. The behavioural side is held by
 * `test/dist-parity.test.js`, which runs the same scenario through src and
 * the min bundles and compares answers; this rule holds the list itself.
 *
 * Word-boundary match over comment-stripped source, so a name surviving only
 * inside a docblock reads as gone — prose is not a property. */
{
  const config = readFileSync(resolve(root, 'rollup.config.js'), 'utf8');
  const match = /INTERNAL_PROPS\s*=\s*\n?\s*\/\^\(([^)]+)\)\$\//.exec(config);
  if (!match) {
    report('mangle-list', 'rollup.config.js', 'INTERNAL_PROPS not found where this rule expects it');
  } else {
    const sources = SRC.map((file) => withoutComments(readFileSync(file, 'utf8'))).join('\n');
    for (const name of match[1].split('|')) {
      if (!new RegExp(`\\b${name}\\b`).test(sources)) {
        report('mangle-list', 'rollup.config.js',
          `"${name}" is on INTERNAL_PROPS but names nothing in src — a refactor left it behind`);
      }
    }
  }
}

/* ── 27 ─ The exports map resolves, in publishing order ─────────────────────
 * Every `exports` condition must point at a file the build writes, `types`
 * must lead each block (TypeScript reads conditions in order and a `types`
 * behind `default` is invisible to node16 resolution), and `development`
 * must precede `default` for the same reason. The repo rule is "exports must
 * resolve to files the build actually writes"; this is that rule as a gate,
 * plus the ordering half that only bites a consumer.
 *
 * Skips visibly when dist has not been built (a clean clone), like
 * `dist-surface.test.js` — a missing build is not a broken map. */
{
  if (!existsSync(resolve(root, 'dist'))) {
    console.log('  (rule 27 skipped: dist/ not built — run npm run build for the exports check)');
  } else {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    for (const [subpath, block] of Object.entries(pkg.exports ?? {})) {
      const keys = Object.keys(block);
      if (keys[0] !== 'types') {
        report('exports-map', 'package.json', `${subpath} leads with "${keys[0]}" — types must come first or node16 consumers lose the declarations`);
      }
      if (keys.includes('development') && keys.indexOf('development') > keys.indexOf('default')) {
        report('exports-map', 'package.json', `${subpath} puts default before development — the dev condition can never match`);
      }
      for (const [condition, target] of Object.entries(block)) {
        if (!existsSync(resolve(root, target))) {
          report('exports-map', 'package.json', `${subpath} ${condition} -> ${target}: the build writes no such file`);
        }
      }
    }
    for (const field of ['main', 'module', 'types']) {
      if (pkg[field] && !existsSync(resolve(root, pkg[field]))) {
        report('exports-map', 'package.json', `top-level ${field} -> ${pkg[field]}: no such file`);
      }
    }
  }
}

/* ── 28 ─ Nothing here may make a page bfcache-ineligible ───────────────────
 * A single `unload` or `beforeunload` listener disqualifies the whole
 * document from the back/forward cache in Chromium and WebKit — so a library
 * that registers one turns every back-navigation on every consuming page from
 * an instant restore into a full reload. It is the largest performance
 * penalty this package could impose, it is invisible in every profile and
 * every test, and it is imposed on the *page*, not on the animation.
 *
 * The library is clean today and this is the rule that keeps it so: teardown
 * has `destroy()`, geometry has `resize`, and neither needs the one event
 * pair that costs a page its restore. `pagehide`/`pageshow` are the
 * bfcache-safe spellings if a lifecycle hook is ever genuinely needed, which
 * is why they are not on this list. */
{
  for (const file of SRC) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    const found = /addEventListener\(\s*['"`](before)?unload['"`]/.exec(source);
    if (found) {
      report('bfcache', file.slice(root.length + 1),
        `registers "${found[1] ? 'beforeunload' : 'unload'}" — that alone makes every consuming page ` +
        'ineligible for the back/forward cache; use pagehide/pageshow');
    }
  }
}

/* ── 29 ─ A module's attributes name the module ──────────────────────────────
 * `PropertyDef.from` / `SettingDef.from` is the import specifier a GUI panel
 * tells an author to add when an attribute's module is not wired — and it is
 * *absent* for core's own definitions, which is what makes forgetting it
 * invisible: a module attribute with no `from` silently reads as core's, in a
 * panel and in the generated reference alike.
 *
 * Core's table lives in `schema.ts` and is exempt by that. Every definition in
 * any other source file is a module's, and must say so. The check is textual
 * rather than by import, because a definition is a literal: any file
 * containing `attribute: '…'` outside schema.ts owes each one a `from`. */
{
  for (const file of SRC) {
    if (/modules\/schema\.ts$/.test(file)) continue;
    const source = withoutComments(readFileSync(file, 'utf8'));
    /** Each definition literal, from its `attribute:` to the next one or the end. */
    const marks = [...source.matchAll(/attribute:\s*'([^']+)'/g)];
    marks.forEach((mark, i) => {
      const body = source.slice(mark.index, marks[i + 1]?.index ?? source.length);
      if (!/\bfrom:\s*\w/.test(body)) {
        report('module-attribution', `${file.slice(root.length + 1)}`,
          `"${mark[1]}" declares no \`from\` — a GUI cannot tell an author what to import, ` +
          'and it reads as one of core\'s');
      }
    });
  }
}

/* ── 22 ─ A docblock left at the end of a schema table ──────────────────────
 * `schema.ts` is a pair of array literals whose entries carry docblocks, and
 * features have been leaving those arrays for the modules since decision 28.
 * Six docblocks were left behind by that on 2026-08-31: `frame`'s sat just
 * above the closing bracket of `PROPERTIES`, and `split`'s, `frame-url`'s,
 * `frame-count`'s, `frame-pad`'s and `frame-ext`'s were stranded in
 * `SETTINGS`, where the first of them read — to anyone scrolling past — as the
 * documentation for `will-change`. Two of the six still described the *chunk*
 * model decision 28 replaced.
 *
 * **This catches one of those six shapes, and only one.** A docblock sitting
 * directly above an entry that is not its own is byte-for-byte what a correct
 * docblock looks like, and a stack of consecutive blocks is a deliberate style
 * here — `when` carries two, one about the setting and one about its parser —
 * so neither can be told apart mechanically. What *is* unambiguous is a
 * docblock with nothing after it but the array's closing bracket: there is no
 * entry left for it to be about. Nobody should read this rule as a net for the
 * whole class.
 */
{
  const source = readFileSync(resolve(root, 'src/modules/schema.ts'), 'utf8').split('\n');
  let open = null;
  source.forEach((line, i) => {
    if (/^export const (PROPERTIES|SETTINGS) = \[/.test(line)) {
      open = /PROPERTIES/.test(line) ? 'PROPERTIES' : 'SETTINGS';
      return;
    }
    if (!open || !/^\] as const/.test(line)) return;
    const before = source[i - 1] ?? '';
    if (/^\s*\*\/\s*$/.test(before) || /^\s*\/\*\*.*\*\/\s*$/.test(before)) {
      report(
        'orphan-doc',
        `src/modules/schema.ts:${i}`,
        `a docblock closes ${open} — the entry it described has moved`
      );
    }
    open = null;
  });
}

/* ── 25 ─ `KNOWN_OPTIONS` is exactly the options interface ──────────────────
 * `createMotion` reports an option name it does not have — a typo'd
 * `intertia` used to run on the default in silence, which is the asymmetry this
 * library refuses one level down, where an unregistered attribute is reported
 * on the element by name.
 *
 * That check reads a set: `Object.keys(DEFAULTS)` plus the two options that
 * cannot have a default. Two of the three parts are derived and the third is
 * two string literals, and a hand-written copy of an interface's members is the
 * drift this repository keeps finding. Here it would
 * fail *closed*: an option added to `MotionOptions` and to nothing else would
 * be reported to the page as not existing, which is worse than silence.
 *
 * So: every member of the options interface is a key of `DEFAULTS` or one of
 * the literals, and nothing is a literal the interface does not have. Both
 * entry points, because one GUI generates the objects for both and a check on
 * one of them is the asymmetry the other half of this was written to remove.
 */
for (const [file, iface, factory] of [
  ['src/modules/createMotion.ts', 'MotionOptions', 'createMotion'],
  ['src/modules/createScrollTo.ts', 'ScrollToOptions', 'createScrollTo'],
]) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const body = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  const defaults = /^const DEFAULTS = \{([\s\S]*?)\n\} as const;/m.exec(source)?.[1];
  const extras = /const KNOWN_OPTIONS = new Set\(\[\.\.\.Object\.keys\(DEFAULTS\)([^\]]*)\]\)/
    .exec(source)?.[1];

  if (!body || !defaults || extras === undefined) {
    report('option-set-drift', file,
      `${iface}, DEFAULTS or KNOWN_OPTIONS is not shaped the way rule 25 reads it`);
    continue;
  }
  const declared = [...body.matchAll(/^ {2}(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)].map((m) => m[1]);
  const defaulted = [...defaults.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
  const named = [...extras.matchAll(/'([a-zA-Z][a-zA-Z0-9]*)'/g)].map((m) => m[1]);
  const known = new Set([...defaulted, ...named]);
  for (const option of declared) {
    if (!known.has(option)) {
      report('option-set-drift', file,
        `${iface}.${option} is in neither DEFAULTS nor KNOWN_OPTIONS, so ${factory} would report ` +
        'it as not existing');
    }
  }
  for (const option of named) {
    if (!declared.includes(option)) {
      report('option-set-drift', file, `KNOWN_OPTIONS names "${option}", which ${iface} does not have`);
    }
  }
}

/* ── 23 ─ Every public member is in the README's API table ──────────────────
 * The two API tables in `README.md` are the reference a consumer reads, and
 * they are hand-maintained against interfaces that are not. `MotionInstance`
 * gained `rejected` and the animation table never did — the one member the rest
 * of that file tells you eight times to look at when something will not
 * animate, absent from the table of what the instance offers, while
 * `scroll-to`'s table two hundred lines below had its own row for it.
 *
 * `check:types` makes the same argument about the built declarations: a
 * hand-held list beside a generated one drifts, and the fix is to read the
 * generated one — the recurring hand-held-list drift. The interface is the source here.
 * Presence only — what the row *says* is prose, and prose is rule 6's problem.
 */
{
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  /**
   * Split at the heading that starts the scroll-to section, because the two
   * interfaces share nine member names — `init`, `destroy`, `refresh`,
   * `collect`, `enable`, `disable`, `setEnabled`, `enabled`, `rejected`. Read
   * as one document, a scroll-to row documents the animation member of the
   * same name and the rule passes on nine of fourteen members it is not
   * actually checking. Verified by deleting the `refresh()` row: caught only
   * once the tables were told apart.
   */
  const boundary = readme.indexOf('### `createScrollTo(');
  const tableRows = (text) => text.split('\n').filter((line) => line.startsWith('|'));
  const rowsFor = {
    MotionInstance: tableRows(boundary < 0 ? readme : readme.slice(0, boundary)),
    ScrollToInstance: tableRows(boundary < 0 ? readme : readme.slice(boundary)),
  };
  const source = readFileSync(resolve(root, 'src/modules/createMotion.ts'), 'utf8');
  const scrollTo = readFileSync(resolve(root, 'src/modules/createScrollTo.ts'), 'utf8');

  const membersOf = (text, name) => {
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1];
    if (!body) return null;
    return [...body.matchAll(/^ {2}(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)[?]?[:(]/gm)].map((m) => m[1]);
  };

  for (const [file, text, name] of [
    ['src/modules/createMotion.ts', source, 'MotionInstance'],
    ['src/modules/createScrollTo.ts', scrollTo, 'ScrollToInstance'],
  ]) {
    const members = membersOf(text, name);
    if (!members) {
      report('undocumented-api', file, `${name} is not shaped the way rule 23 reads it`);
      continue;
    }
    for (const member of members) {
      /**
       * Anywhere in a table row, not at the head of a cell: two members can
       * share one — `refresh()` / `update()` is a row, and reading only the
       * first name in a cell reported the second as undocumented.
       */
      const rows = rowsFor[name];
      if (rows.some((row) => row.includes(`\`${member}\``) || row.includes(`\`${member}(`))) continue;
      report('undocumented-api', 'README.md', `${name}.${member} has no row in the API table`);
    }
  }
}

if (findings.length) {
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const [rule, items] of byRule) {
    console.error(`\n${rule} (${items.length})`);
    for (const item of items) {
      console.error(`  ${item.where.replace(`${root}/`, '')}  ${item.detail}`);
    }
  }
  console.error(`\naudit: ${findings.length} finding(s).`);
  process.exit(1);
}
console.log(`audit: ${SRC.length} source files, ${RULE_COUNT} rules, clean.`);
