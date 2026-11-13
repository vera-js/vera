/**
 * Every diagnostic the framework prints is findable.
 *
 * A user filtering their console needs one string that finds all of them, and the framework had
 * four conventions: `[vera]`, `[vera-jsx]`, `autoloader:`, `@verajs/renderer/spread:` — and one
 * message, the autoloader's load failure, with **no prefix at all**. "Failed to load custom element
 * x-widget from …" gives no indication which library said it.
 *
 * The rule, asserted here rather than remembered:
 *
 * - anything reaching `console.warn` or `console.error` starts `[vera]`
 * - a thrown `Error` may name its function instead, because a stack already names the source — but
 *   if the message is *also* printed to the console by the framework, it carries the prefix too
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { walkFiles, readIfPresent as readRaw } from './walk.mjs';

/**
 * A `'%s'` first argument only stops the console from reading the message as a format string (a subject with `%c3` in
 * it garbled the line and swallowed the forwarded error — 2026-10-09). The message is the NEXT argument, so
 * the checks below read through it.
 */
const readIfPresent = (file) => readRaw(file)?.replace(/console\.(warn|error)\(\s*'%s',\s*/g, 'console.$1(');

const root = new URL('../packages', import.meta.url).pathname;

const sources = [];
sources.push(
  ...walkFiles(root, /\.(ts|js)$/, { ignore: ['node_modules', 'dist'] })
    .filter((file) => !file.endsWith('.d.ts'))
);

/**
 * The prefix a file's diagnostics must carry: `[vera]`, everywhere. (Retired `@verajs/motion`
 * carried its own `@verajs/motion:` prefix until the phase-4 fold-in; the ported motion pack in
 * `@verajs/directives` speaks `[vera]` like everything else, which closed that carve-out.)
 */
const PREFIX_OF = () => '[vera]';

/**
 * The call and its first template literal, which is where a prefix would be. Multi-line calls are
 * the norm here, so this reads forward to the first backtick or quote rather than one line.
 */
const CONSOLE_CALL = /console\.(warn|error)\(\s*(?:`([^`]*)|'([^']*)|"([^"]*))/g;

