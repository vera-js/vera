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
import { dual } from './dual.js';
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
const intersectObservers = new Map<string, { observer: IntersectionObserver; count: number }>();

/**
 * Watch an element's intersection, optionally against a TRIGGER LINE.
 *
 * `margin` is a `rootMargin`, and it is the difference between "is any part of this on screen" and
 * "has this reached a third of the way down" — the second is what a reveal actually wants, and it
 * is height-INDEPENDENT, which no threshold on the element's own travel can be. A tall element and
 * a short one cross the same line at the same place on screen.
 *
 * Observers are keyed by margin: a page using only the default still shares ONE observer, and each
 * distinct trigger line costs exactly one more.
 */
const watchIntersect = (
  el: Element,
  fn: (visible: boolean) => void,
  margin = ''
): (() => void) | null => {
  if (typeof IntersectionObserver !== 'function') return null;
  intersectHandlers.set(el, fn);
  let entry = intersectObservers.get(margin);
  if (!entry) {
    entry = {
      observer: new IntersectionObserver(
        (records) => {
          for (const record of records) intersectHandlers.get(record.target)?.(record.isIntersecting);
        },
        margin ? { rootMargin: margin } : undefined
      ),
      count: 0,
    };
    intersectObservers.set(margin, entry);
  }
  entry.observer.observe(el);
  entry.count++;
  return () => {
    intersectHandlers.delete(el);
    entry.observer.unobserve(el);
    if (--entry.count === 0) {
      entry.observer.disconnect();
      intersectObservers.delete(margin);
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
/** `given` lets a directive whose value carries more than a key hand over just the key. */
const keyFor = (el: Element, attr: string, ctx: Ctx, given?: string): string | null => {
  const key = (given ?? el.getAttribute(attr) ?? '').trim();
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
    summary: 'Writes true when the element crosses a trigger line: "key" or "key 30%".',
    example: 'data-vd-in-view="seen 30%"',
  },
  /**
   * DEGRADED, NEVER DEAD — a server has no observer, so by that rule the answer is `true`. Writing
   * nothing rendered the markup UNREVEALED, which is the exact failure the discipline exists to
   * prevent, in the one place a reader can never recover from it: no JavaScript, ever.
   */
  ssr: (el, _value, ctx) => {
    const key = (el.getAttribute('data-vd-in-view') ?? '').trim().split(/\s+/)[0]?.split(':')[0];
    if (key) ctx.set(key, true);
  },
  setup(el, ctx) {
    /**
     * **A key, and optionally a TRIGGER LINE** — `"seen"` or `"seen 30%"`.
     *
     * Bare, this fires the instant any edge touches the viewport, which is right for "is it on
     * screen" and wrong for a reveal: the element has barely appeared and the animation is over
     * before it is readable. A line is a position ON SCREEN — `30%` means "when it reaches a third
     * of the way down" — and it is HEIGHT-INDEPENDENT, which no measure of the element's own travel
     * can be. A tall card and a short one cross the same line in the same place.
     *
     * Written as a percentage or a fraction, because both readings are natural and neither is worth
     * a refusal: `30%` and `0.3` mean the same thing.
     */
    const raw = (el.getAttribute('data-vd-in-view') ?? '').trim();
    const [name, line] = raw.split(/\s+/);
    /**
     * MODIFIERS ride the key token with the `:viewport` scope's grammar — `"seen:once"`,
     * `"seen:once:down 30%"`. `:once` stops observing after the first true (a reveal is not
     * un-revealed by scrolling away). `:down` is a DIRECTIONAL LATCH, omni's shipped
     * semantics twinned: entering writes true and STAYS true while the reader continues on —
     * the exit EDGE is the direction signal, with zero scroll-position bookkeeping. An exit
     * whose box sits BELOW the viewport (top > 0) means the reader went back UP past it —
     * reset to false so the reveal replays on the way down; an exit off the TOP keeps true.
     */
    const tokens = (name ?? '').split(':');
    const key = keyFor(el, 'data-vd-in-view', ctx, tokens[0]);
    if (!key) return;
    const once = tokens.includes('once');
    const down = tokens.includes('down');

    let margin = '';
    if (line !== undefined) {
      const percent = line.endsWith('%') ? Number(line.slice(0, -1)) : Number(line) * 100;
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        ctx.reject('in-view-bad-line', [line]);
      } else {
        /** The root shrinks to the band above the line, so intersection begins exactly there. */
        margin = `0px 0px -${100 - percent}% 0px`;
      }
    }

    let last: boolean | null = null;
    const stop = watchIntersect(el, (visible) => {
      if (visible === last) return;
      if (down && !visible) {
        /** The directional latch: only a downward exit (the box below the viewport — the
         *  reader went back up) resets; leaving off the top keeps the reveal. */
        if (el.getBoundingClientRect().top <= 0) return;
      }
      last = visible;
      ctx.set(key, visible);
      /**
       * THE EVENT HALF: `vera:in-view` (bubbling, composed, `detail: { visible }`) fires on
       * every transition, because a state write alone cannot TRIGGER anything — fetch listens
       * for events, and "infinite scroll = a sentinel's in-view + place: 'append'" was
       * documented before anything dispatched it (the parity diff caught the gap). The state
       * half remains the reflection surface; this is the trigger surface.
       */
      el.dispatchEvent(new CustomEvent('vera:in-view', { bubbles: true, composed: true, detail: { key, visible } }));
      if (once && visible) stop?.();
    }, margin);
    /**
     * No observer means no way to know — and the honest answer there is VISIBLE, because the
     * alternative hides content from a reader over a capability the page lacks.
     */
    if (!stop) {
      ctx.set(key, true);
      return;
    }
    return stop;
  },
};


/* ── size ────────────────────────────────────────────────────────────────────────────────── */

const size: Directive = {
  name: 'size',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Writes { width, height, scrollWidth, scrollHeight, overflowX, overflowY } as the element resizes.",
    example: 'data-vd-size="box"',
  },
  setup(el, ctx) {
    const rawKey = keyFor(el, 'data-vd-size', ctx);
    /**
     * `:viewport` — the screen-question scope, same grammar as pointer's: writes the WINDOW's
     * inner size on resize instead of this element's box. This is the breakpoint door done the
     * vera way: no named-band table to define or collide over — `data-vd-show="s.width < 768"`
     * says the band inline, and a page pays only when it asks. (The expression-grammar
     * `@screen` alternative was declined: viewport state is a SENSOR's job.)
     */
    const viewport = rawKey?.endsWith(':viewport') ?? false;
    const key = viewport ? rawKey!.slice(0, -':viewport'.length) : rawKey;
    if (!key) return;
    let last: Record<string, number | boolean> = { width: -1, height: -1 };
    const measure = () => {
      const node = el as HTMLElement;
      const width = Math.round(node.offsetWidth);
      const height = Math.round(node.offsetHeight);
      /**
       * **The scroll size and the overflow flags, because "is this overflowing" is the question
       * people actually ask.** A width alone answers "how wide"; it cannot answer whether the
       * content fits, which is what decides between a wrap, a scroller and a truncation. Both are
       * free once the element is being measured anyway, and `overflowX` is the comparison everyone
       * writes by hand and gets subtly wrong (`scrollWidth` is rounded, `clientWidth` is not).
       */
      const scrollWidth = Math.round(node.scrollWidth);
      const scrollHeight = Math.round(node.scrollHeight);
      const next = {
        width,
        height,
        scrollWidth,
        scrollHeight,
        overflowX: scrollWidth > Math.round(node.clientWidth),
        overflowY: scrollHeight > Math.round(node.clientHeight),
      };
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
    const raw = keyFor(el, 'data-vd-pointer', ctx);
    if (!raw) return;
    /**
     * THE `:viewport` SCOPE (ratified with the ambient dual): `data-vd-pointer="p:viewport"`
     * measures across the WHOLE VIEWPORT instead of this element's box — the ambient form, and
     * what `sensors({ pointer: 'p' })` delegates to by setting exactly this attribute on body.
     * The suffix is a scope, not part of the key.
     */
    const viewport = raw.endsWith(':viewport');
    const key = viewport ? raw.slice(0, -':viewport'.length) : raw;
    if (!key) {
      ctx.reject('sensor-no-key', ['data-vd-pointer']);
      return;
    }
    let x = 0.5;
    let y = 0.5;
    let inside = false;
    const write = coalesce(() => ctx.set(key, { x, y, inside }));

    const onMove = (event: Event) => {
      const rect = viewport
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : (el as HTMLElement).getBoundingClientRect();
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
    const moveTarget: EventTarget = viewport ? window : el;
    const leaveTarget: EventTarget = viewport ? el.ownerDocument!.documentElement : el;
    const onLeave = () => {
      x = 0.5;
      y = 0.5;
      inside = false;
      write.run();
    };

    moveTarget.addEventListener('pointermove', onMove);
    leaveTarget.addEventListener('pointerleave', onLeave);
    ctx.set(key, { x, y, inside });
    return () => {
      write.stop();
      moveTarget.removeEventListener('pointermove', onMove);
      leaveTarget.removeEventListener('pointerleave', onLeave);
    };
  },
};

/* ── elect: one-active-among-a-group — the scrollspy election, named for the mechanism ────── */

/**
 * `data-vd-elect="toc"` on each section: the state key holds the id of the section MOST IN VIEW
 * — the owner's sentence, and the semantics omni SHIPPED, twinned here verbatim from their
 * election lore rather than re-derived: one shared TALLY per elected key; every spy reports
 * its intersection RATIO at eleven thresholds (0, .1 … 1 — fine enough to follow scroll,
 * coarse enough that a tally update is not per-pixel; their measured tuning knob); every
 * report re-runs the election over the whole tally; ties resolve first-wins in insertion
 * order, which is document order for static markup — the earlier section keeps it, no
 * hysteresis needed at eleven steps. The empty string is the no-winner value, SEEDED at group
 * birth so reflections never undefined-flash. A departing spy deletes its tally row on
 * teardown, or a removed section could win forever. An election needs coordination between
 * observers — per-element booleans structurally cannot pick one of two adjacent sections both
 * legitimately in view — which is why this is a directive and not a recipe.
 */
const ELECT_THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
interface ElectGroup {
  readonly members: Map<Element, { ratio: number; ctx: Ctx }>;
  observer: IntersectionObserver | null;
  current: string | null;
}
const electGroups = new Map<string, ElectGroup>();

const runElection = (key: string, group: ElectGroup): void => {
  let best: { el: Element; ctx: Ctx; ratio: number } | null = null;
  for (const [el, member] of group.members) {
    if (member.ratio > 0 && (!best || member.ratio > best.ratio)) best = { el, ctx: member.ctx, ratio: member.ratio };
  }
  const id = best ? best.el.id : '';
  if (id === group.current) return;
  group.current = id;
  (best?.ctx ?? [...group.members.values()][0]?.ctx)?.set(key, id);
};

const elect: Directive = {
  name: 'elect',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Elects the section MOST IN VIEW among all elements sharing this key — the state key holds its id, '' when none.",
    example: 'data-vd-elect="toc"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-elect', ctx);
    if (!key) return;
    if (!el.id) {
      ctx.reject('elect-no-id');
      return;
    }
    let group = electGroups.get(key);
    if (!group) {
      group = { members: new Map(), observer: null, current: null };
      electGroups.set(key, group);
      if (typeof IntersectionObserver === 'function') {
        const forKey = key;
        const forGroup = group;
        group.observer = new IntersectionObserver((records) => {
          for (const record of records) {
            const member = forGroup.members.get(record.target);
            if (member) member.ratio = record.isIntersecting ? record.intersectionRatio : 0;
          }
          runElection(forKey, forGroup);
        }, { threshold: ELECT_THRESHOLDS });
      }
      /** Seeded, so `data-vd-class="{ active: toc == 'intro' }"` never reads undefined. */
      ctx.set(key, '');
      group.current = '';
    }
    group.members.set(el, { ratio: 0, ctx });
    if (group.observer) group.observer.observe(el);
    /** No observer, no election — the FIRST member becomes current: a nav highlighting
     *  something sensible is the readable-page answer. */
    else if (group.current === '') {
      group.current = el.id;
      ctx.set(key, el.id);
    }
    return () => {
      group!.observer?.unobserve(el);
      group!.members.delete(el);
      runElection(key, group!);
      if (group!.members.size === 0) {
        group!.observer?.disconnect();
        electGroups.delete(key);
      }
    };
  },
};

