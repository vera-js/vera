/**
 * Splits an element's text into characters, words or lines so each piece can
 * animate on its own.
 *
 * A wired module, like `sequence.ts`, and for the same reason: most pages do
 * not split text, and the ones that do are asking for a whole extra behaviour
 * rather than a tweak to an existing one. The core knows nothing about it —
 * `src/split.ts` declares the setting and the page hands it to `wireMotion`.
 *
 * This paragraph described the **chunk** model — a core carrying an `import()`
 * — until 2026-08-31, which decision 28 replaced. Being wired makes the work
 * synchronous, and `src/split.ts` records the class of bug that removed.
 *
 * **The pieces do the animating; the parent does the staggering.** Splitting
 * copies the element's animation attributes onto each piece and takes them off
 * the parent, so a cascade is `data-vm-stagger` on that same parent — the
 * feature that already exists, with no machinery added here. That is the whole
 * reason this module is small.
 *
 * Two deliberate limits, both of which cost something and both of which are
 * documented rather than hidden:
 *
 * - **Nested markup is refused, not handled.** `Some <strong>bold</strong>
 *   text` is left alone with a warning. Preserving inline structure through a
 *   split is most of what makes a general-purpose splitter large, and getting
 *   it half-right would silently drop a link or an emphasis.
 * - **Accessibility rests on a visually-hidden text copy plus `aria-hidden`
 *   pieces.** It used `aria-label` on the container — the usual mitigation —
 *   but ARIA 1.2 prohibits naming on `generic`/`paragraph` roles, so that
 *   worked by Chromium's leniency and was never measured against WebKit or a
 *   real screen reader. Real text is immune to naming rules: every engine
 *   exposes it by construction (Brian's call, 2026-09-01 — "do it properly").
 *   The cost is that the sentence exists twice in the DOM, so find-in-page
 *   can match the invisible copy; a screen reader losing the sentence
 *   outright outweighs that. An author's own `aria-label` is left in charge:
 *   their name, their shape, and no copy is added under it.
 */
import { reject } from '@verajs/motion';
/**
 * From `namespace.js` directly, never the `schema.js` re-export. Under the Vite build the
 * re-export was re-measured byte-identical either way; under the monorepo rollup build it is
 * not — the whole property table came with it, +679 B gzipped on this artifact. Same rule
 * `scroll-to` has always followed, now for both toolchain reasons.
 */
import { ATTRIBUTE_PREFIX } from './namespace.js';

export type SplitMode = 'chars' | 'words' | 'lines';

export interface Split {
  /** Re-split. Lines depend on layout; the other modes are layout-free. */
  refresh(): void;
  /** Restore the original text, attributes and markup exactly. */
  destroy(): void;
}

