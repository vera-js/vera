/**
 * THE SHARED REFUSAL-ORDER CORPUS, RUN. `docs/motion-spec/fixtures/motion-refusal-order.json` is the
 * contract between this engine and omni's twin — 123 cases mapping an attribute value to its refusal
 * code+where SEQUENCE, its surviving settings, and whether the element is usable.
 *
 * **Until 2026-09-14 nothing in this repository opened that file.** It was written by omni, vendored
 * here, and pinned only by omni's suite; its own header said "vera adoption pending" while claiming
 * 88 cases against a file that held 123. A contract the owner's gate never reads is a promise, not a
 * check — and within hours of adopting it, this suite caught a fixture THIS repo had committed that
 * put an `args` value in the `where` slot. That is the whole argument for the file existing.
 *
 * **Governance (Brian, 2026-09-14): vera is the source of truth.** A disagreement is therefore never
 * a negotiation — it is either a vera DEFECT to fix or a corpus line to update. The `KNOWN` table
 * below records every one still open, with which fields differ and which way it resolves, and the
 * count is asserted: a NEW divergence fails this suite, and closing one is a deliberate edit here.
 *
 * **`motion/internal` is load-bearing, not a convenience.** `parseMotion` ships in `@verajs/motion`
 * while the `preset` insert is registered by the directives pack — so in a PRODUCTION build those
 * are two bundles with two insert registries (CLAUDE.md, "Modules are independent"). Reaching for
 * the public entries here would leave presets unwired under `npm run test:prod`, every preset case
 * would read `motion-presets-unwired`, and the suite would look like it found a divergence when it
 * had only found itself.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const motion = await load('motion/internal');
const { parseMotion, registerVocabulary, lookUpPreset, MOTION_ATTR } = motion;
/** The shipped ten, wired the way `wireDirectives([motion, presets])` wires them. */
registerVocabulary([{ on: 'preset', fn: lookUpPreset }]);

const corpus = JSON.parse(readFileSync(
  new URL('../docs/motion-spec/fixtures/motion-refusal-order.json', import.meta.url), 'utf8'));

/**
 * Every case still disagreeing, by name, with the fields that differ and how it resolves.
 * `vera-fix` means this engine is wrong and the entry disappears when it is fixed; `corpus` means
 * the fixture is stale and the entry disappears when omni's line is updated.
 */
const KNOWN = new Map([
  ['bare non-keyword still asks for quotes', { fields: 'rejected', why: 'vera motion-setting-not-plain predates the quotes ruling; should be motion-quote-the-value', fix: 'vera' }],
]);

/** A case with an `engines` field is a recorded divergence; vera asserts its own branch. */
const expected = (c) => (c.engines ? c.engines.vera : c);

const run = (raw) => {
  const el = dom.window.document.createElement('div');
  /**
   * A `stagger` refuses on an element with no MOTION_ATTR descendants, so a bare probe element
   * reports `motion-stagger-no-descendants` for every stagger case — a harness artifact that reads
   * exactly like an engine divergence.
   */
  for (let i = 0; i < 2; i++) {
    const child = dom.window.document.createElement('span');
    child.setAttribute(MOTION_ATTR, "{ keyframes: { opacity: '0, 1' } }");
    el.appendChild(child);
  }
  const dropped = [];
  const parsed = parseMotion(el, raw, { dropped });
  /**
   * An element whose every animation failed has NO ParsedElement to carry its refusals — they land
   * in `context.dropped` instead. Reading only `parsed.rejected` reports an empty list for exactly
   * the cases this corpus exists to pin.
   */
  const rejected = [...(parsed?.rejected ?? []), ...dropped.flatMap((d) => d.rejected ?? [])]
    .map((r) => ({ code: r.code, where: String(r.where ?? '') }));
  return { parsed, rejected };
};

/** Which of the three fields disagree for one case, as a stable `a+b` string. */
const diffOf = (c) => {
  const want = expected(c);
  const { parsed, rejected } = run(c.raw);
  const fields = [];
  if (JSON.stringify(rejected)
    !== JSON.stringify((want.rejected ?? []).map((r) => ({ code: r.code, where: String(r.where ?? '') })))) fields.push('rejected');
  if (JSON.stringify(parsed?.settings ?? {}) !== JSON.stringify(want.settings ?? {})) fields.push('settings');
  if (!!parsed !== want.usable) fields.push('usable');
  return fields.join('+');
};

test('THE CONTROL: the harness really parses, really refuses, and really resolves presets', () => {
  /**
   * Three ways this suite could pass while testing nothing: a parser that accepts everything, one
   * that refuses everything, and presets left unwired. Each is asserted before any case runs.
   */
  assert.equal(run("{ keyframes: { opacity: '0, 1' } }").rejected.length, 0, 'a valid value is clean');
  assert.deepEqual(run("{ keyframes: { opacity: '0, bad, 1' } }").rejected,
    [{ code: 'motion-bad-value', where: 'opacity' }], 'a bad value refuses BY NAME');
  assert.equal(run('fade-up').rejected.length, 0,
    'a shipped preset resolves — if this fails, presets are unwired and every preset case is noise');
});

test('every case the corpus and this engine agree on', () => {
  let checked = 0;
  for (const c of corpus.cases) {
    if (KNOWN.has(c.name)) continue;
    const want = expected(c);
    const { parsed, rejected } = run(c.raw);
    assert.deepEqual(rejected, (want.rejected ?? []).map((r) => ({ code: r.code, where: String(r.where ?? '') })),
      `${c.name}: refusal sequence — ${c.raw}`);
    assert.deepEqual(parsed?.settings ?? {}, want.settings ?? {}, `${c.name}: surviving settings`);
    assert.equal(!!parsed, want.usable, `${c.name}: usable verdict`);
    checked++;
  }
  assert.equal(checked, corpus.cases.length - KNOWN.size, 'every non-pinned case was actually run');
  assert.ok(checked > 100, `the CONTROL on the pin list: ${checked} cases ran, so KNOWN has not quietly swallowed the corpus`);
});

test('every pinned divergence still diverges, in exactly the fields recorded', () => {
  /**
   * The half that makes the pin list honest. Without it a vera fix or a corpus update would leave a
   * stale entry behind, and the next person would trust a list describing a disagreement that no
   * longer exists.
   */
  const names = new Set(corpus.cases.map((c) => c.name));
  for (const [name, { fields }] of KNOWN) {
    assert.ok(names.has(name), `pinned case "${name}" is not in the corpus — stale entry`);
    const actual = diffOf(corpus.cases.find((c) => c.name === name));
    assert.equal(actual, fields,
      `"${name}" now differs in [${actual || 'nothing'}], pinned as [${fields}]. If this was fixed, remove the pin.`);
  }
});

test('the divergence count is pinned, so a NEW one cannot arrive quietly', () => {
  const diverging = corpus.cases.filter((c) => diffOf(c) !== '').map((c) => c.name);
  assert.deepEqual(diverging.sort(), [...KNOWN.keys()].sort(),
    'the set of divergent cases must equal the pin list exactly');
});
