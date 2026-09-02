/**
 * The deferred line rebuild, and its teardown.
 *
 * Regrouping lines changes the element's height, which the observer is
 * watching, so rebuilding inside the callback notifies again before the
 * delivery has finished. WebKit reports that as a **page error** —
 * `ResizeObserver loop completed with undelivered notifications` — on
 * `window.onerror`, where a consumer's error reporting picks it up. Chromium
 * and Firefox tolerate the same loop silently.
 *
 * So the rebuild is deferred a frame, which means there can be one in flight
 * when `destroy()` runs — an injected callback with no matching teardown,
 * which is the thing CLAUDE.md counts. The *regrouping* needs real layout and
 * is held by `spikes/split-lines.mjs`; the queueing and its cancellation are
 * ordinary logic and belong here.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createSplit } from '../src/modules/split.ts';

let observers, frames, cancelled;

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    observers.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
  fire() { this.callback([]); }
}

const paragraph = (width) => {
  document.body.innerHTML = '<p id="p">one two three four</p>';
  const node = document.getElementById('p');
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  return node;
};
const widen = (node, width) =>
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });

beforeEach(() => {
  observers = []; frames = []; cancelled = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', (handle) => cancelled.push(handle));
});
afterEach(() => vi.unstubAllGlobals());

describe('a width change', () => {
  it('queues the rebuild rather than running it in the callback', () => {
    const node = paragraph(400);
    const made = createSplit(node, 'lines');
    frames.length = 0;

    widen(node, 250);
    observers[0].fire();

    expect(frames).toHaveLength(1);
    made.destroy();
  });

  it('queues once for a burst, since the rebuild changes the height too', () => {
    const node = paragraph(400);
    const made = createSplit(node, 'lines');
    frames.length = 0;

    widen(node, 250);
    observers[0].fire();
    observers[0].fire();
    observers[0].fire();

    expect(frames).toHaveLength(1);
    made.destroy();
  });

  it('ignores a notification that did not change the width', () => {
    const node = paragraph(400);
    const made = createSplit(node, 'lines');
    frames.length = 0;

    observers[0].fire();

    expect(frames).toHaveLength(0);
    made.destroy();
  });
});

describe('destroy', () => {
  it('cancels a rebuild that has not run yet', () => {
    const node = paragraph(400);
    const made = createSplit(node, 'lines');
    widen(node, 250);
    observers[0].fire();

    made.destroy();

    expect(cancelled).toHaveLength(1);
    expect(observers[0].disconnected).toBe(true);
  });

  /** The point of cancelling: a rebuild must not undo the text destroy put back. */
  it('so a queued rebuild cannot re-split the text afterwards', () => {
    const node = paragraph(400);
    const made = createSplit(node, 'lines');
    widen(node, 250);
    observers[0].fire();
    const queued = frames[frames.length - 1];

    made.destroy();
    const restored = node.textContent;
    queued();

    expect(node.textContent).toBe(restored);
    expect(node.querySelectorAll('span')).toHaveLength(0);
  });
});
