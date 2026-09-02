/**
 * Smooth scrolling to in-page anchors.
 *
 * Ported from an earlier standalone scroll-to script, where it was loose top-level code. It
 * defers to the rest of the library at every overlap: easings from easings.ts,
 * offsets from dom.calcOffsetStart, and target geometry measured once and
 * cached rather than read per scroll event.
 */
import { resolveCurve } from './easings.js';
import { getElementSize, getWindowSize, resolveScrollElement, readScrollPosition, isRtl, forgetDirection } from './dom.js';
import { supports, prefersReducedMotion } from './supports.js';
import { scrollListener, resizeListener } from './eventListeners.js';
import { SCROLL_TARGET_ATTRIBUTE } from './namespace.js';

const FALLBACK_EASING = 'ease-in-out';

/**
 * The percent-decoded fragment, or the fragment unchanged when it will not
 * decode. `decodeURIComponent` throws on a lone `%`, and `id="100%"` is a legal
 * id — so a malformed sequence must fall back rather than take the link out.
 */
const decodeFragment = (fragment: string): string => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
};

export interface ScrollToOptions {
  /** Which links become smooth-scroll triggers. */
  selector?: string;
  duration?: number;
  easing?: string;
  /** Pixels to stop short, for a sticky header. */
  offset?: number;
  activeClass?: string;
  /** Fraction of the viewport at which a section counts as current. */
  activeThreshold?: number;
  /**
   * Write the arrived-at section into the address bar.
   *
   * `replaceState`, so clicking anchors never grows the back stack: a nav with
   * eight links would otherwise make Back a tour of the page rather than a way
   * off it. The trade is that Back does not return to the previous section
   * either — the click is intercepted, so the native history entry an anchor
   * would have made never happens. `spikes/scrollto-hash.mjs` holds both
   * halves.
   */
  updateHash?: boolean;
  cancelOnUserInput?: boolean;
  scrollDirection?: 'vertical' | 'horizontal';
  scrollElement?: Window | HTMLElement | string;
  respectReducedMotion?: boolean;
  root?: ParentNode;
  /**
   * Move focus to the target after arriving.
   *
   * Preventing the default anchor navigation also prevents the focus move that
   * comes with it, which strands keyboard and screen-reader users at the top of
   * the document while the page visibly scrolls elsewhere. On by default;
   * turning it off is a deliberate accessibility regression.
   */
  manageFocus?: boolean;
}

interface Link {
  readonly node: HTMLElement;
  /**
   * `null` marks a top-of-document link — HTML's fragment fallback makes
   * `#top` mean "scroll to the top" when nothing carries the id, so there is
   * no target element and no id to hold. Not a sentinel string, because any
   * string is a legal id.
   */
  readonly id: string | null;
}

interface Target {
  readonly id: string;
  readonly node: HTMLElement;
  start: number;
  end: number;
}

/**
 * One thing this instance could not use, for diagnostics.
 *
 * The runtime has had `instance.rejected` since the attribute audit; smooth
 * scrolling had nothing, so a nav pointing at an id that does not exist was
 * silently inert. `node` is null when the problem is the instance's own
 * configuration rather than a particular link.
 */
export interface ScrollToProblem {
  readonly node: Element | null;
  readonly reason: string;
}

export interface ScrollToInstance {
  init(): void;
  destroy(): void;
  refresh(): void;
  update(): void;

  /** Re-scan for links and targets. Call after the page adds or removes some. */
  collect(): void;

  /** Editor toggle, mirroring the animation runtime's. */
  enable(): void;
  disable(): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
  /** Links and configuration this instance could not use. Empty when all is well. */
  readonly rejected: readonly ScrollToProblem[];
  toElement(node: HTMLElement, options?: { duration?: number; easing?: string; offset?: number; onComplete?: () => void }): void;
  toPosition(destination: number, options?: { duration?: number; easing?: string; onComplete?: () => void }): void;
  cancel(): void;
}

const DEFAULTS = {
  selector: 'a[href*="#"]',
  duration: 1000,
  easing: FALLBACK_EASING,
  offset: 0,
  activeClass: 'active',
  activeThreshold: 0.5,
  updateHash: false,
  cancelOnUserInput: true,
  scrollDirection: 'vertical',
  respectReducedMotion: true,
  manageFocus: true,
} as const;

/**
 * Every option name there is: the defaults, plus the two that have none.
 *
 * `scrollElement` and `root` cannot sit in `DEFAULTS` — both are resolved from
 * whatever the page passes rather than defaulted to a value — so they are named
 * here, and audit rule 25 holds this set to `ScrollToOptions`.
 */
const KNOWN_OPTIONS = new Set([...Object.keys(DEFAULTS), 'scrollElement', 'root']);

/**
 * Keys that scroll. `keydown` on its own would cancel an in-flight tween when
 * someone typed into a form field, which is not user-initiated scrolling.
 */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

/**
 * Positions are **distance travelled**, the same coordinate `readScrollPosition` answers in —
 * which in a right-to-left container is the negation of raw `scrollLeft` (0 at the right edge,
 * growing as the reader moves through the content). This is the write half of that convention.
 *
 * A local `readPosition` copy lived here until 2026-09-01, raw and unmirrored — while
 * `getElementSize` hands this module *mirrored* target geometry. In an RTL horizontal container
 * the two coordinate systems never met: no link could test active, and the tween's `Math.max(0,…)`
 * clamp pinned every journey to the start edge, the reachable raw range being negative. One
 * reader, one writer, one convention — `dom.ts`'s "single reader" claim is true again.
 */
const writePosition = (scrollElement: Window | HTMLElement, horizontal: boolean, position: number): void => {
  if (scrollElement === window) {
    /**
     * The other axis is left where it is. `window.scrollTo` takes both
     * coordinates, and passing a literal `0` for the one not being tweened
     * *set* it to zero — so on any page that was scrolled sideways at all, a
     * vertical anchor jump snapped it back to the left edge, sixty times a
     * second for the length of the tween.
     */
    window.scrollTo(
      /** The container convention, for the document: raw scrollX is negative in an RTL page. */
      horizontal ? (isRtl(document.documentElement) ? -position : position) : window.scrollX,
      horizontal ? window.scrollY : position
    );
    return;
  }
  const node = scrollElement as HTMLElement;
  if (horizontal) node.scrollLeft = isRtl(node) ? -position : position;
  else node.scrollTop = position;
};

