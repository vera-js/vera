import { describe, it } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';
import { parseElement } from '../src/modules/parse.ts';
import { createSplit } from '../src/modules/split.ts';

wireMotion([split, sequence]);

const ctx = { origin: 'https://x.test/' };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('feature interactions', () => {
  it('split + when: the pieces inherit the selector driver', () => {
    document.body.innerHTML =
      '<p data-vera-motion data-vera-motion-split="chars" data-vera-motion-when=".open" data-vera-motion-opacity="0% 0, 100% 1">ab</p>';
    const node = document.querySelector('p');
    createSplit(node, 'chars');
    const piece = node.querySelector('[data-vera-motion]');
    expect(piece.getAttribute('data-vera-motion-when')).toBe('.open');
    expect(node.hasAttribute('data-vera-motion-when')).toBe(false);
  });

  it('split + stagger + when together still cascade', () => {
    document.body.innerHTML = `<p data-vera-motion data-vera-motion-split="chars" data-vera-motion-stagger="5"
      data-vera-motion-when=".open" data-vera-motion-opacity="0% 0, 100% 1">abc</p>`;
    const node = document.querySelector('p');
    createSplit(node, 'chars');
    const parsed = [...node.querySelectorAll('[data-vera-motion]')].map((n) => parseElement(n, ctx));
    expect(parsed[0].stagger).toBeUndefined();
    expect(parsed[2].stagger).toEqual({ position: 10, positionUnit: '%' });
    expect(parsed[2].settings.when).toBe('.open');
  });

  it('frame on a non-canvas warns once and does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-frame="0% 0, 100% 10" data-vera-motion-frame-url="/s/" data-vera-motion-frame-count="10"></div>';
    const a = createMotion({ respectReducedMotion: false });
    expect(() => a.init()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    a.destroy();
    warn.mockRestore();
  });

  it('a band on a property that also has a preset resolves the explicit one', () => {
    document.body.innerHTML =
      '<div data-vera-motion="fade-up" data-vera-motion-opacity="0% 0, 100% 1; [0-500]: 100% 0.5"></div>';
    const parsed = parseElement(document.querySelector('div'), ctx);
    const opacity = parsed.animations.find((x) => x.property.attribute === 'opacity');
    expect(opacity.bands).toHaveLength(1);
  });

  it('refresh() drives selector elements, which the observer is not always there to do', () => {
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-when=".open" data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false, observeMutations: false });
    a.init();
    const node = document.querySelector('div');
    expect(node.style.filter).toBe('opacity(0)');
    node.classList.add('open');
    a.refresh();
    expect(node.style.filter).toBe('opacity(1)');
    a.destroy();
  });

  /**
   * `resetElement` used to clear `runOnceRan`, so any resize replayed every
   * run-once element that was not still past its end at that instant — and
   * un-latched selector-driven ones outright, since nothing re-latches those
   * without a fresh match. "Once, ever" is the documented contract.
   */
  it('a re-measure does not replay a latched run-once', () => {
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-run-once data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const e = a.elements[0];
    e.runOnceRan = true;
    a.refresh();
    expect(e.runOnceRan).toBe(true);
    a.destroy();
  });

  it('run-once plus a selector driver latches and stays latched', () => {
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-when=".open" data-vera-motion-run-once data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const node = document.querySelector('div');
    node.classList.add('open');
    a.refresh();
    const e = a.elements[0];
    expect(e.runOnceRan).toBe(true);
    node.classList.remove('open');
    a.refresh();
    expect(e.runOnceRan).toBe(true);
    a.destroy();
  });

  it('two instances on one page do not fight over an element', async () => {
    document.body.innerHTML = '<div id="s" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    const b = createMotion({ respectReducedMotion: false });
    a.init();
    b.init();
    await settle();
    expect(a.elements).toHaveLength(1);
    expect(b.elements).toHaveLength(1);
    a.destroy();
    /** b must still work after a's teardown cleared shared styles. */
    b.refresh();
    expect(b.elements).toHaveLength(1);
    b.destroy();
  });

  it('destroy is idempotent and init after destroy works', () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    a.destroy();
    expect(() => a.destroy()).not.toThrow();
    a.init();
    expect(a.elements).toHaveLength(1);
    a.destroy();
  });
});
