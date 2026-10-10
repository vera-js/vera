/**
 * **Core's own state never lands on an author's fields** (R1 piece 5, O4 — found 2026-10-10). Core keeps per-element
 * state on the host itself, and production MANGLES the internal names to single letters (`_hookPriorities` → `t`,
 * `_removed` → `h`, …): a vera component extending a minified base class that uses `this.t` or `this.h` has them
 * overwritten. The unmangled names (`_hooks`, `_root`, `_cleanups`, `_gen`) are plausible base-class names too.
 *
 * The names are READ FROM THE BUILD under test — its source map's `names` — never guessed, so the row follows whatever
 * the minifier assigns next. A base class sets a sentinel in every one of them; the component's whole lifecycle (init,
 * a render, a same-document move, a removal) must leave every sentinel as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';
import { distUrl, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const { init, html, wire, createStore, useEffect } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every identifier core's build writes for a `_`-named source property, as the build under test spells it. */
const file = fileURLToPath(distUrl('core'));
const code = readFileSync(file, 'utf8').split('\n');
const names = new Set();
eachMapping(new TraceMap(readFileSync(`${file}.map`, 'utf8')), (m) => {
  if (!m.name || !/^_[a-zA-Z]/.test(m.name)) return;
  const id = code[m.generatedLine - 1].slice(m.generatedColumn).match(/^[A-Za-z_$][\w$]*/)?.[0];
  if (id) names.add(id);
});
/** An unminified build keeps the source names and its map carries none: they are the property accesses themselves. */
for (const line of code) for (const [, name] of line.matchAll(/\.(_[a-zA-Z][\w$]*)\b/g)) names.add(name);

test('CONTROL: the build names its host state (the source map was read)', () => {
  assert.ok(names.has('_hooks') && names.size >= 6, [...names].join(', '));
});

/**
 * RED today in both builds (2026-10-10): core reads its fields back too, so a base class's own `_root` makes the render
 * target the wrong object — the component throws (`insertBefore is not a function`) and renders nothing. Fixed by R1
 * piece 5 (O4); a todo until then.
 */
test("a component extending a base class with fields of core's names keeps every one of them", { todo: 'R1 piece 5 (O4): core state off the host' }, async () => {
  /** An ordinary value, as a base class would hold — a Symbol makes core's arithmetic on `_gen` throw instead. */
  const SENTINEL = { base: true };
  class Base extends HTMLElement {
    constructor() {
      super();
      for (const name of names) this[name] = SENTINEL;
    }
  }
  customElements.define('hf-card', class extends Base {
    connectedCallback() {
      init(this, () => {
        const s = createStore({ n: 1 });
        useEffect(() => () => {});
        return () => html`<p>${s.n}</p>`;
      });
    }
  });
  const el = doc.createElement('hf-card');
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  doc.body.append(a, b);
  a.append(el);
  await tick();
  assert.equal(el.textContent, '1', 'CONTROL: it rendered');
  b.append(el);
  await tick();
  el.remove();
  await tick();
  const clobbered = [...names].filter((name) => el[name] !== SENTINEL);
  assert.deepEqual(clobbered, [], `core wrote over the author's fields: ${clobbered.join(', ')}`);
});
