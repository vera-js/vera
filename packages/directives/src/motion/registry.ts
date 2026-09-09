/**
 * The keyframes registry — where generated CSS lives, who is using it, and when it may go.
 *
 * One shared constructed `CSSStyleSheet` holds every generated rule for the page; each tree that
 * needs one ADOPTS the same sheet object — references, not copies — because keyframe names resolve
 * per tree scope and the engines disagree about any fallback (measured, with the rest of this
 * file's load-bearing facts, in `tests/browser/keyframes-tree-scope.test.js`). Rules are named by
 * content hash, so the count of rules tracks DISTINCT animations rather than elements: two hundred
 * `fade-up`s share one rule.
 *
 * **The ordering invariant every caller owes: `acquire` BEFORE the element references the name.**
 * WebKit never re-resolves an animation name an element is already carrying, so mark-then-deliver
 * leaves the element unanimated for ever, only in Safari, only sometimes. `acquire` is synchronous
 * precisely so "insert, then mark" is one straight line in the caller.
 *
 * Design record and the measurements behind every choice here: the write-path spec in the portal.
 */
import type { SheetRoot } from './types.js';
import { pageProblem } from './schema.js';

/**
 * FNV-1a, 32-bit, hex — the content hash that names a rule.
 *
 * **It exists for determinism across two processes, not for speed or dedup.** The server and the
 * client must independently arrive at the same name for the same generated text, or SSR markup
 * carries names the client never defines. A `Map` to a counter would dedup perfectly and break
 * exactly that; a faster library hash would need to ship in the min bundle AND run server-side,
 * byte-for-byte agreed, to save time nobody measured being spent — this hashes a few hundred bytes
 * once per DISTINCT animation, never per element and never per frame.
 *
 * 32 bits is enough on purpose: at a hundred distinct animations the birthday bound is ~1e-6, and a
 * collision's cost is a wrong animation on one page, not corruption.
 */
export const contentHash = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    /* eslint-disable no-bitwise -- FNV-1a IS bitwise; the rule guards `&`-for-`&&` typos, and a
       hash function is its legitimate exception. The xor folds each byte in; `>>> 0` reads the
       accumulator as unsigned so the hex is stable across the sign bit. */
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
  /* eslint-enable no-bitwise */
};

/**
 * The custom properties this page has registered, so a duplicate is skipped rather than thrown.
 *
 * `CSS.registerProperty()` THROWS on a name it already knows (`InvalidModificationError`), and
 * content hashing is exactly what makes two callers want the same name — so the second registration
 * is the ordinary case, not the error case. A `Set` rather than a bare try/catch, because a
 * try/catch alone would also swallow real errors.
 */
const registered = new Set<string>();

/**
 * Registers `name` as an interpolable number, once — the typing every timed mode rests on.
 *
 * Three declarations, three loads carried: `syntax: '<number>'` makes the property INTERPOLATE
 * (unregistered, a transition on it flips at the midpoint — measured, and it is the difference
 * between a play easing and a play snapping); `initialValue: 0` is the server-rendered first frame
 * (the seek resolves against it before any JS runs); `inherits: false` keeps a parent's progress
 * out of its children, or nested motion would interfere silently.
 *
 * Degrades by doing nothing where the API is missing (older engines, the server): a scrub writes
 * discrete values per frame and never needs interpolation, so only the timed modes soften — a play
 * snaps to its end, which is the documented shape.
 *
 * The catch handles the one duplicate the `Set` cannot see: ANOTHER copy of this bundle on the same
 * page (two inlined registries, two Sets — the CDN two-bundle condition). For our own name that
 * collision is byte-identical and harmless. For an AUTHOR-named `progress` property it is not —
 * their earlier registration may carry a different syntax, ours lost, and their type will not
 * interpolate our unitless number — so that case is reported by name rather than swallowed.
 * Anything else rethrows; a swallow that broad would eat real errors.
 */
export const ensureProperty = (name: string): void => {
  if (registered.has(name)) return;
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') return;
  try {
    CSS.registerProperty({ name, syntax: '<number>', inherits: false, initialValue: '0' });
  } catch (error) {
    if ((error as DOMException)?.name !== 'InvalidModificationError') throw error;
    if (name !== PROGRESS_PROPERTY) pageProblem('motion-progress-property-taken', [name]);
  }
  registered.add(name);
};

/** The engine's own variable — the one every generated rule seeks by unless `progress` renames it. */
export const PROGRESS_PROPERTY = '--vd-p';

