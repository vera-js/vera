import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, EVENTS } from '../src/index.ts';

const place = (node, top = 0) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const MARKUP =
  '<div data-vm data-vm-run-once data-vm-translate-y="0% 0px, 100% 120px"></div>';

beforeEach(() => { document.body.innerHTML = ''; });

describe('run-once across a disable/enable toggle', () => {
  /**
   * The latch that stops a finished run-once element costing anything per
   * frame also made it invisible to `start()` — so `disable()` cleared its
   * styles and `enable()` left it blank, having already played.
   */
  it('comes back in its end state', () => {
    document.body.innerHTML = MARKUP;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
    m.refresh();
    const latched = node.style.transform;
    expect(latched).toBe('translateY(120px)');

    m.disable();
    expect(node.style.transform).toBe('');
    m.enable();
    expect(node.style.transform).toBe(latched);
    m.destroy();
  });

  /** Forcing that repaint must not announce a second completion. */
  it('fires complete exactly once, however many times it is repainted', () => {
    document.body.innerHTML = MARKUP;
    const node = document.body.firstElementChild;
    place(node);

    let completes = 0;
    const count = () => { completes++; };
    document.addEventListener(EVENTS.complete, count);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
    m.refresh();
    expect(completes).toBe(1);

    for (let i = 0; i < 3; i++) { m.disable(); m.enable(); }
    m.refresh();
    m.refresh();
    expect(completes).toBe(1);

    document.removeEventListener(EVENTS.complete, count);
    m.destroy();
  });
});
