import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { createSequence } from '../src/modules/sequence.ts';

const A = 'data-vera-motion';

/**
 * A frame that does not load is the failure this module is most likely to
 * produce, and it was the only one it never mentioned. `frame-url` is a plain
 * prefix — nothing enforces the trailing slash the docs describe — so one
 * missing character builds `/seq0003.jpg`, every fetch 404s, and the canvas
 * stays blank with an empty `rejected` and nothing in the console either.
 *
 * On a module whose stated reason for having `rejections.ts` at all is that the
 * GUI reads `rejected` and cannot read a console, that is the one failure it
 * must not be silent about.
 */
const failing = () => {
  vi.stubGlobal('Image', class {
    set src(value) { this._src = value; queueMicrotask(() => this.onerror && this.onerror()); }
    get src() { return this._src ?? ''; }
    addEventListener() {} removeEventListener() {} removeAttribute() {}
    decode() { return Promise.resolve(); }
  });
};

const loading = () => {
  vi.stubGlobal('Image', class {
    set src(value) { this._src = value; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src ?? ''; }
    addEventListener() {} removeEventListener() {} removeAttribute() {}
    decode() { return Promise.resolve(); }
  });
};

const canvas = (url = '/seq') => {
  document.body.innerHTML =
    `<canvas ${A} ${A}-frame="0% 0, 100% 9" ${A}-frame-url="${url}" ${A}-frame-count="10"></canvas>`;
  return document.body.firstElementChild;
};

const settle = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, globalAlpha: 1 });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an image sequence whose frames never arrive', () => {
  it('says so, naming a url that failed', async () => {
    failing();
    const node = canvas();
    const parts = sequence();
    const frame = parts.find((p) => p.attribute === 'frame');
    const release = parts.find((p) => p.on === 'release');

    frame.apply(node, 2);
    await settle();

    const reason = frame.apply(node, 3);
    expect(reason).toContain('frame-url');
    expect(reason).toContain('/seq');
    release.fn(node);
  });

  /**
   * Reported through the drawer that exists, which is the whole gap: a canvas
   * that never got a drawer was already covered, and a wrong url produces one
   * that builds perfectly and then fails every fetch.
   */
  it('even though the drawer itself was built', async () => {
    failing();
    const node = canvas();
    const parts = sequence();
    const frame = parts.find((p) => p.attribute === 'frame');
    const release = parts.find((p) => p.on === 'release');

    /** No refusal at construction: the canvas and the url are both fine. */
    expect(frame.apply(node, 2)).toBeUndefined();
    await settle();
    expect(frame.apply(node, 3)).toContain('nothing loaded');
    release.fn(node);
  });

  /**
   * And asks once per frame, not once per draw.
   *
   * `request` rebuilds the queue from "not loaded and not in flight" every time
   * the frame index moves, and a failure left no trace of itself — so the whole
   * window was re-requested on every quantised movement. Measured before
   * fixing: **1,170 requests for 54 distinct urls** across 30 draws of a
   * 300-frame sequence, and it grows with the scroll rather than levelling off.
   */
  it('and does not ask again for a frame that failed', async () => {
    const created = [];
    vi.stubGlobal('Image', class {
      constructor() { created.push(this); }
      set src(value) { this._src = value; queueMicrotask(() => this.onerror && this.onerror()); }
      get src() { return this._src ?? ''; }
      addEventListener() {} removeEventListener() {} removeAttribute() {}
    });
    const element = document.createElement('canvas');
    element.width = 100; element.height = 100;
    const drawer = createSequence(element, { url: '/wrong', frames: 300 });

    for (let i = 0; i < 30; i++) {
      drawer.draw(i);
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(created.length).toBe(new Set(created.map((image) => image.src)).size);
    drawer.destroy();
  });

  it('and stays quiet when the frames load', async () => {
    loading();
    const node = canvas('/seq/');
    const parts = sequence();
    const frame = parts.find((p) => p.attribute === 'frame');
    const release = parts.find((p) => p.on === 'release');

    frame.apply(node, 2);
    await settle();
    expect(frame.apply(node, 3)).toBeUndefined();
    release.fn(node);
  });
});
