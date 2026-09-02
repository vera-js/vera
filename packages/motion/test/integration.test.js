import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMotion, wireMotion } from '../src/index.ts';
import { path } from '../src/path.ts';

wireMotion(path);

/** The real demo page, so this exercises the markup that actually ships. */
const DEMO = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(DEMO)[1].replace(/<script[\s\S]*?<\/script>/gi, '');

let raf;

beforeEach(() => {
  document.body.innerHTML = body;
  /** Deterministic frames. */
  raf = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { raf.push(fn); return raf.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const flush = () => { const b = raf; raf = []; b.forEach((fn) => fn(performance.now())); };

describe('the demo page end to end', () => {
  it('parses every animated element without throwing', () => {
    const animation = createMotion({ respectReducedMotion: false });
    expect(() => animation.init()).not.toThrow();
    expect(animation.elements.length).toBeGreaterThan(0);
    animation.destroy();
  });

  it('reports no rejected values — the migrated markup is fully valid', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const rejected = animation.elements.flatMap((e) => e.parsed.rejected);
    expect(rejected).toEqual([]);
    animation.destroy();
  });

  it('writes a transform to elements that animate one', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const withTransform = animation.elements.filter((e) => e.plan.transform.length);
    expect(withTransform.length).toBeGreaterThan(0);
    expect(withTransform[0].node.style.transform).toMatch(/\w+\(/);
    animation.destroy();
  });

  it('composes transform functions in schema order, not attribute order', () => {
    document.body.innerHTML = `<div data-vera-motion
      data-vera-motion-scale="2" data-vera-motion-rotate="45deg" data-vera-motion-translate-y="10px"></div>`;
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const style = document.querySelector('[data-vera-motion]').style.transform;
    expect(style.indexOf('translateY')).toBeLessThan(style.indexOf('rotate'));
    expect(style.indexOf('rotate')).toBeLessThan(style.indexOf('scale'));
    animation.destroy();
  });

  /** End to end: computed AND applied, which is where it broke. */
  it('applies the transition to the DOM, not just the element object', async () => {
    const animation = createMotion({ respectReducedMotion: false, inertia: 1 });
    animation.init();
    flush();
    const withTransition = animation.elements.filter((e) => e.transition);
    expect(withTransition.length).toBeGreaterThan(0);
    for (const e of withTransition) {
      expect(e.node.style.transition, e.node.className).toBe(e.transition);
    }
    animation.destroy();
  });

  it('the transition survives a re-measure', () => {
    const animation = createMotion({ respectReducedMotion: false, inertia: 1 });
    animation.init();
    flush();
    const e = animation.elements.find((x) => x.transition);
    expect(e.node.style.transition).toBe(e.transition);

    animation.refresh();
    expect(e.node.style.transition).toBe(e.transition);
    animation.destroy();
  });

  it('degrades with a warning when scrollElement matches nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const animation = createMotion({ respectReducedMotion: false, scrollElement: '.nope' });
    expect(() => animation.init()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(animation.elements.length).toBeGreaterThan(0);
    animation.destroy();
    warn.mockRestore();
  });

  it('degrades with a warning when scrollElement is not valid CSS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const animation = createMotion({ respectReducedMotion: false, scrollElement: 'div[' });
    expect(() => animation.init()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    animation.destroy();
    warn.mockRestore();
  });

  it('leaves the DOM clean after destroy', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    animation.destroy();
    for (const node of document.querySelectorAll('[data-vera-motion]')) {
      expect(node.style.transform).toBe('');
      expect(node.style.filter).toBe('');
    }
  });

  it('animates nothing when the user prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();

    expect(animation.reducedMotion).toBe(true);
    expect(animation.enabled).toBe(false);
    for (const node of document.querySelectorAll('[data-vera-motion]')) {
      expect(node.style.transform).toBe('');
    }
    animation.destroy();
  });

  it('still parses under reduced motion, so an override needs no re-parse', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();
    expect(animation.elements.length).toBeGreaterThan(0);
    animation.destroy();
  });

  /**
   * The authoring escape hatch: someone who personally prefers reduced motion
   * still has to see the animations they are configuring for visitors.
   */
  it('enable() explicitly overrides reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();
    expect(animation.enabled).toBe(false);

    animation.enable();

    expect(animation.enabled).toBe(true);
    const animated = animation.elements.find((e) => e.plan.transform.length);
    expect(animated.node.style.transform).not.toBe('');
    animation.destroy();
  });

  it('respectReducedMotion: false ignores the preference outright', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    expect(animation.reducedMotion).toBe(false);
    expect(animation.enabled).toBe(true);
    animation.destroy();
  });
});

