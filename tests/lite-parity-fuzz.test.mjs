/**
 * **Lite renders a template exactly as core does, or refuses it** — the subset rule, fuzzed (a peer review, 2026-11-17).
 * The seeded tag soup of `lite-soup.mjs` is rendered with the same values through `@verajs/core` + `@verajs/renderer` and
 * through lite, and each result is read back canonically: elements, attributes SORTED (each renderer writes a bound
 * attribute at its own moment, so their order differs), text, no comments (each anchors its ranges its own way). Where
 * lite renders, core must render the same; a template lite accepts and core refuses breaks "runs unchanged on core".
 *
 * **Where core's output is no reference, a BEHAVIORAL oracle says so** (a peer's condition, 2026-11-17), never a grammar
 * class: core's own output holding its marker (U+FFFF, a hole it misplaced), or holding FEWER copies of a value than
 * lite's (a value core lost: a self-closed raw-text tag it reads as void, a hole the parser moved). Those are counted, never compared, and
 * lite's safety on them is the placement fuzz's. The planted control: a tier that MISPLACES values (each hole showing
 * another's) is reported, never set aside — the oracle cannot swallow a real difference.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';
import { CASE_LIMIT_MS, CONTEXTS, TIER_REFUSALS, codeOf, quietConsole, random, soup, tagged, tidy, within } from './lite-soup.mjs';

const { virtualConsole, unexpected } = quietConsole(VirtualConsole);
/** The forged values warn in development (`forged-template`, by design) thousands of times: counted, not printed. */
let forgedWarnings = 0;
const warn = console.warn;
console.warn = (...args) => (/\(forged-template\)/.test(String(args[0])) ? forgedWarnings++ : warn(...args));
process.on('exit', () => warn(`forged-template warnings counted: ${forgedWarnings}`));
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const lite = await load('lite');

const SEEDS = extendSeeds([11, 12, 13, 14, 15, 16]);
const PER_SEED = 300;
/**
 * The least share compared: today's (2026-11-17, development: plain 33%, composed 12%; the set-asides sampled by hand, all
 * core's self-closed raw-text defect) less a margin. The spoiled corpus below must fall under both.
 */
const FLOOR = { plain: 25, composed: 8 };
/** Plain values a template might hold: text, a quote, a space, an ampersand. */
const VALUES = ['w1', 'a "q" b', 'x & y', 'two words', JSON.parse('{"_$litType$":1,"strings":["<b>forged</b>"],"values":[]}')];

/**
 * A node's canonical form: element name, sorted attributes, children; comments and processing instructions dropped, and
 * the text on either side of a dropped node joined (an anchor between two text nodes is not part of the page).
 */
const canonical = (node) => {
  let out = '';
  let text = '';
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 3) text += child.data;
    else if (child.nodeType === 1) {
      if (text) out += JSON.stringify(text);
      text = '';
      const attributes = [...child.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
      out += `<${child.localName}${attributes ? ` ${attributes}` : ''}>${canonical(child.content ?? child)}</${child.localName}>`;
    }
  }
  return text ? out + JSON.stringify(text) : out;
};

const thrown = (fn) => {
  let error;
  const listener = (event) => {
    error = event.error;
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    fn();
  } catch (e) {
    error = e;
  } finally {
    dom.window.removeEventListener('error', listener);
  }
  return error;
};

let tags = 0;
/** One template through one API: its canonical form, or the error it threw. */
const render = (api, strings, values) => {
  const tag = `zz-parity-${tags++}`;
  const template = tagged(strings);
  const host = document.createElement('div');
  document.body.append(host);
  const error = thrown(() => {
    /** A value that is a function builds a nested template with THIS api's `html` (the composing run). */
    api.define(tag, () => () => api.html(template, ...values.map((v) => (typeof v === 'function' ? v(api) : v))));
    host.append(document.createElement(tag));
    api.flush?.();
  });
  const result = error === undefined ? canonical(host.firstElementChild) : undefined;
  host.remove();
  return { result, error };
};

