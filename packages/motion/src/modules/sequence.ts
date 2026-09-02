/**
 * Image-sequence scrubbing: a canvas whose frame is chosen by scroll position.
 *
 * Shipped as `@verajs/motion/sequence`, a wired module. This is the one feature
 * worth splitting out — most pages never use it, and a page that does is about
 * to fetch hundreds of images, so the module itself is noise beside them.
 * Splitting the library by feature was measured and rejected; splitting *this*
 * is a different trade.
 *
 * Two things the pre-rewrite version got wrong, both of which mattered:
 *
 * - it preloaded the entire sequence up front, so a 300-frame animation opened
 *   300 simultaneous connections on page load
 * - it allocated a `new Image()` on every frame it drew
 *
 * Here a sliding window of frames around the current position is fetched, a
 * bounded number at a time, and nothing is allocated while drawing. The window
 * bounds **retention** as well as fetching: frames outside it are released, or
 * a long sequence would accumulate every frame it had ever decoded. At 1080p
 * that is roughly 8 MB per frame once decoded — a 300-frame sequence scrolled
 * end to end would hold on to gigabytes.
 */

export interface SequenceOptions {
  /** Base url; the frame index and extension are appended. Already origin-checked. */
  readonly url: string;
  /** How many frames the sequence has. */
  readonly frames: number;
  /** Zero-padding width for the frame number, e.g. 4 gives `0001.jpg`. */
  readonly pad?: number;
  /** File extension, without the dot. Schema-allowlisted; defaults to jpg. */
  readonly ext?: string;
  /** How many frames either side of the current one to keep loaded. */
  readonly window?: number;
  /** Maximum simultaneous fetches. */
  readonly concurrency?: number;
  /**
   * Called the first time a frame fails to load, with the url that failed.
   *
   * `onerror` used to decrement its counters and move on, so a `frame-url` with
   * a character wrong — a missing trailing slash builds `/seq0003.jpg`, and
   * nothing enforces the slash — left a blank canvas, an empty `rejected` and
   * no console line either. On a module whose stated reason for existing is
   * that a GUI reads `rejected` and cannot read a console, that is the one
   * failure it must not be silent about.
   *
   * The wording belongs to the caller: this file imports nothing, which is what
   * keeps the drawer separable, so it does not know what the attribute is
   * called.
   */
  readonly onFailure?: (url: string) => void;
  /**
   * Cross-fade adjacent frames instead of snapping to the nearest one.
   *
   * Off by default, and that is a performance decision rather than a taste
   * one: snapping redraws only when the rounded frame changes, which on a long
   * scroll is a fraction of the frames; cross-fading redraws whenever the
   * position moves at all, and draws twice when it does.
   */
  readonly tween?: boolean;
}

export interface Sequence {
  /** Draw the frame for a 0-based index. Safe to call every frame. */
  draw(index: number): void;
  destroy(): void;
}

const DEFAULTS = { pad: 4, window: 24, concurrency: 6 } as const;

/**
 * Alpha resolution for a cross-fade, in steps per frame interval.
 *
 * Finer than a viewer can distinguish in a blend of two photographs, and
 * coarse enough that a slow scroll skips redraws entirely rather than
 * repainting for a change of one part in a thousand.
 */
const ALPHA_STEPS = 64;

/**
 * Builds an image-sequence scrubber over a canvas.
 *
 * @param canvas the element to draw into
 * @param options the url, frame count, and the window and concurrency bounds
 * @returns null if a 2D context cannot be had
 */