/** Every call, whether or not the pattern above can read its first argument: a dynamic `console[level](` too (D29). */
const ANY_CONSOLE_CALL = /console(?:\.(?:warn|error)|\[[^\]]+\])\(/g;

/**
 * **A call printing what the shared formatter built is prefixed by construction** — `diagnostic` (shared-utils) writes
 * `[vera]` itself, which the test below the next one reads from its source, so such a call is read here rather than
 * excused.
 */
/** ssr's `ssrWarning` is that formatter's twin (ssr cannot import shared-utils) — prefixed the same way, asserted below. */
const DIAGNOSTIC_CALL = /console\.(warn|error)\(\s*(?:diagnostic|ssrWarning)\(/g;

/**
 * **Calls whose first argument is not a literal, so `CONSOLE_CALL` cannot read them.**
 *
 * The header above claims *anything* reaching `console.warn` or `console.error` starts `[vera]`, and
 * the pattern only ever verified the calls it could parse. Four could not be, and a fifth added
 * tomorrow would have been unverified in silence — a guard that is complete about what it can see and
 * says nothing about the rest.
 *
 * So the set is now closed: every call is either parsed, or listed here with the reason, or fails.
 * Two of these forward **someone else's error object**, where a prefix would misattribute it. (The router's ternary
 * between two messages left with the code-system migration, 2026-10-09: its two variants are one code now.) The
 * ternary branch check below stays, for the next one.
 */
const NOT_A_LITERAL = new Map([
  ['autoloader/src/autoloader.ts', [1, 'forwards a refusal of its own, already coded (loader-url-refused) — routing']],
  ['autoloader/src/loader.ts', [1, 'forwards a refusal of its own, already coded (directive-loader-name, loader-url-refused) — routing']],
  ['ssr/src/vera/shim.ts', [1, 'forwards a caught error object']],
  /** reportUncaught prints the line its caller built: `'[vera] <code>'` or a diagnostic() line, literal at every call site. */
  ['shared-utils/src/utils.ts', [2, "prints a coded line its caller built — '[vera] <code>' or diagnostic()'s"]],
  /** Hydration's once-per-kind helper: every caller hands it a `diagnostic(…)` line — asserted below. */
  ['renderer/src/hydration.ts', [2, 'prints a line diagnostic() built — every caller passes one']],
  /** Motion's one formatter, problemLine(): the fallback reporter prints it, and the server-written script prints
   *  the lines it built — every line starts `[vera]`, asserted below in both builds. */
  ['motion/src/schema.ts', [1, 'prints a line problemLine() built']],
  ['motion/src/ssr.ts', [1, "the server-written script prints problemLine()'s lines"]],
  /** One renderer wired into two cores: diagnostic()'s line in development, the bare code in production (28 B, 2026-10-22). */
  ['renderer/src/renderer.ts', [1, "renderer-two-cores: diagnostic()'s line or '[vera] renderer-two-cores' — both branches prefixed"]],
  ['renderer/src/portal.ts', [1, "portal-no-renderer: diagnostic()'s line or '[vera] portal-no-renderer' — both branches prefixed"]],
  /** D29's once-printer: `console[level]` prints the line `diagnostic()` built, with or without what rides beside it. */
  ['shared-utils/src/diagnostic.ts', [2, "warnOnce/errorOnce print diagnostic()'s line through console[level]"]],
]);

/**
 * The balanced argument text of a call, so a ternary's branches can be read. Counts parentheses
 * rather than matching to the first `)`, since every message here contains them.
 */
const argumentsOf = (text, start) => {
  let depth = 0;
  for (let index = text.indexOf('(', start); index < text.length; index++) {
    if (text[index] === '(') depth++;
    else if (text[index] === ')' && --depth === 0) return text.slice(text.indexOf('(', start) + 1, index);
  }
  return '';
};

test('every console.warn and console.error is prefixed [vera]', () => {
  assert.ok(sources.length > 15, `expected to find the sources, found ${sources.length}`);
  const problems = [];
  for (const file of sources) {
    const text = readIfPresent(file);
    /** Gone between the walk and the read. */
    if (text === null) continue;
    for (const match of text.matchAll(CONSOLE_CALL)) {
      const message = match[2] ?? match[3] ?? match[4] ?? '';
      if (!message.startsWith(PREFIX_OF(file)))
        problems.push(`${relative(root, file)}: ${JSON.stringify(message.slice(0, 60))}`);
    }
  }
  assert.deepEqual(problems, [], `diagnostics a user cannot filter for:\n  ${problems.join('\n  ')}`);
});

/**
 * **And every call the pattern above could not read is accounted for.**
 *
 * Without this the guard verifies what it happens to parse and is silent about the rest, which is how
 * a ternary between two messages sat unchecked: `CONSOLE_CALL` needs a literal immediately after the
 * `(`, and an expression there makes the whole call invisible rather than failing.
 */
test('no console call escapes the check by not starting with a literal', () => {
  const unaccounted = [];
  const unprefixedBranches = [];
  /**
   * **The allowance is keyed by FILE, so it has to be counted.** An entry excuses every unreadable
   * call the file ever grows, not the one it was written for — and `router/src/services.ts` already
   * holds ten console calls, so an eleventh with a variable first argument would have slid through
   * unreviewed. Measured 2026-09-12: each listed file has exactly one, which is the only reason
   * this is a pin rather than a defect. Counting turns a second one into a deliberate edit.
   */
  const excused = new Map();

  for (const file of sources) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const parsed = new Set([...text.matchAll(CONSOLE_CALL), ...text.matchAll(DIAGNOSTIC_CALL)].map((match) => match.index));
    const where = relative(root, file);

    for (const match of text.matchAll(ANY_CONSOLE_CALL)) {
      if (parsed.has(match.index)) continue;
      const entry = NOT_A_LITERAL.get(where);
      if (entry === undefined) {
        unaccounted.push(`${where}: ${text.slice(match.index, match.index + 60).split('\n')[0]}`);
        continue;
      }
      const [, reason] = entry;
      excused.set(where, (excused.get(where) ?? 0) + 1);
      /**
       * A call that forwards an error carries no message of ours. One that holds messages must have
       * each **branch** prefixed — the half a ternary was getting for free.
       *
       * The template that *begins* a branch, not every template in the call: a long message is built
       * by concatenating fragments and only the first carries the prefix. Checking all of them
       * reported six continuations of one correct message as six failures.
       */
      if (!reason.includes('ternary')) continue;
      const args = argumentsOf(text, match.index);
      for (const [, message] of args.matchAll(/[?:]\s*`([^`]*)/g))
        if (!message.startsWith('[vera]'))
          unprefixedBranches.push(`${where}: ${JSON.stringify(message.slice(0, 60))}`);
    }
  }

  assert.deepEqual(
    unaccounted,
    [],
    `these console calls do not begin with a literal, so the prefix check cannot read them. Add each ` +
      `to NOT_A_LITERAL with the reason, or give it a literal first argument:\n  ${unaccounted.join('\n  ')}`
  );
  assert.deepEqual(
    unprefixedBranches,
    [],
    `a branch of a multi-message call is missing the prefix:\n  ${unprefixedBranches.join('\n  ')}`
  );

  /** Both directions: an entry that excuses more than it claims, and one that excuses nothing. */
  const miscounted = [];
  for (const [where, [expected, reason]] of NOT_A_LITERAL) {
    const found = excused.get(where) ?? 0;
    if (found !== expected)
      miscounted.push(
        `${where}: allows ${expected} unreadable call(s) (${reason}) but the file has ${found}. ` +
          (found > expected
            ? 'A new one is being excused without review — check it and raise the count deliberately.'
            : 'The entry no longer has a subject; delete it rather than leave it excusing a future call.')
      );
  }
  assert.deepEqual(miscounted, [], `\n  ${miscounted.join('\n  ')}`);
});

