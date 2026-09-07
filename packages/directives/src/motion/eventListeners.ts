/**
 * Creates a scroll listener that runs its callback exactly once per animation
 * frame, aligned to paint.
 *
 * This replaces a timer-based throttle. A throttle is a *rate limiter*: it
 * drops updates while waiting, and its timer is not aligned to the frame cycle
 * (10ms against 16.7ms at 60Hz, or 8.3ms at 120Hz), so updates land at
 * irregular intervals relative to paint. Irregular spacing between position
 * updates is what reads as "skippy".
 *
 * The dirty flag also removes the opposite failure: without it, every scroll
 * event queues its own frame callback, so several can queue within one frame
 * and all run — redundant work for an identical result.
 *
 * rAF self-throttles on slow devices (the browser simply delivers fewer
 * frames), which is the behaviour a fixed timer can only approximate badly.
 *
 * @param element the element to listen on, or window
 * @param callback runs once per frame while scrolling; read scroll position
 * inside it, so the value reflects position at paint time
 * @returns `removeScrollListener`, for teardown
 */
export const scrollListener = (
  element: Window | HTMLElement | null,
  callback: () => void
): { removeScrollListener: () => void } => {
  const target: Window | HTMLElement = element || window;

  let frame: number | null = null;

  const onScroll = () => {
    if (frame !== null) {
      return;
    }

    frame = requestAnimationFrame(() => {
      frame = null;
      callback();
    });
  };

  /**
   * Passive: this handler never calls preventDefault, and saying so lets the
   * browser scroll without waiting on it.
   */
  target.addEventListener('scroll', onScroll, { passive: true });

  const removeScrollListener = () => {
    target.removeEventListener('scroll', onScroll);

    /**
     * A frame may already be queued when teardown runs. Cancelling it is what
     * stops the callback firing against state that destroy() has since torn
     * down — the old implementation needed a setTimeout in destroy() to wait
     * that out.
     */
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  return { removeScrollListener };
};

/**
 * Creates a resize listener that runs its callback at most once per burst.
 *
 * A window drag fires `resize` at frame rate. The previous version scheduled a
 * fresh `setTimeout(callback, 100)` for every one of them, so a two-second drag
 * queued ~120 timers that each ran the callback — and none of them were
 * cancelled on teardown, so a timer could still fire against state `destroy()`
 * had already torn down. `scrollListener` guards both of those; this did not,
 * and the two sit ten lines apart (principle #5).
 *
 * Trailing rather than leading: the useful moment is when resizing stops, since
 * every intermediate size is about to be replaced.
 *
 * @param callback runs once after resizing settles
 * @returns `removeResizeListener`, for teardown
 */
export const resizeListener = (callback: () => void): { removeResizeListener: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onResize = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, 100);
  };

  window.addEventListener('resize', onResize, { passive: true });

  const removeResizeListener = () => {
    window.removeEventListener('resize', onResize);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { removeResizeListener };
};
