/**
 * **The diagnostics table is a MANIFEST, and this is what makes it one.**
 *
 * Prose used to live as string literals at 47 call sites, where nothing could read it: a code
 * raised with no words, a table entry nobody raises, a code spelled two ways — all invisible, all
 * things a person notices only by accident. As one table keyed by code, both directions become
 * checkable, and that is most of why the table is worth its indirection.
 *
 * It paid immediately. `every-not-object` and `swipe-not-object` were each doing two different
 * jobs — *the attribute is not an object* and *one ENTRY's value is not an object* — which no
 * reader of either call site would have questioned, and which would have made one docs page and
 * one Studio inspector row wrong for both refusals at once. Splitting them was a consequence of
 * writing this file, not of reading the code.
 *
 * **No pack is exempt.** `motion/*` was, briefly and deliberately: it arrived from the retired
 * `@verajs/motion` funnelling every refusal through one `motion-refused` code carrying a composed
 * sentence, which is why its prose shipped to production when no other pack's did and why not one
 * of its refusals could be addressed by a docs page or an inspector row. It now names 73 of its
 * own, and the test that pinned the exemption has been replaced by one asserting there is none —
 * on the instruction its own control carried, which was to delete it the day motion joined.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';


const { PROSE } = await import('../packages/directives/src/diagnostics.ts');

/** Every `.ts` under the package, so a new pack cannot quietly sit outside the check. */
const files = (dir, into = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, into);
    else if (path.endsWith('.ts')) into.push(path);
  }
  return into;
};

/**
 * Codes as RAISED. Reads the third argument of the five-argument form and the first of the
 * three-argument one — a code built at runtime (`ve.code ?? 'value-bad'`) contributes its literal
 * fallback, which is the one this table has to cover.
 */

/**
 * A BALANCED scan rather than a regex, and the difference is not pedantry: a lazy match to the
 * first comma reads `reject(el, attr, 'code', …)` as ending at `el` and finds no code at all, so
 * twelve live codes looked like orphaned prose. Arguments here routinely contain template literals
 * with commas inside them, which is exactly what a regex cannot see the end of.
 */
const closingParen = (text, from) => {
  let depth = 1;
  let quote = null;
  let i = from;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  return i - 1;
};