/**
 * **The shared formatter prefixes every line it builds** — which is what lets a `console.warn(diagnostic(…))` be read
 * as prefixed above. Both of its templates (production's link line, development's sentence) must begin `[vera]`.
 */
test('the shared diagnostic formatter prefixes both of its lines', () => {
  const text = readFileSync(new URL('../packages/shared-utils/src/diagnostic.ts', import.meta.url), 'utf8');
  const start = text.indexOf('export const diagnostic');
  const body = text.slice(start, text.indexOf('\nexport ', start + 1) >>> 0 || undefined);
  const lines = [...body.matchAll(/[?:]\s*`([^`]*)/g)].map(([, line]) => line);
  assert.equal(lines.length, 2, 'CONTROL: the development and production templates were both found');
  for (const line of lines) assert.ok(line.startsWith('[vera] '), `a formatter line lacks the prefix: ${line.slice(0, 40)}`);
});

/** ssr's twin of the shared formatter prefixes its line too (tests/ssr-coded-diagnostics holds the two equal). */
test("ssr's warning formatter prefixes its line", () => {
  const text = readFileSync(new URL('../packages/ssr/src/vera/report.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export const ssrWarning'), text.indexOf('\n', text.indexOf('export const ssrWarning')));
  const lines = [...body.matchAll(/=>\s*`([^`]*)/g)].map(([, line]) => line);
  assert.equal(lines.length, 1, 'CONTROL: the template was found');
  assert.ok(lines[0].startsWith('[vera] '), `ssrWarning's line lacks the prefix: ${lines[0]}`);
});

/** Motion's problemLine() — excused above for its two printers — builds only prefixed lines: `diagnostic()` in
 *  development (checked by the test before this one), and a `[vera] <code>` template in production. */
test("motion's problemLine prefixes both of its lines", () => {
  const text = readFileSync(new URL('../packages/motion/src/schema.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export const problemLine'), text.indexOf('let report'));
  assert.match(body, /\?\s*diagnostic\('motion', /, 'CONTROL: development builds its line with diagnostic()');
  const production = [...body.matchAll(/:\s*`([^`]*)/g)].map(([, line]) => line);
  assert.equal(production.length, 1, 'CONTROL: the production template was found');
  assert.ok(production[0].startsWith('[vera] '), `the production line lacks the prefix: ${production[0]}`);
});

