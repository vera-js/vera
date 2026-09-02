/**
 * Geometry: every reading the runtime takes from the page.
 *
 * Two rules hold across the file. Readings are **transform-immune by construction** — layout
 * metrics (`offsetTop`, `offsetWidth`), never visual boxes, so an element's own animation can
 * never feed back into its own timeline. And anything sticky is **stood down for the length of a
 * reading and put back** — both `offsetTop` and a rect follow sticky positioning, which turns a
 * question about the element's slot into one about where the page happens to be scrolled.
 */
export interface WindowSize {
  /** Scroll offset at the leading edge of the viewport. */
  readonly start: number;
  readonly end: number;
  /** Viewport extent along the scroll axis. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /**
   * The furthest `end` can ever get: the scrollport's extent added to how far
   * this container can scroll. What an element's timeline is compared against
   * to know whether the page is long enough to finish it.
   */
  readonly reach: number;
}

export interface ElementBox {
  readonly start: number;
  readonly end: number;
  readonly size: number;
}

/**
 * Whether a node is sticky, remembered for the length of one measure pass.
 *
 * The chains of five thousand elements share their ancestors, so asking the
 * engine per element per level asked it ten thousand times for a handful of
 * answers — and measured: init at 5,000 typical elements went from 35ms to
 * 50ms, interleaved, three runs each. A `getComputedStyle` allocates a
 * declaration object whether or not the style is dirty.
 *
 * Generation-stamped rather than permanent, because a wrapper can be sticky at
 * one width and not at another. `forgetSticky()` is called before each fresh
 * measure, which is when the answer can have changed: a resize, or an explicit
 * `refresh()`. A class toggle that makes a wrapper sticky without either does
 * go stale — and would anyway, since nothing re-measures on a class change, so
 * the cache adds no failure the design did not already have.
 */
let stickyGeneration = 0;
const stickyCache = new WeakMap<Element, { gen: number; sticky: boolean }>();

const isSticky = (node: HTMLElement): boolean => {
  const seen = stickyCache.get(node);
  if (seen && seen.gen === stickyGeneration) return seen.sticky;
  /**
   * `nodeType`, because this walk is handed whatever the page has. Anything
   * that is not an element — a test double, a degraded host — has no computed
   * style to ask about and cannot be sticky either.
   */
  const sticky = node.nodeType === 1 && getComputedStyle(node).position === 'sticky';
  stickyCache.set(node, { gen: stickyGeneration, sticky });
  return sticky;
};

/** Drops what `isSticky` remembers. Call before re-measuring a page. */
export const forgetSticky = (): void => {
  stickyGeneration++;
};

/**
 * The sticky ancestors of one element, walking the offsetParent chain — the element itself
 * included, because `pin` writes `position: sticky` on it. Null when there are none, so the
 * common page allocates nothing.
 */
const stickyAbove = (element: HTMLElement | null): HTMLElement[] | null => {
  let sticky: HTMLElement[] | null = null;
  for (let up = element; up; up = up.offsetParent as HTMLElement | null) {
    if (isSticky(up)) (sticky ??= []).push(up);
  }
  return sticky;
};

/**
 * How many passes are currently holding the page's sticky ancestors down.
 *
 * Non-zero means `standingDownAll` has already done it for a whole batch, and
 * a per-element `standingDown` inside that batch must not write anything: the
 * ancestors are static already, and the write-read-restore it would do costs a
 * forced layout per element for a reading that would not change.
 */
let standing = 0;

/**
 * Stands every sticky ancestor of a whole batch down **once**, for the length
 * of one pass of readings.
 *
 * `standingDown` did this per element, three lines from the reading — so each
 * element wrote style, forced a layout, read, and restored. On a page whose
 * animated elements sit inside a sticky stage, which is an ordinary WordPress
 * shape, `init()` at 5,000 elements took **57 seconds** against 64ms for the
 * same page without the stage, and 2.3 s at 1,000. Same defect as
 * `clearElement`'s, on the other side of the measurement.
 *
 * The union is taken **before** anything is stood down, and the whole batch is
 * measured while every one of them is static — which is not merely faster but
 * the more honest reading: every element gets its flow position at the same
 * instant, rather than each being measured in a page the others are still
 * sticking in.
 *
 * @param nodes the elements about to be measured; their own position counts
 * @param read taken once, with the page's sticky positioning neutralised
 */
