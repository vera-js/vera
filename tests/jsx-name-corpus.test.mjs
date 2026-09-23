/**
 * Every way a module can bind, reference or merely MENTION a name `@verajs/jsx` injects, crossed
 * with every JSX shape that makes it inject one — transformed, then actually RUN.
 *
 * **This exists because arguing about the rule kept losing to measuring it.** The transform must
 * decide, without parsing, whether a name in the source is a binding it would collide with, a
 * reference to the very import it is adding, or just a word. Three rounds of audit fixed that rule
 * one spelling at a time — `const {svg} = vera`, `const [svg] = …`, `let a, svg`, a parameter, a
 * parameter INSIDE a JSX expression, a commented-out import, an import inside a template literal,
 * an import that is also shadowed — and each fix looked complete until the next shape arrived. A
 * corpus ends that: it is the difference between "I cannot think of another case" and "here are a
 * thousand cases".
 *
 * **Running them is the point, not transforming them.** Every defect in this class PARSES. A renamed
 * import leaves the author's own tag dangling, and a suppressed one leaves the emitted tag dangling;
 * both are `ReferenceError` or `TypeError` at first render and completely invisible to a syntax
 * check. Two of the defects this file was written to catch were found only by evaluating the output.
 *
 * Modules are written INSIDE `node_modules/` so the injected bare specifiers resolve, and the
 * five injected names are deliberately NOT provided as globals: a stub named `html` would satisfy a
 * dangling reference and report the bug as passing.
 */
import { load } from './dist.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const { transformJsx } = await load('jsx');

/** Inside the tree, or a bare `@verajs/core` in the emitted output cannot resolve. */
const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.jsx-corpus-'));
writeFileSync(
  join(dir, 'stubs.mjs'),
  'const tag = (s, ...v) => ({ strings: s, values: v });\n' +
    'export const html = tag, svg = tag, mathml = tag;\n' +
    'export const keyed = (k, v) => v;\nexport const spread = (p) => p;\nexport default tag;\n'
);

/** Each binds, references, or merely mentions `NAME`. The last two are the ones that parse and lie. */
const PRELUDES = [
  '',
  'const NAME = 1;',
  'let NAME;',
  'var q1, NAME;',
  'function NAME() {}',
  'class NAME {}',
  'const { NAME } = lib;',
  'const { q2, NAME, q3 } = lib;',
  'const [NAME] = arr;',
  'const [q4, NAME] = arr;',
  "import { NAME } from './stubs.mjs';",
  "import { NAME as zother } from './stubs.mjs';",
  "import zdef, { NAME } from './stubs.mjs';",
  "const s = 'text/NAME';",
  '// NAME is a comment',
  '/* NAME in a block */',
  'const t = `a NAME in a template`;',
  'const o = { NAME: 1 };',
  'const u = a.NAME;',
  "/*\nimport { NAME } from './stubs.mjs';\n*/",
  "const T = `\nimport { NAME } from 'x';\n`;",
  "const doc = `Usage:\n${`\nimport { NAME } from 'x';\n`}\nDone.`;",
  'const tick = "wrap in `";\nconst NAME = 1;\nconst t2 = `z`;',
  "const API = 'https://api.example.com'; const NAME = 1;",
  "const open = '/*';\nconst NAME = 1;\nconst close = '*/';",
  'class Zx {\n  m() { return NAME`<b>t</b>` }\n}',
  'class Zy extends HTMLElement {\n  render() { return NAME`<i>t</i>` }\n}',
  'const RE = /^[\'"]/;\nconst { NAME } = lib;\nzf("x");',
  'const TICK = /`/;\nconst { NAME } = lib;',
  'const RE2 = /^https?:\\/\\//, NAME = 1;',
  'const r = 6 / 2 / 1;\nconst NAME = 1;',
  "const L = `${ zn ? zf({ zn }) : `it's empty` }`;\nconst NAME = 1;",
  "const D = `U:\n${ [zf({ a: 1 }),\n`\nimport { NAME } from 'x';\n`].join('') }\n.`;",
  'const { zq, ...NAME } = lib;',
  'const [zq2, ...NAME] = arr;',
  'function zr(...NAME) { return NAME; }',
  "const S2 = `${zn} ${ /^['\"]/.test('x') }`;\nconst NAME = 1;",
  "const qs = 'w' / 2; const NAME = 1;",
  'const N2 = `A${ zf({ k: `B${zn}C` }) }D`;\nconst NAME = 1;',
  'const q = { a: 1 } / 2, NAME = 1;',
];