/** The GUI-editor requirement. */
describe('mutations cost the mutation, not the page', () => {
  /**
   * The handlers used `findIndex` and `includes` over the whole element list
   * once per changed node, and then called `start()` — which copies every
   * element to re-apply transitions and runs a full pass. In an editor, where
   * mutations actually come from, that is the whole page per keystroke.
   */
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    flush();
  };

  it('adopts an element added after init', async () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const before = animation.elements.length;

    const node = document.createElement('div');
    node.setAttribute('data-vera-motion', '');
    node.setAttribute('data-vera-motion-opacity', '0% 0, 100% 1');
    document.body.appendChild(node);
    await settle();

    expect(animation.elements.length).toBe(before + 1);
    /** The new one is painted; it must not be left unstyled until the next scroll. */
    expect(animation.elements.at(-1).node).toBe(node);
    animation.destroy();
  });

  it('leaves untouched elements alone when one element changes', async () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    flush();

    const others = animation.elements.slice(1);
    const snapshot = others.map((e) => e.lastTransform);
    /** Its own attributes changed, so this one is re-parsed and re-adopted. */
    animation.elements[0].node.setAttribute('data-vera-motion-opacity', '0% 0, 50% 1');
    await settle();

    for (let i = 0; i < others.length; i++) {
      expect(others[i].lastTransform).toBe(snapshot[i]);
    }
    animation.destroy();
  });

  it('does not leave a stale entry when an element is re-parsed', async () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const node = animation.elements[0].node;
    const before = animation.elements.length;

    node.setAttribute('data-vera-motion-opacity', '0% 0, 50% 1');
    await settle();
    node.setAttribute('data-vera-motion-opacity', '0% 0, 60% 1');
    await settle();

    expect(animation.elements.length).toBe(before);
    expect(animation.elements.filter((e) => e.node === node)).toHaveLength(1);
    animation.destroy();
  });

  it('drops an element removed from the document', async () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const node = animation.elements[0].node;
    const before = animation.elements.length;

    node.remove();
    await settle();

    expect(animation.elements.length).toBe(before - 1);
    expect(animation.elements.some((e) => e.node === node)).toBe(false);
    animation.destroy();
  });
});

describe('disableOnTouch', () => {
  /**
   * `(pointer: coarse)` asks about the primary input device. The old
   * `isTouchScreen` asked whether the browser understood touch events, which a
   * touchscreen laptop with a trackpad also answers yes to — and nothing ever
   * called it.
   */
  const pointerQuery = (coarse) => {
    const listeners = new Set();
    const q = {
      matches: coarse,
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn),
    };
    q.fire = (next) => { q.matches = next; for (const fn of listeners) fn({ matches: next }); };
    q.listenerCount = () => listeners.size;
    return q;
  };
  const stub = (coarse) => {
    const q = pointerQuery(coarse);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query.includes('pointer') ? q : { matches: false, addEventListener() {}, removeEventListener() {} });
    return q;
  };

  it('is off by default, so a phone still animates', () => {
    stub(true);
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.touchDisabled).toBe(false);
    expect(a.enabled).toBe(true);
    a.destroy();
  });

  it('leaves content un-animated when the primary input is coarse', () => {
    stub(true);
    const a = createMotion({ respectReducedMotion: false, disableOnTouch: true });
    a.init();
    flush();
    expect(a.touchDisabled).toBe(true);
    expect(a.enabled).toBe(false);
    for (const node of document.querySelectorAll('[data-vera-motion]')) {
      expect(node.style.transform).toBe('');
    }
    /** Still parsed, so enable() can override without re-parsing. */
    expect(a.elements.length).toBeGreaterThan(0);
    a.destroy();
  });

  it('starts animating when a trackpad arrives mid-session', () => {
    const q = stub(true);
    const a = createMotion({ respectReducedMotion: false, disableOnTouch: true });
    a.init();
    expect(a.enabled).toBe(false);

    q.fire(false);
    flush();
    expect(a.touchDisabled).toBe(false);
    expect(a.enabled).toBe(true);
    a.destroy();
  });

  it('removes its listener on destroy', () => {
    const q = stub(false);
    const a = createMotion({ respectReducedMotion: false, disableOnTouch: true });
    a.init();
    expect(q.listenerCount()).toBe(1);
    a.destroy();
    expect(q.listenerCount()).toBe(0);
  });
});

