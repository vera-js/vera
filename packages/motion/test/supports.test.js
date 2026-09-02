import { describe, it, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import * as supports from '../src/modules/supports.ts';

afterEach(() => vi.unstubAllGlobals());

describe('supports', () => {
  it('reports true in a capable environment', () => {
    expect(supports.supports()).toBe(true);
  });

  it('detects MutationObserver', () => {
    expect(supports.supportsMutationObserver()).toBe(true);
  });

  it('reads prefers-reduced-motion from matchMedia', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    expect(supports.prefersReducedMotion()).toBe(true);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false });
    expect(supports.prefersReducedMotion()).toBe(false);
  });

  it('is false rather than throwing where matchMedia is absent', () => {
    const original = window.matchMedia;
    delete window.matchMedia;
    expect(supports.prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});
