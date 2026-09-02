import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A bare attribute reads as true, the way HTML booleans behave, and `"true"`
 * and `"false"` are spelled out because a GUI needs a way to say *off* that
 * survives a round trip.
 *
 * Everything else used to read as **false**, silently. `run-once="yes"` and
 * `run-once="1"` both meant "on" to whoever wrote them, and these attributes
 * are written by people and by AI as well as by the GUI. Being wrong about a
 * boolean is quiet in a way being wrong about a number is not: nothing looks
 * broken, the animation simply repeats when it was asked not to.
 */
const parse = (value) => {
  document.body.innerHTML =
    `<div data-vm ${value === null ? 'data-vm-run-once' : `data-vm-run-once="${value}"`} ` +
    'data-vm-translate-y="0% 0px, 100% 40px"></div>';
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  const element = m.elements[0];
  return {
    m,
    setting: element?.parsed.settings['run-once'],
    said: m.rejected.flatMap((r) => r.rejected).join(' '),
  };
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('a boolean setting', () => {
  it('is true when the attribute is bare', () => {
    const { m, setting, said } = parse(null);
    expect(setting).toBe(true);
    expect(said).toBe('');
    m.destroy();
  });

  it('is true when spelled out', () => {
    const { m, setting } = parse('true');
    expect(setting).toBe(true);
    m.destroy();
  });

  it('is false when spelled out, which a GUI needs to round-trip', () => {
    const { m, setting, said } = parse('false');
    expect(setting).toBe(false);
    expect(said).toBe('');
    m.destroy();
  });

  it.each(['yes', '1', 'on', 'TRUE', 'no'])('refuses %s rather than reading it as off', (value) => {
    const { m, setting, said } = parse(value);
    expect(setting).toBeUndefined();
    expect(said).toContain('run-once');
    m.destroy();
  });
});
