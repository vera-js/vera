/**
 * **A console line with a second argument is never a format string** (vera-5a, 2026-10-09). With two or more
 * arguments the console reads the first as a FORMAT: `%c` `%s` `%d` `%i` `%f` `%o` `%O` are specifiers (the WHATWG
 * Console "Formatter"; measured in Node). So a line carrying a user-influenced subject — a path, an href, a src — before
 * a forwarded error was garbled by ordinary percent-escapes, and LOST THE ERROR: `/caf%c3%a9` (é) printed `/caf3%a9`
 * and the error vanished; `%f0` (an emoji's first byte) printed `NaN`. A browser applies `%c` as CSS, so a crafted
 * href could also restyle or hide the line.
 *
 * The rule, enforced across every package: a multi-argument console call passes `'%s'` first, or its first argument
 * is a plain literal with no `%` and no interpolation. One exemption, counted: `reportUncaught`, whose sentence every
 * caller passes as a fixed literal of the framework's own (no subject) — fixing it would cost core 4 B for no defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The closing parenthesis of a call, past strings, template literals and their `${…}`. */
const closing = (text, at) => {
  let depth = 1;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) {
        if (text[i] === '\\') i++;
        else if (c === '`' && text[i] === '$' && text[i + 1] === '{') {
          let inner = 1;
          for (i += 2; i < text.length && inner > 0; i++) inner += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
          i--;
        }
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
};
const topLevel = (args) => {
  const out = [];
  let depth = 0, quote = null, current = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    current += c;
    if (quote) {
      if (c === '\\') current += args[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

const EXEMPT = new Map([['packages/shared-utils/src/utils.ts', [2, "reportUncaught: the sentence is always the framework's own fixed literal — no subject"]]]);

test('every multi-argument console call passes %s first, or starts with a plain literal free of %', () => {
  const unsafe = [];
  const exempted = new Map();
  let multi = 0;
  for (const file of globSync('packages/*/src/**/*.ts', { cwd: root })) {
    const text = readFileSync(root + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
    for (const match of text.matchAll(/console\.(?:log|info|warn|error|debug)\(/g)) {
      const end = closing(text, match.index + match[0].length);
      const args = topLevel(text.slice(match.index + match[0].length, end));
      if (args.length < 2) continue;
      multi++;
      const first = args[0];
      const plain = /^(['"])[^%\\]*\1$/.test(first) || /^`[^%`$]*`$/.test(first);
      if (first === "'%s'" || plain) continue;
      if (EXEMPT.has(file)) {
        exempted.set(file, (exempted.get(file) ?? 0) + 1);
        continue;
      }
      unsafe.push(`${file}:${text.slice(0, match.index).split('\n').length} — ${first.slice(0, 60)}`);
    }
  }
  assert.ok(multi >= 10, `CONTROL: ${multi} multi-argument calls found`);
  assert.deepEqual(unsafe, [], "the first argument would be read as a format string — pass '%s' first");
  for (const [file, [count, why]] of EXEMPT) assert.equal(exempted.get(file), count, `${file}: ${why} — the count is the exemption`);
});

test('a navigation to a path holding %c3 that throws: the path verbatim, the error forwarded last — every build', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'PopStateEvent', 'MouseEvent', 'customElements']) globalThis[k] = dom.window[k];
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.history = dom.window.history;
  const router = await load('router');
  router.setRouterRenderer(() => {});
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.append(view);
  document.body.append(el);
  router.initRouter(el, { view, focusView: false, handleInitial: false }).addRoutes([
    /** A catch-all, so the test is about the REPORT, not about how a percent-encoded path matches. */
    { path: '/*rest', component: () => { throw new Error('component boom'); } },
  ]);
  const calls = [];
  const error = console.error;
  console.error = (...args) => calls.push(args);
  const link = document.createElement('a');
  link.href = '/caf%c3%a9';
  link.setAttribute('route', '');
  el.append(link);
  try {
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    console.error = error;
  }
  const ours = calls.find((args) => args.some((arg) => String(arg).includes('router-navigate-threw')));
  assert.ok(ours, `CONTROL: the navigation failed and was reported — ${JSON.stringify(calls.map((args) => args.map(String)))}`);
  assert.equal(ours[0], '%s', 'the line is passed as an ARGUMENT, never as the format');
  assert.ok(String(ours[1]).includes('%c3%a9') || String(ours[1]).includes('%C3%A9'), `the path verbatim: ${ours[1]}`);
  assert.ok(ours.at(-1) instanceof Error && ours.at(-1).message === 'component boom', 'and the error is the call\'s last argument');
});
