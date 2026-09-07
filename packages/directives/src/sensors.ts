/**
 * The SENSORS pack — the missing third of the system's symmetry.
 *
 * Reflections write state to the DOM (`show`, `class`, `text`). Events write state from the user
 * (`on-*`). Nothing wrote state from the ENVIRONMENT — whether an element is on screen, how big
 * it is, where the pointer is over it, how far it has travelled through the viewport — and none of
 * those are reachable any other way: CSS has no `--mouse-x`, container queries can style by a size
 * but cannot hand it to logic, and the expression tier is deliberately PURE so it can never read
 * an event. Without these, a tilt card, a spotlight, a "have they seen it" flag and a gesture are
 * not merely missing but impossible to express in markup.
 *
 * Each sensor NAMES a state key and writes to it; everything else on the page is the vocabulary
 * that already exists. That is the whole design:
 *
 * ```html
 * <img data-vd-in-view="seen" data-vd-class="{ 'is-revealed': seen }" />
 * <div data-vd-pointer="p" data-vd-style="{ '--tilt': (p.x - 0.5) * 20 }"></div>
 * <p data-vd-measure="box" data-vd-show="box.width > 400">only when wide</p>
 * ```
 *
 * **Three disciplines hold throughout**, and each is load-bearing rather than tidy:
 *
 * 1. **Coalesced to a frame.** `pointermove` and `scroll` fire far faster than paint, and one
 *    measurement per frame is all a transform can consume.
 * 2. **Written only on CHANGE.** A sensor writing an equal value would re-run every hook that
 *    reads it, for ever — the fixed-point rule `region` also obeys.
 * 3. **Degraded, never dead.** Where `IntersectionObserver`/`ResizeObserver` do not exist (an old
 *    engine, a server, a test DOM), the sensor reports the READABLE answer — in view, measured
 *    once — because content the page cannot sense must still be content the reader can see.
 */
import { isObject } from './parse.js';
import type { Directive, Ctx, EngineConnector } from './types.js';


/* ── shared machinery: ONE of each observer for the page, not one per element ─────────────── */

/**
 * **The platform is built for this and the naive shape is not.** `IntersectionObserver.observe()`
 * takes many targets, so a page with two hundred revealed images wants ONE observer with two
 * hundred targets — not two hundred observers. The same repo has measured what the other way
 * costs: `@verajs/autoloader` moved to one shared observer after per-root observers billed
 * **779 ms to mount 400 components**, and its comment says exactly why. A sensor is a leaf, so the
 * count is larger, not smaller.
 *
 * Each registry is created at the FIRST subscriber and released with the LAST, which keeps the
 * pack's founding promise one level deeper: a page that wires sensors but never uses one pays for
 * no object, no listener and no frame.
 */
const intersectHandlers = new WeakMap<Element, (visible: boolean) => void>();
let intersectObserver: IntersectionObserver | null = null;
let intersectCount = 0;

const watchIntersect = (el: Element, fn: (visible: boolean) => void): (() => void) | null => {
  if (typeof IntersectionObserver !== 'function') return null;
  intersectHandlers.set(el, fn);
  intersectObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) intersectHandlers.get(entry.target)?.(entry.isIntersecting);
  });
  intersectObserver.observe(el);
  intersectCount++;
  return () => {
    intersectHandlers.delete(el);
    intersectObserver?.unobserve(el);
    if (--intersectCount === 0) {
      intersectObserver?.disconnect();
      intersectObserver = null;
    }
  };
};

const resizeHandlers = new WeakMap<Element, () => void>();
let resizeObserver: ResizeObserver | null = null;
let resizeCount = 0;

const watchResize = (el: Element, fn: () => void): (() => void) | null => {
  if (typeof ResizeObserver !== 'function') return null;
  resizeHandlers.set(el, fn);
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) resizeHandlers.get(entry.target)?.();
  });
  resizeObserver.observe(el);
  resizeCount++;
  return () => {
    resizeHandlers.delete(el);
    resizeObserver?.unobserve(el);
    if (--resizeCount === 0) {
      resizeObserver?.disconnect();
      resizeObserver = null;
    }
  };
};

/**
 * ONE scroll listener and ONE animation frame for the whole page, whatever the subscriber count.
 * Per-element listeners each with their own frame is the shape that makes a long page stutter:
 * scroll fires far faster than paint, and N listeners scheduling N frames does N times the work
 * to produce one paint's worth of answer. The motion pack's scroll listener is the same design
 * and says the same thing.
 */
