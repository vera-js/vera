/**
 * **`llms.txt` is the file most likely to be copied and the only one no runner read.**
 *
 * `CLAUDE.md` calls its buildless JSX block "the fastest path to a working single-file demo", and it
 * was wrong: `import { render as renderer }` followed by `wire([renderer])` wires the render
 * *function* where `wire` wants the *module*, which throws. The framework has a purpose-built error
 * for that exact mistake — *"`render` is not a module — did you mean `renderer`?"* — which is how
 * you know it is a mistake people make. This file made it.
 *
 * `tests/docs-recipes.test.mjs` executes every block marked `<!-- recipe -->`, and it globs
 * `README.md` and every `packages/<name>/README.md`. `llms.txt` is neither, so the most-copied code in the
 * project had no coverage at all.
 *
 * The two blocks here are JSX inside `<script type="text/vera-jsx">`, so they are compiled with
 * `transformJsx` — the same path `@verajs/jsx/standalone` takes in a browser — and run against the
 * built artifacts with the bare specifiers rewritten, exactly as an import map would.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transformJsx } from '@verajs/jsx';
import { distUrl } from './dist.mjs';

const source = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');

/** Bare specifiers, pointed at the artifacts this run is testing — what the import map does. */
const PACKAGES = {
  '@verajs/core': 'core',
  '@verajs/renderer': 'renderer',
  '@verajs/renderer/keyed': 'renderer/keyed',
  '@verajs/renderer/spread': 'renderer/spread',
  '@verajs/reactivity': 'reactivity',
};
const resolveImports = (code) =>
  code.replace(/from ['"](@verajs\/[a-z/]+)['"]/g, (whole, specifier) => {
    assert.ok(PACKAGES[specifier], `tests/llms-recipes: add "${specifier}" to PACKAGES`);
    return `from '${distUrl(PACKAGES[specifier])}'`;
  });

const jsxBlocks = [...source.matchAll(/<script type="text\/vera-jsx">\n([\s\S]*?)<\/script>/g)].map(([, body]) => body);

test('the JSX blocks are where this expects them', () => {
  assert.equal(jsxBlocks.length, 1, `expected one <script type="text/vera-jsx"> block, found ${jsxBlocks.length}`);
});

test('every `wire` in llms.txt wires a module, not a function', () => {
  /**
   * The precise mistake, asserted by shape rather than by running everything: `wire([x])` where `x`
   * was imported as `render` under another name. Cheap, and it catches the case anywhere in the file.
   */
  const aliased = [...source.matchAll(/import \{[^}]*\brender as (\w+)[^}]*\} from '@verajs\/renderer'/g)].map(([, name]) => name);
  for (const name of aliased)
    assert.ok(
      !new RegExp(`wire\\(\\[[^\\]]*\\b${name}\\b`).test(source),
      `llms.txt aliases \`render\` to \`${name}\` and then passes it to wire([…]) — wire takes the module \`renderer\``
    );
});

test('the buildless JSX recipe runs', () => {
  const compiled = transformJsx(jsxBlocks[0], 'llms-buildless.jsx');
  const script = `
${resolveImports(compiled)}

/** The recipe defines <my-app>; mounting it is what proves the wiring. */
const el = document.createElement('my-app');
document.body.appendChild(el);
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const rows = [...el.querySelectorAll('li')].map((n) => n.textContent);
if (rows.join('|') !== 'row 1|row 2|row 3') throw new Error('rendered ' + JSON.stringify(rows));
process.stdout.write('ok');
`;
  const setup = new URL('./dom-globals.mjs', import.meta.url).href;
  /** The artifact under test is chosen by `--conditions`, so the child inherits it — either spelling. */
  const inherited = process.execArgv.flatMap((argument, index) =>
    argument.startsWith('--conditions')
      ? argument.includes('=')
        ? [argument]
        : [argument, process.execArgv[index + 1]]
      : []
  );
  const out = execFileSync(process.execPath, [...inherited, '--import', setup, '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  });
  assert.equal(out, 'ok');
});
