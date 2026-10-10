/**
 * **Core's own state never lands on an author's fields** (R1 piece 5, O4 — found 2026-10-10). The element is the
 * author's object. Core used to keep its state on it under `_root`, `_hooks`, `_cleanups`, `_gen` and — production
 * mangling the rest — single letters (`_hookPriorities` became `t`, `_removed` `h`, …): a component extending a base
 * class with a field of any of those names was overwritten, and since core reads its fields back, a base class's own
 * `_root` sent the render to the wrong object (`insertBefore is not a function`, nothing rendered), in both builds. Every
 * field core keeps is now sigiled (`_$g$ _$h$ …`, see `ComponentElement`).
 *
 * The names are READ FROM THE BUILD under test — its source map's `names` when minified, its own property accesses when
 * not — never guessed, so the rows follow whatever the minifier assigns next; a CONTROL asserts they were read.
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
  if (!m.name || !/^_[\w$]/.test(m.name)) return;
  const id = code[m.generatedLine - 1].slice(m.generatedColumn).match(/^[A-Za-z_$][\w$]*/)?.[0];
  if (id) names.add(id);
});
/** An unminified build keeps the source names and its map carries none: they are the property accesses themselves. */
for (const line of code) for (const [, name] of line.matchAll(/\.(_[\w$]+)/g)) names.add(name);

/** A component exercising what core keeps: a store, an effect with a cleanup, a render; then a move and a removal. */
const lifecycle = async (tag, Base) => {
  customElements.define(tag, class extends Base {
    connectedCallback() {
      init(this, () => {
        const s = createStore({ n: 1 });
        useEffect(() => () => {});
        return () => html`<p>${s.n}</p>`;
      });
    }
  });
  const el = doc.createElement(tag);
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  doc.body.append(a, b);
  a.append(el);
  await tick();
  const rendered = el.textContent;
  b.append(el);
  await tick();
  el.remove();
  await tick();
  return { el, rendered };
};

test('CONTROL: the build names its host state (the source map, or the code, was read)', () => {
  assert.ok(names.has('_$h$') && names.size >= 6, [...names].join(', '));
});

test("a component extending a base class with fields of every name core's build uses keeps every one of them", async () => {
  /** An ordinary value, as a base class would hold — a Symbol makes arithmetic on a number field throw instead. */
  const SENTINEL = { base: true };
  class Base extends HTMLElement {
    constructor() {
      super();
      for (const name of names) if (!name.startsWith('_$')) this[name] = SENTINEL;
    }
  }
  const { el, rendered } = await lifecycle('hf-card', Base);
  assert.equal(rendered, '1', 'CONTROL: it rendered');
  const clobbered = [...names].filter((name) => !name.startsWith('_$') && el[name] !== SENTINEL);
  assert.deepEqual(clobbered, [], `core wrote over the author's fields: ${clobbered.join(', ')}`);
});

test('everything core adds to an element is sigiled — no plain or single-letter name lands on the author\'s object', async () => {
  const before = new Set(Object.getOwnPropertyNames(doc.createElement('div')));
  const { el, rendered } = await lifecycle('hf-plain', HTMLElement);
  assert.equal(rendered, '1', 'CONTROL: it rendered');
  const added = Object.getOwnPropertyNames(el).filter((name) => !before.has(name));
  assert.ok(added.length > 0, 'CONTROL: core added state at all');
  const plain = added.filter((name) => !/^_\$[\w]+\$$/.test(name));
  assert.deepEqual(plain, [], `unsigiled: ${plain.join(', ')} (all added: ${added.join(', ')})`);
});
