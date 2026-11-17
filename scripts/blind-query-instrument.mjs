/**
 * **The blind-query instrument** (the gate's "blind queries" step, `scripts/blind-queries.mjs`; Brian approved,
 * 2026-11-17). Preloaded into every test process (`NODE_OPTIONS=--import`), it wraps each jsdom window's
 * `querySelector`/`querySelectorAll` on documents, elements and fragments. A query that comes back EMPTY while a
 * `<template>` under the same root holds a match for the same selector is a BLIND query: a check that found nothing only
 * because the content sat in template content. A served declarative shadow root parses as a plain `<template>` in jsdom,
 * so a server suite that queries only the document asserts absence against nothing (CLAUDE.md). Each blind query is
 * appended, as one JSON line, to the file `BLIND_QUERIES_OUT` names.
 */
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';

const OUT = process.env.BLIND_QUERIES_OUT;
const require = createRequire(new URL('../package.json', import.meta.url));
const { JSDOM } = require('jsdom');

/** Whether any `<template>` under `root` (nested ones included) holds a match for `selector`. */
const inTemplates = (root, selector) => {
  for (const template of root.querySelectorAll('template')) {
    try {
      if (template.content.querySelector(selector) !== null || inTemplates(template.content, selector)) return true;
    } catch {
      return false;
    }
  }
  return false;
};

/** The test file and line that made the query: the first stack frame inside `tests/`. */
const site = () => /\(?(?:file:\/\/)?([^\s()]*\/tests\/[^\s():]+):(\d+)/.exec(new Error().stack ?? '')?.slice(1, 3).join(':') ?? 'unknown';

const patched = new WeakSet();
const patch = (window) => {
  if (patched.has(window)) return;
  patched.add(window);
  for (const Proto of [window.Document.prototype, window.Element.prototype, window.DocumentFragment.prototype])
    for (const name of ['querySelector', 'querySelectorAll']) {
      const original = Proto[name];
      Proto[name] = function (selector) {
        const result = original.call(this, selector);
        if (OUT && typeof selector === 'string' && selector !== 'template' && (name === 'querySelector' ? result === null : result.length === 0)) {
          let blind = false;
          try {
            blind = inTemplates(this, selector);
          } catch {
            blind = false;
          }
          if (blind) appendFileSync(OUT, `${JSON.stringify({ at: site(), query: name, selector })}\n`);
        }
        return result;
      };
    }
};

const descriptor = Object.getOwnPropertyDescriptor(JSDOM.prototype, 'window');
Object.defineProperty(JSDOM.prototype, 'window', {
  ...descriptor,
  get() {
    const window = descriptor.get.call(this);
    patch(window);
    return window;
  },
});