export const standingDownAll = <T>(nodes: Iterable<HTMLElement>, read: () => T): T => {
  const sticky = new Set<HTMLElement>();
  for (const node of nodes) for (const up of stickyAbove(node) ?? []) sticky.add(up);
  if (!sticky.size) return read();

  const all = [...sticky];
  const held = all.map((node) => node.style.position);
  for (const node of all) node.style.position = 'static';
  standing++;
  /** `finally` for the same reason `standingDown` has one, and it matters more here. */
  try {
    return read();
  } finally {
    standing--;
    all.forEach((node, i) => { node.style.position = held[i]!; });
  }
};

/**
 * Takes one element's reading with every sticky ancestor stood down, and puts them back.
 *
 * (This docblock sat on `stickyAbove` until 2026-09-01 — describing a `read` parameter that
 * function does not have.) Both measurements need the stand-down for the same reason:
 * `offsetTop` and `getBoundingClientRect` **both** follow sticky positioning, so both answer a
 * question about where the page happens to be scrolled rather than about the element. Standing
 * the ancestors down for the reading is what makes the answer the element's slot.
 *
 * `displacementOf` used to decline entirely under a sticky ancestor instead, which cost it the
 * correction it exists for: the inertia lab's five tracks sit inside a sticky stage **and** carry
 * a per-row transform, so declining left every row's timeline off by its own offset and the
 * tracks stopped lining up. One neutralisation serves both readings and neither has to choose.
 *
 * The inline value is saved and restored rather than cleared: it may be the author's, and it may
 * be the `position: sticky` that `pin` wrote.
 *
 * @param element the element being measured; its own position counts too
 * @param read taken while the ancestors are static
 */
const standingDown = <T>(element: HTMLElement | null, read: () => T): T => {
  /** Already held down for the whole batch — see `standingDownAll`. */
  if (standing > 0) return read();
  const sticky = stickyAbove(element);
  if (!sticky) return read();

  const held = sticky.map((node) => node.style.position);
  for (const node of sticky) node.style.position = 'static';
  /**
   * `finally`, because this stands the page's own layout down for the length
   * of a reading. Anything thrown by `read()` — a hostile host, a rect on
   * something that is not an element — would otherwise leave every sticky
   * wrapper on the page set to `static` for good: a page that would merely
   * have failed to animate instead has its layout permanently altered, by the
   * library, on the way out.
   */
  try {
    return read();
  } finally {
    sticky.forEach((node, i) => { node.style.position = held[i]!; });
  }
};

/**
 * Distance from the document start to the element, walking the offsetParent
 * chain. Deliberately not getBoundingClientRect: this must be unaffected by
 * any transform the animation itself has applied.
 *
 * **The chain ends early for `position: fixed`, and for anything display:none.**
 * `offsetParent` is null in both cases, so the walk returns an offset relative
 * to the viewport rather than the document — a fixed element reads as sitting
 * at the very top of the page.
 *
 * The consequence is worth knowing rather than fixing. A fixed element starts
 * near the end of its own timeline — `viewport / (element + viewport)`, which
 * for a 100px element in a 700px viewport is **0.875 at scroll 0** — and its
 * animation reaches its last keyframe within the first viewport, so it is over
 * before anyone scrolls. Nothing breaks, and nothing is refused.
 *
 * Measured in all three engines by `spikes/fixed-element.mjs`. It used to read
 * "0.929, clamped at 1", from one Chromium session with no fixture kept: the
 * figure is geometry-dependent and neither the element nor the viewport was
 * recorded with it, and the clamp belongs to the *value*, not to
 * `timelinePosition`, which is deliberately unclamped and keeps climbing.
 *
 * Not detected and refused, deliberately. `position` can be set by a media
 * query, so an element fixed at one width is not at another, and a refusal
 * recorded at measure time would be wrong at the next breakpoint. The honest
 * answer is that "when does this enter the scroll window" has no answer for an
 * element that does not scroll — so the library gives a deterministic one and
 * says so here and in the README.
 */