/* ── scroll-progress ─────────────────────────────────────────────────────────────────────── */

const scrollProgress: Directive = {
  name: 'scroll-progress',
  value: 'literal',
  priority: 60,
  docs: {
    summary: 'Writes 0→1 as the element travels the viewport — or as the DOCUMENT scrolls.',
    example: 'data-vd-scroll-progress="@scroll document"',
  },
  setup(el, ctx) {
    /**
     * **A key, and optionally what to measure** — `"p"` or `"@scroll document"`.
     *
     * Bare, this is the element's own travel. `document` measures the PAGE instead: 0 at the top,
     * 1 at the bottom. Written to an `@key` it becomes a page-global any expression can read with
     * nothing declared — `data-vd-style="{ --p: @scroll }"` — which is the reading-progress bar,
     * the condensed nav, the parallax that depends on where the page is rather than where an
     * element is. One attribute instead of four, and the same sensor rather than a second one.
     */
    const raw = (el.getAttribute('data-vd-scroll-progress') ?? '').trim();
    const [name, of] = raw.split(/\s+/);
    const key = keyFor(el, 'data-vd-scroll-progress', ctx, name);
    if (!key) return;
    if (of !== undefined && of !== 'document') {
      ctx.reject('scroll-progress-bad-source', [of]);
      return;
    }
    const wholeDocument = of === 'document';

    let last = -1;
    const measure = () => {
      let value: number;
      if (wholeDocument) {
        const doc = el.ownerDocument.documentElement;
        const travel = doc.scrollHeight - doc.clientHeight;
        value = travel <= 0 ? 0 : doc.scrollTop / travel;
      } else {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const span = window.innerHeight + rect.height;
        /**
         * 0 is the moment the element begins entering the viewport and 1 the moment it has
         * completely left — the same quantity `data-vd-motion` normalises against, so a page can
         * mix a motion animation and a progress read and have them agree.
         */
        value = span === 0 ? 0 : (window.innerHeight - rect.top) / span;
      }
      const rounded = Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 1000;
      if (rounded === last) return;
      last = rounded;
      ctx.set(key, rounded);
    };
    measure();
    return watchScroll(measure);
  },
};

