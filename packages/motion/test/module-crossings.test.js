import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion, parseMeasure } from '../src/index.ts';

const place = (node) => {
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const scrollTo = (m, y) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  m.refresh();
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * The audit enumerated the places this library hands
 * control to somebody else and asks, of each, what a throw does. It said
 * "exactly six" and listed six of nine: a module's `apply`, a property's
 * `parse` and a setting's `parse` were all missing, and all three were
 * unguarded.
 *
 * They are reachable from any third-party module, which the README invites.
 */
describe('a module that throws where the library calls it', () => {
  /**
   * The per-frame one, and the worst. A throw from `apply` left `init()`, and
   * after init it stopped every element *after* the offending one — on every
   * frame, for the life of the page, while the instance reported itself
   * enabled and `rejected` stayed empty.
   */
  it('apply: does not take the rest of the page with it', () => {
    let armed = false;
    wireMotion({
      attribute: 'boom', category: 'text', cssProperty: 'letter-spacing',
      defaultUnit: 'px', units: ['px'], initial: 0,
      apply() { if (armed) throw new Error('apply exploded'); },
    });
    document.body.innerHTML =
      '<div id="a" data-vm data-vm-boom="0% 0px, 100% 50px"></div>' +
      '<div id="b" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const b = document.getElementById('b');
    place(document.getElementById('a'));
    place(b);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    armed = true;

    /** A *changing* value: an unchanged one never reaches `apply` at all. */
    expect(() => scrollTo(m, 5000)).not.toThrow();
    expect(b.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  it('apply: says which property it was, in rejected', () => {
    wireMotion({
      attribute: 'boom2', category: 'text', cssProperty: 'word-spacing',
      defaultUnit: 'px', units: ['px'], initial: 0,
      apply() { throw new Error('apply exploded'); },
    });
    document.body.innerHTML =
      '<div data-vm data-vm-boom2="0% 0px, 100% 50px"></div>';
    place(document.body.firstElementChild);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    scrollTo(m, 5000);
    expect(m.rejected.flatMap((r) => r.rejected).join(' ')).toContain('boom2');
    m.destroy();
  });

  it('apply: does not escape init() either', () => {
    wireMotion({
      attribute: 'boom3', category: 'text', cssProperty: 'text-indent',
      defaultUnit: 'px', units: ['px'], initial: 0,
      apply() { throw new Error('apply exploded'); },
    });
    document.body.innerHTML =
      '<div data-vm data-vm-boom3="0% 0px, 100% 50px"></div>';
    place(document.body.firstElementChild);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    expect(() => m.init()).not.toThrow();
    m.destroy();
  });

  /**
   * A throw from a property's `parse` took `init()` down with **zero**
   * elements adopted — the whole page unanimated over one bad value in one
   * module.
   */
  it('parse: refuses the value rather than the page', () => {
    wireMotion({
      attribute: 'boom4', category: 'text', cssProperty: 'text-indent',
      defaultUnit: '', units: [''], initial: 0,
      parse() { throw new Error('parse exploded'); },
    });
    document.body.innerHTML =
      '<div data-vm data-vm-boom4="0% x, 100% y"></div>' +
      '<div id="b" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const b = document.getElementById('b');
    place(b);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    expect(() => m.init()).not.toThrow();
    scrollTo(m, 5000);
    /** The other element is animating, which is the whole point. */
    expect(b.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  /**
   * `parseMeasure` is exported for a GUI to validate a control's input with,
   * so a throwing `parse` reached the editor as well as the page.
   */
  it('parseMeasure: answers null, the same as any unusable value', () => {
    expect(parseMeasure('anything', {
      attribute: 'boom5', category: 'text', defaultUnit: '', units: [''], initial: 0,
      parse() { throw new Error('parse exploded'); },
    })).toBeNull();
  });

  /** And a setting's own parser, which `@verajs/motion/sequence` uses for urls. */
  it('a setting parse: refuses that setting and nothing else', () => {
    wireMotion({ attribute: 'boom-setting', type: 'string', parse() { throw new Error('boom'); } });
    document.body.innerHTML =
      '<div data-vm data-vm-boom-setting="x" ' +
      'data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    expect(() => m.init()).not.toThrow();
    scrollTo(m, 5000);
    expect(node.style.transform).toBe('translateY(40px)');
    expect(m.elements[0].parsed.rejected.join(' ')).toContain('boom-setting');
    m.destroy();
  });
});
