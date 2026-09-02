import { describe, it } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { createSplit } from '../src/modules/split.ts';

describe('accessibility contract', () => {
  /** Principle #2: never ship an animation that hides content when motion is off. */
  it('reduced motion never leaves content hidden or displaced', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    document.body.innerHTML = `
      <div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>
      <div id="b" data-vera-motion data-vera-motion-translate-y="0% 400px, 100% 0px"></div>
      <div id="c" data-vera-motion data-vera-motion-scale="0% 0, 100% 1"></div>`;
    const a = createMotion({ respectReducedMotion: true });
    a.init();
    for (const node of document.querySelectorAll('[data-vera-motion]')) {
      expect(node.style.opacity, node.id).not.toBe('0');
      expect(node.style.transform, node.id).toBe('');
      expect(node.style.filter, node.id).toBe('');
    }
    a.destroy();
    vi.restoreAllMocks();
  });

  it('a split keeps the text readable through a hidden copy and hides only the pieces', () => {
    document.body.innerHTML = '<h1 data-vera-motion data-vera-motion-opacity="0">Hello there</h1>';
    const node = document.querySelector('h1');
    createSplit(node, 'chars');
    /** No aria-label: ARIA 1.2 prohibits naming these roles; real text needs no naming rule. */
    expect(node.hasAttribute('aria-label')).toBe(false);
    const copy = node.querySelector(':scope > span:not([aria-hidden])');
    expect(copy.textContent).toBe('Hello there');
    expect([...node.querySelectorAll('span[aria-hidden]')].every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('a split restores the element exactly, aria included', () => {
    document.body.innerHTML = '<h1 data-vera-motion data-vera-motion-opacity="0">Hello there</h1>';
    const node = document.querySelector('h1');
    createSplit(node, 'chars').destroy();
    expect(node.hasAttribute('aria-label')).toBe(false);
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
  });

  it('disable() returns content to its natural state, not a frozen frame', () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    a.disable();
    const node = document.querySelector('div');
    expect(node.style.filter).toBe('');
    expect(node.style.transform).toBe('');
    a.destroy();
  });

  it('pieces created by a split are not focusable or read twice', () => {
    document.body.innerHTML = '<h1 data-vera-motion data-vera-motion-opacity="0">Hi there</h1>';
    const node = document.querySelector('h1');
    createSplit(node, 'words');
    for (const span of node.querySelectorAll('span[aria-hidden]')) {
      expect(span.hasAttribute('tabindex')).toBe(false);
      expect(span.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