/** And a local helper excused above for printing `diagnostic()` lines receives nothing else. */
test("hydration's warn helper is only ever handed a diagnostic() line", () => {
  const text = readFileSync(new URL('../packages/renderer/src/hydration.ts', import.meta.url), 'utf8');
  const calls = [...text.matchAll(/(?<![.\w])warn\(/g)].filter((m) => !text.slice(m.index - 20, m.index).includes('const '));
  const coded = calls.filter((m) => /^warn\([^,]+,\s*diagnostic\(/.test(text.slice(m.index, m.index + 200)));
  assert.ok(calls.length > 0, 'CONTROL: the helper is called');
  assert.equal(coded.length, calls.length, 'a warn() call passes something other than a diagnostic() line');
});

/** And the prefix has to survive into the shipped bundles, or it only exists in source. */
test('the prefix reaches the built artifacts', () => {
  for (const bundle of [
    'packages/core/dist/development/vera.js',
    'packages/renderer/dist/development/vera-renderer-spread.js',
    'packages/autoloader/dist/development/vera-autoloader.js',
  ]) {
    const text = readFileSync(new URL(`../${bundle}`, import.meta.url).pathname, 'utf8');
    assert.match(text, /\[vera\]/, `${bundle} carries no [vera] diagnostic`);
  }
});

/**
 * **`console.warn` and `console.error`, and nothing else.**
 *
 * The rule above is about those two, and a diagnostic written with a third method escapes it twice
 * over. `console.info('[vera] …')` is not read by the prefix check, which only looks at those two
 * names — and it is not dropped by the production build, whose terser config is `drop_console:
 * ['log']` rather than `true`, deliberately, so that real failures survive minification.
 *
 * So it would ship, unchecked, and be invisible to the console filter this convention exists to give
 * a user. `console.debug` and `console.trace` are the same. `console.log` fails differently and is
 * arguably worse: it is *dropped* in production, so a diagnostic written with it works in development
 * and silently does not exist for the people who need it — the dev/prod divergence this audit already
 * has a defect for.
 *
 * The profiler's single `console.log` is the exception and is deliberate: that entry is built for
 * development only, and printing a report is what it is for.
 */
test('no diagnostic uses a console method outside warn and error', () => {
  const ALLOWED = new Set(['warn', 'error']);
  /** `[file, method]` pairs that are deliberate, each with the reason. */
  const EXCEPTIONS = new Map([['renderer/src/profiler.ts', 'log — a development-only entry printing its report']]);

  const found = [];
  for (const file of sources) {
    const text = readIfPresent(file);
    if (text === null) continue;
    const where = relative(root, file);
    for (const [, method] of text.matchAll(/console\.(\w+)\(/g)) {
      if (ALLOWED.has(method)) continue;
      if (EXCEPTIONS.get(where)?.startsWith(method)) continue;
      found.push(`${where}: console.${method}()`);
    }
  }

  assert.deepEqual(
    found,
    [],
    `a diagnostic here would be unfilterable and unchecked — the prefix rule reads only warn and ` +
      `error, and production drops only log:\n  ${found.join('\n  ')}`
  );
});

/* ── D29 (2026-11-12): no hand-written once-flags ─────────────────────────────────────────────────────────────────── */

/**
 * **What a page has already been told lives in ONE place**, shared-utils' memory behind `warnOnce` / `errorOnce` /
 * `hasWarned` (ssr's twin, `once`, in ssr's report.ts). Brian, 2026-11-12: no names. Of 42 hand-written flags in two
 * naming styles (`saidLists`, `warnedDrop`, per-element WeakSets, per-key Sets), the 37 development-only ones were
 * converted; the 5 that SHIP TO PRODUCTION keep a memory at their site, named for what it holds (`printed…`), because the
 * shared memory costs +80–145 B gz per bundle there (measured 2026-11-12). They are allow-listed below, so a sixth
 * production memory fails until it is reviewed. Read with
 * the TypeScript parser, never a regex: module level means the file's own statements, and a regex literal or a template
 * cannot make it lose its place (the trap a hand scanner fell into, 2026-11-12).
 */
import ts from 'typescript';
/** A binding that looks like a once-memory: `false`, or a new Set / WeakSet / Map / WeakMap. */
const onceShaped = (init) =>
  init !== undefined &&
  (init.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && /^(Weak)?(Set|Map)$/.test(init.expression.text)));
/** Kept on purpose, each with its reason (the site's comment says the same). */
const ONCE_ALLOWED = new Map([
  /** The 5 production once-sites (Brian's ruling, D29): a production warning keeps its memory at its site. */
  ['core/src/hooks/drawInto.ts printedNoRenderer', 'no-renderer ships to production: the shared memory costs bytes there'],
  ['renderer/src/portal.ts printedPortal', 'portal-no-renderer ships to production'],
  ['motion/src/group.ts printedModuleThrew', "motion-module-threw ships to production, through motion's reporter seam"],
  ['directives/src/engine.ts printedCodes', "directives' refusals ship to production, once per code"],
  ['jsx/src/standalone.ts printedHelpers', 'jsx-helper-missing ships to production, once per helper URL'],
  /** Behavior state, not a memory of what was said. */
  ['renderer/src/hydration.ts causesThisPass', 'once per hydration PASS: cleared at the next microtask, which warnOnce never does'],
  ['hot/src/index.ts requested', 'gates the ONE reload a page requests, not only its warning: behavior state, not a memory of what was said'],
]);
/** Every module-level once-shaped binding read in a function that prints, and every binding named said…/warned…. */
const onceFlags = (where, text) => {
  const file = ts.createSourceFile(where, text, ts.ScriptTarget.Latest, true, where.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const found = [];
  const shaped = new Set();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (/^(said|warned)([A-Z_]|$)/.test(name)) found.push(`${where} ${name}: a once-flag by its NAME`);
      else if (onceShaped(declaration.initializer)) shaped.add(name);
    }
  }
  /**
   * THE idiom, "ask, mark, then print": a once-shaped binding read in a CONDITION of a function (`if (x)`, `!x.has(k) &&`),
   * and, in one block of it, a statement that MARKS it (`x = true`, `x.add(…)`) followed by one that writes the console.
   * A cache or a table is read and filled beside a console call all the time (`.set`, `.get`); asking, marking and
   * printing in that order is what makes a once-flag.
   */
  const conditioned = new WeakMap();
  const askedIn = (fn) => {
    if (conditioned.has(fn)) return conditioned.get(fn);
    const names = new Set();
    const take = (n) => { if (ts.isIdentifier(n) && shaped.has(n.text)) names.add(n.text); ts.forEachChild(n, take); };
    const scan = (n) => {
      if (n !== fn && ts.isFunctionLike(n)) return;
      if (ts.isIfStatement(n)) take(n.expression);
      if (ts.isConditionalExpression(n)) take(n.condition);
      if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) take(n.left);
      ts.forEachChild(n, scan);
    };
    scan(fn);
    conditioned.set(fn, names);
    return names;
  };
  const marks = (statement) => {
    const marked = new Set();
    const scan = (n) => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && shaped.has(n.left.text)) marked.add(n.left.text);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) &&
        shaped.has(n.expression.expression.text) && n.expression.name.text === 'add') marked.add(n.expression.expression.text);
      ts.forEachChild(n, scan);
    };
    scan(statement);
    return marked;
  };
  const prints = (statement) => {
    let found = false;
    const scan = (n) => {
      if (found || ts.isFunctionLike(n)) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === 'console' && /^(warn|error)$/.test(n.expression.name.text)) found = true;
      /** Motion's reporter seam prints a problem too (verify and ssr replace it), so a once before it is a once. */
      else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(pageProblem|elementProblem)$/.test(n.expression.text)) found = true;
      else ts.forEachChild(n, scan);
    };
    scan(statement);
    return found;
  };
  const visit = (node, fn) => {
    const within = ts.isFunctionLike(node) ? node : fn;
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const marked = new Set();
      for (const statement of node.statements) {
        if (prints(statement)) for (const name of marked) if (within && askedIn(within).has(name)) found.push(`${where} ${name}: asked, marked, then the console written (a hand-written once)`);
        for (const name of marks(statement)) marked.add(name);
      }
    }
    ts.forEachChild(node, (child) => visit(child, within));
  };
  visit(file, undefined);
  return [...new Set(found)];
};

