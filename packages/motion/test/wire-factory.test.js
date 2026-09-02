import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { sequence } from '../src/sequence.ts';

describe('a factory module wired both ways', () => {
  it('accepts the bare factory', () => {
    wireMotion(sequence);
    document.body.innerHTML =
      '<canvas data-vera-motion data-vera-motion-frame="0% 0, 100% 9" ' +
      'data-vera-motion-frame-url="/s/" data-vera-motion-frame-count="10"></canvas>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    /**
     * `parsed.rejected`, not `m.rejected`, and the difference is the point of
     * this test. What it asserts is that wiring the bare factory made `frame`
     * and the `frame-*` settings **recognised** — nothing refused at parse
     * time. It used to read the merged list, and passed because a module's
     * refusal could not reach it: happy-dom's canvas has no 2D context, so
     * this element has been refused at draw time for as long as the test has
     * existed, and the assertion said "nothing was rejected".
     */
    expect(m.elements[0].parsed.rejected).toEqual([]);
    /** Resolved to absolute at parse time, so matched by shape rather than by string. */
    expect(m.elements[0].parsed.settings['frame-url']).toMatch(/\/s\/$/);
    m.destroy();
  });

  it('and the configured form', () => {
    wireMotion(sequence({ allowedOrigins: ['https://cdn.test'] }));
    document.body.innerHTML =
      '<canvas data-vera-motion data-vera-motion-frame="0% 0, 100% 9" ' +
      'data-vera-motion-frame-url="https://cdn.test/s/" data-vera-motion-frame-count="10"></canvas>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.elements[0].parsed.settings['frame-url']).toBe('https://cdn.test/s/');
    m.destroy();
  });
});
