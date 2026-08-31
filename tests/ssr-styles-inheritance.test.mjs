/**
 * A component class that extends another, rendered on the server.
 *
 * **No SSR fixture in this repository used inheritance** — every one is `extends HTMLElement` — and
 * the light-DOM half is exactly where Defect 58 lived. Hoisting is deduplicated with a flag on the
 * class, and `class Child extends Base` makes `Base` the prototype of `Child`, so reading that flag
 * without `hasOwnProperty` finds the base's and skips the subclass.
 *
 * ## The server hits it harder than the client
 *
 * On the client it was **order-dependent**: mounting the child first hoisted both, because inheritance
 * only looks upward. On the server there is no such luck — definitions run base-first, every time — so
 * a server-rendered page shipped its subclass components **unstyled, deterministically**, and then
 * disagreed with a client-only render of the same tree.
 *
 * Reverting the fix drops this from three `@scope` blocks to one, which is what makes this file worth
 * having rather than a restatement of the client suite.
 *
 * ## Both modes, because they take different paths
 *
 * Light DOM hoists to the document and is scoped by tag. Shadow DOM writes into the root and is scoped
 * by the boundary itself, so it never consults the class flag — asserted here to keep it that way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr/vera';

const fixture = new URL('./fixtures/ssr/styles-inheritance-ssr.js', import.meta.url);
const rendered = await renderToString(fixture);

test('every light-DOM class in the hierarchy hoists its own scoped block', () => {
  const blocks = [...rendered.styles.matchAll(/@scope \(([a-z-]+)\)/g)].map((match) => match[1]);

  assert.deepEqual(
    blocks, ['light-base', 'light-fancy', 'light-bare'],
    'one block per class, each naming its own tag'
  );
});

test('and each carries the styles that class actually declares', () => {
  /** Split rather than match: the block delimiters are parentheses and braces, and escaping them
   *  inside a `new RegExp` string is how the first version of this got it wrong. */
  const blockFor = (tag) => {
    const start = rendered.styles.indexOf(`@scope (${tag})`);
    if (start === -1) return '';
    const end = rendered.styles.indexOf('}', start);
    return rendered.styles.slice(start, end === -1 ? undefined : end);
  };

  assert.match(blockFor('light-base'), /color: red/, 'the base declares red');
  assert.match(blockFor('light-fancy'), /color: blue/, 'the subclass overrode it');
  assert.match(
    blockFor('light-bare'), /color: red/,
    'and one that declares nothing inherits the CSS while keeping its own scope'
  );
});

/** The failure this guards: a single block means the subclasses were skipped and ship unstyled. */
test('so the count is three rather than one', () => {
  const blocks = rendered.styles.match(/@scope/g) ?? [];
  assert.equal(blocks.length, 3, `${blocks.length} scope block(s) — a subclass was skipped`);
});

test('shadow-DOM subclasses are scoped by their root instead, and are unaffected', () => {
  const roots = [...rendered.html.matchAll(/<(shadow-[a-z]+)[^>]*>\s*<template shadowrootmode="open">\s*<style vera-styles>([^<]*)</g)];
  const byTag = Object.fromEntries(roots.map(([, tag, css]) => [tag, css]));

  assert.match(byTag['shadow-base'] ?? '', /color: green/, 'the base styled its own root');
  assert.match(byTag['shadow-fancy'] ?? '', /color: teal/, 'and the subclass styled its own');
});

test('and the tree itself rendered, so none of the above is vacuous', () => {
  for (const tag of ['light-base', 'light-fancy', 'light-bare', 'shadow-base', 'shadow-fancy'])
    assert.match(rendered.html, new RegExp(`<${tag}[ >]`), `${tag} is missing from the markup`);
});
