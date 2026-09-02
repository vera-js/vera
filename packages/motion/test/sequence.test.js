import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createSequence } from '../src/modules/sequence.ts';

let created;
class FakeImage {
  constructor() { created.push(this); this._src = ''; }
  set src(v) { this._src = v; }
  get src() { return this._src; }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.aborted = true; } }
  settle() { this.onload?.(); }
  fail() { this.onerror?.(); }
}

const canvas = () => {
  const c = document.createElement('canvas');
  c.width = 100; c.height = 100;
  const drawImage = vi.fn();
  c.getContext = () => ({ drawImage });
  c.__draw = drawImage;
  return c;
};

beforeEach(() => { created = []; vi.stubGlobal('Image', FakeImage); });
afterEach(() => vi.unstubAllGlobals());

describe('createSequence', () => {
  it('returns null without a 2d context rather than throwing', () => {
    const c = document.createElement('canvas');
    c.getContext = () => null;
    expect(createSequence(c, { url: '/s/', frames: 10 })).toBeNull();
  });

  it('builds zero-padded frame urls', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 50 });
    s.draw(0);
    expect(created[0].src).toBe('/s/0001.jpg');
  });

  it('honours a custom padding width', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 50, pad: 2 });
    s.draw(0);
    expect(created[0].src).toBe('/s/01.jpg');
  });

  /** The old version opened one connection per frame, all at once. */
  it('fetches a bounded number at a time, not the whole sequence', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 300, concurrency: 6 });
    s.draw(0);
    expect(created.length).toBeLessThanOrEqual(6);
  });

  it('requests the current frame before its neighbours', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 100, concurrency: 3 });
    s.draw(50);
    expect(created[0].src).toBe('/s/0051.jpg');
  });

  it('draws once the frame arrives', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 10 });
    s.draw(0);
    expect(c.__draw).not.toHaveBeenCalled();
    created[0].settle();
    expect(c.__draw).toHaveBeenCalled();
  });

  it('does no work when the frame index has not changed', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 10 });
    s.draw(3);
    const after = created.length;
    s.draw(3.4);
    expect(created.length).toBe(after);
  });

  it('clamps an out-of-range index', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 10 });
    expect(() => { s.draw(-50); s.draw(9999); }).not.toThrow();
  });

  it('keeps loading after a frame fails', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 20, concurrency: 2 });
    s.draw(0);
    const before = created.length;
    created[0].fail();
    expect(created.length).toBeGreaterThan(before);
  });

  it('falls back to the nearest loaded frame within the window', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 100, window: 24, concurrency: 2 });
    s.draw(0);
    created[0].settle();
    c.__draw.mockClear();
    s.draw(10);           // unfetched, but a loaded frame is within the window
    expect(c.__draw).toHaveBeenCalled();
  });

  /**
   * Past the window there is nothing to fall back to — but the canvas is never
   * cleared, so the last drawn frame stays on screen. A fast scroll through
   * unfetched territory holds the previous image rather than going blank.
   */
  it('leaves the previous frame on screen when nothing is near', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 400, window: 4, concurrency: 2 });
    s.draw(0);
    created[0].settle();
    expect(c.__draw).toHaveBeenCalledTimes(1);

    c.__draw.mockClear();
    s.draw(300);          // far outside the window, nothing loaded
    expect(c.__draw).not.toHaveBeenCalled();   // nothing drawn, nothing cleared
  });

  /** AUDIT A17 — the window bounded fetching but not retention. */
  it('releases frames outside the retention window', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 400, window: 4, concurrency: 40 });
    s.draw(0);
    created.forEach((i) => i.settle());
    const early = created.length;

    s.draw(300);
    created.slice(early).forEach((i) => i.settle());

    /** Back at the start, the early frames must be re-fetched — they were released. */
    const beforeReturn = created.length;
    s.draw(0);
    expect(created.length).toBeGreaterThan(beforeReturn);
  });

  it('stops drawing and fetching after destroy', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 10 });
    s.draw(0);
    s.destroy();
    const after = created.length;
    s.draw(5);
    expect(created.length).toBe(after);
    expect(c.__draw).not.toHaveBeenCalled();
  });
});

describe('frame-ext', () => {
  it('defaults to jpg', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 3 });
    s.draw(0);
    expect(created[0].src).toBe('/s/0001.jpg');
    s.destroy();
  });

  it('uses the requested extension', () => {
    const s = createSequence(canvas(), { url: '/s/', frames: 3, ext: 'webp' });
    s.draw(0);
    expect(created[0].src).toBe('/s/0001.webp');
    s.destroy();
  });
});

/**
 * A window of frames is fetched around the current one, six at a time. Scrub
 * fast and those six are for territory that has already gone past — and they
 * hold the concurrency slots the frame being looked at is queued behind.
 */
describe('fetches for frames that have scrolled away are abandoned', () => {
  it('abandons in-flight frames outside the retention window', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 2000, window: 2, concurrency: 6 });

    s.draw(0);
    const early = created.filter((i) => i.src);
    expect(early.length).toBeGreaterThan(0);

    /** Jump far enough that none of those frames is worth keeping. */
    s.draw(1500);

    for (const image of early) expect(image.aborted, image.src).toBe(true);
    s.destroy();
  });

  it('frees the slot so the frame now wanted can start', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 2000, window: 2, concurrency: 2 });

    s.draw(0);
    /** Concurrency is 2, so only two are ever in flight at once. */
    expect(created.filter((i) => i.src && !i.aborted)).toHaveLength(2);

    s.draw(1500);
    const live = created.filter((i) => i.src && !i.aborted);
    expect(live).toHaveLength(2);
    /** And they are the new ones, not the abandoned pair. */
    for (const image of live) expect(Number(image.src.replace(/\D/g, ''))).toBeGreaterThan(1000);
    s.destroy();
  });

  it('stops fetching when the sequence is destroyed', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 100, window: 4, concurrency: 6 });
    s.draw(50);
    const live = created.filter((i) => i.src && !i.aborted);
    expect(live.length).toBeGreaterThan(0);

    s.destroy();
    for (const image of live) expect(image.aborted).toBe(true);
  });

  it('does not assign an empty src, which would re-request the page', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 2000, window: 2, concurrency: 6 });
    s.draw(0);
    const early = created.filter((i) => i.src);
    s.draw(1500);
    /**
     * `src = ''` resolves against the document, so the image fetches the page
     * itself — measured in all three engines. The abandon path must go through
     * `removeAttribute`, which is what `aborted` records.
     */
    for (const image of early) expect(image.aborted).toBe(true);
    s.destroy();
  });
});
