import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, EVENTS } from '../src/index.ts';
import { NAMESPACE } from '../src/modules/schema.ts';
import { parseElement } from '../src/modules/parse.ts';
import { createRuntimeElement, updateElement, updateStateElement } from '../src/modules/runtime.ts';

const ctx = { origin: 'https://example.com/' };
const S = {
  scrollDirection: 'vertical', inertia: 0.1, inertiaEase: 'linear', ease: 'linear'
};
const win = (start = 0) => ({ start, end: start + 900, size: 900, width: 1400, height: 900 });

const build = (html, settings = S) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 1000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return createRuntimeElement(parseElement(node, ctx), settings);
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('event names', () => {
  /** Derived, never written out, so `data-vera-motion-*` and `vera-motion:*` cannot drift. */
  it('are built from the same namespace as the attributes', () => {
    expect(EVENTS.active).toBe(`${NAMESPACE}:active`);
    expect(EVENTS.idle).toBe(`${NAMESPACE}:idle`);
    expect(EVENTS.complete).toBe(`${NAMESPACE}:complete`);
  });

  /**
   * Not `enter`/`leave`. The tracker's margin reaches half a viewport past the
   * viewport, so an element goes active well before it is visible — naming
   * these for visibility would make them lie to anyone hanging analytics off
   * them.
   */
  it('avoid visibility words, because they are not about visibility', () => {
    const names = Object.values(EVENTS).join(' ');
    expect(names).not.toMatch(/enter|leave|visible|seen|view/);
  });
});