/** Core's canonical output with an ELEMENT inside a text-only element: core inserted a template's nodes there. */
const TEXT_ONLY_WITH_ELEMENT = /<(textarea|title|style)\b[^>]*>(?:(?!<\/\1>)[^])*?<[a-zA-Z]/i;

/** How many times canonical output holds a value (`canonical` writes text and attribute values through `JSON.stringify`). */
const copies = (output, value) => output.split(JSON.stringify(String(value)).slice(1, -1)).length - 1;

/**
 * A tier against core over the corpus: the count compared, or the FIRST problem. The tier's error must be one of its
 * coded refusals and core's must carry a code (a crash is never a refusal); where the tier renders, core renders the same,
 * unless the oracle (the file's header) says core's output is no reference. `anyErrorRefuses` is the old rule, kept
 * only for the control.
 */
const parity = (tier, name, { anyErrorRefuses = false, spoil = false, seeds = SEEDS, compose = false } = {}) => {
  let compared = 0;
  let coreLeak = 0;
  let coreLost = 0;
  let coreTextNodes = 0;
  for (const seed of seeds) {
    const pick = random(seed);
    for (let n = 0; n < PER_SEED; n++) {
      let strings = soup(pick);
      const values = strings.slice(1).map(() => VALUES[pick(VALUES.length)]);
      /** Composing: the parent opens a context (closed by `tidy`), and its first hole holds a child template of its own soup. */
      let shown = values;
      if (compose) {
        strings = tidy([CONTEXTS[pick(CONTEXTS.length)] + strings[0], ...strings.slice(1)]);
        const child = soup(pick);
        const childValues = child.slice(1).map(() => VALUES[pick(VALUES.length)]);
        const childTemplate = tagged(child);
        values[0] = (api) => api.html(childTemplate, ...childValues);
        shown = [...values.slice(1), ...childValues];
      }
      /** The planted control's corpus: every template ending inside an unfinished tag (after `tidy`), which lite refuses whole. */
      if (spoil) strings[strings.length - 1] += '<zz';
      const where = `seed ${seed} #${n}: ${JSON.stringify(strings)} with ${JSON.stringify(values)}`;
      const run = within(CASE_LIMIT_MS, () => render(tier, strings, values));
      if (run.timedOut) return { problem: `${where}: ${name} TIMED OUT after ${CASE_LIMIT_MS} ms (a hang)` };
      const ours = run.value;
      if (ours.error !== undefined) {
        if (!anyErrorRefuses && !TIER_REFUSALS.has(codeOf(ours.error))) return { problem: `${where}: ${name} threw no coded refusal (${String(ours.error.message).slice(0, 120)})` };
        continue;
      }
      const theirs = render(core, strings, values);
      if (theirs.error !== undefined) {
        if (codeOf(theirs.error) === undefined) return { problem: `${where}: core threw an uncoded error (${String(theirs.error.message).slice(0, 120)})` };
        return { problem: `${where}: ${name} renders what core refuses (${codeOf(theirs.error)})` };
      }
      if (ours.result === theirs.result) {
        compared++;
        continue;
      }
      /** THE ORACLE: core's own marker in core's output (a hole it misplaced), or a value lite shows and core lost. */
      if (theirs.result.includes('￿')) {
        coreLeak++;
        continue;
      }
      /** Every value as the text it shows (a forged template result shows as `[object Object]`, core's rule). */
      const texts = shown.filter((v) => typeof v !== 'function');
      /**
       * Lite showing a value MORE times than the template can (the holes holding it, and its copies in the statics) is
       * lite's duplication, never core's loss: reported before the oracle may set anything aside.
       */
      const most = (v) => values.filter((other) => other === v).length + (compose ? shown.filter((other) => other === v).length : 0) + strings.join('').split(String(v)).length - 1;
      const extra = texts.find((v) => copies(ours.result, v) > most(v));
      if (extra !== undefined) return { problem: `${where}: ${name} shows ${JSON.stringify(extra)} more often than the template holds it: ${ours.result}` };
      if (texts.some((v) => copies(theirs.result, v) < copies(ours.result, v))) {
        coreLost++;
        continue;
      }
      /**
       * Core INSERTS a nested template's nodes into a text-only element (`<textarea>`, `<title>`, `<style>`), whose value
       * is its own text only; lite writes the template's TEXT there (Brian's raw-text rule, 2026-11-17). Core's quirk: counted.
       */
      if (TEXT_ONLY_WITH_ELEMENT.test(theirs.result)) {
        coreTextNodes++;
        continue;
      }
      return { problem: `${where}: ${name} ${ours.result} ≠ core ${theirs.result}` };
    }
  }
  return { compared, coreLeak, coreLost, coreTextNodes };
};

