/**
 * **What a preset name says when no pack is wired.**
 *
 * Its own file because wiring is per process: `directives-presets.test.mjs` wires the pack and
 * cannot also assert the absence. The two together are the whole claim.
 *
 * The rule under test is the one already written for unknown KEYS — never report "this library has
 * no such thing" when the thing belongs to a module nobody wired. `fade-up` is real and correctly
 * spelled; telling its author to check the spelling sends them hunting in the one place where
 * nothing is wrong. With the table now living in a pack, that failure mode became reachable for
 * preset NAMES too, and this is the guard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, settled, rejections } = await load('directives');

/** Motion, and deliberately NOT presets. That absence is the fixture. */
wireDirectives([motion]);

test('a real preset name with no pack wired names the WIRING, never the spelling', async () => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = `<div data-vd-motion="fade-up"></div>`;
  dom.window.document.body.appendChild(host);
  await settled();

  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.length > 0, 'the control: the name was refused at all, rather than silently ignored');
  assert.ok(reasons.some((r) => r.code === 'motion-presets-unwired'),
    'its own code, distinct from an unknown name — a tool has to tell these apart');
  assert.ok(!reasons.some((r) => r.code === 'motion-preset-unknown'),
    'and NOT the unknown-name code: fade-up is spelled correctly and nothing was looked up');

  if (!isProduction) {
    assert.match(reasons.find((r) => r.code === 'motion-presets-unwired').fix ?? '', /wireDirectives/,
      'the fix is the line to write');
  }
});

test('an element with a preset name and nothing else animates nothing, quietly', async () => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = `<div data-vd-motion="fade-up"></div>`;
  dom.window.document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(host.querySelector('div').getAttribute('style'), null,
    'nothing half-applied: an unresolvable preset leaves the element exactly as authored');
});