describe('reduced motion is watched, not sampled', () => {
  /**
   * Both macOS and Windows expose the preference as a live toggle, so reading
   * it once at init honours it only for people who set it before they arrived.
   */
  const liveQuery = (matches) => {
    const listeners = new Set();
    const query = {
      matches,
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn),
    };
    query.fire = (next) => {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    };
    query.listenerCount = () => listeners.size;
    return query;
  };

  it('stops animating when the visitor turns reduced motion on', () => {
    const query = liveQuery(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();
    flush();
    expect(animation.enabled).toBe(true);
    const node = animation.elements[0].node;
    expect(node.style.transform === '' && node.style.filter === '').toBe(false);

    query.fire(true);
    expect(animation.reducedMotion).toBe(true);
    expect(animation.enabled).toBe(false);
    /** Natural state, not frozen mid-transform. */
    expect(node.style.transform).toBe('');
    expect(node.style.filter).toBe('');
    animation.destroy();
  });

  it('resumes when the visitor turns it back off', () => {
    const query = liveQuery(true);
    vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();
    expect(animation.enabled).toBe(false);

    query.fire(false);
    flush();
    expect(animation.reducedMotion).toBe(false);
    expect(animation.enabled).toBe(true);
    animation.destroy();
  });

  it('does not watch when the instance was told not to respect it', () => {
    const query = liveQuery(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    expect(query.listenerCount()).toBe(0);
    animation.destroy();
  });

  it('removes the listener on destroy', () => {
    const query = liveQuery(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    const animation = createMotion({ respectReducedMotion: true });
    animation.init();
    expect(query.listenerCount()).toBe(1);
    animation.destroy();
    expect(query.listenerCount()).toBe(0);
  });
});

describe('re-measure on resize', () => {
  /**
   * Found in a real browser, not here: a `ResizeObserver` on the document
   * element does not fire for a viewport that changes only in height, because
   * the root element's box is the *content* height. Measured in Chromium — a
   * height-only change fires `resize` once and the observer not at all. That
   * was harmless until keyframe positions gained units that resolve against
   * `element.size + win.size`, which a shorter viewport changes.
   */
  it('re-measures on a plain resize event, with no ResizeObserver involved', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();

    const element = animation.elements[0];
    element.start = -1;

    /** resizeListener defers by 100ms, then the re-measure coalesces into a frame. */
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    flush();

    expect(element.start).not.toBe(-1);
    animation.destroy();
  });
});

describe('the enable/disable toggle', () => {
  it('starts enabled after init', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    expect(animation.enabled).toBe(true);
    animation.destroy();
  });

  it('returns elements to their natural state when disabled, not frozen mid-transform', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const node = animation.elements[0].node;
    expect(node.style.transform).not.toBe('');

    animation.disable();
    expect(animation.enabled).toBe(false);
    expect(node.style.transform).toBe('');
    animation.destroy();
  });

  it('re-applies on enable without re-parsing', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    const before = animation.elements;

    animation.disable();
    animation.enable();

    expect(animation.enabled).toBe(true);
    /** Same element objects — parsed state was kept, so the toggle is instant. */
    expect(animation.elements).toBe(before);
    expect(animation.elements[0].node.style.transform).not.toBe('');
    animation.destroy();
  });

  it('setEnabled drives both directions', () => {
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    animation.setEnabled(false);
    expect(animation.enabled).toBe(false);
    animation.setEnabled(true);
    expect(animation.enabled).toBe(true);
    animation.destroy();
  });
});

describe('shadow DOM', () => {
  it('animates inside a registered shadow root', () => {
    document.body.innerHTML = '<my-widget></my-widget>';
    const host = document.querySelector('my-widget');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p data-vera-motion="fade-up">hello</p>';

    const animation = createMotion({ respectReducedMotion: false, root: shadow });
    animation.init();

    expect(animation.elements).toHaveLength(1);
    expect(shadow.querySelector('p').style.transform).toMatch(/translateY/);
    animation.destroy();
  });

  it('observe() adopts a shadow root discovered after init', async () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0"></div><my-widget></my-widget>';
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    expect(animation.elements).toHaveLength(1);

    const shadow = document.querySelector('my-widget').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p data-vera-motion="fade">late</p>';
    animation.observe(shadow);
    await flush();

    expect(animation.elements).toHaveLength(2);
    animation.destroy();
  });

  it('unobserve() removes a root and resets its elements', () => {
    document.body.innerHTML = '<my-widget></my-widget>';
    const shadow = document.querySelector('my-widget').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p data-vera-motion="fade">bye</p>';

    const animation = createMotion({ respectReducedMotion: false, root: shadow });
    animation.init();
    const node = shadow.querySelector('p');
    expect(node.style.filter).not.toBe('');

    animation.unobserve(shadow);
    expect(animation.elements).toHaveLength(0);
    expect(node.style.filter).toBe('');
    animation.destroy();
  });
});
