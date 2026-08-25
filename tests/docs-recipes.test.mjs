/**
 * The documented code, executed.
 *
 * Both README quick-starts were broken for days: they called `setHtml` but never `setRenderer`, so
 * they rendered `<button @click="">Clicked 0 times</button>` and clicking did nothing. Nothing
 * caught it because nothing ran them. This does.
 *
 * The code blocks are extracted from README.md and executed as written — not copied here, which
 * would drift the moment someone edits the docs. Bare `@verajs/*` specifiers are rewritten to the
 * built artifacts under test, which is the only transformation applied.
 *
 * Two layers. The named tests below cover the root README's quick-starts, where the assertions are
 * specific — the button increments, the effect fires. Beneath them, every README in the repo is
 * scanned for blocks marked `<!-- recipe -->`, each of which is executed and must complete without
 * throwing and without a console warning or error.
 *
 * The marked pass exists because the root README is the one file that **does not ship**: tarballs
 * carry `packages/*​/README.md`, so the documentation users actually receive was the part with no
 * coverage at all. Marking is opt-in rather than "run every js block" because a README legitimately
 * contains code that must not run — `@verajs/eslint-config` documents both the wrong and the right
 * way to write a class field, and executing the wrong one proves nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { distUrl } from './dist.mjs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** Every fenced block, with its language. */