/**
 * How many live instances currently treat an element as a target.
 *
 * The marker is one attribute and instances are not aware of each other, so
 * the last one to let go has to be the one that removes it. Without the count,
 * a page with a main nav and a sidebar nav pointing at the same sections lost
 * the marker the moment *either* instance was destroyed or re-collected, while
 * the other was still live and still tracking the element.
 *
 * Weak, so an element that leaves the document takes its count with it.
 */
const markCounts = new WeakMap<Element, number>();

/** @param node the element becoming a target for one more instance */
const mark = (node: Element, attribute: string): void => {
  markCounts.set(node, (markCounts.get(node) ?? 0) + 1);
  node.setAttribute(attribute, '');
};

/** @param node the element one instance has stopped treating as a target */
const unmark = (node: Element, attribute: string): void => {
  const remaining = (markCounts.get(node) ?? 1) - 1;
  if (remaining > 0) {
    markCounts.set(node, remaining);
    return;
  }
  markCounts.delete(node);
  node.removeAttribute(attribute);
};

/** The furthest the element can actually scroll; tweening past it renders nothing. */
const maxScroll = (scrollElement: Window | HTMLElement, horizontal: boolean): number => {
  const node = scrollElement === window ? document.documentElement : (scrollElement as HTMLElement);
  return horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
};

/**
 * Creates a smooth-scroll instance for in-page anchors.
 *
 * Imperative navigation rather than scroll-driven rendering, which is why it
 * ships as its own entry point and shares no state with the animation runtime.
 *
 * @param options overrides for the defaults above
 */
