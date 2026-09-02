import { describe, it, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const MARKUP = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';

/**
 * Both preferences are live toggles, so the library watches them. These drive
 * the listener directly — `query` decides which media query starts out true.
 */
const watching = (query) => {
  const handlers = [];
  vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
    matches: query.test(q),
    media: q,
    addEventListener: (_event, fn) => handlers.push(fn),
    removeEventListener: () => {},
  }));
  return (matches) => { for (const fn of handlers) fn({ matches }); };
};

afterEach(() => vi.restoreAllMocks());

/**
 * `enable()` overriding reduced motion is the authoring escape hatch the README
 * promises: someone who personally prefers reduced motion still has to be able
 * to preview what they are configuring for visitors.
 *
 * It held until the preference next changed. The resolver compared only `off`
 * against `enabled`, so a preference that moved twice walked over the explicit
 * call and put the instance back where the media query wanted it — and the
 * comment above that resolver had always claimed the opposite.
 */
describe('an explicit call outranks the preference that follows it', () => {
  it('keeps enable() through a preference that changes twice', () => {
    const fire = watching(/reduced/);
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    expect(m.enabled).toBe(false);

    m.enable();
    expect(m.enabled).toBe(true);

    /** Away and back: one change alone never reached the bug. */
    fire(false);
    fire(true);
    expect(m.enabled).toBe(true);
    m.destroy();
  });

  it('keeps disable() through a preference that changes twice', () => {
    const fire = watching(/nothing-matches/);
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    m.disable();
    expect(m.enabled).toBe(false);

    fire(true);
    fire(false);
    expect(m.enabled).toBe(false);
    m.destroy();
  });

  /**
   * The other half, and the reason this is not simply "ignore the media query".
   * An instance nobody has instructed still follows the visitor's preference,
   * in both directions, which is the whole point of watching it.
   */
  it('still follows the preference when nobody has said otherwise', () => {
    const fire = watching(/nothing-matches/);
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    expect(m.enabled).toBe(true);

    fire(true);
    expect(m.enabled).toBe(false);
    fire(false);
    expect(m.enabled).toBe(true);
    m.destroy();
  });

  /**
   * `enable()` before `init()` does nothing at all — there is nothing to
   * enable — so it must not count as an instruction either, or a page that
   * called it early would stop honouring the preference for ever after.
   */
  it('is not triggered by an enable() that did nothing', () => {
    const fire = watching(/nothing-matches/);
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: true });
    m.enable();
    m.init();
    fire(true);
    expect(m.enabled).toBe(false);
    m.destroy();
  });

  /** A fresh `init()` is a fresh instance's worth of intent. */
  it('follows the preference again after destroy and init', () => {
    const fire = watching(/nothing-matches/);
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    m.disable();
    m.destroy();

    m.init();
    fire(true);
    expect(m.enabled).toBe(false);
    fire(false);
    expect(m.enabled).toBe(true);
    m.destroy();
  });
});
