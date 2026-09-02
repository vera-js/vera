import { describe, it } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * Its own file on purpose: the "already warned" flag is module scope, and
 * every other easing test wires the module. Vitest gives each file a fresh
 * module registry, which is the only way to observe the unwired state.
 */
describe('a non-linear ease with the module not wired', () => {
  it('warns once, names the import, and keeps animating', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML =
      '<div id="a" data-vm data-vm-ease="ease-in-out" data-vm-opacity="0% 0, 100% 1"></div>' +
      '<div id="b" data-vm data-vm-ease="ease-out" data-vm-opacity="0% 0, 100% 1"></div>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    /** One line for the page, not one per element. */
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain('@verajs/motion/easings');
    expect(message).toContain('wireMotion');
    expect(message).toContain('ease-in-out');

    /** Still animating — on a straight line, which is the documented fallback. */
    expect(document.getElementById('a').style.filter).toBeTruthy();
    m.destroy();
    warn.mockRestore();
  });
});