export const createScrollTo = (options: ScrollToOptions = {}): ScrollToInstance => {
  const settings = { ...DEFAULTS, ...options };
  /**
   * An option present with the value `undefined` means **not given**, not
   * "off" — the same fix `createMotion` carries, and the same reason. A spread
   * lets an explicit `undefined` win, so `manageFocus: undefined` and
   * `cancelOnUserInput: undefined` both came out **off** against defaults of
   * `true`. `{ manageFocus: config.focus }` with the key absent is how
   * generated code is written.
   */
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined && key in DEFAULTS) {
      (settings as Record<string, unknown>)[key] = (DEFAULTS as Record<string, unknown>)[key];
    }
  }

  /**
   * A selector that did not resolve, reported back rather than deduced.
   *
   * This was a deduction — a *string* option that came back as `window` can
   * only have fallen through — because `resolveScrollElement`'s reporter
   * parameter had been removed as 13 wasted bytes: the animation runtime could
   * not use it, its `rejected` entries requiring an element that a
   * configuration mistake does not have. That is no longer true, so the
   * reporter is back and both entry points use it.
   *
   * Worth the round trip: the deduction could say only *that* the selector did
   * not resolve. The reporter says which — a selector that matched nothing and
   * a selector that is not valid CSS are different mistakes, and only one of
   * them is a typo in a name.
   *
   * Held rather than pushed once, because `collect()` empties `problems` and
   * this is a property of the instance rather than of the current markup — just
   * as true after a re-scan as before it.
   */
  /**
   * Numeric options, checked the way `duration` and `easing` already are.
   *
   * `offset` and `activeThreshold` went through nothing. `parseInt` of a bad
   * config string is `NaN`, and both feed arithmetic that has no other guard:
   * a `NaN` offset makes every destination `NaN`, so the tween runs its whole
   * duration and arrives nowhere, and a `NaN` threshold makes every comparison
   * false, so no link is ever the active one. Both look exactly like the
   * feature being broken.
   *
   * Held rather than pushed, for the same reason `scrollElementProblem` is:
   * `collect()` empties `problems`, and a bad option is a property of the
   * instance rather than of the current markup.
   */
  const configProblems: string[] = [];
  const refuse = (reason: string, name: keyof typeof DEFAULTS): void => {
    configProblems.push(reason);
    console.warn(`@verajs/motion: scrollTo ${reason}`);
    (settings as Record<string, unknown>)[name] = DEFAULTS[name];
  };

  /**
   * An option name this entry point does not have — the same check
   * `createMotion` makes, on the same argument. Every *value* below is
   * validated and every bad one reported; the key was not, so
   * `createScrollTo({ dration: 500 })` tweened for a second and said nothing.
   *
   * Both entry points, because the reason this is worth bytes at all is that
   * one GUI reads both and generates the objects for both. A check on one of
   * them is the same one-entry-point asymmetry this package keeps having to
   * remove, in the other direction.
   */
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) {
      configProblems.push(`"${key}" is not an option createScrollTo has`);
      console.warn(`@verajs/motion: scrollTo "${key}" is not an option it has`);
    }
  }
  /**
   * The same refusal `createMotion` makes, and for the same reason it made it:
   * anything that is not one of the two was read **as** vertical in silence, so
   * a typo scrolled the wrong axis with nothing to find. The animation entry
   * point fixed that and this one never did — the asymmetry this pass keeps
   * turning up, one GUI reading both.
   */
  if (settings.scrollDirection !== 'vertical' && settings.scrollDirection !== 'horizontal') {
    refuse(
      `scrollDirection ${JSON.stringify(settings.scrollDirection)} is not 'vertical' or ` +
      "'horizontal'; using vertical.",
      'scrollDirection'
    );
  }

  /**
   * A boolean option that is not a boolean — the same refusal `createMotion`
   * makes, derived from `DEFAULTS` so a new boolean option is covered by
   * existing. `manageFocus: 'no'` and `cancelOnUserInput: 'no'` are both
   * truthy, so both came out **on** when the author had written off.
   */
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback !== 'boolean') continue;
    const given = (options as Record<string, unknown>)[key];
    if (given === undefined || typeof given === 'boolean') continue;
    refuse(
      `${key} must be true or false, not ${JSON.stringify(given)}; using ${fallback}`,
      key as keyof typeof DEFAULTS
    );
  }

  /** `duration` is not here: `durationFor` covers it, and the per-call override too. */
  for (const name of ['offset', 'activeThreshold'] as const) {
    if (Number.isFinite(settings[name])) continue;
    /** `String`, not `JSON.stringify`, which renders NaN as `null`. */
    refuse(`${name} ${String(settings[name])} is not a number; using ${DEFAULTS[name]}`, name);
  }

  /**
   * And a threshold outside the viewport it is a fraction of.
   *
   * `activeThreshold` is "fraction of the viewport at which a section counts as
   * current", so `5` puts the line five screens down and `-1` one screen up:
   * no section ever contains it, no link is ever marked, and the feature looks
   * broken rather than misconfigured. A finite number was all that was asked
   * for, which is the same gap `inertia` had between its option and its
   * attribute.
   */
  if (settings.activeThreshold < 0 || settings.activeThreshold > 1) {
    refuse(
      `activeThreshold ${settings.activeThreshold} is not between 0 and 1; using ${DEFAULTS.activeThreshold}`,
      'activeThreshold'
    );
  }

  /**
   * And the class, which is not a value but a **token**.
   *
   * `classList.toggle` throws on an empty string and on one containing
   * whitespace — `SyntaxError` and `InvalidCharacterError`, verified in
   * Chromium, WebKit and Firefox. `update()` runs from the scroll listener, so
   * `activeClass: 'nav-link active'` — two classes, which is the obvious thing
   * to write — did not fail at `init()` where someone is looking. It threw on
   * the first frame a link became current, and on every frame after that.
   */
  if (typeof settings.activeClass !== 'string' || !/^\S+$/.test(settings.activeClass)) {
    refuse(
      `activeClass ${JSON.stringify(settings.activeClass)} is not a single class name; using ${DEFAULTS.activeClass}`,
      'activeClass'
    );
  }

  let scrollElementProblem: string | null = null;
  const scrollElement = resolveScrollElement(settings.scrollElement, (reason) => {
    scrollElementProblem = reason;
    console.warn(`@verajs/motion: scrollTo ${reason}`);
  });
  const horizontal = settings.scrollDirection === 'horizontal';
  /**
   * A root that can be scanned, or the document.
   *
   * The animation runtime had the same gap and it read worse here: a string
   * root made `root.querySelectorAll` throw, the `catch` around it assumes a
   * malformed selector, and the instance reported **"selector is not valid CSS:
   * a[href*=\"#\"]"** — about the default selector, which is perfectly valid.
   * A diagnostic that names the wrong option is worse than none.
   */
  const usableRoot = typeof (settings.root as ParentNode | null)?.querySelectorAll === 'function';
  if (settings.root !== undefined && !usableRoot) {
    configProblems.push('root is not an element or document; using the document');
  }
  /**
   * Same server-side allowance as the animation entry's root set: construction
   * touches no DOM, `init()` returns early through `supports()` where there is
   * none, and a `DocumentFragment` stands in as an empty scope so nothing
   * downstream has to branch on it.
   */
  const root: ParentNode = usableRoot
    ? (settings.root as ParentNode)
    /**
     * `null!` off a browser, not a fragment: `DocumentFragment` is a DOM
     * global too, so constructing one to stand in for a document reproduces
     * the failure it was meant to remove. `init()` returns early through
     * `supports()` where there is no DOM, so nothing ever dereferences it.
     */
    : (typeof document === 'undefined' ? (null as unknown as ParentNode) : document);
  /**
   * Marks every element a managed link points at, for the page's own use.
   *
   * Nothing here reads it. It is an outward hook so a page can style or find
   * its sections without repeating the nav's selector — `scroll-margin-top` on
   * `[data-vera-motion-scroll-target]` being the obvious one, which covers the
   * jumps this library never sees: a modified click, a page opened straight at
   * a hash. `offset` cannot, because it only applies to scrolling done here.
   *
   * Documented in the README, and worth keeping documented: it was written,
   * reference-counted and tested while appearing in no doc at all, which makes
   * it 113 bytes nobody could knowingly use.
   */
  const targetAttribute = SCROLL_TARGET_ATTRIBUTE;

  let links: Link[] = [];
  let problems: ScrollToProblem[] = [];
  let targets: Target[] = [];
  let activeId: string | null = null;
  let frame: number | null = null;
  let started = false;
  let enabled = true;
  const teardown: Array<() => void> = [];

  /**
   * Resolves an id **within this instance's root**.
   *
   * `document.getElementById` cannot see into a shadow root, so a scrollTo
   * scoped to a component's root would find none of its own targets. Both
   * Document and ShadowRoot implement getElementById; an ordinary Element
   * does not, hence the fallback.
   */
  const byIdIn = (scope: ParentNode, id: string): HTMLElement | null => {
    const byId = (scope as Document | ShadowRoot).getElementById;
    if (typeof byId === 'function') return byId.call(scope, id) as HTMLElement | null;
    return scope.querySelector(`[id="${CSS.escape(id)}"]`);
  };

  /**
   * The root first, then the tree the root is in.
   *
   * Scoping to the root alone is what audit SC2 fixed — ids inside a shadow
   * root are private and `document.getElementById` cannot see them. It also
   * made an **element** root useless: `root: document.querySelector('nav')` is
   * the natural way to say "only these links", and every one of them then
   * reported `no element with id "..."` because the sections it points at are
   * outside the nav. A root scopes which *links* are collected; the target of
   * an anchor is an id in the tree, which is what an anchor means.
   *
   * `getRootNode()` is the same tree in both cases and needs no branch: for an
   * element in the document it is the document, for one inside a shadow root it
   * is that shadow root, and for a root that is already a whole tree it is
   * itself — one wasted lookup on a miss, and nothing else.
   */
  const findById = (id: string): HTMLElement | null =>
    byIdIn(root, id) ?? byIdIn((root as Node).getRootNode() as ParentNode, id);

  /**
   * Resolves an easing name, and says so when it cannot.
   *
   * An unknown name fell back to `easeInOutCubic` in silence, so a typo — or a
   * name from another library's vocabulary — produced a working animation with
   * the wrong curve and nothing to search for. A bad `selector` has been
   * reported since the diagnostics work; this is the same kind of mistake in
   * the same options object, and `ScrollToProblem.node` is already documented
   * as null for "the instance's own configuration rather than a particular
   * link".
   *
   * Recorded once. It is reached per click rather than per frame, but a list
   * that grows on every click is a leak rather than a diagnostic.
   *
   * @param name the easing the caller asked for
   * @returns that easing, or the fallback
   */
  /**
   * One vocabulary for the whole package: the CSS timing functions the animation entry's
   * `ease` already speaks — keywords, `cubic-bezier()`, `steps()` — resolved by the same
   * solver source. The Penner table this used to read (`easeInOutCubic` and its 23 siblings)
   * retired 2026-09-01; the README carries the old-name → `cubic-bezier()` mapping.
   *
   * `resolveEasing` answers null for `linear` *and* for junk, so `linear` is picked off first —
   * it is a real request here, not an absence.
   */
  const easingFor = (name: string): ((progress: number) => number) => {
    if (name === 'linear') return (progress) => progress;
    const found = resolveCurve(name);
    if (found) return found;

    /**
     * `steps()` is deliberately not among them: a stepped scroll tween teleports in chunks,
     * which is the opposite of what this module is for — and leaving it out keeps its whole
     * implementation out of this bundle (187 B gzipped, measured).
     */
    const reason =
      `easing "${name}" is not a continuous timing function — use a keyword or ` +
      `cubic-bezier(); using ${FALLBACK_EASING}`;
    if (!problems.some((problem) => problem.reason === reason)) {
      problems.push({ node: null, reason });
      console.warn(`@verajs/motion: scrollTo ${reason}`);
    }
    return resolveCurve(FALLBACK_EASING)!;
  };

  /**
   * A duration that is a number, and says so when it is not.
   *
   * `NaN` is the value worth guarding, and it is what `parseInt` of a config
   * value produces — the animation runtime guards its `priority` for exactly
   * this reason. Here it did not merely misbehave, it hung: `duration <= 0` is
   * false for NaN, so the tween started; `elapsed` became NaN on the first
   * frame; and `elapsed >= duration` is never true, so the loop scheduled
   * itself forever. Measured in Chromium — `parseInt('fast')` as a duration
   * left the page at 0 with a frame still being requested 800ms later, writing
   * a NaN scroll position every one of them and never reaching `onComplete`.
   *
   * Normalised to 0 rather than to the default, because arriving at once is
   * the honest outcome for "no usable duration" and it is what a zero or
   * negative duration already does.
   *
   * @param value the duration asked for
   * @returns that duration, or 0
   */
  const durationFor = (value: number): number => {
    if (Number.isFinite(value)) return value;

    /**
     * The type, not just the value. `toPosition('500')` was refused as "is not
     * a number: 500", which reads as nonsense to whoever wrote it — the value
     * printed is exactly what they passed and it plainly *is* a number to look
     * at. A string that looks numeric is what a GUI and a PHP template both
     * produce, so it is the likeliest way to arrive here.
     *
     * `String` rather than `JSON.stringify` for the value itself, which is why
     * the type has to be said separately: `JSON.stringify(NaN)` is `null`.
     */
    const reason = `duration ${String(value)} (${typeof value}) is not a number; arriving at once`;
    if (!problems.some((problem) => problem.reason === reason)) {
      problems.push({ node: null, reason });
      console.warn(`@verajs/motion: scrollTo ${reason}`);
    }
    return 0;
  };

  /**
   * The element whose `scroll-behavior` decides whether the browser animates a
   * scroll write. For the window that is the document element, which is where
   * `html { scroll-behavior: smooth }` lands — and a very large number of
   * themes ship exactly that rule.
   */
  const behaviourHost = (): HTMLElement =>
    scrollElement === window ? document.documentElement : (scrollElement as HTMLElement);

  /** What the page had inline there, so it goes back exactly as it was. */
  let hadBehaviour: string | null = null;

  /**
   * Two things animating one property is one too many.
   *
   * This tween writes a scroll position every frame. With
   * `scroll-behavior: smooth` in force the browser animates *each of those
   * writes*, so the page crawls — measured in Chromium, twelve frames into a
   * 600ms tween towards 1,800px it had reached 34 — and every one of this
   * module's own options is overridden: the duration, the easing, the offset.
   *
   * Worse than slow, it made `onComplete` a lie. The tween ends on elapsed
   * time, so it reported arrival at **scrollY 94** with the target at 1,800,
   * and `manageFocus` moves focus on that signal — putting a keyboard user
   * somewhere the page has not gone.
   *
   * So the tween takes the property for its duration and gives it back. Taking
   * it means an inline `auto`, which beats a stylesheet rule; giving it back
   * means restoring whatever was inline before, which may be nothing.
   */
  const takeBehaviour = (): void => {
    const host = behaviourHost();
    hadBehaviour = host.style.scrollBehavior;
    host.style.scrollBehavior = 'auto';
  };

  const releaseBehaviour = (): void => {
    if (hadBehaviour === null) return;
    const host = behaviourHost();
    if (hadBehaviour) host.style.scrollBehavior = hadBehaviour;
    else {
      host.style.removeProperty('scroll-behavior');
      /**
       * And the attribute itself if that emptied it. Setting a property on an
       * element with no `style` attribute creates one, and removing the
       * property again leaves it behind empty — `<html style="">` on every
       * page that ever used an anchor link.
       *
       * Checked only by `spikes/smooth-css.mjs`. happy-dom's `removeProperty`
       * drops the emptied attribute itself, and calls `removeAttribute` to do
       * it, so nothing in the suite can tell this line from the host doing the
       * same thing — which is why there is no mutation planted here either.
       */
      if (!host.getAttribute('style')) host.removeAttribute('style');
    }
    hadBehaviour = null;
  };

  const cancel = (): void => {
    releaseBehaviour();
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };

  /**
   * `getElementSize`, not a hand-run of the same subtraction. This re-derived
   * `calcOffsetStart(node) - calcOffsetStart(container)` — which is precisely what
   * `getElementSize().start` computes, minus its RTL mirroring — so click-scrolling and
   * active-tracking measured the same target in two coordinate systems (#5, and the RTL defect
   * above). One geometry for both.
   *
   * Not clamped here. `toPosition` clamps everything it is given, which is both this and
   * whatever a caller passes directly — one place rather than two, and the direct path had none.
   */
  const destinationFor = (node: HTMLElement, offset: number): number =>
    getElementSize(node, settings.scrollDirection, scrollElement).start - offset;

  const toPosition: ScrollToInstance['toPosition'] = (destination, opts = {}) => {
    cancel();

    /**
     * Nothing to scroll off a browser. `toElement`/`toPosition` are the two
     * methods a page calls *imperatively* rather than through `init()`, so
     * they are the ones reachable on an instance that never started — and
     * `maxScroll` read `document.documentElement` for the clamp. `onComplete`
     * still fires, as it does for a refused destination and a journey of zero
     * length: a caller awaiting it is never left hanging by a no-op.
     */
    if (!supports()) {
      opts.onComplete?.();
      return;
    }

    /**
     * An `onComplete` that is not a function.
     *
     * `opts.onComplete?.()` calls anything that is not null or undefined, so
     * `{ onComplete: 5 }` threw `done is not a function` **out of a public
     * method** — the caller's own click handler, taken down by a value the
     * library was handed. `createMotion` has guarded `onProgress` this way for
     * a long time, on the argument that a callback is the one option a page
     * builds rather than writes down; this is the same option on the other
     * entry point, and it had neither the guard nor the try/catch that goes
     * with it.
     *
     * Replaced rather than refused-and-stopped: the scroll is what the caller
     * asked for and the callback is not the point of the call.
     */
    if (opts.onComplete !== undefined && typeof opts.onComplete !== 'function') {
      problems.push({
        node: null,
        reason: `onComplete must be a function, not ${typeof opts.onComplete}; ignoring it`,
      });
      const { onComplete: _ignored, ...rest } = opts;
      opts = rest;
    }

    /**
     * A destination that is not a number is refused, not tweened towards.
     *
     * `parseInt` of a data attribute, an offset arithmetic that touched an
     * `undefined`, a computed position from an element that is not laid out —
     * every one of them hands this a `NaN`, and this is a **public method**
     * taking a number, which is the one place a caller's mistake arrives
     * undeclared. Measured before the guard: a 30ms tween ran its whole
     * duration writing 27 scroll positions that moved nothing, and
     * `onComplete` fired as though it had arrived. That is the same failure the
     * clamp below exists for, one step earlier and with nothing to clamp.
     *
     * `onComplete` is still called, as it is for a journey of zero length: a
     * caller waiting on it is not left hanging by a refusal it can read in
     * `rejected`.
     */
    if (!Number.isFinite(destination)) {
      problems.push({
        node: null,
        reason:
          'scrollTo was given a destination that is not a number: ' +
          `${String(destination)} (${typeof destination})`,
      });
      opts.onComplete?.();
      return;
    }

    /**
     * Clamped to what the container can actually reach.
     *
     * `toElement` was clamped and this was not, so a position past the end
     * animated to somewhere unreachable: the page hit the bottom about a third
     * of the way through and sat there while the tween ran out its duration.
     * Measured — asked for 72,180 against a maximum of 3,609, the page stopped
     * moving at 100ms and `onComplete` fired at 297. Everything in it, the hash
     * update and the focus move, waited for a journey that had finished.
     *
     * The endpoint was always right, because the browser clamps a scroll write
     * of its own accord. What was wrong is everything about the trip.
     */
    const target = Math.max(0, Math.min(destination, maxScroll(scrollElement, horizontal)));

    const start = readScrollPosition(scrollElement, settings.scrollDirection);
    const change = target - start;
    const done = opts.onComplete;

    if (change === 0) {
      done?.();
      return;
    }

    const duration = durationFor(opts.duration ?? settings.duration);

    if (
      duration <= 0 ||
      (settings.respectReducedMotion && prefersReducedMotion())
    ) {
      writePosition(scrollElement, horizontal, target);
      done?.();
      return;
    }

    const easing = easingFor(opts.easing ?? settings.easing);
    takeBehaviour();

    let startTime: number | null = null;

    /** Driven off the rAF timestamp, so the tween is measured against the clock that paints it. */
    const step = (timestamp: number): void => {
      /**
       * A stamp that is not a finite number never seeds the clock. No engine
       * delivers one, but a wrapped `requestAnimationFrame` can — zone.js and
       * test doubles are the ordinary sources — and a NaN here poisons
       * `startTime`, makes every `elapsed` NaN, and the completion test below
       * is then never true: the loop schedules forever and `onComplete` never
       * fires, the exact failure `durationFor` guards from the other side.
       * Skipping the frame costs one tick; a permanently broken clock behaves
       * as a frozen one, which already just waits.
       */
      if (!Number.isFinite(timestamp)) {
        frame = requestAnimationFrame(step);
        return;
      }
      if (startTime === null) startTime = timestamp;
      const elapsed = Math.min(timestamp - startTime, duration);

      writePosition(scrollElement, horizontal, start + change * easing(elapsed / duration));

      /**
       * Terminates on elapsed time. The original compared scrollTop against a
       * fractional destination it could never match exactly, so the loop never
       * ended after arrival.
       */
      if (elapsed >= duration) {
        frame = null;
        writePosition(scrollElement, horizontal, target);
        /** Before `onComplete`, so a callback that scrolls again is not fighting it. */
        releaseBehaviour();
        done?.();
        return;
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
  };

  const toElement: ScrollToInstance['toElement'] = (node, opts = {}) => {
    if (!node) return;
    toPosition(destinationFor(node, opts.offset ?? settings.offset), opts);
  };

  const update = (): void => {
    /**
     * `started` too, not just `enabled`: an instance that never started — or
     * one whose `init()` found no DOM — has no geometry to read, and this
     * reached `getWindowSize` for the window it does not have. The animation
     * entry's `refresh()` carried the same hole.
     */
    if (!started || !enabled || !links.length) return;

    const win = getWindowSize(settings.scrollDirection, scrollElement);
    const position = readScrollPosition(scrollElement, settings.scrollDirection);
    const threshold = position + win.size * settings.activeThreshold;

    /**
     * The **latest-starting** target containing the threshold, not the last one
     * that happens to be listed in the nav.
     *
     * Sections nest — a `<section id="features">` holding an `<h3
     * id="pricing">`, both anchor targets — and more than one then contains the
     * threshold. Taking the last match made the answer depend on the order the
     * links are written in: the same page at the same scroll position marked
     * `#features` when the nav listed pricing first and `#pricing` when it
     * listed features first. Nav order is not document order, which the
     * bottomed-out branch below already refuses to depend on and says why.
     *
     * Greatest `start` is the more specific of two nested sections — the one a
     * reader would say they are in — and it does not change anything for a
     * page whose sections do not overlap, where only one can contain the
     * threshold at all.
     */
    let current: string | null = null;
    let currentStart = -Infinity;
    for (const target of targets) {
      if (target.start > threshold || target.end <= threshold) continue;
      if (target.start < currentStart) continue;
      current = target.id;
      currentStart = target.start;
    }

    /**
     * Bottomed out: the last section wins, whatever the threshold says.
     *
     * The threshold sits `activeThreshold` of a viewport below the top of the
     * scroll container, so at the end of the range it stops that far short of
     * the document's end — and a final section shorter than the remainder can
     * never contain it. Measured before fixing: a 200px section at the foot of
     * a 3,960px page in a 700px viewport left `#three` marked at *every*
     * scroll position including the very bottom, so its own link never lit up
     * once. This is the ordinary shape of a page whose last section is a short
     * contact block or footer.
     *
     * Chosen by greatest `start` rather than by position in `targets`, which
     * is nav order: a nav is free to list its links in an order the sections
     * are not in.
     */
    if (position >= maxScroll(scrollElement, horizontal) - 1) {
      let last: Target | undefined;
      for (const target of targets) if (!last || target.start > last.start) last = target;
      if (last) current = last.id;
    }

    if (current === activeId) return;
    activeId = current;

    for (const link of links) {
      /**
       * The null guard is for the top-of-document link, whose id is null —
       * and so is `current` whenever no section contains the threshold, which
       * would light the back-to-top link up by coincidence of representation.
       */
      link.node.classList.toggle(settings.activeClass, link.id !== null && link.id === current);
    }
  };

  const refresh = (): void => {
    /** The documented way to report a `direction` change — see `forgetDirection`. */
    forgetDirection();
    for (const target of targets) {
      /**
       * `scrollElement`, because `update()` compares these against a position
       * read from that container. Without it the targets were measured in
       * document coordinates and the threshold in the container's, so inside a
       * custom scroll container no link was ever marked active.
       *
       * `destinationFor` had always subtracted the container's offset, which
       * is why `getElementSize`'s own docblock says scrollTo.ts "already did
       * exactly this" — true of scrolling *to* a target, not of measuring one.
       * The same bug, in the same pair of modules, in the other direction
       * (a teardown that skips one channel has shipped here before).
       */
      const { start, end } = getElementSize(target.node, settings.scrollDirection, scrollElement);
      target.start = start;
      target.end = end;
    }
    update();
  };

  /**
   * Undoes the last injected tabindex, whether by blur or by teardown.
   *
   * Blur alone was not enough: an element focused and never blurred kept the
   * attribute *and* the listener forever, so `destroy()` left the page
   * modified. This package counts an injected attribute as something that needs a
   * matching teardown, alongside listeners and observers.
   */
  let dropTabIndex: (() => void) | null = null;

  /**
   * Moves focus to the target after arriving.
   *
   * Native anchor navigation moves focus; preventing the default prevents that
   * too, which leaves keyboard and screen-reader users at the top of the
   * document while the page scrolls somewhere else entirely. `preventScroll`
   * because the tween has already put it where it belongs, and a temporary
   * tabindex because most section elements are not focusable on their own.
   */
  const focusTarget = (node: HTMLElement): void => {
    /**
     * Injected only where it is needed.
     *
     * `tabIndex` reads 0 on anything natively focusable — a button, a link, a
     * field — and -1 on a section or a heading, measured in all three engines
     * by `spikes/anchor-focus.mjs`. An author's own `tabindex` is theirs in
     * either case and is never touched.
     *
     * It used to go on regardless, so scrolling to a `<button>` rewrote an
     * element that was already focusable and then had to take the attribute
     * back off again. An injected attribute is something that needs a matching
     * teardown, and the cheapest teardown is not injecting.
     */
    const needsTabIndex = !node.hasAttribute('tabindex') && node.tabIndex < 0;
    if (needsTabIndex) node.setAttribute('tabindex', '-1');

    node.focus({ preventScroll: true });
    if (!needsTabIndex) return;

    /** Remove it again so the element does not join the tab order for good. */
    dropTabIndex?.();
    const drop = () => {
      node.removeAttribute('tabindex');
      node.removeEventListener('blur', drop);
      if (dropTabIndex === drop) dropTabIndex = null;
    };
    dropTabIndex = drop;
    node.addEventListener('blur', drop);
  };

  const collect = (): void => {
    /**
     * Undo the previous pass before building the next one.
     *
     * Both lists are about to be replaced, and everything this instance wrote
     * onto their nodes would otherwise be stranded: the marker attribute stayed
     * on an element that had stopped being a target, and stayed there through
     * `destroy()` too, which only ever iterates the *current* list. A nav link
     * that stopped matching kept the active class for the same reason.
     *
     * Scoped to what this instance tracked rather than a query for the
     * attribute, because two instances on one page mark their own targets and
     * one must not clear the other's.
     */
    for (const target of targets) unmark(target.node, targetAttribute);
    clearActive();

    links = [];
    targets = [];
    problems = [];
    for (const reason of configProblems) problems.push({ node: null, reason });
    if (scrollElementProblem) problems.push({ node: null, reason: scrollElementProblem });

    let linkNodes: Iterable<Element>;
    try {
      linkNodes = root.querySelectorAll(settings.selector);
    } catch {
      /**
       * A malformed `selector` option is a developer typo, but throwing here
       * would abandon init() half-wired — started, with no listeners. A clear
       * warning and no links is a better failure than a raw DOMException and a
       * broken instance.
       */
      console.warn(`@verajs/motion: scrollTo selector is not valid CSS: ${settings.selector}`);
      problems.push({ node: null, reason: `selector is not valid CSS: ${settings.selector}` });
      return;
    }

    /**
     * Checked here so a configuration typo is reported at `init()` rather than
     * on the first click, which is how the selector check behaves and is the
     * only moment anyone is looking.
     */
    easingFor(settings.easing);
    durationFor(settings.duration);

    for (const node of linkNodes) {
      const href = node.getAttribute('href') ?? '';
      const hash = href.indexOf('#');
      if (hash === -1) continue;
      /**
       * A **trailing** `#` is a top link, not a link to nothing.
       *
       * HTML says an empty fragment indicates the top of the document, and all
       * three engines do exactly that — measured, 2000px to 0 in Chromium,
       * WebKit and Firefox, the same destination `#top` reaches. It was skipped
       * here, so the commonest spelling of a back-to-top link jumped while
       * `#top` glided: the very inconsistency the `top` fallback below exists
       * to remove, left in place for the more popular form.
       *
       * Taking it is safe for the other thing `<a href="#">` is used as — a
       * placeholder for a JavaScript hook — because a handler on the link runs
       * in the target phase, before this document listener, and `onClick`
       * yields to `event.defaultPrevented` as its first act. Measured: such a
       * link does not move. A page that delegates on `document` and registers
       * *after* `init()` would still lose its `preventDefault`, but that is the
       * same exposure every `#section` link on the page already has rather than
       * a new one.
       */
      const emptyFragment = hash === href.length - 1;

      /**
       * **This document, or leave it to the browser.**
       *
       * A `#` in the href was the whole test, so any link carrying a fragment
       * was adopted — including one pointing somewhere else entirely.
       * `href="/pricing#faq"` on a page that happens to have `id="faq"`, or
       * `href="https://elsewhere.example/#contact"` on a page with a contact
       * section, were **intercepted and never navigated**: the click scrolled
       * the current page instead of going where the link said. The ids that
       * collide are exactly the common ones — `contact`, `about`, `faq`,
       * `pricing`, `top` — so this is ordinary markup on a WordPress site,
       * not a contrived case.
       *
       * The platform's own rule for a same-document navigation is the URL
       * matching but for the fragment, so that is the comparison: origin,
       * path and query. `node.href` is the *resolved* URL, which is what makes
       * a relative href, a `<base>` and a bare `#one` all answer correctly.
       * A malformed or non-HTTP href (`mailto:`, `javascript:`) fails to
       * parse or fails the comparison and is left alone, which is right —
       * this module has no business preventing those defaults.
       */
      let sameDocument = false;
      try {
        const url = new URL((node as HTMLAnchorElement).href, location.href);
        sameDocument =
          url.origin === location.origin &&
          url.pathname === location.pathname &&
          url.search === location.search;
      } catch { sameDocument = false; }
      if (!sameDocument) continue;

      /** Top of the document, by the same route `#top` takes below. */
      if (emptyFragment) {
        links.push({ node: node as HTMLElement, id: null });
        continue;
      }

      const fragment = href.slice(hash + 1);
      /**
       * Raw first, then percent-decoded — the order the platform uses.
       *
       * A fragment is matched against ids as written, and only then decoded, so
       * `#both%41` finds `id="both%41"` in preference to `id="bothA"`.
       * **Measured in Chromium, WebKit and Firefox** (`spikes/anchor-encoding.mjs`)
       * rather than taken from the spec, because the whole point of this
       * fallback is matching what an engine actually does.
       *
       * Only the raw form was tried before, so a percent-encoded anchor found
       * nothing: `#caf%C3%A9` did not resolve `id="café"`, and the link was
       * reported as broken and left to navigate natively. Any heading that is
       * not plain ASCII is written this way by the CMS this library exists to
       * serve, so accented and CJK anchors are the common case rather than an
       * edge.
       */
      const decoded = decodeFragment(fragment);
      const target = findById(fragment) ?? (decoded === fragment ? null : findById(decoded));
      if (!target) {
        /**
         * HTML's fragment fallback: `top` (exactly, case-sensitive) with no
         * matching element scrolls to the top of the document — the classic
         * back-to-top link, valid in every browser. It was reported here as a
         * broken link, and left un-intercepted: the one anchor on the page
         * that jumped while every other one glided. It is a real target whose
         * position is 0, so it glides like the rest and reports nothing.
         */
        if (decoded === 'top') {
          links.push({ node: node as HTMLElement, id: null });
          continue;
        }
        problems.push({ node, reason: `no element with id "${fragment}"` });
        continue;
      }

      /**
       * The id as the element spells it, not as the href did. `targets` and
       * `links` are matched by this string and the hash is written from it, so
       * an encoded href resolving to a decoded id has to settle on one of them.
       */
      const id = target.id;

      links.push({ node: node as HTMLElement, id });
      /**
       * Marked once per target, not once per link.
       *
       * `targets` is deduped by id and the undo loop above walks `targets`, so
       * a second link to the same section left the count one higher than
       * anything would ever take off: the marker attribute survived
       * `collect()` and `destroy()` for the life of the page, and the count
       * climbed by one more on every re-collect. Two links to one heading is
       * the ordinary case — a top nav and a footer nav, or a "back to top" —
       * not an edge.
       */
      if (!targets.some((t) => t.id === id)) {
        mark(target, targetAttribute);
        targets.push({ id, node: target, start: 0, end: 0 });
      }
    }
  };

  const init = (): void => {
    /** Calling init twice would double every listener. */
    if (started) return;
    /**
     * No DOM, nothing to do — and **before** anything reads `root`, which is
     * nominally null off a browser. `collect()` ran first and its
     * `querySelectorAll` threw into the catch that assumes a malformed
     * selector, so an SSR render reported "selector is not valid CSS:
     * a[href*=\"#\"]" about the perfectly valid default. A diagnostic that
     * names the wrong option is worse than none — the same trap the root
     * check above was written for.
     */
    if (!supports()) return;

    started = true;
    collect();

    /**
     * No early-out on an empty page.
     *
     * This used to return when `collect()` found no links, which left the
     * instance started with nothing listening — and `collect()`, the method
     * documented as "call after the page adds or removes some", then had no
     * listeners to feed. A nav rendered after init, which is every SPA, was
     * silently dead with no way to recover.
     *
     * The listeners cost nothing on a page with no anchors: `onClick` matches
     * no link and returns, and `update()` returns on an empty list.
     */

    const onClick = (event: Event): void => {
      if (!enabled) return;

      /**
       * Leave the browser's own navigation alone.
       *
       * A modified click on a link is a request to open it somewhere else —
       * Cmd or Ctrl for a new tab, Shift for a new window, Alt to download —
       * and calling preventDefault() on those took that away for every
       * in-page anchor on the site. `button > 0` covers a middle click where
       * the browser still reports it as a click, and `defaultPrevented` yields
       * to any handler that has already decided.
       */
      const mouse = event as MouseEvent;
      if (
        event.defaultPrevented ||
        mouse.button > 0 ||
        mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey
      ) {
        return;
      }

      /**
       * composedPath, not event.target. A click inside a shadow root is
       * retargeted to the host by the time a document listener sees it, so
       * `target.closest('a')` would find the host — or nothing — rather than
       * the anchor that was actually clicked.
       */
      const path = event.composedPath?.() ?? [event.target];
      const link = links.find((l) => path.includes(l.node));
      if (!link) return;

      /** `target="_blank"` means open elsewhere; that is not ours to intercept. */
      const where = link.node.getAttribute('target');
      if (where && where !== '_self') return;

      /**
       * A top-of-document link has no element: tween to 0 and let the hash
       * say `#top`. No focus move — native `#top` navigation focuses nothing
       * in particular either, and there is no element to hand focus to.
       */
      if (link.id === null) {
        event.preventDefault();
        toPosition(0, {
          onComplete: () => {
            if (settings.updateHash && 'replaceState' in history) {
              history.replaceState(null, '', '#top');
            }
          },
        });
        return;
      }

      const target = targets.find((t) => t.id === link.id)?.node;
      if (!target) return;

      event.preventDefault();

      toElement(target, {
        onComplete: () => {
          if (settings.updateHash && 'replaceState' in history) {
            history.replaceState(null, '', `#${link.id}`);
          }
          if (settings.manageFocus) focusTarget(target);
        },
      });
    };

    document.addEventListener('click', onClick);
    teardown.push(() => document.removeEventListener('click', onClick));

    if (settings.cancelOnUserInput) {
      /** A tween that keeps running while the user scrolls feels like the page fighting back. */
      const onInput = (event: Event) => {
        /**
         * Only keys that actually scroll. Cancelling on any keydown would
         * abort the tween the moment someone typed into a form field.
         */
        if (event.type === 'keydown' && !SCROLL_KEYS.has((event as KeyboardEvent).key)) return;
        cancel();
      };
      for (const type of ['wheel', 'touchstart', 'keydown']) {
        window.addEventListener(type, onInput, { passive: true });
        teardown.push(() => window.removeEventListener(type, onInput));
      }
    }

    /**
     * Its own frame-aligned listener rather than borrowing the animation
     * runtime's. Each dirty-flag listener coalesces to one callback per frame,
     * so the cost of a second is negligible — and it keeps this module usable
     * entirely on its own, which is the point of shipping it separately.
     */
    const scroll = scrollListener(scrollElement, update);
    teardown.push(scroll.removeScrollListener);

    const resize = resizeListener(refresh);
    teardown.push(resize.removeResizeListener);

    /**
     * Same stale-geometry problem the animation runtime has: targets are
     * measured once, and a page still loading images is still reflowing, so
     * every measurement goes out of date.
     */
    if (document.readyState !== 'complete') {
      const onLoad = () => refresh();
      window.addEventListener('load', onLoad, { once: true });
      teardown.push(() => window.removeEventListener('load', onLoad));
    }

    if ('ResizeObserver' in window) {
      /** Same deferred-frame teardown as the runtime's remeasure; see there. */
      let queued: number | null = null;
      const sizeObserver = new ResizeObserver(() => {
        if (queued !== null) return;
        queued = requestAnimationFrame(() => { queued = null; refresh(); });
      });
      sizeObserver.observe(document.documentElement);
      teardown.push(() => {
        sizeObserver.disconnect();
        if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
      });
    }

    refresh();
  };

  const clearActive = (): void => {
    for (const link of links) link.node.classList.remove(settings.activeClass);
    activeId = null;
  };

  return {
    init,
    refresh,
    update,

    /**
     * Re-scan **and** re-measure.
     *
     * The internal `collect` rebuilds the lists with every `start` and `end` at
     * zero, which are filled in by `refresh`. On its own it therefore produced
     * a half-working state: a newly added link scrolled correctly, because a
     * destination is measured live at click time, and could never become
     * active, because tracking compares a threshold against those zeros. The
     * documented instruction is "call after the page adds or removes some",
     * and a link that highlights only after the next resize does not meet it.
     *
     * `init` keeps calling the two separately — it has listeners to wire in
     * between — so this is the public wrapper rather than a change to either.
     */
    collect() {
      collect();
      refresh();
    },

    toElement,
    toPosition,
    cancel,

    enable() {
      if (enabled) return;
      enabled = true;
      update();
    },

    disable() {
      if (!enabled) return;
      enabled = false;
      cancel();
      clearActive();
    },

    setEnabled(next: boolean) {
      if (next) this.enable();
      else this.disable();
    },

    get enabled() {
      return enabled;
    },

    get rejected(): readonly ScrollToProblem[] {
      return problems;
    },

    destroy() {
      cancel();
      dropTabIndex?.();
      for (const off of teardown.splice(0)) off();
      clearActive();
      for (const target of targets) unmark(target.node, targetAttribute);
      links = [];
      targets = [];
      started = false;
      /**
       * Back to how it was constructed, which `enabled` was not.
       *
       * `disable()` then `destroy()` then `init()` produced a started instance
       * with every listener attached and `enabled` still false, so `onClick`
       * returned immediately and smooth scrolling was silently dead — no
       * error, no diagnostic, and nothing about the instance looking wrong.
       *
       * The animation runtime had the same hole and it was fixed there first:
       * recurring mistake 9, fixing one module and not its twin. It resolves
       * this in `init()` rather than here, because it has live preferences to
       * consult; this has none, so "as constructed" is the whole answer.
       */
      enabled = true;
      /** Diagnostics for a page this instance no longer looks at. */
      problems = [];
    },
  };
};
