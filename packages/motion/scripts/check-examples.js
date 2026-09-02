/**
 * Every `data-vm` example in the docs must parse cleanly.
 *
 * The README and the reference are full of markup an author or an agent will
 * copy verbatim. Nothing checked that any of it was valid — a typo in a
 * documented example teaches the typo, and `instance.rejected` only helps
 * someone who already suspects a problem.
 *
 * Runs the real parser over every HTML block in the docs and fails on any
 * attribute the schema refuses.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { parseElement } from '../src/modules/parse.ts';
import { ATTRIBUTE_PREFIX, SUB_PREFIX } from '../src/modules/namespace.ts';
import { wireMotion, properties, settings } from '../src/modules/schema.ts';
import { paint } from '../src/paint.ts';
import { path } from '../src/path.ts';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';
import { easings } from '../src/easings.ts';
/** Demo-owned, not a library entry — wired because the demo page wires it. */
import { gradient } from '../src/demo-gradient.ts';
import { classes } from '../src/demo-classes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const window = new Window({ url: 'https://example.test/' });
globalThis.window = window;
globalThis.document = window.document;

/**
 * Every markdown file under `docs/`, at any depth.
 *
 * This read `docs/` one level deep, which was right when `docs/` was flat. The
 * per-module docs live in `docs/modules/`, and they are the files densest in
 * module attributes — exactly the examples most likely to be wrong and the
 * ones a shallow read would never have parsed.
 */
const markdownUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? markdownUnder(full) : entry.name.endsWith('.md') ? [full] : [];
});

const files = [
  join(root, 'README.md'),
  ...markdownUnder(join(root, 'docs')),
  /** The demo's own `<pre>` samples are markup people copy, same as the docs'. */
  join(root, 'index.html'),
  join(root, 'lab.html'),
];

/**
 * A band suffix is only valid if the instance registered that name, and the
 * docs register their own — `breakpoints: { phone: [0, 500] }` in a js block
 * above the markup that uses `-phone`. Reading those out of the same file is
 * the difference between checking the examples and flagging correct ones: the
 * first version of this script reported the README's own breakpoint example as
 * broken.
 */
const breakpointsIn = (source) => {
  const names = new Map([
    ['mobile', { min: 0, max: 640 }],
    ['tablet', { min: 641, max: 1024 }],
  ]);
  for (const [, body] of source.matchAll(/breakpoints:\s*\{([^}]*)\}/g)) {
    for (const [, name] of body.matchAll(/([A-Za-z][\w-]*)\s*:\s*\[/g)) {
      names.set(name, { min: 0, max: Infinity });
    }
  }
  return names;
};

/**
 * `dropped` matters here. An element whose only attribute is a typo produces
 * no animation, so `parseElement` returns null and takes the reasons with it —
 * the first version of this script read those as "nothing to report" and
 * cheerfully passed a planted misspelling. Same hole the library had, in the
 * tool checking the library.
 */
const context = {
  origin: 'https://example.test',
  allowedOrigins: [],
  breakpoints: new Map(),
  dropped: [],
};

/**
 * Every module, because the docs document them. `split` and `frame` are module
 * attributes now, and a checker that does not know them would report the
 * library's own documented examples as unknown attributes.
 */
/**
 * Wired one at a time, and what each one adds to the live registry is recorded
 * as it appears — the same derive-by-observation `generate-reference.js` uses,
 * so no list here names an attribute. Ends with all five library modules wired
 * — plus the demo's own `gradient`, which the demo page wires — which is what
 * the parsing above needs.
 */
const owner = new Map();
for (const [name, wirable] of [['paint', paint], ['path', path], ['split', split], ['sequence', sequence], ['easings', easings], ['gradient', gradient], ['classes', classes]]) {
  const before = new Set([...properties(), ...settings()].map((entry) => entry.attribute));
  wireMotion(wirable);
  for (const entry of [...properties(), ...settings()]) {
    if (!before.has(entry.attribute)) owner.set(entry.attribute, name);
  }
}

let blocks = 0;
let elements = 0;
const bad = [];

