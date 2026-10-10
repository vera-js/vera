/**
 * **Every line the formatters write is one of the documented forms, and the docs show every production form**
 * (code-system phase 5b, vera-5a, 2026-10-09). tests/diagnostics-through-tables reads hand-written SOURCE literals; a
 * formatter's output is no literal, so it never sees it — this drives the formatters themselves (shared-utils'
 * `diagnostic`, `misuse`, `misuseAbout`, `reportUncaught`, and ssr's twins) in the build under test and requires each output to match
 * exactly one form, and the form its formatter is for. The forms are disjoint by construction (each test input keeps
 * ` — ` out of the words, as real prose need not), so "exactly one" is checkable. The other half is the docs: the
 * "reading a `[vera]` line" section, in the core README and in llms.txt, must show every PRODUCTION form at least once
 * (the development forms are what the formatter rows assert), and every example it gives must be one of the forms.
 * Found when cms's reader printed `createReader: "<url>" (HTTP 404): <link>`, a form nothing documented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isProduction } from './dist.mjs';
import { ssrMisuse, ssrWarning } from '../packages/ssr/dist/vera/report.js';

const shared = await import(`../packages/shared-utils/dist/${isProduction ? 'vera-shared-utils.min.js' : 'development/vera-shared-utils.js'}`);

const CODE = '[a-z][a-z0-9-]*';
const LINK = `https:\\/\\/verajs\\.dev\\/e\\/${CODE}`;
/** A function's name, or (a cms validation line) the quoted field it is about. */
const NAME = '(?:[A-Za-z][\\w.]*|"[^"]+")';

const FORMS = {
  'printed, with its link': new RegExp(`^\\[vera\\] ${CODE}: .+ — ${LINK}$`),
  /** With its subject, or — where there is none — the code alone, ending the line. */
  'printed, the bare code': new RegExp(`^\\[vera\\] ${CODE}(?:: (?![^—]*\\(${CODE}\\)$)[^—]+)?$`),
  'printed, development': new RegExp(`^\\[vera\\] ${CODE}: .+ — (?!https:).+ \\(${CODE}\\)$`),
  'thrown, with its link': new RegExp(`^${NAME}: ${LINK}$`),
  'thrown, the bare code': new RegExp(`^${NAME}: ${CODE}$`),
  'thrown with its subject, with its link': new RegExp(`^${NAME}: (?!https:)[^—]+ — ${LINK}$`),
  'thrown, development': new RegExp(`^${NAME}: (?!.* — ).+ \\(${CODE}\\)$`),
  'thrown with its subject, development': new RegExp(`^${NAME}: [^—]+ — (?!https:).+ \\(${CODE}\\)$`),
  'compiled, with its link': new RegExp(`^[^\\s:]+:\\d+:\\d+ — ${LINK}$`),
};
const PRODUCTION_FORMS = Object.keys(FORMS).filter((form) => !form.endsWith('development'));

const formsOf = (line) => Object.entries(FORMS).filter(([, shape]) => shape.test(line)).map(([form]) => form);

const PROSE = ['the value is not usable here.', 'Pass a function instead.'];

/**
 * reportUncaught prints the line it is handed with the error BESIDE it (Node has no `reportError`, so it prints here in
 * both builds) — the line a hook's caller hands it: the bare code in production, its sentence in development.
 */
const forwarded = (() => {
  const saved = console.error;
  const error = new Error("the user's");
  let args = [];
  console.error = (...printed) => { args = printed; };
  try {
    shared.reportUncaught(error, isProduction ? '[vera] hook-threw' : shared.diagnostic('core', 'a hook', 'hook-threw', PROSE));
  } finally {
    console.error = saved;
  }
  assert.ok(args.length === 2 && args[1] === error, 'the error is printed beside the line, unformatted');
  return String(args[0]);
})();

/** `[formatter, the line it wrote, the form it is for, a fragment the line must hold — the CONTROL that it ran]`. */
const ROWS = [
  ['diagnostic', shared.diagnostic('core', '<x-card>', 'probe-code', PROSE), isProduction ? 'printed, with its link' : 'printed, development', 'probe-code'],
  ['misuse', shared.misuse('untrack', 'probe-code', PROSE), isProduction ? 'thrown, with its link' : 'thrown, development', 'probe-code'],
  ['misuseAbout', shared.misuseAbout('parseFrontmatter', 'line 3', 'probe-code', PROSE),
    isProduction ? 'thrown with its subject, with its link' : 'thrown with its subject, development', 'probe-code'],
  /** ssr keeps its words in every build (a server's log is read by the person who fixes it). */
  ["ssr's ssrMisuse", ssrMisuse('probe-code', PROSE), 'thrown, development', 'probe-code'],
  ["ssr's ssrWarning", ssrWarning('<x-card>', 'probe-code', PROSE), 'printed, development', 'probe-code'],
  ['reportUncaught', forwarded, isProduction ? 'printed, the bare code' : 'printed, development', 'hook-threw'],
];

for (const [formatter, line, expected, mark] of ROWS)
  test(`${formatter} writes exactly one documented form: ${expected}`, () => {
    assert.ok(line.includes(mark), `CONTROL: the formatter produced its line: ${JSON.stringify(line)}`);
    assert.deepEqual(formsOf(line), [expected], JSON.stringify(line));
  });

/** The "reading a `[vera]` line" section, up to the next heading. */
const section = (file) => {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = text.indexOf('## Diagnostics — reading a `[vera]` line');
  assert.ok(start !== -1, `CONTROL: ${file} has the section`);
  return text.slice(start, text.indexOf('\n## ', start + 1));
};

for (const file of ['packages/core/README.md', 'llms.txt'])
  test(`${file}: every example line is one form, and every production form has an example`, () => {
    /** An example is a code span holding a line: `[vera] …`, or `<name>: <something>` (not a bare URL). */
    const examples = [...section(file).replace(/\n/g, ' ').matchAll(/`([^`]+)`/g)].map(([, span]) => span)
      .filter((span) => span.startsWith('[vera] ') || /^[^\s:]+(?::\d+:\d+)?:? \S/.test(span) && !span.startsWith('https:'));
    assert.ok(examples.length >= PRODUCTION_FORMS.length, `CONTROL: read ${examples.length} examples`);
    const shown = new Set();
    for (const example of examples) {
      const forms = formsOf(example.replace(/ … /g, ' '));
      assert.equal(forms.length, 1, `"${example}" is one documented form, not ${JSON.stringify(forms)}`);
      shown.add(forms[0]);
    }
    assert.deepEqual(PRODUCTION_FORMS.filter((form) => !shown.has(form)), [], 'every production form is shown');
  });