/** Each makes the transform inject at least one name; two also TAG by hand, beside their JSX. */
const BODIES = [
  'export const view = <div>hi</div>;',
  'export const view = <path d="M0" />;',
  'export const view = (x) => <ul>{x.map((i) => <li key={i}>{i}</li>)}</ul>;',
  'export const view = (p) => <b {...p}>x</b>;',
  'export const view = <g><title>T</title><path d="M0" /></g>;',
  'export const view = (x) => <div>{x ? html`<b>t</b>` : null}</div>;',
  'export const view = (items) => <g>{items.map((NAME) => <path d={NAME} />)}</g>;',
  'export const view = ({ NAME }) => <path d={NAME} />;',
  'export const view = <math><mtext><b>x</b></mtext></math>;',
  'export const view = <Frame><path d="M0" /><circle r="1" /></Frame>;',
  'export function view() {\n  return html`<b>t</b>`;\n}\nexport const other = <div>hi</div>;',
  'export const view = () => <Frame><title>T</title><path d="M0" /></Frame>;',
  "export const view = (x) => <div>{x && <p>Don't stop</p>}</div>;",
  'export const view = (x) => <div>{x && <p>a ` b</p>}</div>;',
  'export const view = (x) => <div title={x && <p>it\'s</p>}>y</div>;',
];

const NAMES = ['html', 'svg', 'keyed', 'spread', 'mathml'];

test('every module the transform can be handed still parses and runs', async () => {
  const failures = [];
  let built = 0;
  let ran = 0;
  const silence = console.warn;
  console.warn = () => {};
  try {
    for (const name of NAMES)
      for (const prelude of PRELUDES)
        for (const body of BODIES) {
          const pre = prelude.replaceAll('NAME', name);
          const source = `${pre}\n${body.replaceAll('NAME', name)}`;
          /**
           * A source that BINDS the name to a non-function and then TAGS with it is broken as
           * written — the author's own `html` is `1`. Aliasing the import and leaving theirs alone
           * is the correct answer, so the throw is the snippet's own and the pair is not a legal
           * corpus entry.
           */
          const binds = new RegExp(
            `(?:const|let|var|function|class)[\\s{[,]*[^=;\\n]*\\b${name}\\b|[,(]\\s*${name}\\s*[=:,)]`
          ).test(pre.replace(/^\s*import\b[^\n]*$/gm, ''));
          if (binds && source.includes(`${name}\``)) continue;

          let out;
          try {
            out = transformJsx(source, 'corpus.jsx', { inject: true });
          } catch (error) {
            failures.push(`transform threw: ${error.message}\n    ${source.replace(/\n/g, ' | ')}`);
            continue;
          }
          const file = join(dir, `m${built++}.mjs`);
          /** Stubs for what the SNIPPETS reference — never for what the transform injects. */
          writeFileSync(file, `const lib = {}, arr = [], a = {}, Frame = (zp) => zp, HTMLElement = class {};\nconst zf = (zx) => String(zx), zn = 1;\n${out}`);
          try {
            const module = await import(pathToFileURL(file).href);
            if (typeof module.view === 'function') module.view([1, 2]);
            ran++;
          } catch (error) {
            if (
              error instanceof SyntaxError ||
              error instanceof ReferenceError ||
              error instanceof TypeError
            )
              failures.push(`${error.constructor.name}: ${error.message}\n    ${source.replace(/\n/g, ' | ')}`);
            else ran++;
          }
        }
  } finally {
    console.warn = silence;
    rmSync(dir, { recursive: true, force: true });
  }

  /** A corpus that generated nothing would report perfect behaviour. */
  assert.ok(built > 900, `the matrix built ${built} modules, which is too few to mean anything`);
  assert.equal(ran, built, `every module must evaluate\n  ${failures.slice(0, 8).join('\n  ')}`);
  assert.deepEqual(failures, [], `modules the transform broke:\n  ${failures.slice(0, 8).join('\n  ')}`);
  console.log(`jsx name corpus: ${built} modules transformed, evaluated and rendered clean`);
});
