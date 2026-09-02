import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

describe('attributes the runtime cannot understand', () => {
  /**
   * A misspelled property, an unknown setting, and a breakpoint alias the
   * instance never registered all used to vanish without a trace — on the very
   * channel the README tells an agent to check when nothing animates.
   */
  it('reports them instead of ignoring them', () => {
    document.body.innerHTML = `
      <div data-vm
           data-vm-translate-y-[0-3000]="0% 200px, 100% 0px"
           data-vm-nonsense="whatever"
           data-vm-tranlsate-y="0% 0px, 100% 40px"
           data-vm-opacity-phone="0% 0, 100% 1"
           data-vm-opacity="0% 0, 100% 1"></div>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    const reported = m.rejected.flatMap((r) => r.rejected);
    for (const name of ['translate-y-[0-3000]', 'nonsense', 'tranlsate-y', 'opacity-phone']) {
      expect(reported.some((r) => r.includes(name)), name).toBe(true);
    }
    m.destroy();
  });
});
