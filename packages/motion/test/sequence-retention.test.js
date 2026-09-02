/**
 * The window bounds what is kept, not only what is fetched.
 *
 * A decoded frame is the largest thing this library ever holds — roughly 8 MB
 * at 1080p — so a sequence that kept every frame it had ever drawn would hold
 * gigabytes by the time a long one had been scrolled end to end. The
 * pre-rewrite version did exactly that, alongside opening a connection per
 * frame at once.
 *
 * Releasing is invisible from the outside except by its consequence: a frame
 * that was let go has to be fetched again when it is next wanted. That is the
 * observable, and it is the same one that would show a *leak* — a sequence
 * that never re-fetches is a sequence that never released.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createSequence } from '../src/modules/sequence.ts';

let created;

class FakeImage {
  constructor() { created.push(this); this._src = ''; }
  set src(value) { this._src = value; }
  get src() { return this._src; }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.aborted = true; } }
  settle() { this.onload?.(); }
}

const canvas = () => {
  const node = document.createElement('canvas');
  node.width = 50;
  node.height = 50;
  node.getContext = () => ({ drawImage() {}, globalAlpha: 1 });
  return node;
};

/** Draw, let every request land, and report what was asked for. */
const drawAndSettle = (sequence, index) => {
  created.length = 0;
  sequence.draw(index);
  created.forEach((image) => image.settle());
  return created.map((image) => image.src).filter(Boolean);
};

beforeEach(() => { created = []; vi.stubGlobal('Image', FakeImage); });
afterEach(() => vi.unstubAllGlobals());

const build = () =>
  createSequence(canvas(), { url: '/s/', frames: 200, window: 2, concurrency: 50 });

describe('a frame outside the window', () => {
  it('is released, so returning to it fetches again', () => {
    const sequence = build();
    const first = drawAndSettle(sequence, 0);
    expect(first).toContain('/s/0001.jpg');

    drawAndSettle(sequence, 100);
    const again = drawAndSettle(sequence, 0);

    expect(again).toContain('/s/0001.jpg');
    sequence.destroy();
  });
});

describe('a frame still inside the window', () => {
  /**
   * The half that stops the test above passing for a sequence that simply
   * fetches everything every time.
   */
  it('is kept, so returning to it fetches nothing', () => {
    const sequence = build();
    drawAndSettle(sequence, 50);

    /** One frame along, well within a window of two. */
    const nearby = drawAndSettle(sequence, 51);

    expect(nearby).not.toContain('/s/0051.jpg');
    sequence.destroy();
  });
});

describe('destroy', () => {
  it('lets go of everything it was holding', () => {
    const sequence = build();
    drawAndSettle(sequence, 50);
    sequence.destroy();

    created.length = 0;
    sequence.draw(50);
    expect(created).toHaveLength(0);
  });

  it('abandons what was still in flight', () => {
    const sequence = build();
    created.length = 0;
    sequence.draw(50);
    const inFlight = created.filter((image) => image.src !== '');
    expect(inFlight.length).toBeGreaterThan(0);

    sequence.destroy();
    expect(inFlight.every((image) => image.aborted === true)).toBe(true);
  });
});