export const calcOffsetStart = (
  element: HTMLElement | null,
  scrollDirection: string
): number => {
  const horizontal = scrollDirection === 'horizontal';
  const walk = (): number => {
    let offsetStart = 0;
    let node = element;
    while (node) {
      offsetStart += horizontal ? node.offsetLeft : node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return offsetStart;
  };

  /**
   * **`offsetTop` follows sticky positioning**, which is the one way this walk
   * is not a layout measurement.
   *
   * A stuck ancestor reports the pinned offset, not the slot the element
   * occupies in the flow, and that number is a function of the scroll
   * position. Measured in all three engines (`spikes/sticky-ancestor.mjs`): an
   * element 850px down, inside a sticky wrapper, measures **2,200** if the
   * page happens to be scrolled there when the measurement is taken. A reload
   * part-way down a sticky section does exactly that, and so does any
   * re-measure while it is stuck — a resize, a font swap, a lazy image — which
   * makes a running animation jump backwards and stay wrong.
   *
   * The element itself is included, because `pin` writes `position: sticky` on
   * it — a pinned element would otherwise measure its own pinned position and
   * drive its own timeline from it.
   */
  return standingDown(element, walk);
};

/**
 * Current scroll offset of a scroll element along one axis.
 *
 * The single reader for this. There were two, and they disagreed: this one's
 * vertical branch read `window.scrollY` unconditionally, ignoring the element
 * entirely, so a custom vertical scroll container animated against the
 * window's scroll position instead of its own. The smooth-scroll module had a
 * correct copy. One implementation, so they cannot diverge again (principle #5).
 */
export const readScrollPosition = (
  scrollElementNode: Window | HTMLElement,
  scrollDirection: string
): number => {
  const horizontal = scrollDirection === 'horizontal';
  if (scrollElementNode === window) {
    if (!horizontal) return window.scrollY;
    /**
     * The document scrolls in its own direction too: in an RTL page
     * `window.scrollX` is 0 at the right edge and negative through the
     * content, exactly the container convention below. The window path
     * skipped this and broke the file's own "one reader, one convention"
     * rule for the one scroller that is not an element.
     */
    return window.scrollX * (isRtl(document.documentElement) ? -1 : 1);
  }
  const node = scrollElementNode as HTMLElement;
  /**
   * Negated in a right-to-left container, where `scrollLeft` is 0 at the right
   * edge and goes negative as the reader moves through the content. Left as it
   * is, every timeline ran backwards: measured in Chromium, an element sat at
   * position 1.169 before anyone scrolled and walked down to -0.831.
   */
  return horizontal ? node.scrollLeft * (isRtl(node) ? -1 : 1) : node.scrollTop;
};

/**
 * How far something *other than this library* has already displaced an element
 * from where the layout tree says it is.
 *
 * `calcOffsetStart` walks `offsetTop`, which is layout position and therefore
 * immune to any transform — that is the whole reason it is used, since the
 * element's own animated transform must never feed back into its own timeline.
 * The cost is that a transform on an **ancestor** is invisible too, and that
 * one moves the element for real: measured in Chromium, a wrapper with
 * `translateY(300px)` left its child measured at 1,500 while it was drawn at
 * 1,800, and the animation ran a third of its timeline early.
 *
 * The difference between where it is drawn and where it is laid out is exactly
 * that displacement. Read **once, before this library writes anything**, so it
 * captures every other cause and none of its own: an ancestor's transform
 * counts, a page-authored inline one counts, and the animation that has not
 * happened yet does not.
 *
 * An ancestor transform that *changes* — a parent this library is itself
 * animating — is not tracked, and cannot be by anything that caches geometry.
 *
 * @param layoutStart what `getElementSize` measured, to subtract
 * @returns the displacement along the scrolled axis, container-relative
 */
export const displacementOf = (
  element: HTMLElement,
  scrollDirection: string,
  layoutStart: number,
  scrollElement?: Window | HTMLElement | null
): number => {
  const horizontal = scrollDirection === 'horizontal';
  const rect = element.getBoundingClientRect();
  /**
   * No box, no displacement to speak of. An element that is `display: none`
   * measures all zeros, and so does everything in a host without layout — and
   * subtracting a real layout position from zero would report the element as
   * displaced by its whole offset, which is worse than not correcting at all.
   * Zero is the answer that changes nothing.
   */
  if (!rect.width && !rect.height) return 0;
  const container = scrollElement && scrollElement !== window ? (scrollElement as HTMLElement) : null;
  /**
   * Declined in a right-to-left container on the horizontal axis, where
   * `getElementSize` has already mirrored the axis and this reading has not.
   * Applied anyway it is not a small error: it undid the mirroring outright and
   * put the element back at position 1.169 before anyone had scrolled, which
   * is the defect that fix exists to remove.
   *
   * Correcting it properly means mirroring this reading too, and the honest
   * reason not to is that the combination — right-to-left, scrolled
   * horizontally, inside an ancestor carrying a transform — is one this can
   * reason about but not readily measure. An uncorrected displacement is a
   * timeline that starts early; a wrongly corrected one is a timeline that
   * runs backwards.
   */
  if (horizontal && isRtl(container ?? document.documentElement)) return 0;
  /**
   * Read with the sticky ancestors stood down, exactly as `calcOffsetStart`
   * reads its side.
   *
   * A rect follows sticky positioning too, so a stuck ancestor makes this a
   * question about where the page is scrolled: the difference between the slot
   * `calcOffsetStart` now reports and the pinned rect is the stick, and
   * correcting by it carried a 1,350px offset for the life of the page.
   *
   * Declining outright was the first fix, and it cost the correction the thing
   * it exists for. The inertia lab's five tracks sit inside a sticky stage
   * **and** carry a per-row transform: declining left every row's timeline off
   * by its own offset, and `spikes/lab-page.mjs` said so. Both readings taken
   * the same way is the answer that needs no trade.
   */
  const drawn = standingDown(element, () => {
    const box = element.getBoundingClientRect();
    return container
      ? (horizontal
        ? box.left - container.getBoundingClientRect().left + container.scrollLeft
        : box.top - container.getBoundingClientRect().top + container.scrollTop)
      : (horizontal ? box.left + window.scrollX : box.top + window.scrollY);
  });
  /**
   * Rounded, because `offsetTop` is an integer and a rect is not. Unrounded,
   * every ordinary element picked up the sub-pixel difference between the two
   * and its whole timeline shifted by a fraction — 44 cells of the acceptance
   * baseline moved by thousandths of a pixel, for elements with no ancestor
   * transform anywhere near them.
   *
   * That is more precise, and it is not what this is for. A correction meant
   * for a 300px displacement should be silent at 0.007px, and staying in
   * `offsetTop`'s own integer domain is what makes it so.
   */
  return Math.round(drawn - layoutStart);
};

/**
 * Whether a scroll container's inline direction runs right to left.
 *
 * Cached per container, because the callers are the hot ones.
 * `readScrollPosition` runs from `getWindowSize` once a frame while scrolling,
 * and `getElementSize` runs per element on every re-measure — a
 * `getComputedStyle` in either is a forced style recalculation on a path this
 * library exists to keep off. A container's `direction` changes about as often
 * as the page's language does, and `refresh()` is the documented way to say it
 * has.
 *
 * Not an `instanceof Element` check: the guard is `getComputedStyle` being
 * absent or refusing, which is also what a test double or a non-DOM host looks
 * like. Left-to-right is the safe answer either way — it is what every reading
 * did before this existed.
 */
let directionGeneration = 0;
const rtlCache = new WeakMap<object, { gen: number; rtl: boolean }>();

/**
 * Drops what `isRtl` remembers. The docblock above has always said `refresh()` is the documented
 * way to report a direction change — and until 2026-09-01 the cache was permanent, so it was not:
 * the promise existed and the mechanism did not. Both re-measure paths call this now, the same
 * generation pattern `forgetSticky` uses.
 */
export const forgetDirection = (): void => {
  directionGeneration++;
};

/** Exported for `scroll-to`, whose tween must write raw `scrollLeft` in the container's own convention. */
export const isRtl = (node: object): boolean => {
  const seen = rtlCache.get(node);
  if (seen && seen.gen === directionGeneration) return seen.rtl;
  {
    let known: boolean;
    try {
      known = getComputedStyle(node as Element).direction === 'rtl';
    } catch {
      known = false;
    }
    rtlCache.set(node, { gen: directionGeneration, rtl: known });
    return known;
  }
};

/**
 * The scrollport's current position and extent, plus the viewport's size.
 *
 * @param scrollDirection which axis the timeline runs along
 * @param scrollElementNode the scrolling container, or window
 * @returns `size` follows the scrollport; `width` and `height` stay the
 * viewport's, because they exist to resolve `vw` and `vh` keyframe positions
 */
export const getWindowSize = (
  scrollDirection: string,
  scrollElementNode: Window | HTMLElement
): WindowSize => {
  const horizontal = scrollDirection === 'horizontal';
  /**
   * `width` and `height` stay the *viewport's*, because they exist to resolve
   * `vw` and `vh` keyframe positions and that is what those units mean.
   */
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = document.documentElement.clientHeight || window.innerHeight;

  /**
   * `size` is the scrollport's extent, which is not the viewport's when the
   * scroll element is a container. Reading the viewport here made a custom
   * `scrollElement` animate against the wrong window entirely — measured on a
   * 400px-tall pane in an 800px viewport, every timeline was stretched by
   * exactly that difference.
   */
  const scroller = scrollElementNode === window ? null : (scrollElementNode as HTMLElement);
  const size = scroller
    ? (horizontal ? scroller.clientWidth : scroller.clientHeight)
    : (horizontal ? width : height);

  const start = readScrollPosition(scrollElementNode, scrollDirection);
  const scrolled = scroller ?? document.documentElement;
  const extent = horizontal
    ? scrolled.scrollWidth - scrolled.clientWidth
    : scrolled.scrollHeight - scrolled.clientHeight;
  return { start, end: start + size, size, width, height, reach: Math.max(0, extent) + size };
};

/**
 * An element's position and extent along the scroll axis.
 *
 * Both readings are **transform-immune by construction**: `offsetTop` walks the
 * layout tree, and `offsetWidth`/`offsetHeight` are layout metrics. That is the
 * whole point of not using `getBoundingClientRect()` here, whose width and
 * height reflect the *visual* box — an element mid-`scale()` would measure its
 * scaled size and feed that back into its own timeline.
 *
 * It also makes re-measuring a pure read. The earlier version measured with a
 * rect, which meant clearing the element's transform first and re-applying it
 * afterwards: a write, then a read, then a write, per element. That is layout
 * thrash, and it showed up as stutter on a cold cache, when every image that
 * arrives triggers another re-measure.
 *
 * The cost is integer rounding — sub-pixel, and irrelevant at the scale scroll
 * geometry works at.
 */
export const getElementSize = (
  element: HTMLElement,
  scrollDirection: string,
  /**
   * The scrolling container, when it is not the window. `calcOffsetStart`
   * walks all the way to the document, so its offset has to come back off
   * again — otherwise the element's position is measured in document
   * coordinates while the scroll position is measured in the container's.
   * Every caller needs it. `scrollTo.ts` passed it when scrolling *to* a
   * target and not when measuring one, which is how the active-link highlight
   * stayed broken inside a custom container long after the runtime was fixed.
   */
  scrollElement?: Window | HTMLElement | null
): ElementBox => {
  let start = calcOffsetStart(element, scrollDirection);
  const container = scrollElement && scrollElement !== window ? (scrollElement as HTMLElement) : null;
  if (container) start -= calcOffsetStart(container, scrollDirection);
  const size = scrollDirection === 'horizontal' ? element.offsetWidth : element.offsetHeight;
  /**
   * Measured from the right edge in a right-to-left container, which is where
   * its content starts and where `scrollLeft` reads 0. `offsetLeft` is still
   * physical, so it already carries the RTL scroll origin — turning it round
   * needs the scrollport's own width and nothing else.
   */
  const scroller = container ?? document.documentElement;
  if (scrollDirection === 'horizontal' && isRtl(scroller)) {
    start = scroller.clientWidth - start - size;
  }
  return { start, end: start + size, size };
};

/**
 * Resolves the `scrollElement` option to something scrollable.
 *
 * `undefined` means the window — the default is not `window` itself, because a
 * module-scope default would touch `window` at import time and break SSR.
 * A string is a CSS selector, resolved once here.
 *
 * Shared by both entry points rather than written twice: the runtime had it and
 * `scroll-to` did not, so the same option accepted a selector in one and not
 * the other. Each bundle inlines its own copy — the deliberate trade: one
 * source, two artifacts.
 *
 * @param option whatever the caller passed for `scrollElement`
 * @returns the container, falling back to the window with a warning
 */
/**
 * A caller that needs to *report* the fallback rather than only warn about it
 * can see it without being told: a string option that came back as `window`
 * did not resolve, since `querySelector` returns an element or nothing. That
 * is how `scrollTo` puts it in its diagnostics, and it is why this stayed a
 * plain function — a reporter parameter here cost the animation runtime bytes
 * for something it cannot use, its `rejected` entries requiring an element.
 */
export const resolveScrollElement = (
  option: Window | HTMLElement | string | undefined,
  report: (reason: string) => void
): Window | HTMLElement => {
  /**
   * **Off a browser, there is nothing to resolve and nothing to say.**
   *
   * `DEFAULTS.scrollElement` is deliberately `undefined` rather than `window`
   * so importing the module on a server does not touch a global that is not
   * there — and then *construction* read `window` here anyway, so
   * `createMotion()` threw `window is not defined` out of an SSR render.
   * Both entry points construct before they start, both are documented as
   * doing nothing until `init()`, and `init()` already returns early through
   * `supports()` where the DOM is absent. Returning the `undefined` option as
   * a nominal window keeps that contract: nothing is resolved, nothing is
   * reported, and the instance is inert exactly as it says it is.
   */
  if (typeof window === 'undefined') return option as Window;
  if (option === undefined) return window;
  /**
   * A node or the window, and nothing else.
   *
   * Anything that is not a string was handed straight back, so a number — which
   * is what a config generated by PHP produces when a field is left as `0` or
   * miscast — became the scroll element, and the first thing to use it as a
   * `WeakMap` key threw `Invalid value used as weak map key` out of `init()`.
   * The selector and the missing-element cases were both handled; the wrong
   * *type* was not, which is the same gap `root` had.
   */
  if (typeof option !== 'string') {
    if (typeof (option as HTMLElement | null)?.addEventListener === 'function') return option;
    report('scrollElement is not an element or a selector; using window.');
    return window;
  }
  try {
    const found = document.querySelector(option) as HTMLElement | null;
    if (found) return found;
    report(`no element matched scrollElement "${option}"; using window.`);
  } catch {
    report(`scrollElement is not valid CSS: ${option}`);
  }
  return window;
};