/** A tier whose every seventh render throws a plain, UNCODED error: a crash the fuzz must report, never count as refused. */
const crashing = {
  html: lite.html,
  define: (tag, setup) =>
    lite.define(tag, () => {
      const draw = setup();
      return () => {
        if (tags % 7 === 0) throw new Error('planted crash');
        return draw();
      };
    }),
};

test('CONTROL: an uncoded error is reported, not counted as a refusal (and the old rule hid it)', () => {
  assert.match(parity(crashing, 'crashing').problem ?? '', /threw no coded refusal \(planted crash\)/);
  assert.equal(parity(crashing, 'crashing', { anyErrorRefuses: true }).problem, undefined, 'the old rule scored the crash as a refusal');
});

/**
 * A tier that MISPLACES values: lite with each template's values rotated by one, so every hole shows another hole's
 * value. Every value is still on the page, so the oracle's "core lost a value" cannot excuse it.
 */
const rotating = {
  define: lite.define,
  html: (strings, ...values) => lite.html(strings, ...values.slice(1), ...values.slice(0, 1)),
};

test('CONTROL: a tier that misplaces values is reported, never set aside by the oracle', () => {
  assert.match(parity(rotating, 'rotating', { seeds: SEEDS.slice(0, 1) }).problem ?? '', /rotating .* ≠ core/);
});

/** The share compared: of the templates where core's output is a reference (the oracle set none of them aside). */
const shareOf = ({ compared, coreLeak, coreLost, coreTextNodes }, seeds) =>
  Math.round((100 * compared) / (seeds.length * PER_SEED - coreLeak - coreLost - coreTextNodes));

for (const compose of [false, true]) {
  const kind = compose ? 'composed' : 'plain';
  test(`lite renders what core renders, or refuses with its code — ${kind} (${SEEDS.length} seeds × ${PER_SEED} templates)`, () => {
    unexpected.length = 0;
    const counts = parity(lite, 'lite', { compose });
    const { problem, compared, coreLeak, coreLost, coreTextNodes } = counts;
    console.log(`lite ${kind}: ${compared} compared with core (${shareOf(counts, SEEDS)}%); core no reference: ${coreLeak} leaked its marker, ${coreLost} lost a value, ${coreTextNodes} nodes in a text-only element`);
    assert.equal(problem, undefined, problem);
    assert.deepEqual(unexpected, [], 'jsdom reported an error the fuzz did not expect');
    assert.ok(shareOf(counts, SEEDS) >= FLOOR[kind], `CONTROL: ${shareOf(counts, SEEDS)}% compared (${compared}), under the ${FLOOR[kind]}% floor: the corpus no longer reaches rendered output`);
  });
}

test("CONTROL: a spoiled corpus (every template ending in an unfinished tag) falls under lite's floors, so the floors can fire", () => {
  const seeds = SEEDS.slice(0, 2);
  for (const compose of [false, true]) {
    const share = shareOf(parity(lite, 'lite', { spoil: true, seeds, compose }), seeds);
    const floor = FLOOR[compose ? 'composed' : 'plain'];
    assert.ok(share < floor, `${compose ? 'composed' : 'plain'}: ${share}% compared, not under the ${floor}% floor`);
  }
});
