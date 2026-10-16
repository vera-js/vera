/**
 * **The hook reading right now is ONE cell, saved and restored by every run** (work queue 6, A14a, 2026-10-16). Each
 * place that starts a run — a hook's run, `untracked`, `init`'s setup window — saves the cell, sets it and restores it
 * in its `finally`, so nesting lives on the call stack. Three levels deep, with a throw in the middle (vera-5a): the
 * render, a hook it runs, and an `untrack` read inside that. Each level is checked by what a WRITE re-runs — never by
 * reading the cell, which production mangles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key] ?? globalThis[key];
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('render → a hook it runs → an untrack read, with a throw in the middle: every level reads as its own', async () => {
  const reported = [];
  const handler = (error) => reported.push(error);
  core.wire({ on: 'error', fn: handler, priority: 78 });
  try {
    const a = core.createStore({ before: 0, after: 0 });
    const b = core.createStore({ tracked: 0, untracked: 0 });
    let renders = 0;
    let inner = 0;
    customElements.define('tc-x', class extends HTMLElement {
      connectedCallback() {
        core.init(this, () => {
          /** The middle level: a raw hook the render runs inside itself — it reads, reads untracked, then throws. */
          const middle = core.createHook({ element: {}, priority: 1, callback: () => {
            inner++;
            void b.tracked;
            core.untrack(() => b.untracked);
            throw new Error('the middle level failed');
          } });
          return () => {
            renders++;
            void a.before;
            middle(undefined, true);
            /** Read AFTER the middle level threw: it must subscribe the RENDER, so the cell was restored. */
            return core.html`<p>${a.after}</p>`;
          };
        });
      }
    });
    const el = doc.createElement('tc-x');
    doc.body.append(el);
    await tick();
    assert.equal(renders, 1, 'CONTROL: the render ran');
    assert.ok(reported.length >= 1 && reported.every((e) => e.message === 'the middle level failed'), 'CONTROL: the middle level threw, and it was reported');

    const r0 = renders;
    a.after = 1;
    await tick();
    assert.equal(renders, r0 + 1, 'a key read AFTER the throw subscribed the render — the outer cell was restored');
    assert.equal(el.textContent, '1');

    const r1 = renders, i1 = inner;
    b.tracked = 1;
    await tick();
    assert.equal(inner, i1 + 1, 'the middle level heard its own tracked read');
    assert.equal(renders, r1, 'and the render did not — that read was the middle level’s, not the render’s');

    const r2 = renders, i2 = inner;
    b.untracked = 1;
    await tick();
    assert.equal(inner, i2, 'the untrack read subscribed nothing');
    assert.equal(renders, r2, 'not even the render around it');
    el.remove();
  } finally {
    const chain = core.inserts.get('error');
    const at = chain.indexOf(handler);
    chain.splice(at, 1);
    chain._p.splice(at, 1);
  }
});