const blocks = [...README.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map(([, lang, body]) => ({ lang, body }));

const PACKAGES = {
  '@verajs/core': 'core',
  '@verajs/renderer': 'renderer',
  '@verajs/router': 'router',
  '@verajs/autoloader': 'autoloader',
  '@verajs/inserts': 'inserts',
  '@verajs/reactivity': 'reactivity',
  '@verajs/reactivity/computed': 'reactivity/computed',
  '@verajs/renderer/spread': 'renderer/spread',
  '@verajs/styles': 'styles',
};

/**
 * Point bare specifiers at the artifacts this run is testing, with a per-recipe cache-buster.
 *
 * The query matters more than it looks. Core's insert registry is module-level state, so without a
 * fresh instance a recipe inherits whatever earlier recipes registered — and a recipe that forgot
 * `setRenderer` would then pass, carried by a renderer someone else wired. That is precisely the
 * defect this file was written for, so the harness must not be able to hide it. Verified: dropping
 * `setRenderer` from a recipe fails the run.
 */
const resolveImports = (code, generation) =>
  /** `[a-z/]`, not `[a-z]`: subpath entries like `@verajs/renderer/spread` are specifiers too. */
  code.replace(/from ['"](@verajs\/[a-z/]+)['"]/g, (whole, spec) =>
    PACKAGES[spec] ? `from '${distUrl(PACKAGES[spec], `?recipe=${generation}`)}'` : whole
  );

let generation = 0;
const runModule = async (code) => {
  const resolved = resolveImports(code, generation++);
  await import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
};

const setupDom = (markup) => {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { pretendToBeVisual: true });
  for (const k of ['document', 'HTMLElement', 'Node', 'customElements', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CSSStyleSheet']) {
    globalThis[k] = dom.window[k];
  }
  return dom;
};

const frame = () => new Promise((r) => setTimeout(r, 60));

test('README has the quick-start blocks this suite expects', () => {
  assert.ok(blocks.some((b) => b.lang === 'html' && b.body.includes('importmap')), 'the CDN recipe');
  assert.ok(blocks.some((b) => b.lang === 'ts' && b.body.includes('customElements.define')), 'the npm + TypeScript recipe');
});

test('the CDN quick-start actually renders and its button works', async () => {
  const block = blocks.find((b) => b.lang === 'html' && b.body.includes('importmap'));
  const script = block.body.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const tag = block.body.match(/<(\w[\w-]*)><\/\1>/)?.[1] ?? 'click-counter';

  const dom = setupDom(`<${tag}></${tag}>`);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    await runModule(script);
    await frame();

    const el = dom.window.document.querySelector(tag);
    const root = el.shadowRoot ?? el;
    const button = root.querySelector('button');
    assert.ok(button, 'the recipe rendered a button');
    assert.match(button.textContent, /Clicked 0 times/);

    button.dispatchEvent(new dom.window.Event('click'));
    await frame();
    assert.match(
      root.querySelector('button').textContent,
      /Clicked 1 times/,
      'clicking it increments — this is exactly what was broken'
    );
    assert.doesNotMatch(root.innerHTML, /@click/, 'no sigil leaked into the DOM');
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warnings, [], 'the recipe produces no warnings');
});

test('the npm + TypeScript quick-start renders and its button works', async () => {
  const block = blocks.find((b) => b.lang === 'ts' && b.body.includes('customElements.define'));
  /** The only TypeScript in the block is the import list; it is valid JS as written. */
  const tag = block.body.match(/customElements\.define\('([\w-]+)'/)[1];

  const dom = setupDom(`<${tag}></${tag}>`);
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await runModule(block.body);
    await frame();

    const el = dom.window.document.querySelector(tag);
    const root = el.shadowRoot ?? el;
    const button = root.querySelector('button');
    assert.ok(button, 'the recipe rendered a button');

    button.dispatchEvent(new dom.window.Event('click'));
    await frame();
    assert.match(root.querySelector('button').textContent, /Clicked 1 times/);
    assert.ok(logs.some((l) => /count is now 1/.test(l)), 'the documented useEffect fired');
  } finally {
    console.log = realLog;
  }
});

test('the install line names the packages the recipes import', () => {
  const install = blocks.find((b) => b.lang === 'bash' && b.body.includes('npm install @verajs'));
  const ts = blocks.find((b) => b.lang === 'ts' && b.body.includes('customElements.define'));
  const imported = [...ts.body.matchAll(/from '(@verajs\/[a-z]+)'/g)].map((m) => m[1]);
  for (const pkg of imported) {
    assert.ok(install.body.includes(pkg), `\`npm install\` must include ${pkg}`);
  }
});

test('the multi-module CDN snippet hands the router core\u2019s registry', () => {
  /**
   * Standalone bundles each inline their dependencies, so a module carrying its own registry would
   * write to one core never reads — in production only. None carry one; the router is handed core's
   * through `wire`. This asserted `connectInserts` until that function was removed in 0.2.0, and it
   * is the one check that keeps the README from drifting back to a reconciliation step.
   */
  const block = blocks.find((b) => b.lang === 'js' && b.body.includes('connectRouter'));
  assert.ok(block, 'the multi-module snippet is present');
  assert.match(block.body, /wire\(\[/, 'it must install the modules through wire([\u2026])');
  assert.doesNotMatch(block.body, /connectInserts/, 'connectInserts no longer exists');
});

/* ── Marked recipes, every README in the repo ─────────────────────────────────────────────────────
 *
 * Opt in by putting `<!-- recipe -->` on the line before a fenced block. The block is then executed
 * as an ES module under a fresh jsdom and must finish without throwing and without writing to
 * `console.warn` or `console.error` — VeraJS reports real misuse through those, so a silent recipe
 * is the actual contract. A block without the marker is documentation only, which is what lets a
 * README show the wrong way to do something.
 *
 * A recipe must be self-contained, imports included. That is a docs property worth enforcing rather
 * than a limitation to work around: a reader copying one block should get working code, and a block
 * that only runs given something established earlier in the page cannot be copied.
 *
 * Each runs in its own process — see `tests/run-recipe.mjs` for why a cache-busting query is not
 * enough. Under the production condition the `__DEV__` guards that produce these warnings are
 * compiled out, so that run checks only that a recipe completes without throwing; the warning
 * assertions are meaningful in development, which is where a developer would see them.
 */
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const RECIPE = /<!--\s*recipe\s*-->\s*\n```(\w+)\n([\s\S]*?)```/g;

const readmes = ['README.md', ...globSync('packages/*/README.md').sort()];
const recipes = readmes.flatMap((path) => {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  return [...text.matchAll(RECIPE)].map(([, lang, body], i) => ({ path, lang, body, index: i + 1 }));
});

/**
 * The inventory, pinned exactly rather than as a floor.
 *
 * A recipe losing its marker is invisible otherwise — the suite would simply run one fewer test and
 * stay green, which is the same shape as the original problem this file exists for. An exact map
 * means both adding and removing a recipe is a deliberate edit here.
 */
const EXPECTED_RECIPES = {
  'packages/core/README.md': 1,
  'packages/reactivity/README.md': 1,
  'packages/renderer/README.md': 2,
  'packages/styles/README.md': 2,
};

test('the marked recipes are exactly the ones we expect', () => {
  const byFile = {};
  for (const r of recipes) byFile[r.path] = (byFile[r.path] ?? 0) + 1;
  assert.deepEqual(byFile, EXPECTED_RECIPES);
  for (const r of recipes) {
    assert.ok(['js', 'ts'].includes(r.lang), `${r.path} recipe ${r.index}: only js/ts can be executed`);
  }
});

const RUNNER = new URL('./run-recipe.mjs', import.meta.url).pathname;

for (const { path, body, index } of recipes) {
  test(`${path} — recipe ${index} runs clean`, () => {
    const resolved = resolveImports(body, `recipe-${index}`);
    const result = spawnSync('node', [RUNNER, Buffer.from(resolved).toString('base64')], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${path} recipe ${index} threw:\n${result.stderr}`);
    assert.deepEqual(
      JSON.parse(result.stdout || '[]'),
      [],
      `${path} recipe ${index} wrote to the console`
    );
  });
}
