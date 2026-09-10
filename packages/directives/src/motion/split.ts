/**
 * Split — `data-vd-split="chars|words|lines"`: break an element's text into
 * pieces so each animates on its own.
 *
 * A DIRECTIVE now, not an insert: it runs at priority 40 — before motion's
 * 45 on the same element — rewrites its own subtree, and the engine's churn
 * activation picks the pieces up like any hand-written elements. The whole
 * `prepare` insert existed for this module, and dies with the promotion.
 *
 * **The pieces do the animating; the container does the staggering.** Each
 * piece carries a FILTERED serialization of the container's motion value —
 * `stagger` stays behind (moving it made every piece animate in unison,
 * which is precisely the thing splitting is for; browser-verified) and `pin`
 * is dropped with the teaching warning (a piece cannot hold the container).
 * The container's own `data-vd-motion` stays in place as the template — the
 * motion directive skips split containers — so a value edit rebuilds
 * through the engine and re-splits with the fresh template.
 *
 * Two deliberate limits, kept from the source with their reasons:
 * - **Nested markup is refused, not handled.** Preserving inline structure
 *   through a split is most of what makes a general-purpose splitter large,
 *   and getting it half-right silently drops a link or an emphasis.
 * - **Accessibility rests on a visually-hidden text copy plus `aria-hidden`
 *   pieces** (Brian's call, 2026-09-01 — "do it properly"): ARIA 1.2
 *   prohibits naming on `generic`/`paragraph` roles, so the `aria-label`
 *   shape worked by Chromium's leniency. Real text is immune to naming
 *   rules. An author's own `aria-label` is left in charge.
 */
import type { Directive } from '../types.js';
import { MOTION_ATTR, serializeMotion } from '@verajs/motion/internal';

import { parseValue, isObject } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';

export type SplitMode = 'chars' | 'words' | 'lines';

const SPLIT_ATTR = 'data-vd-split';
const MODES: readonly string[] = ['chars', 'words', 'lines'];

/**
 * How many pieces one element may be broken into. Every piece becomes a span
 * *and* a registered animated element, so this is a promise that one
 * paragraph cannot enrol ten thousand elements in the scroll loop.
 */
const MAX_PIECES = 500;

/** Keys that describe the CONTAINER rather than the animation. */
const CONTAINER_KEYS: ReadonlySet<string> = new Set(['stagger', 'pin']);

/**
 * The value each piece carries: the container's motion text, minus the
 * container-only keys. A preset literal passes verbatim (presets carry
 * neither); no motion value at all returns null and the split is refused —
 * splitting then hides the text behind `aria-hidden` and buys nothing.
 */
const pieceValue = (
  node: Element,
  reject: (code: string, args?: readonly string[]) => void
): string | null => {
  const raw = node.getAttribute(MOTION_ATTR);
  if (raw === null || raw.trim() === '') {
    reject('split-no-animation');
    return null;
  }
  const text = raw.trim();
  if (!text.startsWith('{')) return text;
  try {
    const parsed = parseValue(text) as Parsed;
    if (!isObject(parsed)) return text;
    const object = parsed as ParsedObject;
    if (object['pin'] !== undefined) {
      reject('split-pin-dropped');
    }
    return serializeMotion(object, CONTAINER_KEYS);
  } catch {
    /** The motion side reports the parse failure with its hint; nothing to add. */
    return null;
  }
};

const piece = (text: string, value: string): HTMLElement => {
  const span = document.createElement('span');
  span.textContent = text;
  /** Transforms need a box; an inline span has none. */
  span.style.display = 'inline-block';
  /** The container carries the readable text — these are decoration. */
  span.setAttribute('aria-hidden', 'true');
  span.setAttribute(MOTION_ATTR, value);
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
 * `Intl.Segmenter` groups by grapheme cluster — `Array.from` iterates code
 * points, which tears a combining mark off its letter: measured, a family
 * emoji splits into five pieces, a flag into two, Devanagari `नि` into two.
 * Guarded because it is not universal, and code points are a better wrong
 * answer than a thrown TypeError.
 */
const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const characters = (text: string): string[] =>
  segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);
const isSpace = (part: string): boolean => /^\s+$/.test(part);

