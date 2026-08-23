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
  '@verajs/styles': 'styles',
};

/** Point bare specifiers at the artifacts this run is testing. */
const resolveImports = (code) =>
  code.replace(/from ['"](@verajs\/[a-z]+)['"]/g, (whole, spec) =>
    PACKAGES[spec] ? `from '${distUrl(PACKAGES[spec])}'` : whole
  );

const runModule = async (code) => {
  const resolved = resolveImports(code);
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

test('the multi-module CDN snippet wires connectInserts', () => {
  /** Documented as load-bearing: standalone bundles each inline their own registry. */
  const block = blocks.find((b) => b.lang === 'js' && b.body.includes('setAutoloader'));
  assert.ok(block, 'the multi-module snippet is present');
  assert.match(block.body, /connectInserts\(/, 'it must call connectInserts');
});
