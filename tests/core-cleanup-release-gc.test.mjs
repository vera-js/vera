/**
 * **A removed component holds on to none of its hooks' callbacks or cleanups — measured by collection, in an isolated
 * child process** (work queue 5, step 3; Brian, 2026-10-11: "make sure we're not holding on to references"). Each hook
 * keeps its latest cleanup on itself; removal walks the hooks, runs each cleanup and CLEARS it, and teardown drops the
 * element's hook list. Nothing observable follows a dropped callback, so the pin is retention, and gc is the instrument
 * — alone in its own process (`--expose-gc`), as `core-subscription-sweep` does (CLAUDE.md allows exactly this shape).
 *
 * A hook can be held from outside in two ways, one row each:
 * - its ELEMENT, kept alive here on purpose (code holding a removed element: an exit animation, a test) — so the
 *   callback and cleanup can die only because teardown dropped the hook list;
 * - the function `useHook` returned, kept by the caller — so its cleanup can die only because removal cleared it.
 * Controls: the same shapes on a component still connected stay ALIVE; a dropped plain object dies (or gc never ran).
 * Each marker is made in its own function scope, so a closure sharing a V8 context cannot keep it alive by accident.
 * No slots, nothing a MutationObserver watches: jsdom holds observed nodes strongly and would fake a leak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const child = () => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const core = await load('core');
  const { renderer } = await load('renderer');
  core.wire([renderer]);
  const refs = new Map();
  const mark = (name) => { const marker = { name }; refs.set(name, new WeakRef(marker)); return marker; };
  /** An effect whose callback holds one marker and whose cleanup holds another — each in its own scope. */
  const effectFor = (name) => {
    const held = mark(name + ':effect');
    return () => {
      void held;
      const captured = mark(name + ':cleanup');
      return () => { void captured; };
    };
  };
  /** The functions useHook returned, kept as a caller would keep them. */
  const kept = new Map();
  customElements.define('cr-x', class extends HTMLElement { connectedCallback() {
    const name = this.dataset.name;
    core.init(this, () => {
      core.useEffect(effectFor(name));
      kept.set(name, core.useHook(effectFor(name + ':kept'), 65));
      return () => core.html\`<p>x</p>\`;
    });
  } });
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const dropped = new WeakRef({ plain: true });
  const make = (name) => { const el = document.createElement('cr-x'); el.dataset.name = name; return el; };
  const els = { removed: make('removed'), live: make('live') };
  document.body.append(els.removed, els.live);
  await settle();
  els.removed.remove();
  await settle();
  await gc();
  const alive = (name) => refs.get(name)?.deref() !== undefined;
  process.stdout.write(JSON.stringify({
    ran: refs.size === 8,
    held: els.removed.localName === 'cr-x' && typeof kept.get('removed') === 'function',
    removedEffect: alive('removed:effect'),
    removedCleanup: alive('removed:cleanup'),
    keptCleanup: alive('removed:kept:cleanup'),
    liveEffect: alive('live:effect'),
    liveCleanup: alive('live:cleanup'),
    liveKeptCleanup: alive('live:kept:cleanup'),
    droppedDied: dropped.deref() === undefined,
  }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

test("a removed component's hook callbacks and cleanups are released — its element and a kept hook held alive", () => {
  const r = child();
  assert.equal(r.ran, true, 'CONTROL: both components made every marker (two hooks each, a callback and a cleanup)');
  assert.equal(r.droppedDied, true, 'CONTROL: gc ran — a dropped plain object died');
  assert.equal(r.held, true, 'CONTROL: the removed element and its kept hook were held alive');
  assert.deepEqual({ effect: r.liveEffect, cleanup: r.liveCleanup, kept: r.liveKeptCleanup }, { effect: true, cleanup: true, kept: true },
    'CONTROL: a connected component keeps its callbacks and current cleanups');
  assert.deepEqual({ effect: r.removedEffect, cleanup: r.removedCleanup, kept: r.keptCleanup }, { effect: false, cleanup: false, kept: false },
    'released: the hook list was dropped, and the kept hook no longer holds its spent cleanup');
});
