import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * These attributes have three authors — people, the GUI, and AI — and two of
 * those three write CSS all day. A trailing separator is what CSS habit
 * produces, and the value is not CSS.
 *
 * A trailing **comma** used to push the empty segment to `rejected` as itself,
 * which is the empty string: the animation ran perfectly and the GUI showed a
 * complaint with no text in it. A trailing **semicolon** was worse — it is the
 * band separator, and with no bands present it reached the keyframe parser
 * attached to the last value, so `"0% 0px, 100% 40px;"` lost its end keyframe
 * and the element sat at `translateY(0px)` for good.
 */
const animate = (value) => {
  document.body.innerHTML = `<div data-vm data-vm-translate-y="${value}"></div>`;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { m, node, said: m.rejected.flatMap((r) => r.rejected) };
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  /** Scrolled past it, so a finished animation reads as its end value. */
  Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('a separator left at the end', () => {
  it('costs nothing after a comma', () => {
    const { m, node, said } = animate('0% 0px, 100% 40px,');
    expect(node.style.transform).toBe('translateY(40px)');
    expect(said).toEqual([]);
    m.destroy();
  });

  it('costs nothing after a semicolon', () => {
    const { m, node, said } = animate('0% 0px, 100% 40px;');
    expect(node.style.transform).toBe('translateY(40px)');
    expect(said).toEqual([]);
    m.destroy();
  });

  it('nor after several, with space between them', () => {
    const { m, node, said } = animate('0% 0px, 100% 40px ;;');
    expect(node.style.transform).toBe('translateY(40px)');
    expect(said).toEqual([]);
    m.destroy();
  });

  it('nor doubled in the middle', () => {
    const { m, node, said } = animate('0% 0px,,100% 40px');
    expect(node.style.transform).toBe('translateY(40px)');
    expect(said).toEqual([]);
    m.destroy();
  });

  /**
   * The band path always split on `;` and always skipped its empty segments,
   * which is why a trailing one was survivable there and not here. Kept as a
   * check that the two agree now.
   */
  it('and the same after a band', () => {
    const { m, said } = animate('0% 0px, 100% 40px; [0-700]: 100% 10px;');
    expect(said).toEqual([]);
    m.destroy();
  });

  /**
   * And an attribute with nothing in it is named in words rather than echoed.
   * Pushing the raw value reported the empty string, so the complaint had no
   * text in it — the very thing this file exists to have stopped.
   */
  it('says what is wrong with an empty value, rather than repeating it', () => {
    const { m, said } = animate('');
    expect(said).toEqual(['translate-y: no keyframes']);
    m.destroy();
  });

  /**
   * Still refused, and this is the line: an empty segment carries no keyframe
   * and there is nothing to say about it, but a malformed one carries a
   * mistake and must still be named.
   */
  it('while a malformed keyframe is still reported', () => {
    const { m, said } = animate('0% 0px, 100%40px');
    expect(said.join(' ')).toContain('100%40px');
    m.destroy();
  });
});

/**
 * A band with a range and no keyframes after it. `[0-700]:` is what a
 * half-written attribute looks like — the GUI mid-edit, or a value someone
 * deleted — and it produced a complaint with no text in it for the same reason
 * an empty attribute did.
 */
describe('a band with nothing after the colon', () => {
  it('is named rather than echoed', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-opacity="0% 0, 100% 1; [0-700]:"></div>';
    const node = document.body.firstElementChild;
    Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 100, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual(['opacity: no keyframes']);
    m.destroy();
  });
});