const scrollSubscribers = new Set<() => void>();
let scrollFrame: number | null = null;
let scrollBound = false;

const runScrollPass = () => {
  if (scrollFrame !== null) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    for (const fn of scrollSubscribers) fn();
  });
};

const watchScroll = (fn: () => void): (() => void) => {
  scrollSubscribers.add(fn);
  if (!scrollBound) {
    scrollBound = true;
    window.addEventListener('scroll', runScrollPass, { passive: true });
    window.addEventListener('resize', runScrollPass);
  }
  return () => {
    scrollSubscribers.delete(fn);
    if (scrollSubscribers.size) return;
    window.removeEventListener('scroll', runScrollPass);
    window.removeEventListener('resize', runScrollPass);
    scrollBound = false;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };
};

/** Per-element coalescing, for the readings only that element's own events can drive. */
const coalesce = (fn: () => void): { run: () => void; stop: () => void } => {
  let frame: number | null = null;
  return {
    run: () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        fn();
      });
    },
    stop: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
};

/** The fixed-point rule, in one place: a sensor that writes an equal value re-runs every hook
 *  that reads it, for ever. `region` obeys the same rule; this is the shared spelling of it. */
const same = (a: Record<string, number | boolean>, b: Record<string, number | boolean>): boolean => {
  for (const key of Object.keys(b)) if (a[key] !== b[key]) return false;
  return true;
};

/** The key a literal sensor writes to, or null with the refusal already recorded. */
const keyFor = (el: Element, attr: string, ctx: Ctx): string | null => {
  const key = (el.getAttribute(attr) ?? '').trim();
  if (key === '') {
    ctx.reject('sensor-no-key', [attr]);
    return null;
  }
  return key;
};

/* ── in-view ─────────────────────────────────────────────────────────────────────────────── */

const inView: Directive = {
  name: 'in-view',
  value: 'literal',
  priority: 60,
  docs: {
    summary: 'Writes true to a state key while the element is on screen.',
    example: 'data-vd-in-view="seen"',
  },
  /**
   * DEGRADED, NEVER DEAD — this file's third discipline, applied where it matters most. A server
   * has no observer, so by that rule the answer is `true`; writing nothing meant server markup
   * rendered UNREVEALED, which is the exact failure the discipline exists to prevent, in the one
   * place a reader can never recover from it: no JavaScript, ever.
   */
  ssr: (el, _value, ctx) => {
    const key = (el.getAttribute('data-vd-in-view') ?? '').trim();
    if (key) ctx.set(key, true);
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-in-view', ctx);
    if (!key) return;
    /**
     * No observer means no way to know — and the honest answer there is VISIBLE, because the
     * alternative hides content from a reader over a capability the page lacks.
     */
    let last: boolean | null = null;
    const stop = watchIntersect(el, (visible) => {
      if (visible === last) return;
      last = visible;
      ctx.set(key, visible);
    });
    if (!stop) {
      ctx.set(key, true);
      return;
    }
    return stop;
  },
};

/* ── size ────────────────────────────────────────────────────────────────────────────────── */

const measure: Directive = {
  name: 'measure',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Writes the element's { width, height } to a state key as it changes.",
    example: 'data-vd-measure="box"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-measure', ctx);
    if (!key) return;
    let last = { width: -1, height: -1 };
    const measure = () => {
      const width = Math.round((el as HTMLElement).offsetWidth);
      const height = Math.round((el as HTMLElement).offsetHeight);
      const next = { width, height };
      if (same(last, next)) return;
      last = next;
      ctx.set(key, next);
    };
    measure();
    /** Measured once where there is no observer — a fixed answer beats no answer. */
    return watchResize(el, measure) ?? undefined;
  },
};

/* ── pointer ─────────────────────────────────────────────────────────────────────────────── */