const skipped = [];
let fixtureElements = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');

  /**
   * A design note documents a proposal, including attributes that were
   * considered and not built — `docs/VIDEO-SCRUBBING.md` spells out the
   * `data-vm-video` that was deliberately not shipped. Checking those
   * against the schema would be checking the wrong thing.
   *
   * Reported rather than silently dropped: a check that quietly excludes files
   * reads as covering more than it does.
   */
  if (/design notes|rather than a feature/i.test(source.slice(0, 400))) {
    skipped.push(file.replace(`${root}/`, ''));
    continue;
  }

  context.breakpoints = breakpointsIn(source);
  /**
   * Markdown carries examples in fenced blocks; the demo carries them inside
   * `<pre>`, as escaped text. Both are markup a reader copies, so both are
   * checked. The demo's *live* elements are covered by the acceptance test —
   * what was unchecked is the code it puts on screen.
   */
  const unescape = (text) => text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  const samples = file.endsWith('.html')
    ? [...source.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => ['html', unescape(m[1])])
    : [...source.matchAll(/```(\w+)?\n([\s\S]*?)```/g)].map((m) => [m[1], m[2]]);

  for (const [lang, body] of samples) {
    if (lang !== 'html') continue;
    blocks++;
    /** Comments carry prose, not markup; strip them so `<!-- ... -->` is not parsed. */
    window.document.body.innerHTML = body.replace(/<!--[\s\S]*?-->/g, '');
    for (const node of window.document.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) {
      elements++;
      context.dropped.length = 0;
      const parsed = parseElement(node, context);
      const rejected = parsed ? parsed.rejected : context.dropped.flatMap((d) => d.rejected);
      if (rejected.length) {
        bad.push(`${file.replace(`${root}/`, '')}: ${rejected.join(' | ')}`);
      }
    }
  }
}

/**
 * The spike fixtures, whose live markup is checked the same way and for a
 * sharper reason than the docs': a harness reads its subject out of its own
 * page, so an attribute the parser refuses does not fail the harness — it
 * quietly removes the thing the harness exists to measure, and the harness
 * goes on printing a table.
 *
 * `who-tweens.html` is why this runs. Its two subjects were told apart by
 * `data-vm-speed`, the name `inertia` used to have, so both fell back
 * to the default and the page that says "one has no transition at all" had
 * two elements that both did. Its own first line printed the transition string
 * of the element it called untransitioned, and the settle table below agreed
 * with the false header because 25 frames is long enough for the transition it
 * was not supposed to have to finish.
 *
 * Scripts are stripped: this checks the markup an author wrote, not what a
 * harness builds at runtime, which is the half that cannot be checked without
 * a browser.
 */
/**
 * The spike fixtures, and the two pages that ship: the demo doubles as
 * documentation, and its 22 live elements were checked nowhere. Its `<pre>`
 * samples are checked above as markup people copy; this is the markup that
 * runs.
 */
const fixtures = [
  /**
   * The spike harnesses live in the private portal (2026-09-01 migration) and reach this
   * tree through a gitignored symlink, so their fixtures are checked wherever that clone
   * exists — and visibly skipped where it does not (a public checkout, CI). The skip is
   * printed with a count: a fixture sweep that silently checks nothing looks exactly like
   * a clean one.
   */
  ...(existsSync(join(root, 'spikes'))
    ? readdirSync(join(root, 'spikes')).filter((name) => name.endsWith('.html')).sort().map((name) => `spikes/${name}`)
    : (console.log('check-examples: spikes/ not present (private portal not cloned) — spike fixtures skipped.'), [])),
  /**
   * Every page at the root, read rather than listed.
   *
   * This named `index.html` and `lab.html`, and `preview.html` — 252 lines and
   * 33 attributes, the page that announces what is new — was checked by nothing
   * but the size-claim rule. A hand-written list of the things that exist,
   * inside a check whose whole subject is hand-written lists going stale
   * (hand-held copies of live tables drift).
   */
  ...readdirSync(root).filter((name) => name.endsWith('.html')).sort(),
];

/**
 * A page's wiring is wherever its script is. The demo's lives in
 * `src/index.ts` behind `<script type="module" src>` — which is exactly where
 * the module refactor left `sequence` unwired and the demo's image sequence
 * dead — so the source read for wiring is the page plus the modules it loads,
 * one level. A probe that read only the HTML reported the demo as unwired, and
 * was wrong.
 */
