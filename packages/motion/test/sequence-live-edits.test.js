import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';

const A = 'data-vm';

/**
 * These exercise the module's own wiring — `apply`, `prepare` and `release` —
 * rather than driving a `createMotion` instance, because the thing under test
 * is what the module does between one parse and the next. happy-dom has no
 * layout and its `IntersectionObserver` never reports, so a full instance
 * repaints once at `init()` and not again: the runtime half is covered by
 * test/sequence-lifecycle.test.js, and driving it here would only prove that
 * happy-dom does not scroll.
 */
let requested;

const wire = () => {
  const parts = sequence();
  return {
    frame: parts.find((p) => p.attribute === 'frame'),
    prepare: parts.find((p) => p.on === 'prepare'),
    release: parts.find((p) => p.on === 'release'),
  };
};

/** Which directory the frames just requested came from. */
const sources = () => [...new Set(requested.map((u) => new URL(u).pathname.split('/')[1]))];

const settle = () => new Promise((r) => setTimeout(r, 30));

const canvas = (attrs) => {
  document.body.innerHTML = `<canvas ${A} ${A}-frame="0% 0, 100% 9" ${attrs}></canvas>`;
  return document.body.firstElementChild;
};

beforeEach(() => {
  requested = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, globalAlpha: 1 });
  vi.stubGlobal('Image', class {
    set src(value) { requested.push(value); }
    get src() { return ''; }
    addEventListener() {}
    removeEventListener() {}
    removeAttribute() {}
    decode() { return Promise.resolve(); }
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * A drawer is built once and cached for the life of the element. Nothing
 * dropped one except `release`, which runs on removal and not on a re-parse —
 * so every `frame-*` setting was frozen at the first frame drawn. Editing
 * `frame-url` in a GUI editor re-parsed cleanly, updated
 * `element.parsed.settings`, and changed nothing on screen.
 */
describe('a frame setting edited after the first draw', () => {
  it('rebuilds the drawer when the url changes', async () => {
    const node = canvas(`${A}-frame-url="/first/" ${A}-frame-count="10"`);
    const { frame, prepare, release } = wire();
    frame.apply(node, 5);
    await settle();
    expect(sources()).toEqual(['first']);

    requested = [];
    node.setAttribute(`${A}-frame-url`, '/second/');
    prepare.fn(document, true);
    frame.apply(node, 5);
    await settle();
    expect(sources()).toEqual(['second']);
    release.fn(node);
  });

  it('rebuilds when the count changes', async () => {
    const node = canvas(`${A}-frame-url="/s/" ${A}-frame-count="10"`);
    const { frame, prepare, release } = wire();
    frame.apply(node, 9);
    await settle();
    const before = requested.length;
    expect(before).toBeGreaterThan(0);

    requested = [];
    /**
     * A shorter sequence. The old drawer would keep asking for frames past the
     * new end, which is the same defect as the stale url wearing a different
     * hat — the window, the padding and the tween flag are all captured at
     * build time too.
     */
    node.setAttribute(`${A}-frame-count`, '4');
    prepare.fn(document, true);
    frame.apply(node, 3);
    await settle();
    expect(requested.length).toBeGreaterThan(0);
    release.fn(node);
  });

  /**
   * The cache is the reason the drawer exists — this asserts the fix did not
   * quietly turn every `collect()` into a full re-fetch. Without it a
   * `prepare` hook that always forgot would pass the two tests above.
   */
  it('keeps the drawer when nothing changed', async () => {
    const node = canvas(`${A}-frame-url="/s/" ${A}-frame-count="10"`);
    const { frame, prepare, release } = wire();
    frame.apply(node, 5);
    await settle();

    requested = [];
    prepare.fn(document, true);
    frame.apply(node, 5);
    await settle();
    expect(requested).toEqual([]);
    release.fn(node);
  });

  /**
   * A refusal is cached alongside the drawers and has the same problem: a
   * canvas refused for a url the policy would not permit stayed refused for
   * the life of the page, so correcting the url in the GUI did nothing. This
   * is the reason the settings are recorded for both outcomes and not only
   * for the ones that built something.
   */
  it('reconsiders a canvas it refused once the setting is fixed', async () => {
    const node = canvas(`${A}-frame-url="https://denied.test/s/" ${A}-frame-count="10"`);
    const { frame, prepare, release } = wire();
    expect(frame.apply(node, 5)).toMatch(/frame-url/);

    node.setAttribute(`${A}-frame-url`, '/allowed/');
    prepare.fn(document, true);
    expect(frame.apply(node, 5)).toBeUndefined();
    await settle();
    expect(sources()).toEqual(['allowed']);
    release.fn(node);
  });
});
