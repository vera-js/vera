import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion(sequence);

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 20));
};

/**
 * happy-dom's canvas has no 2D context, so `createSequence` correctly returns
 * null and nothing ever attaches — which is why the sequence half of the
 * disable-guard could not be tested when it was written. Stubbing the context,
 * as test/sequence.test.js already does, makes the whole path reachable.
 */
const canvasPage = () => {
  document.body.innerHTML =
    '<canvas data-vm data-vm-frame="0% 0, 100% 9" ' +
    'data-vm-frame-url="/s/" data-vm-frame-count="10"></canvas>';
  const node = document.body.firstElementChild;
  node.getContext = () => ({ drawImage: vi.fn() });
  return node;
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * The origin policy moved with the feature. It is the module's decision now —
 * `sequence({ allowedOrigins })` — and an attribute still cannot widen it,
 * which was the point of having it at instance level in the first place.
 */
describe('the sequence module owns the origin policy', () => {
  const markup =
    '<canvas data-vm data-vm-frame="0% 0, 100% 9" ' +
    'data-vm-frame-count="10" data-vm-frame-url="https://cdn.test/s/"></canvas>';

  it('refuses a cross-origin url by default', () => {
    wireMotion(sequence());
    document.body.innerHTML = markup;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected).some((r) => r.includes('frame-url'))).toBe(true);
    m.destroy();
  });

  it('accepts it when the module was wired with that origin', () => {
    wireMotion(sequence({ allowedOrigins: ['https://cdn.test'] }));
    document.body.innerHTML = markup;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.elements[0].parsed.settings['frame-url']).toBe('https://cdn.test/s/');
    m.destroy();
  });
});

describe('image sequence across the instance lifecycle', () => {
  it('attaches on a live instance', async () => {
    canvasPage();
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    expect(m.elements[0].sequence).not.toBeNull();
    m.destroy();
  });

  /**
   * `started` is flipped only by init() and destroy(), so guarding the
   * in-flight chunk on it alone let a chunk landing after disable() build a
   * live loader on an instance that had just released everything — and the
   * next enable() built a second one over the top, leaking the first.
   */
  /**
   * The module builds a decoder on the first frame that asks for one, and a
   * disabled instance asks for none — so nothing is fetched or decoded for a
   * page that is not animating. This replaces a test about a chunk landing
   * after disable(), which cannot happen now that the module is wired rather
   * than fetched.
   */
  it('decodes nothing while disabled', async () => {
    const node = canvasPage();
    let drawn = 0;
    node.getContext = () => ({ drawImage: () => { drawn++; } });
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    m.disable();
    await settle();
    expect(drawn).toBe(0);
    m.destroy();
  });

  /**
   * A refused canvas is forgotten with everything else at `destroy()` — the
   * release pass covers refused-only nodes, not just ones with drawers. The
   * observable is the second warning: a fresh instance re-decides rather than
   * inheriting the dead one's cached answer.
   */
  it('re-decides a refused canvas after destroy()', async () => {
    document.body.innerHTML =
      '<canvas data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-count="10" data-vm-frame-url="https://elsewhere.test/s/"></canvas>';
    document.body.firstElementChild.getContext = () => ({ drawImage: vi.fn() });
    const warned = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => warned.push(String(args[0])));
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    m.destroy();
    const again = createMotion({ respectReducedMotion: false });
    again.init();
    await settle();
    again.destroy();
    expect(warned.filter((w) => w.includes('not permitted'))).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('re-attaches on enable()', async () => {
    canvasPage();
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    m.disable();
    await settle();
    m.enable();
    await settle();
    expect(m.elements[0].sequence).not.toBeNull();
    m.destroy();
  });
});
