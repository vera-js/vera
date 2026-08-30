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

/**
 * **The buildless import map has to cover every specifier the transform can inject.**
 *
 * `llms.txt` told readers the transform injects "`html` from `@verajs/core` and `keyed` from
 * `@verajs/renderer`". The first half is right; the second names the wrong package and omits the
 * condition. `keyed` comes from **`@verajs/renderer/keyed`**, and only when a block writes
 * `key={…}` on an element — an explicit `keyed(…)` call is not injected at all.
 *
 * That is not pedantry about a subpath. A page built on the stated mechanism — `key={…}` in the JSX,
 * `@verajs/core` and `@verajs/renderer` in the map — **does not render**, in every engine, with
 * `Failed to resolve module specifier "@verajs/renderer/keyed"`. Measured in a browser before this
 * was written.
 *
 * So the map is checked against the transform rather than against the prose: whatever the transform
 * would inject has to be resolvable by the recipe's own import map.
 */
test('every specifier the JSX transform injects is in the buildless import map', () => {
  const text = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
  /** `llms.txt` carries two import maps — the plain CDN one and the JSX one — and only the JSX
   * recipe has anything injected into it. Take the last map before the first JSX block. */
  const jsxAt = text.indexOf('<script type="text/vera-jsx">');
  assert.ok(jsxAt > 0, 'the buildless JSX recipe is gone');
  const maps = [...text.slice(0, jsxAt).matchAll(/<script type="importmap">\s*(\{[\s\S]*?\})\s*<\/script>/g)];
  assert.ok(maps.length, 'the buildless JSX recipe no longer has an import map before it');
  const imports = JSON.parse(maps[maps.length - 1][1]).imports;

  /** Every shape the transform injects for, so a new injection target fails here. */
  const sources = [
    ['a plain element', '<p>hi</p>'],
    ['a keyed element', '<ul>{[1].map((i) => <li key={i}>{i}</li>)}</ul>'],
    ['a fragment', '<><p>a</p><p>b</p></>'],
    ['a component', '<Row label="x" />'],
  ];
  const injected = new Set();
  for (const [, source] of sources) {
    const output = transformJsx(`const a = ${source};`, 'inline.jsx');
    for (const line of String(output.code ?? output).split('\n')) {
      const match = /^import .*? from '([^']+)';/.exec(line);
      if (match) injected.add(match[1]);
    }
  }
  assert.ok(injected.has('@verajs/core'), 'the transform no longer injects html from core');
  assert.ok(injected.has('@verajs/renderer/keyed'), 'the transform no longer injects keyed from the subpath entry');

  const missing = [...injected].filter((specifier) => !(specifier in imports));
  assert.deepEqual(
    missing,
    [],
    `the recipe's import map cannot resolve what the transform injects: ${missing.join(', ')}`
  );
});
