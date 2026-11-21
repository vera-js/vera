/**
 * **The one way a browser test waits for something** (2026-11-20): poll `predicate` every 10 ms until it is truthy, and
 * answer its value; past `timeout` ms, throw naming `what`. A test that sleeps a fixed time and then asserts reads a
 * loaded machine's lateness as a failure (two did, on Windows: a 404's `onerror` after 200 ms, a transition sampled once
 * at 120 ms), and one that asserts something did NOT happen after a fixed sleep proves nothing about a late event. Wait
 * for the event, or for a sentinel that is shown to have fired, never for a time.
 *
 * Eight test files each carried their own copy, in three signatures; they all use this one, with their old timeouts
 * passed explicitly so the move changed nothing they assert.
 *
 * @param {() => unknown} predicate polled; a throw counts as not yet
 * @param {string} what named in the timeout's error
 * @param {number} timeout ms
 */
export const until = async (predicate, what, timeout) => {
  if (typeof what !== 'string' || !(timeout > 0)) throw new TypeError('until(predicate, what, timeout): name what you wait for and how long');
  const started = performance.now();
  for (;;) {
    let value;
    try {
      value = predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** `count` animation frames: a real event, not a time, for a test that needs the renderer to have painted. */
export const frames = (count = 1) =>
  new Promise((resolve) => {
    const step = (left) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