describe('vera-motion:complete', () => {
  it('fires once when a run-once element latches', () => {
    const e = build(`<div data-vera-motion data-vera-motion-run-once
      data-vera-motion-opacity="0% 0, 100% 1"></div>`);
    const seen = vi.fn();
    e.node.addEventListener(EVENTS.complete, seen);

    updateElement(e, win(0), S);
    expect(seen).not.toHaveBeenCalled();

    updateElement(e, win(2000), S);   // past the end of its range
    expect(seen).toHaveBeenCalledTimes(1);

    updateElement(e, win(2400), S);   // latched; must not fire again
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('carries the timeline position it fired at', () => {
    const e = build('<div data-vera-motion data-vera-motion-run-once data-vera-motion-opacity="0% 0, 100% 1"></div>');
    let detail = null;
    e.node.addEventListener(EVENTS.complete, (event) => { detail = event.detail; });
    updateElement(e, win(2000), S);
    expect(detail.progress).toBeGreaterThanOrEqual(1);
  });

  it('does not fire for an element that is not run-once', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>');
    const seen = vi.fn();
    e.node.addEventListener(EVENTS.complete, seen);
    updateElement(e, win(2000), S);
    updateElement(e, win(2400), S);
    expect(seen).not.toHaveBeenCalled();
  });

  it('fires for a state-driven run-once element too', () => {
    const e = build(`<div data-vera-motion data-vera-motion-when=".open" data-vera-motion-run-once
      data-vera-motion-opacity="0% 0, 100% 1"></div>`);
    const seen = vi.fn();
    e.node.addEventListener(EVENTS.complete, seen);

    updateStateElement(e, true, S);
    expect(seen).not.toHaveBeenCalled();

    e.node.classList.add('open');
    updateStateElement(e, false, S);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('bubbles, so a page can delegate from the document', () => {
    const e = build('<div data-vera-motion data-vera-motion-run-once data-vera-motion-opacity="0% 0, 100% 1"></div>');
    const seen = vi.fn();
    document.addEventListener(EVENTS.complete, seen);
    updateElement(e, win(2000), S);
    document.removeEventListener(EVENTS.complete, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].target).toBe(e.node);
  });
});

describe('onProgress', () => {
  it('is called with the node and its timeline position each update', () => {
    const onProgress = vi.fn();
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>', { ...S, onProgress });

    updateElement(e, win(1000), { ...S, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    const [node, progress] = onProgress.mock.calls[0];
    expect(node).toBe(e.node);
    expect(progress).toBeCloseTo(e.timelinePosition, 9);
  });

  /** Keyframes may sit outside 0-1, so progress may too. */
  it('reports positions outside 0..1 rather than clamping them', () => {
    const onProgress = vi.fn();
    const settings = { ...S, onProgress };
    const e = build('<div data-vera-motion data-vera-motion-opacity="-50% 0, 150% 1"></div>', settings);
    updateElement(e, win(0), settings);
    expect(onProgress.mock.calls[0][1]).toBeLessThan(0);
  });

  it('is called for state-driven elements as well as scroll-driven ones', () => {
    const onProgress = vi.fn();
    const settings = { ...S, onProgress };
    const e = build(`<div data-vera-motion data-vera-motion-when=".open"
      data-vera-motion-opacity="0% 0, 100% 1"></div>`, settings);
    updateStateElement(e, true, settings);
    expect(onProgress).toHaveBeenCalledWith(e.node, expect.any(Number));
  });

  it('costs nothing when unset', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>');
    expect(() => updateElement(e, win(1000), S)).not.toThrow();
  });
});

describe('the instance dispatches both edges', () => {
  let instances;
  class FakeIO {
    constructor(cb) { this.cb = cb; this.targets = new Set(); instances.push(this); }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    report(target, isIntersecting) { this.cb([{ target, isIntersecting }]); }
  }
  beforeEach(() => { instances = []; vi.stubGlobal('IntersectionObserver', FakeIO); });
  afterEach(() => vi.unstubAllGlobals());

  const page = () => {
    document.body.innerHTML = '<div id="s" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    return document.getElementById('s');
  };

  it('fires vera-motion:idle when an element leaves, and vera-motion:active when it returns', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();

    const seen = [];
    document.addEventListener(EVENTS.active, (e) => seen.push(['active', e.target.id]));
    document.addEventListener(EVENTS.idle, (e) => seen.push(['idle', e.target.id]));

    instances[0].report(node, false);
    instances[0].report(node, true);

    expect(seen).toEqual([['idle', 's'], ['active', 's']]);
    animation.destroy();
  });

  it('carries the settled progress, not the position it is leaving', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();

    let detail = null;
    node.addEventListener(EVENTS.idle, (e) => { detail = e.detail; });
    instances[0].report(node, false);

    expect(detail).not.toBeNull();
    expect(detail.progress).toBeCloseTo(animation.elements[0].timelinePosition, 9);
    animation.destroy();
  });

  /**
   * The pair has to balance across everything that stops the instance, not
   * only across what the tracker reports. `idle` fired for an element the
   * *tracker* stopped watching and never for an instance that stopped
   * animating — so `disable()`, `destroy()` and a reduced-motion preference
   * arriving all left every listener holding an element it believed was still
   * animating. The documented use is "start this video when it arrives", which
   * then never stopped.
   */
  it('fires idle for an active element when the instance is disabled', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    instances[0].report(node, true);

    const seen = [];
    document.addEventListener(EVENTS.idle, () => seen.push('idle'));
    animation.disable();
    document.removeEventListener(EVENTS.idle, () => seen.push('idle'));

    expect(seen).toEqual(['idle']);
    animation.destroy();
  });

  it('and on destroy', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    instances[0].report(node, true);

    const seen = vi.fn();
    document.addEventListener(EVENTS.idle, seen);
    animation.destroy();
    document.removeEventListener(EVENTS.idle, seen);

    expect(seen).toHaveBeenCalledTimes(1);
  });

  /**
   * Only for what was announced. Two ways to get there and both are needed:
   * an element the tracker never reported on at all, and one it reported as
   * *not* active — the second is what tells `announced.add` from
   * `if (active) announced.add`, and without it the mutation that adds every
   * reported element survived.
   */
  it('but not for an element that was never announced active', () => {
    page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();

    const seen = vi.fn();
    document.addEventListener(EVENTS.idle, seen);
    animation.disable();
    document.removeEventListener(EVENTS.idle, seen);

    expect(seen).not.toHaveBeenCalled();
    animation.destroy();
  });

  it('nor for one the tracker reported as idle', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    /** Goes active, then leaves: the pair is already closed. */
    instances[0].report(node, true);
    instances[0].report(node, false);

    const seen = vi.fn();
    document.addEventListener(EVENTS.idle, seen);
    animation.disable();
    document.removeEventListener(EVENTS.idle, seen);

    expect(seen).not.toHaveBeenCalled();
    animation.destroy();
  });

  /**
   * And re-enabling starts a fresh tracker, so every element announces again.
   * Without it the tracker's memory of having already reported means nothing
   * is ever told the element came back, and a page that stopped a video on
   * idle has no signal to start it.
   */
  it('announces again after enable, from a fresh tracker', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    instances[0].report(node, true);
    animation.disable();

    const before = instances.length;
    animation.enable();
    expect(instances.length).toBe(before + 1);

    const seen = [];
    document.addEventListener(EVENTS.active, () => seen.push('active'));
    instances[instances.length - 1].report(node, true);
    document.removeEventListener(EVENTS.active, () => seen.push('active'));
    expect(seen).toEqual(['active']);
    animation.destroy();
  });

  it('stays quiet while the instance is disabled', () => {
    const node = page();
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    animation.disable();

    const seen = vi.fn();
    document.addEventListener(EVENTS.idle, seen);
    instances[0].report(node, false);
    document.removeEventListener(EVENTS.idle, seen);

    expect(seen).not.toHaveBeenCalled();
    animation.destroy();
  });
});
