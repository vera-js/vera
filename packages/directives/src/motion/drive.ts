/**
 * The driver — the one place JavaScript writes the progress variable, and the pack's only frame
 * loop, SELF-STOPPING by construction.
 *
 * The old write path never needed a loop: smoothing was a CSS transition on the written values, so
 * the runtime stayed event-driven and an idle page ticked nothing. The generated path cannot lean
 * on that — a transition on the registered variable does not retime the seek (measured, all three
 * engines, `motion-registry.test.js`) — so smoothing and play clocks live here instead. The
 * discipline survives: the loop runs only while something is settling or ramping, and stops itself
 * the frame nothing is. An idle page ticks exactly as it did before: never.
 *
 * Two profiles, one tick. A CHASE eases toward a moving target (`inertia`) with an exponential
 * approach — frame-rate independent via `1 - exp(-dt/τ)`, smooth under per-frame retargeting where
 * a restarted tween would stutter, τ = inertia/3 so it reads as "settled" on the old transition's
 * schedule. A RAMP is a play's clock: linear over exactly `play` seconds, because the duration is
 * the author's number and the SHAPE belongs to the keyframes' own per-segment easing, which the
 * sweep test proves the ramp honours. A retargeted ramp restarts from the current written value —
 * reverse-on-exit falls out with no interrupt machinery.
 */
import type { Driven } from './types.js';


const active = new Set<Driven>();
let ticking = false;
let last = 0;

const write = (driven: Driven, value: number): void => {
  driven.written = value;
  driven.node.style.setProperty(driven.varName, String(value));
  /** The function door — same number, same moment as the variable write, contained upstream. */
  driven.run?.(value);
};

const tick = (now: number): void => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const driven of active) {
    if (driven.mode === 'ramp') {
      const t = driven.rampDuration <= 0 ? 1
        : Math.min(1, (now - driven.rampStart) / (driven.rampDuration * 1000));
      write(driven, driven.rampFrom + (driven.target - driven.rampFrom) * t);
      if (t >= 1) { driven.mode = 'idle'; active.delete(driven); }
      continue;
    }
    const gap = driven.target - (driven.written ?? driven.target);
    if (Math.abs(gap) < 0.001) {
      write(driven, driven.target);
      driven.mode = 'idle';
      active.delete(driven);
      continue;
    }
    write(driven, (driven.written ?? 0) + gap * (1 - Math.exp(-dt / driven.tau)));
  }
  if (active.size) requestAnimationFrame(tick);
  else ticking = false;
};

/**
 * REALM NOTE (CODE-PRINCIPLES §2, the stated trade): this loop ticks on the MODULE window's rAF.
 * Writing a portaled element's style from here is legal cross-realm, but the cadence — and any
 * background throttling — is this window's, not the element's. Per-view loops are queued with the
 * per-realm shared sheet; until then a portaled play may stutter when the opener is throttled,
 * which beats being typed or animated in the wrong realm outright.
 */
const ensureTicking = (): void => {
  if (ticking) return;
  ticking = true;
  last = performance.now();
  requestAnimationFrame(tick);
};

/**
 * The scrub write — and the repaint write, which is what keeps every force/latch call site honest
 * with no edits: an idle element writes through immediately, so "repaint what it latched at" is
 * this same call. A first-ever write lands immediately whatever τ says, because there is nothing
 * on screen to ease FROM — easing from the registered initial would play a phantom entrance.
 * While a ramp runs, position updates are bookkeeping only; the clock owns the pixels.
 */
export const syncTo = (driven: Driven, value: number, tau: number): void => {
  if (driven.mode === 'ramp') return;
  driven.target = value;
  if (tau <= 0 || driven.written === null) {
    driven.mode = 'idle';
    active.delete(driven);
    write(driven, value);
    return;
  }
  driven.tau = tau / 3;
  driven.mode = 'chase';
  active.add(driven);
  ensureTicking();
};

/** A play's clock: linear, from wherever the value is, over exactly `seconds`. */
export const rampTo = (driven: Driven, value: number, seconds: number): void => {
  driven.rampFrom = driven.written ?? 0;
  driven.target = value;
  driven.rampStart = performance.now();
  driven.rampDuration = seconds;
  driven.mode = 'ramp';
  active.add(driven);
  ensureTicking();
};

/** Teardown: the loop must never hold a removed element — that is the leak class this pack hunts. */
export const dispose = (driven: Driven): void => {
  driven.mode = 'idle';
  active.delete(driven);
};
