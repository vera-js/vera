/**
 * Cross-fading adjacent frames — `frame-tween`.
 *
 * `draw()` rounds to the nearest frame, so a short sequence scrubbed slowly
 * steps visibly. Tweening blends the two frames either side of the position
 * instead. The interesting cases are all about *not* blending: a frame drawn
 * as a fallback has no meaningful neighbour, an unloaded neighbour must not
 * suppress the frame we do have, and the untweened path must keep its
 * cheapness — one draw, and none at all when the rounded frame has not moved.
 */
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
}

/** Records the alpha in force at each `drawImage`, which is the thing under test. */
const canvas = () => {
  const c = document.createElement('canvas');
  c.width = 100; c.height = 100;
  const alphas = [];
  const context = {
    globalAlpha: 1,
    drawImage: () => alphas.push(context.globalAlpha),
  };
  c.getContext = () => context;
  c.__alphas = alphas;
  c.__context = context;
  return c;
};

beforeEach(() => { created = []; vi.stubGlobal('Image', FakeImage); });
afterEach(() => vi.unstubAllGlobals());

/** `request` queues the centre first, then outwards, so index n settles predictably. */
const settleAll = () => created.forEach((image) => image.settle());

describe('frame-tween off (the default)', () => {
  it('draws one image and ignores the fractional part', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50 });
    s.draw(2);
    settleAll();
    c.__alphas.length = 0;
    s.draw(3.25);
    expect(c.__alphas).toEqual([1]);
  });

  it('does not redraw while the rounded frame is unchanged', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50 });
    s.draw(3);
    settleAll();
    c.__alphas.length = 0;
    s.draw(3.1);
    s.draw(3.2);
    expect(c.__alphas).toEqual([]);
  });
});

describe('frame-tween on', () => {
  it('blends the upper frame over the lower at the fractional part', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2);
    settleAll();
    c.__alphas.length = 0;
    s.draw(2.25);
    expect(c.__alphas).toEqual([1, 0.25]);
  });

  it('restores globalAlpha, so a page drawing into the same canvas is unaffected', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2);
    settleAll();
    s.draw(2.5);
    expect(c.__context.globalAlpha).toBe(1);
  });

  it('draws once when sitting exactly on a frame', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2.5);
    settleAll();
    c.__alphas.length = 0;
    s.draw(4);
    expect(c.__alphas).toEqual([1]);
  });

  it('draws the loaded frame alone when its neighbour has not arrived', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2.25);
    /** `request` centres on 2, so the first image built is frame 2 itself. */
    created[0].settle();
    expect(c.__alphas).toEqual([1]);
  });

  /**
   * The case the obvious test misses. When the frame we want is unloaded,
   * `nearestLoaded` substitutes a different one — and *that* frame may well
   * have a loaded neighbour, so blending would cross-fade two images neither
   * of which is where the scroll is. Reaching it needs the substitute to be
   * above the requested index, which is why frames 4 and 5 are loaded and 2
   * and 3 are not.
   */
  it('does not blend onto a substituted frame', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(4.5);
    /** Queue order from centre 4 is 4, 3, 5 — settle the outer pair only. */
    created[0].settle();
    created[2].settle();
    c.__alphas.length = 0;
    s.draw(3.5);
    expect(c.__alphas).toEqual([1]);
  });

  it('repaints the pair when the upper frame arrives later', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2.25);
    created[0].settle();
    c.__alphas.length = 0;
    /** Queue order is centre, then outwards: 2, 1, 3 — so this is frame 3. */
    created[2].settle();
    expect(c.__alphas).toEqual([1, 0.25]);
  });

  it('skips a redraw for a movement below the alpha resolution', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2.5);
    settleAll();
    c.__alphas.length = 0;
    s.draw(2.5001);
    expect(c.__alphas).toEqual([]);
  });

  it('does redraw for a movement above it', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 50, tween: true });
    s.draw(2.5);
    settleAll();
    c.__alphas.length = 0;
    s.draw(2.55);
    expect(c.__alphas).toEqual([1, expect.closeTo(0.55, 1)]);
  });

  it('never blends past the end of the sequence', () => {
    const c = canvas();
    const s = createSequence(c, { url: '/s/', frames: 3, tween: true });
    s.draw(99);
    settleAll();
    c.__alphas.length = 0;
    s.draw(99);
    expect(c.__alphas).toEqual([]);
    expect(created.every((i) => !/000[4-9]/.test(i.src))).toBe(true);
  });
});
