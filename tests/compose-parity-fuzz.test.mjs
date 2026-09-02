/**
 * Composed component trees, server against client.
 *
 * `render-parity` asks this of one template and `lifecycle-parity` of one component; both use
 * hand-written case tables, and both say in their own headers that adding a case is one line and
 * should be preferred over a bespoke test. This asks it of the **tree**: components nesting
 * components, some with a shadow root and some in light DOM, each with its own state, at depths and
 * in arrangements nobody chose.
 *
 * Composition is where the two sides have the most room to disagree — a shadow boundary inside a
 * light-DOM parent, a child whose own render runs while its parent's is still settling, a component
 * whose children were placed by another component.
 *
 * ## Comparison
 *
 * `canonical.mjs`, shared with every other parity suite so that "the same DOM" cannot come to mean
 * two things. It is what makes this comparison meaningful across a shadow boundary: a client
 * `shadowRoot` and a server `<template shadowrootmode>` are read into the same marker, and the
 * template is skipped as a light-DOM child, so **nested** shadow content is compared on both sides
 * rather than silently dropped from one.
 *
 * ## What the mutations showed
 *
 * Stopping the server from composing below depth 1 fails **9 of 18** trees — the composition path is
 * genuinely reached, not merely present.
 *
 * Two further mutations survived and are **not** evidence of a gap: an extra attribute on the
 * server's `<template shadowrootmode>` (which `canonical` deliberately excludes — the template is the
 * shadow-root marker, not content) and an override of `getAttribute` (which the serializer does not
 * use; it walks `_attributes` directly). Both landed outside the compared surface by construction.
 * Recorded so they are not repeated as if they had meant something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { canonical } from './canonical.mjs';

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/**
 * One generated tree. The root always has children — a single-component "tree" tests composition of
 * nothing, and seven of the first eighteen generated were exactly that.
 */
const buildTree = (random, prefix) => {
  const parts = [];
  let counter = 0;

  const make = (depth) => {
    const tag = `${prefix}-${counter++}`;
    const shadow = random() < 0.5;
    const childCount = depth >= 2 ? 0 : depth === 0 ? 1 + Math.floor(random() * 2) : Math.floor(random() * 3);
    const children = Array.from({ length: childCount }, () => make(depth + 1));
    const body = children.length ? children.map((child) => `<${child}></${child}>`).join('') : `<i>leaf ${tag}</i>`;

    parts.push(
      `customElements.define('${tag}', class extends HTMLElement {\n` +
        `  connectedCallback() {\n` +
        `    init(this${shadow ? ", { mode: 'open' }" : ''});\n` +
        `    const state = createStore({ n: ${counter} });\n` +
        `    render(() => html\`<div class="${tag}" data-n=\${state.n}>${body}</div>\`);\n` +
        `  }\n` +
        `});`
    );
    return tag;
  };

  const root = make(0);
  return { root, source: `import { init, createStore, render, html } from '@verajs/core';\n${parts.join('\n')}\n` };
};

const SEEDS = [5, 21, 47, 88, 150, 1618];
const ROUNDS = 3;

const trees = [];
for (const seed of SEEDS) {
  const random = rng(seed);
  for (let round = 0; round < ROUNDS; round++)
    trees.push({ name: `${seed}/${round}`, ...buildTree(random, `cp-s${seed}r${round}`) });
}

test('the server and the client produce the same DOM for a composed component tree', async () => {
  const failures = [];
  /**
   * Inside the repo, because `renderToString` takes a module URL and that module imports
   * `@verajs/core` by bare specifier — a temp directory outside the tree cannot resolve it. Same
   * reasoning as `lifecycle-parity`.
   */
  const dir = mkdtempSync(new URL('./.compose-', import.meta.url).pathname);

  try {
    const files = trees.map((tree, index) => {
      const file = `${dir}/t${index}.js`;
      writeFileSync(file, `${tree.source}export default customElements.get('${tree.root}');\n`);
      return file;
    });

    const serverScript = `
import { renderToString } from '@verajs/ssr';
const out = {};
${trees
  .map(
    (tree, index) =>
      `try { out[${JSON.stringify(tree.name)}] = (await renderToString(${JSON.stringify(`file://${files[index]}`)}, { tag: ${JSON.stringify(tree.root)} })).html; }` +
      ` catch (error) { out[${JSON.stringify(tree.name)}] = { threw: String(error.message).slice(0, 140) }; }`
  )
  .join('\n')}
process.stdout.write(JSON.stringify(out));
`;
    const server = JSON.parse(
      execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', serverScript], {
        cwd: new URL('..', import.meta.url).pathname,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
    );

    const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
    for (const key of [
      'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
      'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
      'CustomEvent',
    ])
      globalThis[key] = dom.window[key];

    const core = await import('@verajs/core');
    const { renderer } = await import('@verajs/renderer');
    core.wire([renderer]);
    const D = dom.window.document;
    const host = D.getElementById('host');
    const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

    for (let index = 0; index < trees.length; index++) {
      const tree = trees[index];
      const markup = server[tree.name];
      if (markup && markup.threw) {
        failures.push(`${tree.name}: the server threw — ${markup.threw}`);
        continue;
      }

      await import(`file://${files[index]}`);
      const element = D.createElement(tree.root);
      host.appendChild(element);
      /** Three frames: nested components each schedule their own, one level at a time. */
      await frame();
      await frame();
      await frame();

      const client = canonical(element.shadowRoot ?? element);

      const holder = D.createElement('div');
      holder.innerHTML = markup;
      const serverRoot = holder.firstElementChild;
      const serverTemplate = serverRoot?.querySelector(':scope > template[shadowrootmode]');
      const fromServer = canonical(serverTemplate ? serverTemplate.content : serverRoot);

      if (client !== fromServer)
        failures.push(`${tree.name}\n      client: ${client.slice(0, 220)}\n      server: ${fromServer.slice(0, 220)}`);
      element.remove();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const sizes = trees.map((tree) => (tree.source.match(/customElements\.define/g) ?? []).length);
  assert.ok(Math.min(...sizes) >= 2, `a generated tree had ${Math.min(...sizes)} component(s) — composition of nothing`);
  assert.ok(Math.max(...sizes) >= 4, `the largest tree had only ${Math.max(...sizes)} components`);
  assert.deepEqual(
    failures.slice(0, 6),
    [],
    `${failures.length} of ${trees.length} composed trees disagree:\n\n  ${failures.slice(0, 6).join('\n\n  ')}`
  );
});