/**
 * Lines are a layout question rather than a text one: lay the words out,
 * then group them by the vertical position the browser actually chose.
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

export const splitDirective: Directive = {
  name: 'split',
  value: 'literal',
  priority: 40,
  docs: {
    summary: "Splits the element's text into chars, words or lines; each piece inherits the element's motion.",
    example: 'data-vd-split="words"',
  },
  setup(el, ctx) {
    const node = el as HTMLElement;
    /** Codes, like every other pack: the words live in `diagnostics.ts` and fold out of
     *  production, and each refusal gets a name a docs page and Studio can address. */
    const reject = (code: string, args?: readonly string[]): void => ctx.reject(code, args ?? []);
    const mode = (el.getAttribute(SPLIT_ATTR) ?? '').trim();
    if (!MODES.includes(mode)) {
      reject('split-bad-mode', [mode]);
      return;
    }

    /**
     * Every child node, not just the element ones. A comment node passing
     * the check got split like ordinary text and was **permanently
     * destroyed** — and a comment is how Vue, Svelte, lit and htmx anchor
     * themselves in a page. Teardown is documented to give back what it
     * borrowed; taking something away is worse than refusing.
     */
    for (let i = 0; i < node.childNodes.length; i++) {
      if (node.childNodes[i]!.nodeType === 3) continue;
      /** Two codes rather than one with a word for an argument: the word WAS the prose, so
       *  passing it kept the strings in the bundle the table exists to empty. */
      reject(node.childNodes[i]!.nodeType === 8 ? 'split-has-comments' : 'split-has-markup');
      return;
    }

    const original = node.textContent ?? '';
    if (original.trim() === '') return;

    /**
     * Text the bidi algorithm would reorder is refused, not reordered
     * wrongly: every piece is an atomic inline-block, and atomic inlines
     * lay out in SOURCE order — so a Hebrew or Arabic run inside an LTR
     * paragraph comes back visually reversed the moment it is split
     * (measured in all three engines). A run *matching* the base direction
     * is safe, which is why this asks about opposition rather than scripts.
     * The LTR-strong test is deliberately the conservative subset (Latin):
     * a missed refusal degrades to today's behaviour, a false one blocks a
     * clean split.
     */
    const rtlBase = getComputedStyle(node).direction === 'rtl';
    const opposing = rtlBase ? /[A-Za-z\u00C0-\u024F]/ : /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    if (opposing.test(original)) {
      reject('split-bidi-opposed');
      return;
    }

    /**
     * Counted the same way it will be built, before anything is: `chars`
     * strips spaces because spaces go back as text; for `lines` the word
     * count bounds the measuring pass and the registered pieces are fewer.
     */
    const count =
      mode === 'chars'
        ? characters(original.replace(/\s+/g, '')).length
        : tokenise(original).filter((part) => !isSpace(part)).length;
    if (count > MAX_PIECES) {
      reject('split-too-many', [mode, String(count), String(MAX_PIECES)]);
      return;
    }

    const value = pieceValue(node, reject);
    if (value === null) return;

    /** The author's own aria-label is the name they chose; no copy under it. */
    const ownCopy = !node.hasAttribute('aria-label');

    /**
     * The classic clip pattern, inline — no stylesheet injected. `nowrap`
     * stops the 1px box wrapping every word to its own line, which some
     * screen readers announce with pauses; `user-select: none` keeps the
     * copy out of drag-selection so copying a passage does not paste the
     * sentence twice.
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
          else if (mode === 'words') node.append(piece(part, value));
          else for (const character of characters(part)) node.append(piece(character, value));
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
         * A separator between lines, or `textContent` runs them together
         * and find-in-page and selection stop working across the boundary.
         * The pieces are inline-block, so the space does not affect layout.
         */
        if (index > 0) node.append(' ');
        node.append(piece(line.join(' '), value));
      });
    };

    build();

    /**
     * A line split is only valid for the width and font it was measured at;
     * characters and words are layout-free and never need this. Rebuilt on
     * the NEXT frame rather than inside the callback: regrouping changes
     * the element's height, which the observer is watching, and WebKit
     * reports a same-cycle rebuild as a page error (`ResizeObserver loop
     * completed with undelivered notifications`) where the other engines
     * tolerate it silently.
     */
    let observer: ResizeObserver | null = null;
    let destroyed = false;
    let queued: number | null = null;

    if (mode === 'lines' && typeof ResizeObserver === 'function') {
      let width = node.offsetWidth;
      observer = new ResizeObserver(() => {
        if (destroyed || queued !== null || node.offsetWidth === width) return;
        width = node.offsetWidth;
        queued = requestAnimationFrame(() => {
          queued = null;
          if (!destroyed) build();
        });
      });
      observer.observe(node);
      /**
       * A font swap re-wraps the text, which regroups the lines.
       * `document.fonts.ready` cannot be cancelled, so the callback checks
       * whether it still has a job — without that, a split torn down while
       * fonts were loading was rebuilt afterwards, wiping the text the
       * teardown had just put back.
       */
      void document.fonts?.ready.then(() => { if (!destroyed) build(); });
    }

    return () => {
      destroyed = true;
      if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
      observer?.disconnect();
      observer = null;
      /** Wipes the pieces and the hidden copy together — the copy is ordinary child text. */
      node.textContent = original;
    };
  },
};