/**
 * `scroll-direction` — which way the page is currently moving: `'down'`, `'up'`, or `''` at rest.
 *
 * The missing half of a reveal. `in-view` says an element is on screen and `scroll-progress` says
 * how far through it is, but neither says which WAY the reader is going — so "play it in, and let
 * it play back out only when they scroll back up" could not be expressed at all, and every
 * direction-aware pattern (a header that hides going down and returns going up, a reveal that
 * reverses one way and holds the other) needed hand-written JavaScript.
 *
 * A reading rather than an event, so it composes: a class toggles from it, and `data-vd-motion`'s
 * `when` selector animates from the class. That is the whole four-mode reveal vocabulary out of
 * pieces that already existed, with no new setting on the motion side.
 */
const scrollDirection: Directive = {
  name: 'scroll-direction',
  value: 'literal',
  priority: 60,
  docs: {
    summary: "Writes 'down', 'up', or '' at rest, as the page scrolls.",
    example: 'data-vd-scroll-direction="dir"',
  },
  setup(el, ctx) {
    const key = keyFor(el, 'data-vd-scroll-direction', ctx);
    if (!key) return;
    let previous = window.scrollY;
    let last = '';
    const read = () => {
      const now = window.scrollY;
      /**
       * A dead band, because a trackpad delivers sub-pixel jitter in both directions at rest and a
       * reveal that flickers between its two states is worse than one that does nothing. Two
       * pixels is below the threshold of a deliberate scroll and above the noise.
       */
      if (Math.abs(now - previous) < 2) return;
      const value = now > previous ? 'down' : 'up';
      previous = now;
      if (value === last) return;
      last = value;
      ctx.set(key, value);
    };
    return watchScroll(read);
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

/**
 * `wireDirectives([sensors])` bare, or `sensors({ pointer: 'p' })` — the AMBIENT dual, ratified
 * as both doors with ONE implementation: the called form is for platform devs who cannot author
 * markup (a WP theme, an embedder), and it DELEGATES by setting `data-vd-pointer="<key>:viewport"`
 * on `<body>` — literally the markup composition, so the two doors cannot drift and the docs
 * define one in terms of the other. Discipline over door-count.
 */
export interface SensorsOptions {
  /** State key the viewport-scoped pointer writes to — `sensors({ pointer: 'p' })` is
   *  `<body data-vd-pointer="p:viewport">` said from JavaScript. */
  readonly pointer?: string;
}

const connect = (options?: SensorsOptions): EngineConnector => (seams) => {
  for (const directive of [inView, size, pointer, elect, scrollProgress, scrollDirection, swipe]) seams.directive(directive);
  const ambient = options?.pointer;
  if (typeof ambient === 'string' && ambient !== '' && typeof document !== 'undefined') {
    const apply = () => document.body?.setAttribute('data-vd-pointer', `${ambient}:viewport`);
    /** A head-loaded CDN script wires before <body> exists; the delegation waits for it. */
    if (document.body) apply();
    else document.addEventListener('DOMContentLoaded', apply, { once: true });
  }
};

export const sensors = dual<SensorsOptions>(connect);