const SPLIT_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-split`;

/**
 * How many pieces one element may be broken into.
 *
 * Every piece becomes a span *and* a registered animated element, so this is
 * not a memory cap so much as a promise that one paragraph cannot enrol ten
 * thousand elements in the scroll loop. A heading split by character is tens;
 * a long article body split by character would be thousands, and is a mistake
 * rather than an intent.
 */
const MAX_PIECES = 500;

/**
 * Settings that describe the *container* rather than the animation, and so
 * must not be moved onto the pieces.
 *
 * `stagger` is the one that matters and the one that caught me out: moving it
 * to the pieces leaves the parent no longer a stagger host, and every piece
 * animates in unison — which is precisely the thing splitting is for. Verified
 * in a browser (`spikes/split-live.mjs`); the unit tests would not have shown
 * it, because the failure is the *absence* of a cascade.
 *
 * Everything else — inertia, ease, run-once and the rest — configures
 * how a piece animates, and belongs with the pieces.
 */
export const CONTAINER_SETTINGS: ReadonlySet<string> = new Set([
  `${ATTRIBUTE_PREFIX}-split`,
  `${ATTRIBUTE_PREFIX}-stagger`,
]);

/** The attributes that move to the pieces. */
const animationAttributes = (node: Element): Array<[string, string]> =>
  node
    .getAttributeNames()
    .filter((name) => name.startsWith(`${ATTRIBUTE_PREFIX}-`) && !CONTAINER_SETTINGS.has(name))
    .map((name) => [name, node.getAttribute(name) ?? ''] as [string, string]);

const piece = (text: string, attributes: ReadonlyArray<[string, string]>): HTMLElement => {
  const span = document.createElement('span');
  span.textContent = text;
  /** Transforms need a box; an inline span has none. */
  span.style.display = 'inline-block';
  /** The container carries the readable text — these are decoration. */
  span.setAttribute('aria-hidden', 'true');
  span.setAttribute(ATTRIBUTE_PREFIX, '');
  for (const [name, value] of attributes) span.setAttribute(name, value);
  return span;
};

/**
 * Words, keeping runs of whitespace as their own entries so they can be put
 * back as plain text nodes — wrapping and justification then behave as they
 * did before the split.
 */
const tokenise = (text: string): string[] => text.split(/(\s+)/).filter((part) => part !== '');

/**
 * Characters as a reader sees them, not as the string stores them.
 *
 * `Array.from` iterates code points, which is a different thing, and every
 * piece gets its own `inline-block` box — so a combining mark is torn off the
 * letter it belongs to and rendered as its own glyph. Measured: a family emoji
 * splits into five pieces, a flag into two, a skin-tone modifier into two,
 * Devanagari `नि` into two, and a decomposed `é` into two.
 *
 * `Intl.Segmenter` groups by grapheme cluster, which is what "split by
 * character" means to anyone writing it. Guarded because it is not universal,
 * and code points are a better wrong answer than a thrown TypeError.
 */
const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const characters = (text: string): string[] =>
  segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);
const isSpace = (part: string): boolean => /^\s+$/.test(part);

/**
 * Lines are a layout question rather than a text one: lay the words out, then
 * group them by the vertical position the browser actually chose.
 */
const groupLines = (words: readonly HTMLElement[]): string[][] => {
  const lines: string[][] = [];
  let top: number | null = null;
  for (const word of words) {
    const y = word.offsetTop;
    /** A pixel of tolerance: sub-pixel baselines differ within one line. */
    if (top === null || Math.abs(y - top) > 1) {
      lines.push([]);
      top = y;
    }
    lines[lines.length - 1]!.push(word.textContent ?? '');
  }
  return lines;
};

/** Warns and records, so the reason survives past the console. */
const refuse = (node: HTMLElement, message: string): null => {
  console.warn(`@verajs/motion: ${message}`);
  reject(node, message);
  return null;
};

/**
 * @param node the element to split; must contain plain text only
 * @param mode characters, words, or layout-measured lines
 * @returns the split, or null when it refused
 */
export const createSplit = (node: HTMLElement, mode: SplitMode): Split | null => {
  /**
   * Both refusals go to `MotionInstance.rejected` as well as the console.
   * A refused split is the quietest failure this module has: the element still
   * animates, as one block, which is a plausible-looking result rather than a
   * missing one — nobody goes looking for a warning they have no reason to
   * expect.
   */
  /**
   * Every child node, not just the element ones.
   *
   * This read `node.children`, which is elements only — so a **comment node**
   * passed the check, got split like ordinary text, and was **permanently
   * destroyed**: `the <!-- c --> fox` came back from `destroy()` as
   * `the  fox`. `textContent` was preserved, which is the invariant this
   * module guards, and the comment is not part of it.
   *
   * That matters more than it sounds. A comment node is how Vue, Svelte, lit
   * and htmx anchor themselves in a page, and `destroy()` is documented to give
   * back what it borrowed — taking something away is worse than refusing.
   */
  for (let i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i]!.nodeType === 3) continue;
    const kind = node.childNodes[i]!.nodeType === 8 ? 'comments' : 'nested markup';
    return refuse(node, `${SPLIT_ATTRIBUTE} needs plain text, not ${kind}.`);
  }

  const original = node.textContent ?? '';
  if (original.trim() === '') return null;

  /**
   * Text the bidi algorithm would reorder is refused, not reordered wrongly.
   *
   * Every piece becomes an atomic inline-block, and atomic inlines lay out in
   * **source order** in their base direction — so a Hebrew or Arabic run
   * inside an LTR paragraph, which native rendering shows right-to-left as a
   * unit, comes back visually reversed the moment it is split. Measured in
   * Chromium, WebKit and Firefox alike (`spikes/split-bidi.mjs`): native
   * reorders, pieces do not. A run *matching* the base direction is safe —
   * source order is reading order there — which is why this asks about
   * opposition rather than about scripts: an RTL page splits its own Hebrew
   * fine, and it is the embedded-opposite run that silently scrambles.
   *
   * Refused rather than wrapped in direction isolates, for the reason nested
   * markup is: grouping runs correctly *is* the bidi algorithm (numerals,
   * neutrals, isolate controls), and getting it half-right reorders someone's
   * sentence in silence. The sentence says the fix: give the opposite run its
   * own element and split that, where it is the base.
   *
   * The LTR-strong test is deliberately the conservative subset (Latin);
   * Greek or Cyrillic inside an RTL base slips past it — a missed refusal
   * degrades to today's behaviour, while a false one would block a clean
   * split.
   */
  const rtlBase = getComputedStyle(node).direction === 'rtl';
  const opposing = rtlBase ? /[A-Za-z\u00C0-\u024F]/ : /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  if (opposing.test(original)) {
    return refuse(
      node,
      `${SPLIT_ATTRIBUTE}: this text runs against the paragraph's direction, and split pieces ` +
      'keep source order — the bidi reordering that makes it read correctly is lost. Split an ' +
      'element whose direction matches the text instead.'
    );
  }

  /** Counted before anything is built, so an over-long text is left alone entirely. */
  /**
   * Counted the same way it will be built, or the cap guards a different
   * number. `chars` strips spaces because spaces go back as text, and `words`
   * keeps only the non-space tokens for the same reason — counting the raw
   * token list refused a ~250-word paragraph as "over 500 pieces" when it
   * would have built 250. For `lines` the word count is an upper bound on the
   * *measuring* pass (a transient span per word) rather than the pieces
   * registered, which are the lines and always fewer.
   */
  const pieces =
    mode === 'chars'
      ? characters(original.replace(/\s+/g, '')).length
      : tokenise(original).filter((part) => !isSpace(part)).length;
  if (pieces > MAX_PIECES) {
    return refuse(
      node,
      `${SPLIT_ATTRIBUTE}="${mode}" would make ${pieces} pieces, over the ${MAX_PIECES} limit.`
    );
  }

  const attributes = animationAttributes(node);

  /**
   * `pin` is the one moved attribute that cannot mean anything on a piece.
   *
   * Everything else configures *how a piece animates* — inertia, easing,
   * origin — and reads correctly once per word. `pin` says "hold this element
   * against the leading edge while its animation runs", and the element the
   * author meant is the paragraph. Moved, it makes every word
   * `position: sticky` inside the paragraph's own box: each one pinning
   * separately, for the height of a line.
   *
   * Not refused, because refusing would abandon the split over a setting, and
   * not kept on the container either — a container carries no marker of its
   * own, so nothing would ever apply it and the result would be silence
   * instead of nonsense. Said out loud, with the spelling that works: pin a
   * wrapper around the paragraph.
   */
  if (attributes.some(([name]) => name === `${ATTRIBUTE_PREFIX}-pin`)) {
    const reason =
      `${ATTRIBUTE_PREFIX}-pin moves to each piece when the text is split, and a piece ` +
      'cannot hold the container — put it on a wrapper around this element instead.';
    console.warn(`@verajs/motion: ${reason}`);
    reject(node, reason);
  }

  for (const [name] of attributes) node.removeAttribute(name);
  /**
   * The readable sentence survives the split as a **visually-hidden text
   * copy**, not as `aria-label`: ARIA 1.2 prohibits naming on the roles a
   * split container usually has (`generic`, `paragraph`), so the label shape
   * depended on engine leniency — measured in Chromium, unmeasurable in
   * WebKit from a test runner, and exactly the kind of bet a screen-reader
   * user loses silently. Real text needs no naming rule.
   *
   * Skipped when the author wrote their own `aria-label`: that is the name
   * they chose, splitting is no reason to replace it, and a hidden copy
   * underneath it would double-speak.
   */
  const ownCopy = !node.hasAttribute('aria-label');

  /**
   * The classic clip pattern, inline — the library injects no stylesheet.
   * `nowrap` stops the 1px box wrapping every word to its own line, which
   * some screen readers announce with pauses. `user-select: none` keeps the
   * copy out of drag-selection, so copying a passage does not paste the
   * sentence twice — selection UI is invisible to accessibility trees, so the
   * screen-reader text costs nothing for it. Find-in-page can still match the
   * copy; that half is harmless.
   */
  const hiddenCopy = (): HTMLElement => {
    const copy = document.createElement('span');
    copy.textContent = original;
    copy.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;user-select:none;';
    return copy;
  };

  const build = (): void => {
    node.textContent = '';
    /** First child, so assistive reading order starts with the sentence. */
    if (ownCopy) node.append(hiddenCopy());

    if (mode !== 'lines') {
      for (const part of tokenise(original)) {
        if (isSpace(part)) node.append(part);
        else if (mode === 'words') node.append(piece(part, attributes));
        else for (const character of characters(part)) node.append(piece(character, attributes));
      }
      return;
    }

    /** Lay the words out plainly first, measure where they landed, then wrap. */
    const measured: HTMLElement[] = [];
    for (const part of tokenise(original)) {
      if (isSpace(part)) {
        node.append(part);
        continue;
      }
      const span = document.createElement('span');
      span.textContent = part;
      node.append(span);
      measured.push(span);
    }

    const lines = groupLines(measured);
    node.textContent = '';
    if (ownCopy) node.append(hiddenCopy());
    lines.forEach((line, index) => {
      /**
       * A separator between lines, or `textContent` runs them together and
       * find-in-page and text selection stop working across the boundary.
       * The pieces are inline-block, so the space does not affect layout.
       */
      if (index > 0) node.append(' ');
      node.append(piece(line.join(' '), attributes));
    });
  };

  build();

  /**
   * A line split is only valid for the width and font it was measured at.
   * Characters and words are layout-free and never need this.
   */
  let observer: ResizeObserver | null = null;
  /**
   * `document.fonts.ready` cannot be cancelled, so the callback has to check
   * whether it still has a job. Without this a split destroyed while fonts
   * were loading was rebuilt afterwards, wiping the text `destroy()` had just
   * put back.
   */
  let destroyed = false;
  /** A deferred line rebuild, so `destroy()` can cancel one in flight. */
  let queued: number | null = null;

  if (mode === 'lines' && typeof ResizeObserver === 'function') {
    let width = node.offsetWidth;
    /**
     * Rebuilt on the next frame rather than inside the callback.
     *
     * Regrouping the lines changes the element's height, which the observer is
     * watching, so a same-cycle rebuild notifies again before the delivery has
     * finished — and WebKit reports that as a **page error**, `ResizeObserver
     * loop completed with undelivered notifications`, on `window.onerror`
     * where a consumer's error reporting picks it up. Chromium and Firefox
     * tolerate the same loop silently, which is why it took an engine that
     * does not to notice.
     *
     * Deferring costs a frame and breaks the cycle: the height settles before
     * the next delivery, so the guard above sees an unchanged width and stops.
     */
    observer = new ResizeObserver(() => {
      if (destroyed || queued !== null || node.offsetWidth === width) return;
      width = node.offsetWidth;
      queued = requestAnimationFrame(() => {
        queued = null;
        if (!destroyed) build();
      });
    });
    observer.observe(node);
    /** A font swap re-wraps the text, which regroups the lines. */
    void document.fonts?.ready.then(() => { if (!destroyed) build(); });
  }

  return {
    refresh: build,
    destroy() {
      destroyed = true;
      if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
      observer?.disconnect();
      observer = null;
      /** Wipes the pieces and the hidden copy together — the copy is ordinary child text. */
      node.textContent = original;
      for (const [name, value] of attributes) node.setAttribute(name, value);
    },
  };
};
