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
 * <p data-vd-size="box" data-vd-show="box.width > 400">only when wide</p>
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
import type { Directive, Ctx } from './types.js';

/* ── the pack's own connector shape (additive rule: nothing imported from the engine) ────── */
type EngineSeams = {
  _$seams$: true;
  directive: (d: Directive) => void;
  reject: (element: Element | null, directive: string, code: string, message: string, fix?: string) => void;
};
type EngineConnector = (seams: EngineSeams) => void;

/** One frame's worth of work per element, however many events asked for it. */
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

/** The key a literal sensor writes to, or null with the refusal already recorded. */
const keyFor = (el: Element, attr: string, ctx: Ctx): string | null => {
  const key = (el.getAttribute(attr) ?? '').trim();
  if (key === '') {
    ctx.reject('sensor-no-key', `${attr} needs the name of a state key to write.`,
      `Write ${attr}="seen" and read it with data-vd-show="seen".`);
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
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-in-view', ctx);
    if (!key) return;
    /**
     * No observer means no way to know — and the honest answer there is VISIBLE, because the
     * alternative hides content from a reader over a capability the page lacks.
     */
    if (typeof IntersectionObserver !== 'function') {
      ctx.set(key, true);
      return;
    }
    let last: boolean | null = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting === last) continue;
        last = entry.isIntersecting;
        ctx.set(key, entry.isIntersecting);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  },
};

/* ── size ────────────────────────────────────────────────────────────────────────────────── */

const size: Directive = {
  name: 'size',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Writes the element's { width, height } to a state key as it changes.",
    example: 'data-vd-size="box"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-size', ctx);
    if (!key) return;
    let last = { width: -1, height: -1 };
    const measure = () => {
      const width = Math.round((el as HTMLElement).offsetWidth);
      const height = Math.round((el as HTMLElement).offsetHeight);
      if (width === last.width && height === last.height) return;
      last = { width, height };
      ctx.set(key, { width, height });
    };
    measure();
    /** Measured once where there is no observer — a fixed answer beats no answer. */
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
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
    const write = coalesce(measure);
    measure();
    window.addEventListener('scroll', write.run, { passive: true });
    window.addEventListener('resize', write.run);
    return () => {
      write.stop();
      window.removeEventListener('scroll', write.run);
      window.removeEventListener('resize', write.run);
    };
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
          context.reject('swipe-not-object', 'data-vd-swipe takes { left: { … }, right: { … } }.');
          programs = {};
          return;
        }
        const entries = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const name of Object.keys(entries)) {
          if (!(DIRECTIONS as readonly string[]).includes(name)) {
            context.reject('swipe-bad-direction', `"${name}" is not a direction — use left, right, up or down.`);
            continue;
          }
          if (!isObject(entries[name] as never)) {
            context.reject('swipe-not-object', `the value for "${name}" must be a braced assignments object.`);
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
  for (const directive of [inView, size, pointer, scrollProgress, swipe]) seams.directive(directive);
};
