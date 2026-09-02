import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

describe('instance.rejected reaches the caller', () => {
  it('reports an element whose every animation failed', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-grayscale="0% 0%, 100% 100%"></div>' +
      '<div id="b" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1" data-vera-motion-grayscale="0% 0%, 100% 100%"></div>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    const ids = m.rejected.map((r) => r.node.id).sort();
    expect(ids).toEqual(['a', 'b']);
    m.destroy();
    expect(m.rejected).toHaveLength(0);
  });
});
