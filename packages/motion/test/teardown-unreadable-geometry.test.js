/**
 * `destroy()` completes even when a geometry read throws.
 *
 * The strip is the promise; the re-measure that follows it (so `enable()` can
 * re-style without re-parsing) is a convenience. No engine makes a geometry
 * read throw — detached, hidden, foreign-document and detached-tree elements
 * all answer finite zeros, measured in Chromium — but the `offsetHeight`
 * accessor is configurable, and plugins and test tooling do override it. A
 * throw there turned teardown into a half-teardown: styles cleared, listeners
 * still attached, roots still watched, the instance neither alive nor gone.
 */
import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});

describe('teardown against unreadable geometry', () => {
  it('completes, clears the element, and leaves nothing started', () => {
    document.body.innerHTML =
      '<div id="x" data-vm data-vm-translate-y="0% 0, 100% 90px"></div>';
    const node = document.getElementById('x');
    for (const [k, v] of [['offsetTop', 500], ['offsetHeight', 100], ['offsetParent', null]]) {
      Object.defineProperty(node, k, { value: v, configurable: true });
    }

    const m = createMotion({ respectReducedMotion: false, inertia: 0.1 });
    m.init();
    expect(node.style.transform, 'the control: it was animating').toBeTruthy();

    /** A page override that throws — the shape a broken plugin or a test double produces. */
    Object.defineProperty(node, 'offsetHeight', {
      get() { throw new Error('geometry is unreadable'); },
      configurable: true,
    });

    m.destroy();
    expect(node.style.cssText, 'the strip still happened').toBe('');
    expect(m.elements).toHaveLength(0);
    /** And the instance is genuinely finished: a second destroy is a no-op, init() works again. */
    m.destroy();
    Object.defineProperty(node, 'offsetHeight', { value: 100, configurable: true });
    m.init();
    expect(m.elements, 'usable again after the guarded teardown').toHaveLength(1);
    m.destroy();
  });
});