const pointer: Directive = {
  name: 'pointer',
  value: 'literal',
  priority: 60,
  docs: {
    summary: 'Writes the pointer position over this element as { x, y, inside }, normalised 0→1.',
    example: 'data-vd-pointer="p"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-pointer', ctx);
    if (!key) return;
    let x = 0.5;
    let y = 0.5;
    let inside = false;
    const write = coalesce(() => ctx.set(key, { x, y, inside }));

    const onMove = (event: Event) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointerEvent = event as unknown as { clientX: number; clientY: number };
      x = Math.min(Math.max((pointerEvent.clientX - rect.left) / rect.width, 0), 1);
      y = Math.min(Math.max((pointerEvent.clientY - rect.top) / rect.height, 0), 1);
      inside = true;
      write.run();
    };
    /**
     * Leaving RE-CENTRES rather than freezing: a tilt card returns to rest instead of holding the
     * angle it happened to exit at, which reads as a bug on every page that has one.
     */
    const onLeave = () => {
      x = 0.5;
      y = 0.5;
      inside = false;
      write.run();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    ctx.set(key, { x, y, inside });
    return () => {
      write.stop();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  },
};

/* ── scroll-progress ─────────────────────────────────────────────────────────────────────── */

const scrollProgress: Directive = {
  name: 'scroll-progress',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Writes 0→1 as the element travels through the viewport.",
    example: 'data-vd-scroll-progress="p"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-scroll-progress', ctx);
    if (!key) return;
    let last = -1;
    const measure = () => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const span = window.innerHeight + rect.height;
      /**
       * 0 is the moment the element begins entering the viewport and 1 the moment it has
       * completely left — the same quantity `data-vd-motion` normalises against, so a page can
       * mix a motion animation and a progress read and have them agree.
       */
      const raw = span === 0 ? 0 : (window.innerHeight - rect.top) / span;
      const value = Math.round(Math.min(Math.max(raw, 0), 1) * 1000) / 1000;
      if (value === last) return;
      last = value;
      ctx.set(key, value);
    };
    measure();
    return watchScroll(measure);
  },
};

/* ── swipe ───────────────────────────────────────────────────────────────────────────────── */

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;

/**
 * `swipe` is an EVENT, not a reading, so it takes assignments the way `on-*` does — and the
 * direction is a KEY rather than a suffix, which is the same "names select, values configure"
 * shape `every` uses for its intervals.
 */
const swipe: Directive = {
  name: 'swipe',
  value: 'object',
  priority: 70,
  docs: {
    summary: 'Runs assignments on a swipe: { left: { … }, right: { … } }.',
    example: "data-vd-swipe=\"{ left: { page: page + 1 } }\"",
  },
  setup(el, ctx) {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    /**
     * The per-direction programs, held in the CLOSURE rather than stashed back onto the element:
     * `apply` already receives them parsed, and re-serialising an object just so a handler could
     * re-read it as text would be inventing work the engine has already done.
     */
    let programs: Record<string, unknown> = {};
    /** Short enough to be a flick rather than a drag, long enough not to fire on a tap. */
    const MIN = 40;

    const onDown = (event: Event) => {
      const e = event as unknown as { clientX: number; clientY: number };
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    };
    const onCancel = () => {
      tracking = false;
    };
    const onUp = (event: Event) => {
      if (!tracking) return;
      tracking = false;
      const e = event as unknown as { clientX: number; clientY: number };
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      /** The DOMINANT axis decides, so a diagonal drag is one gesture rather than two. */
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const distance = horizontal ? dx : dy;
      if (Math.abs(distance) < MIN) return;
      const direction = horizontal ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      const program = programs[direction];
      if (program) ctx.run(program as never);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);

    return {
      teardown: () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
      },
      /**
       * Read here rather than in the handler so an edited attribute re-runs — and a direction the
       * grammar does not have is refused by name, because a silent `data-vd-swipe="{ sideways: … }"`
       * is a gesture that never fires with nothing said about it.
       */
      apply: (_element: Element, value: unknown, context: Ctx) => {
        if (!isObject(value as never)) {
          context.reject('swipe-not-object');
          programs = {};
          return;
        }
        const entries = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const name of Object.keys(entries)) {
          if (!(DIRECTIONS as readonly string[]).includes(name)) {
            context.reject('swipe-bad-direction', [name]);
            continue;
          }
          if (!isObject(entries[name] as never)) {
            context.reject('swipe-entry-not-object', [name]);
            continue;
          }
          next[name] = entries[name];
        }
        programs = next;
      },
    };
  },
};

/** `wireDirectives([sensors])` — no options; each sensor is inert until an element names a key. */
export const sensors: EngineConnector = (seams) => {
  for (const directive of [inView, measure, pointer, scrollProgress, swipe]) seams.directive(directive);
};