const topLevelArgs = (body) => {
  const out = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += body[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

/** `[callee, index of the code argument]` — the engine's own form puts it third, `Ctx`'s first. */
const FORMS = [['ctx.reject(', 0], ['context.reject(', 0], ['seams.reject(', 2], ['reject(', 2]];

const raised = new Map();
for (const path of files(new URL('../packages/directives/src', import.meta.url).pathname)) {
  const text = readFileSync(path, 'utf8');
  const rel = path.slice(path.indexOf('directives/src/') + 'directives/src/'.length);
  const seen = new Set();
  for (const [callee, index] of FORMS) {
    let at = 0;
    while ((at = text.indexOf(callee, at)) !== -1) {
      /** `ctx.reject(` also contains `reject(`; only the bare form needs the boundary check. */
      if (callee === 'reject(' && /[a-zA-Z.]/.test(text[at - 1] ?? ' ')) { at += callee.length; continue; }
      const end = closingParen(text, at + callee.length);
      const args = topLevelArgs(text.slice(at + callee.length, end));
      const key = `${at}`;
      at = end;
      if (seen.has(key)) continue;
      seen.add(key);
      /** A runtime code (`ve.code ?? 'value-bad'`) contributes its literal fallback — the one the
       *  table has to cover, since the other branch is the parser's own vocabulary. */
      const literal = (args[index] ?? '').match(/'([a-z][a-z0-9-]*)'/);
      if (!literal) continue;
      if (!raised.has(literal[1])) raised.set(literal[1], new Set());
      raised.get(literal[1]).add(rel);
    }
  }

  /**
   * Motion raises through routes of its own — `pageProblem('code')`, a `{ code }` object pushed
   * onto the refusal pipeline, a lookup in its settings-type map. Rather than teach the scanner
   * three more shapes, every `motion-*`/`split-*` literal in that directory counts as a raise:
   * those strings are only ever codes there, and the alternative is a scanner that silently misses
   * a route and reports live prose as orphaned.
   */
  if (rel.startsWith('motion/')) {
    /** A directive's own NAME looks exactly like a code — `data-vd-motion-group` declares
     *  `name: 'motion-group'` — so the names are subtracted rather than reported as codes with
     *  no prose, which is what the broad scan first did. */
    const names = new Set([...text.matchAll(/name:\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
    for (const match of text.matchAll(/'((?:motion|split)-[a-z0-9-]+)'/g)) {
      if (names.has(match[1])) continue;
      if (!raised.has(match[1])) raised.set(match[1], new Set());
      raised.get(match[1]).add(rel);
    }
  }

  /**
   * The parser reaches the registry by a SECOND route, and missing it made twelve live codes look
   * like orphaned prose. `parse.ts` throws a `ValueError` carrying its own code, and the engine
   * rejects under that code rather than a literal of its own — so `fail('object-missing-colon', …)`
   * is a raise, even though no `reject(` call names it anywhere.
   */
  /** A THIRD route: a refusal that travels as a throw names its code at the throw site, not in a
   *  `reject(` call — `refusal('payload-not-walkable', …)` and `error.code = '…'` both count. */
  for (const match of text.matchAll(/(?:refusal\(|\.code = )'([a-z][a-z0-9-]*)'/g)) {
    if (!raised.has(match[1])) raised.set(match[1], new Set());
    raised.get(match[1]).add(rel);
  }

  for (const match of text.matchAll(/\bfail\('([a-z][a-z0-9-]*)'/g)) {
    if (!raised.has(match[1])) raised.set(match[1], new Set());
    raised.get(match[1]).add(rel);
  }
}

test('every code raised has an entry — no refusal without words', () => {
  const missing = [...raised.keys()]
    .filter((code) => !(code in PROSE))
    .map((code) => `${code} (raised in ${[...raised.get(code)].join(', ')})`);
  assert.deepEqual(missing, [],
    'a code with no table entry records a refusal that cannot explain itself, in dev or in the docs');
});

test('every entry is actually raised — no orphan prose', () => {
  const orphans = Object.keys(PROSE).filter((code) => !raised.has(code));
  assert.deepEqual(orphans, [],
    'an entry nothing raises is prose that ships to the docs describing a refusal that cannot happen');
});

/**
 * **The motion exemption is GONE, and this is what replaced it.**
 *
 * That test asserted motion was the only pack raising codes with no table entry, and its control
 * said in as many words: *if motion ever joins the table this is measuring nothing — delete it
 * then*. It joined. So the claim inverts — no pack is exempt now — and the two tests above already
 * enforce it in both directions for every file, motion included.
 */
test('no pack is exempt: every code raised anywhere has an entry', () => {
  const exempt = [...raised.keys()].filter((code) => !(code in PROSE));
  assert.deepEqual(exempt, [],
    'the last exemption was motion, folded in deliberately — a new one is a regression, not a choice');
});

test('no entry is empty, and a fix never repeats its message', () => {
  for (const [code, prose] of Object.entries(PROSE)) {
    const [message, fix] = prose(...Array.from({ length: 4 }, (_, i) => `{a${i}}`));
    assert.ok(typeof message === 'string' && message.length > 0, `${code} has no message`);
    assert.notEqual(fix, message, `${code}'s fix restates its message instead of saying what to do`);
  }
});

test('production carries none of it', () => {
  const bundle = readFileSync(
    new URL('../packages/directives/dist/vera-directives.min.js', import.meta.url), 'utf8');
  const sample = ['was not declared by the state', 'nothing wired provides', 'is not a direction'];
  for (const text of sample) {
    assert.doesNotMatch(bundle, new RegExp(text),
      'the table is referenced only inside __DEV__, so rollup drops the module entirely');
  }
});