export const createSequence = (
  canvas: HTMLCanvasElement,
  options: SequenceOptions
): Sequence | null => {
  const context = canvas.getContext('2d');
  if (!context) return null;

  const { url, frames } = options;
  const pad = options.pad ?? DEFAULTS.pad;
  const windowSize = options.window ?? DEFAULTS.window;
  const concurrency = options.concurrency ?? DEFAULTS.concurrency;
  const tween = options.tween === true;
  let reportedFailure = false;

  /** Sparse on purpose: only fetched frames occupy a slot. */
  const loaded: Array<HTMLImageElement | undefined> = new Array(frames);
  /**
   * Which slots are occupied. `evict` used to scan all `frames` slots on every
   * draw to find them, so a 2,000-frame sequence did 2,000 iterations per
   * frame to release at most a handful. This is the same information, sized to
   * what is actually held rather than to the sequence.
   */
  const held = new Set<number>();
  const pending = new Set<number>();
  /**
   * Frames whose fetch failed. Asked for once, not once per draw.
   *
   * `onerror` cleared the slot and moved on, so nothing remembered — and
   * `request` rebuilds the queue from "not loaded and not in flight" on every
   * quantised movement. A wrong base url, which is the failure this module is
   * most likely to produce, therefore re-requested the whole window every time
   * the frame index changed: measured at **1,170 requests for 54 distinct urls
   * across 30 draws** of a 300-frame sequence, growing with every pixel
   * scrolled. The module's own opening paragraph names "300 simultaneous
   * connections on page load" as the thing it exists to have fixed.
   *
   * A frame is never retried within a sequence's life, which is the same
   * bargain `reportedFailure` makes: these are static files at fixed urls, and
   * a 404 is not going to become a 200. The cost is that a genuinely transient
   * failure loses that one frame until the sequence is rebuilt — `draw` falls
   * back to the nearest loaded frame, so what it costs is sharpness there and
   * not a blank canvas.
   */
  const failed = new Set<number>();
  /** The element behind each in-flight fetch, so it can be abandoned. */
  const inProgress = new Map<number, HTMLImageElement>();
  const queue: number[] = [];
  let inFlight = 0;
  let destroyed = false;
  let lastDrawn = -1;
  /** Opacity of `lastDrawn + 1` over `lastDrawn`. Always 0 when not tweening. */
  let lastAlpha = 0;

  const ext = options.ext ?? 'jpg';
  const src = (index: number) => `${url}${String(index + 1).padStart(pad, '0')}.${ext}`;

  const pump = (): void => {
    while (!destroyed && inFlight < concurrency && queue.length) {
      const index = queue.shift() as number;
      if (loaded[index] || pending.has(index)) continue;

      const image = new Image();
      pending.add(index);
      inProgress.set(index, image);
      inFlight++;

      image.decoding = 'async';
      image.onload = () => {
        inFlight--;
        pending.delete(index);
        inProgress.delete(index);
        if (destroyed) return;
        loaded[index] = image;
        held.add(index);
        /**
         * The frame we are sitting on may have arrived — draw it now. When
         * tweening that is a *pair*, so the upper half arriving has to repaint
         * too, or a blend stays stuck at whichever half loaded first.
         */
        if (index === lastDrawn || (tween && index === lastDrawn + 1)) render(lastDrawn, lastAlpha);
        pump();
      };
      image.onerror = () => {
        inFlight--;
        pending.delete(index);
        inProgress.delete(index);
        failed.add(index);
        /** Once per sequence, not once per frame: a wrong base url fails all of them. */
        if (!reportedFailure) {
          reportedFailure = true;
          options.onFailure?.(image.src);
        }
        pump();
      };
      image.src = src(index);
    }
  };

  /**
   * Queue the window around `centre`, nearest first, so the frame the user is
   * actually looking at arrives before its neighbours.
   */
  const request = (centre: number): void => {
    queue.length = 0;
    for (let offset = 0; offset <= windowSize; offset++) {
      for (const index of offset === 0 ? [centre] : [centre - offset, centre + offset]) {
        if (index < 0 || index >= frames) continue;
        if (loaded[index] || pending.has(index) || failed.has(index)) continue;
        queue.push(index);
      }
    }
    pump();
  };

  /**
   * Abandons a fetch for a frame that has scrolled away.
   *
   * `removeAttribute('src')`, **not** `src = ''`. The empty string is resolved
   * against the document, so assigning it makes the image re-request the
   * *page* — measured in Chromium, Firefox and WebKit alike
   * (`spikes/image-abort.mjs`), which is worse than the waste it was meant to
   * save. Removing the attribute cancels the fetch in Chromium and Firefox,
   * and is inert in WebKit, where the frame simply arrives and is ignored.
   *
   * The handlers are cleared first so `inFlight` is adjusted here exactly
   * once, rather than again from an `onerror` the removal may provoke.
   */
  const abandon = (index: number): void => {
    const image = inProgress.get(index);
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    inProgress.delete(index);
    pending.delete(index);
    inFlight--;
  };

  /**
   * Releases frames outside the retention window. Dropping the reference is
   * what lets the decoded bitmap go.
   *
   * In-flight fetches for the same territory are abandoned, which matters more
   * than the bandwidth: they hold the concurrency slots the frame actually
   * being looked at is queued behind. This docblock claimed the cancellation
   * for a long time while nothing did it — `src` was only ever assigned, never
   * cleared.
   */
  const evict = (centre: number): void => {
    const keep = windowSize * 2;
    for (const i of held) {
      if (Math.abs(i - centre) <= keep) continue;
      loaded[i] = undefined;
      held.delete(i);
    }
    let freed = false;
    for (const i of [...inProgress.keys()]) {
      if (Math.abs(i - centre) <= keep) continue;
      abandon(i);
      freed = true;
    }
    /** Those slots are free now, and the queue is already centred on `centre`. */
    if (freed) pump();
  };

  /**
   * Draws `lower`, then `lower + 1` over it at `alpha`.
   *
   * The cross-fade is **positional, not temporal**: alpha is the fractional
   * part of the scroll-derived frame, so a scroll that stops mid-way holds a
   * blend rather than finishing one. That is what makes it right for scrubbing,
   * and why the pre-rewrite library's `tweenDuration` has no equivalent here —
   * a duration describes a fade that runs on its own clock, which is precisely
   * what a scrubbed sequence must not do.
   *
   * `globalAlpha` is restored rather than left set. The context is the
   * canvas's, not ours, and a page drawing its own overlay into the same
   * canvas would otherwise inherit whatever opacity the last frame happened to
   * land on.
   */
  const render = (lower: number, alpha: number): void => {
    const base = loaded[lower];
    if (!base) return;
    context.drawImage(base, 0, 0, canvas.width, canvas.height);
    const next = alpha > 0 ? loaded[lower + 1] : undefined;
    if (!next) return;
    context.globalAlpha = alpha;
    context.drawImage(next, 0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;
  };

  /**
   * Falls back to the nearest loaded frame rather than showing nothing, so a
   * fast scroll through unfetched territory degrades to a coarser sequence
   * instead of a blank canvas.
   */
  const nearestLoaded = (index: number): number => {
    for (let offset = 0; offset <= windowSize; offset++) {
      if (loaded[index - offset]) return index - offset;
      if (loaded[index + offset]) return index + offset;
    }
    return -1;
  };

  return {
    draw(raw) {
      /**
       * Finite or nothing. A NaN index would sail through the clamp, miss every cache test,
       * and fetch `…NaN.jpg` — no internal path produces one, but this file's whole design
       * (imports nothing, separable) invites callers this module has never met (#8).
       */
      if (destroyed || !Number.isFinite(raw)) return;
      const clamped = Math.min(frames - 1, Math.max(0, raw));

      const index = tween ? Math.floor(clamped) : Math.round(clamped);
      /**
       * Quantised, so a movement too small to see does not cost two
       * `drawImage` calls. The guard is the reason a stationary scroll is free
       * in both modes — without it, tweening would redraw on every frame the
       * position moved by any amount at all.
       */
      const alpha = tween ? Math.round((clamped - index) * ALPHA_STEPS) / ALPHA_STEPS : 0;
      if (index === lastDrawn && alpha === lastAlpha) return;
      lastDrawn = index;
      lastAlpha = alpha;

      /**
       * A fallback frame is drawn alone. Blending the neighbour of a frame we
       * are not showing would cross-fade between two wrong images.
       */
      const target = loaded[index] ? index : nearestLoaded(index);
      if (target >= 0) render(target, target === index ? alpha : 0);
      request(index);
      evict(index);
    },
    destroy() {
      destroyed = true;
      queue.length = 0;
      /** A torn-down sequence must stop pulling frames, not merely ignore them. */
      for (const i of [...inProgress.keys()]) abandon(i);
      pending.clear();
      failed.clear();
      held.clear();
      loaded.length = 0;
    },
  };
};