test('D29: no package keeps a hand-written once-flag (by name, or by shape beside a console call)', () => {
  const found = [];
  const allowed = new Set();
  for (const file of sources) {
    const text = readRaw(file);
    if (text === null) continue;
    const where = relative(root, file);
    for (const line of onceFlags(where, text)) {
      const key = line.split(':')[0];
      if (ONCE_ALLOWED.has(key)) allowed.add(key);
      else found.push(line);
    }
  }
  assert.deepEqual(found, [], `hand-written once-flags (use warnOnce / errorOnce / hasWarned from @verajs/shared-utils):\n  ${found.join('\n  ')}`);
  assert.deepEqual([...allowed].sort(), [...ONCE_ALLOWED.keys()].sort(), 'every allowed entry still has its subject (else delete it)');
});

test('D29 CONTROL: planted flags after a regex literal and after a template are found; a template\'s TEXT is not a flag', () => {
  const planted = [
    "const re = /`[^`'\"]*/g;",
    'let warnedPlantedAfterRegex = false;',
    'const t = `${"`"}${re}`;',
    'const shownOnce = new Set();',
    'export const tell = (k) => { if (shownOnce.has(k)) return; shownOnce.add(k); console.warn(`[vera] x: ${k}`); };',
    'const cache = new Map();',
    'export const read = (k) => { if (!cache.has(k)) console.warn(`[vera] y`); return cache.get(k); };',
    'const text = `let saidOnlyText = false;`;',
  ].join('\n');
  const found = onceFlags('planted.ts', planted);
  assert.ok(found.some((l) => l.includes('warnedPlantedAfterRegex') && l.includes('NAME')), `the named flag after a regex: ${found}`);
  assert.ok(found.some((l) => l.includes('shownOnce') && l.includes('asked, marked')), `the renamed flag after a template, by its shape: ${found}`);
  assert.ok(!found.some((l) => l.includes('saidOnlyText')), 'text inside a template is not a declaration');
  assert.ok(!found.some((l) => l.includes('cache')), 'a cache read beside a console call is not a once-flag');
});