/** One rule's live bookkeeping. `cssText` is kept for two replays: a fallback root arriving after
 *  the rule, and rebuilding a fallback sheet on eviction. */
type Entry = { count: number; cssText: string };

/** Hash → its rule's bookkeeping. Page-wide, because the SHEET is — only adoption is per tree. */
const entries = new Map<string, Entry>();

/** Insertion order, kept parallel to the shared sheet's rule indexes so eviction can address its
 *  rule by position. A `Map` preserves insertion order but not an index; this is the index. */
const order: string[] = [];

/** Trees already carrying the shared sheet. Weak on purpose: the registry must never be the thing
 *  keeping a discarded shadow root alive. */
const adopted = new WeakSet<SheetRoot>();

/** The one shared sheet, made on first use so importing this module is safe where `CSSStyleSheet`
 *  does not exist (the server — SSR emits rules through its own path, not through here). */
let shared: CSSStyleSheet | null = null;

/**
 * Whether constructed sheets work here, decided once. jsdom's `CSSStyleSheet` throws on
 * construction and older engines lack `adoptedStyleSheets`; both take the `<style>` fallback.
 */
const constructed = (): boolean => {
  try {
    return new CSSStyleSheet() instanceof CSSStyleSheet;
  } catch {
    return false;
  }
};
let usable: boolean | null = null;

/**
 * Fallback roots' `<style>` elements. Unlike adoption this path DUPLICATES per root — acceptable,
 * because it only runs where constructed sheets are unavailable — and eviction rebuilds the text
 * wholesale rather than tracking indexes, because the rare path should be the simple one.
 */
const fallbackStyles = new WeakSet<SheetRoot>();
const fallbackRoots: (WeakRef<SheetRoot>)[] = [];

const fallbackText = (): string => order.map((hash) => entries.get(hash)!.cssText).join('\n');

const fallbackStyleIn = (root: SheetRoot): HTMLStyleElement | null => {
  const doc = root instanceof Document ? root : root.ownerDocument;
  for (const child of (root instanceof Document ? root.head : root).children) {
    if ((child as HTMLElement).dataset?.['vdSheet'] !== undefined) return child as HTMLStyleElement;
  }
  const style = doc.createElement('style');
  style.dataset['vdSheet'] = '';
  (root instanceof Document ? root.head : root).appendChild(style);
  return style;
};

const refreshFallbacks = (): void => {
  const text = fallbackText();
  for (let i = fallbackRoots.length - 1; i >= 0; i--) {
    const root = fallbackRoots[i]!.deref();
    if (!root) {
      fallbackRoots.splice(i, 1);
      continue;
    }
    const style = fallbackStyleIn(root);
    if (style) style.textContent = text;
  }
};

/**
 * Ensures `hash`'s rule exists and is visible from `root`, and counts the caller in.
 *
 * Synchronous, and the caller marks the element AFTER it returns — the invariant in the header.
 * The `cssText` is only read the first time a hash is seen; identical animations hand in identical
 * text by construction, since the hash IS the text.
 */
export const acquire = (root: SheetRoot, hash: string, cssText: string): void => {
  usable ??= constructed();

  const entry = entries.get(hash);
  if (entry) entry.count++;
  else {
    entries.set(hash, { count: 1, cssText });
    order.push(hash);
    if (usable) {
      shared ??= new CSSStyleSheet();
      shared.insertRule(cssText, shared.cssRules.length);
    }
  }

  if (usable) {
    if (!adopted.has(root)) {
      adopted.add(root);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, shared!];
    }
  } else if (!fallbackStyles.has(root)) {
    fallbackStyles.add(root);
    fallbackRoots.push(new WeakRef(root));
    refreshFallbacks();
  } else if (!entry) {
    refreshFallbacks();
  }
};

/**
 * Counts a caller out; the last one out takes the rule with it.
 *
 * The sheet stays adopted by its roots — an empty or shrunken sheet costs a reference, and
 * un-adopting on last use would buy bookkeeping for nothing measurable. Deliberately tolerant of a
 * hash it does not know: teardown paths run in error recovery, where a second release must not
 * become its own failure.
 */
export const release = (hash: string): void => {
  const entry = entries.get(hash);
  if (!entry) return;
  if (--entry.count > 0) return;

  entries.delete(hash);
  const at = order.indexOf(hash);
  order.splice(at, 1);
  if (usable && shared) shared.deleteRule(at);
  else refreshFallbacks();
};