const withScripts = (name, source) => {
  const parts = [source];
  for (const [, src] of source.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) {
    if (/^https?:/.test(src)) continue;
    const file = join(root, dirname(name), src.replace(/^\//, ''));
    if (existsSync(file)) parts.push(readFileSync(file, 'utf8'));
  }
  return parts.join('\n');
};

for (const name of fixtures) {
  const file = join(root, name);
  const source = readFileSync(file, 'utf8');

  /**
   * A fixture whose rejections are the measurement says so. Reported, not
   * silent — an exclusion nobody can see reads as coverage.
   */
  if (source.includes('check-examples: expect-rejected')) {
    skipped.push(`${name} (expects rejections)`);
    continue;
  }

  context.breakpoints = breakpointsIn(source);
  window.document.body.innerHTML = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  for (const node of window.document.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) {
    fixtureElements++;
    context.dropped.length = 0;
    const parsed = parseElement(node, context);
    const rejected = parsed ? parsed.rejected : context.dropped.flatMap((d) => d.rejected);
    if (rejected.length) bad.push(`${name}: ${rejected.join(' | ')}`);
  }
}

/**
 * And whether a fixture that uses a module's attributes actually wires that
 * module. This is the failure the parse check structurally cannot see, because
 * the parse check wires all four itself: the page compiles, the library loads,
 * the harness runs and prints — measuring a library without the feature it was
 * written to measure. Eight harnesses did exactly that for the whole module
 * refactor, silently, because a harness takes its wiring from its own page.
 *
 * Both halves are required — imported from its own entry, and passed to
 * `wireMotion`. Dropping either one alone reproduces the failure.
 *
 * Only static markup, so a fixture that builds its subjects in script is not
 * covered here; the count below is printed for that reason, so how thin this
 * is stays visible rather than reading as "every fixture, checked".
 */
let declaring = 0;
for (const name of fixtures) {
  const source = withScripts(name, readFileSync(join(root, name), 'utf8'));
  window.document.body.innerHTML = source.replace(/<!--[\s\S]*?-->/g, '');

  const needed = new Set();
  for (const node of window.document.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) {
    for (const attr of node.getAttributeNames()) {
      if (!attr.startsWith(`${ATTRIBUTE_PREFIX}-`)) continue;
      const own = owner.get(attr.slice(ATTRIBUTE_PREFIX.length + 1).replace(/-\[.*\]$/, ''));
      if (own) needed.add(own);
    }
  }
  if (!needed.size) continue;
  declaring++;

  for (const module of needed) {
    const imported = new RegExp(
      `import\\s*\\{[^}]*\\b${module}\\b[^}]*\\}\\s*from\\s*['"][^'"]*${module}\\.[tj]s`
    ).test(source);
    const passed = new RegExp(`wireMotion\\([^)]*\\b${module}\\b`).test(source);
    if (imported && passed) continue;
    bad.push(
      `${name}: uses ${module} attributes but does not ` +
      `${imported ? `pass ${module} to wireMotion` : `import ${module}`}`
    );
  }
}

/**
 * Every attribute *name* in those pages, as text — including the ones a script
 * builds into a template string, which the two passes above cannot see because
 * they read a parsed DOM with the scripts stripped.
 *
 * That blind spot was not theoretical. `spikes/ease.html` writes its eight
 * subjects from an array, and the third column of that array was still called
 * `speed` — the name `inertia` had before the vocabulary was settled. Its
 * reference row exists to carry no transition at all, so the raw curve can be
 * compared against something; unrecognised, it took the default inertia like
 * every other row, and the harness printed eight rows of

     reference   8.2px   33ms   50ms   49%
     linear      8.2px   33ms   50ms   49%
     ...

 * identical to the last digit, as a table comparing timing functions. The
 * reference now reads 0.0px / 0ms / n/a and the rest still match each other,
 * which is the harness's actual finding: `ease` shapes the curve, not the
 * catch-up.
 *
 * A name is allowed if the registry has it, if it is a registered band suffix
 * on a name the registry has, or if it is the marker `scroll-to` injects —
 * that one is written by the library and read by nobody, so it is deliberately
 * not in the registry.
 */
const injected = [`${SUB_PREFIX}scroll-target`];
const vocabulary = new Set([...properties(), ...settings()].map((entry) => entry.attribute));

for (const name of fixtures) {
  const text = readFileSync(join(root, name), 'utf8');
  /** A page whose refusals are the demonstration opts out of this too, not only of parsing. */
  if (text.includes('check-examples: expect-rejected')) continue;
  text.split('\n').forEach((line, i) => {
    for (const [, attribute] of line.matchAll(new RegExp(`${SUB_PREFIX}([a-z][a-z0-9-]*)`, 'g'))) {
      if (vocabulary.has(attribute)) continue;
      if (injected.includes(`${SUB_PREFIX}${attribute}`)) continue;
      if ([...vocabulary].some((known) => attribute.startsWith(`${known}-`))) continue;
      bad.push(`${name}:${i + 1}: ${SUB_PREFIX}${attribute} is not an attribute`);
    }
  });
}

/**
 * And the migration tool's output, run for real and parsed.
 *
 * `migrate-attributes.mjs` converts a page from the original plugin's
 * `data-oxyani-*` attributes, and the docs tell people to run it. It had gone a
 * whole grammar out of date: it emitted `-from`, `-at-n50` and a bare name for
 * the end — the shape keyframe positions left in `4db01be` — so its own output
 * was refused by the parser it migrates *to*. `translate-y-from` is an unknown
 * attribute, and what survived was a one-keyframe animation going *to* a value
 * instead of between two. Markup that looks migrated and animates wrong.
 *
 * Its maps had rotted too: `transform-speed`/`filter-speed` on both sides long
 * after `speed` became `inertia`, and a `position` property that does not
 * exist.
 *
 * Running the tool rather than reading it, because reading it is what missed
 * this: every map entry can be a real attribute while the emitter still writes
 * the wrong grammar around them.
 */
{
  const fixture = join(root, 'scripts', 'migrate-fixture.html');
  const output = execFileSync(process.execPath, [join(root, 'scripts', 'migrate-attributes.mjs'), fixture], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /** The tool prints a report; the markup it would write is what is checked. */
  const migrated = execFileSync(process.execPath, ['-e', `
    const { readFileSync, writeFileSync, copyFileSync } = require('node:fs');
    const tmp = process.argv[1] + '.check';
    copyFileSync(process.argv[1], tmp);
    require('node:child_process').execFileSync(process.execPath, [process.argv[2], tmp, '--write'], { stdio: 'ignore' });
    process.stdout.write(readFileSync(tmp, 'utf8'));
    require('node:fs').unlinkSync(tmp);
  `, fixture, join(root, 'scripts', 'migrate-attributes.mjs')], { encoding: 'utf8' });

  context.breakpoints = breakpointsIn(migrated);
  window.document.body.innerHTML = migrated.replace(/<!--[\s\S]*?-->/g, '');

  let migratedElements = 0;
  for (const node of window.document.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) {
    migratedElements++;
    context.dropped.length = 0;
    const parsed = parseElement(node, context);
    const rejected = parsed ? parsed.rejected : context.dropped.flatMap((entry) => entry.rejected);
    if (rejected.length) bad.push(`migrate-attributes.mjs output: ${rejected.join(' | ')}`);
  }
  if (!migratedElements) {
    bad.push('migrate-attributes.mjs produced no animated element from its fixture');
  }
  /** Anything it could not map is reported by the tool; an empty fixture would pass silently. */
  if (!/NOT MIGRATED|before/.test(output)) {
    bad.push('migrate-attributes.mjs printed no report — the check may not be running it');
  }
}

if (bad.length) {
  for (const line of bad) console.error(`  ${line}`);
  console.error(`\ncheck-examples: ${bad.length} finding(s) — markup the parser refuses, an attribute name that is not one, or a fixture measuring a module it never wired.`);
  process.exit(1);
}
console.log(
  `check-examples: ${elements} elements across ${blocks} html blocks, ` +
  `${fixtureElements} live elements across ${fixtures.length} fixtures, the demo and the lab, all accepted; ` +
  `${declaring} of those declare module attributes in markup and wire the module.` +
  (skipped.length ? ` Skipped ${skipped.length}: ${skipped.join(', ')}.` : '')
);
