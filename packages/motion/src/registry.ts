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
 * FNV-1a, 64-bit, as fourteen base36 characters — the content hash that names a rule.
 *
 * **It exists for determinism across two processes, not for speed or dedup.** The server and the
 * client must independently arrive at the same name for the same generated text, or SSR markup
 * carries names the client never defines. A `Map` to a counter would dedup perfectly and break
 * exactly that, and so would anything stateful: activation order is UNKNOWABLE here, because a
 * client root is walked at custom-element upgrade and the autoloader makes that `await import()`
 * over the network. Two loads of one page can differ from each other. The name must therefore be a
 * pure function of its own body and of nothing else — see `tests/motion-order-independence.test.mjs`.
 *
 * **Why 64 and not 32.** The previous 32-bit form said "32 bits is enough on purpose: a collision's
 * cost is a wrong animation on one page, not corruption". The first half was optimistic and the
 * second was the thing worth fixing — a wrong animation IS the defect, `acquire` discards the
 * `cssText` it is handed on a hit, and a searched-for pair (`r7wzx` / `ra6cd`) demonstrated it in
 * Chromium. Measured rates for N distinct rules on a page:
 *
 * | bits | accident @10k rules | targeted second preimage |
 * | ---- | ------------------- | ------------------------ |
 * | 32   | 1 in 83             | ~13 minutes              |
 * | 64   | 1 in 370 billion    | ~10^5 years              |
 *
 * **Why base36 and not a denser alphabet, which is a measured reversal.** The first 64-bit form
 * packed six bits per character over `[A-Za-z0-9_-]`, reaching eleven characters on the reasoning
 * that a CSS identifier accepts all 64 symbols so hex was wasting half of each character. True, and
 * it cost **105 B gzipped** — the 64-character alphabet is a high-entropy literal gzip cannot
 * compress, and the packing loop is hand-rolled where `toString(36)` is free. Two 32-bit halves in
 * base36 are seven characters each, so the name is 14 rather than 11. Those three characters are
 * repeated per element and per selector, which is exactly the shape gzip erases; the 105 B were
 * paid once per bundle by every consumer. Measured both ways before choosing.
 *
 * A leading digit is therefore possible, which is fine in both positions the name appears: an
 * attribute VALUE (`[data-vm-motion="…"]`), and after the `vm-` prefix in a keyframes identifier.
 *
 * The FUNCTION matches omni's twin (`fnv1a64`), which the shared corpus in
 * `docs/motion-spec/fixtures/hash-vectors.json` pins; only the ENCODING differs (they hex), and the
 * engines never share generated rules, so the names were already distinct by ratified decision.
 */

/** The 64-bit accumulator in four 16-bit limbs. `Math.imul` cannot carry 64 bits, and BigInt
 *  measured 5.5x slower and ships heavier; the limb form is what omni's PHP twin uses too. */
const fnv1a64 = (text: string): [number, number, number, number] => {
  let a0 = 0x2325, a1 = 0x8422, a2 = 0x9ce4, a3 = 0xcbf2;
  for (let i = 0; i < text.length; i++) {
    /* eslint-disable no-bitwise -- FNV-1a IS bitwise; the rule guards `&`-for-`&&` typos, and a
       hash function is its legitimate exception. */
    a0 ^= text.charCodeAt(i) & 0xffff;
    /* eslint-enable no-bitwise */
    /** The prime 0x100000001b3 has two non-zero limbs: b0 = 0x1b3 and b2 = 0x100. */
    const c0 = a0 * 0x1b3;
    const c1 = a1 * 0x1b3 + Math.floor(c0 / 65536);
    const c2 = a2 * 0x1b3 + a0 * 0x100 + Math.floor(c1 / 65536);
    const c3 = a3 * 0x1b3 + a1 * 0x100 + Math.floor(c2 / 65536);
    /* eslint-disable no-bitwise */
    a0 = c0 & 0xffff; a1 = c1 & 0xffff; a2 = c2 & 0xffff; a3 = c3 & 0xffff;
    /* eslint-enable no-bitwise */
  }
  return [a0, a1, a2, a3];
};

export const contentHash = (text: string): string => {
  const [a0, a1, a2, a3] = fnv1a64(text);
  return (a1 * 65536 + a0).toString(36).padStart(7, '0') +
    (a3 * 65536 + a2).toString(36).padStart(7, '0');
};

/**
 * There is deliberately NO hex twin of the above. One existed briefly, to check this function
 * against the shared cross-engine corpus — and it shipped in `vera-motion.min.js` and
 * `vera-motion-client.min.js`, verification-only code in every consumer's bundle. The corpus check
 * now DECODES a name back to its 64 bits (`tests/motion-registry-hash.test.mjs`), which costs
 * nothing here and tests strictly more: a hex twin shares the hash but bypasses the encoding, so a
 * mis-packed name would pass while every generated rule name was wrong.
 */

/**
 * The custom properties this page has registered, so a duplicate is skipped rather than thrown.
 *
 * `CSS.registerProperty()` THROWS on a name it already knows (`InvalidModificationError`), and
 * content hashing is exactly what makes two callers want the same name — so the second registration
 * is the ordinary case, not the error case. A `Set` rather than a bare try/catch, because a
 * try/catch alone would also swallow real errors.
 */
const registered = new WeakMap<object, Set<string>>();

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
export const ensureProperty = (
  name: string,
  node: Element,
  /** Tier C's split (the recorded invariant): the SCROLLER var must inherit or descendants
   *  never see it; everything per-element stays non-inheriting or a parent's number leaks into
   *  nested motion. `initial` parameterized for the same tier: the range divisor defaults to 1
   *  so an unwritten element divides by one, never by zero. */
  options?: { readonly inherits?: boolean; readonly initial?: string }
): void => {
  /**
   * The ELEMENT'S realm, never the module's (CODE-PRINCIPLES §2): `CSS.registerProperty` types a
   * property in the calling window, and an element in a portaled document needs its own window's
   * registration or its number never interpolates there. One registered-set per view for the same
   * reason — the same name is a fresh registration in a fresh realm.
   */
  const view = (node.ownerDocument?.defaultView ?? globalThis) as
    typeof globalThis & { CSS?: { registerProperty?: (d: object) => void } };
  const names = registered.get(view) ?? new Set<string>();
  if (names.has(name)) return;
  if (typeof view.CSS?.registerProperty !== 'function') return;
  try {
    view.CSS.registerProperty({ name, syntax: '<number>',
      inherits: options?.inherits ?? false, initialValue: options?.initial ?? '0' });
  } catch (error) {
    if ((error as DOMException)?.name !== 'InvalidModificationError') throw error;
    if (name !== PROGRESS_PROPERTY) pageProblem('motion-progress-property-taken', [name]);
  }
  names.add(name);
  registered.set(view, names);
};

/** The engine's own variable — the one every generated rule seeks by unless `progress` renames it. */
export const PROGRESS_PROPERTY = '--vm-p';

/** The per-element STAGGER offset, subtracted in every seek — `var(--vm-so, 0)`, so a
 *  non-staggered element pays one fallback lookup and every sibling shares one rule set.
 *  A constant per element (written at measure time), never chased, so it is not a Driven and
 *  needs no registration: the calc fallback types it. */
export const STAGGER_PROPERTY = '--vm-so';

/**
 * Tier C — the one-write scroller (measured: typed division through the whole seek chain, 3/3
 * engines incl. Firefox). The region writes THIS, once per scroller per pass; every element
 * derives its own progress in CSS from two per-element constants written at measure time. The
 * per-frame JS cost of a scrub stops scaling with element count.
 */
export const SCROLL_PROPERTY = '--vm-s';
/** Range start along the axis, px, per element — written at measure, re-written on re-measure. */
export const RANGE_START_PROPERTY = '--vm-r0';
/** Range size along the axis, px, per element. Registered initial 1: never divide by zero. */
export const RANGE_SIZE_PROPERTY = '--vm-r1';

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
 * The realm the shared sheet belongs to. A constructed sheet can only be adopted by documents of
 * ITS OWN realm — cross-window adoption throws — so a root from any OTHER document takes the
 * `<style>` fallback below, which builds through `ownerDocument` and is realm-safe by
 * construction. Duplication per foreign window is the accepted cost; a per-realm shared sheet is
 * queued rather than half-built.
 */
let sheetDocument: Document | null = null;
const documentOf = (root: SheetRoot): Document =>
  isDocument(root) ? root : (root.ownerDocument as Document);

/**
 * Whether constructed sheets work here, decided once. jsdom's `CSSStyleSheet` throws on
 * construction and older engines lack `adoptedStyleSheets`; both take the `<style>` fallback.
 */
const constructed = (root: SheetRoot): boolean => {
  try {
    /**
     * BOTH halves, learned the hard way: jsdom constructs a `CSSStyleSheet` happily and then has
     * no `adoptedStyleSheets` to put it in — probing construction alone chose the constructed
     * path and threw "not iterable" out of the first acquire, taking the whole element with it.
     * A capability check that tests half the capability is a capability check for a different
     * feature.
     */
    return new CSSStyleSheet() instanceof CSSStyleSheet &&
      Array.isArray((root as Document).adoptedStyleSheets);
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

/**
 * The pinned TAIL — the `(scripting: none)` neutraliser. Its whole design is being LAST in the
 * sheet so specificity-tied rules lose to it on order; every later insert would unseat a plain
 * append, so the registry owns the pinning: inserts land BEFORE the tail, and the fallback text
 * appends it after everything.
 */
let tails: readonly string[] = [];
export const setTails = (cssTexts: readonly string[]): void => {
  /** SET-ONCE: every caller pins the same constant set at first delivery. Replacing tails
   *  mid-life would need index bookkeeping nothing exercises, so a change is ignored rather
   *  than half-supported — the constant lives in one place and cannot legitimately differ. */
  if (tails.length) return;
  tails = cssTexts;
  if (usable && shared) for (const text of cssTexts) shared.insertRule(text, shared.cssRules.length);
  else refreshFallbacks();
};

const fallbackText = (): string =>
  order.map((hash) => entries.get(hash)!.cssText).join('\n') +
  (tails.length ? `\n${tails.join('\n')}` : '');

/**
 * Realm-free document test (CODE-PRINCIPLES: derive from the node, never the module global).
 * `instanceof Document` reaches for a global CLASS the embedding may not have installed — the
 * jsdom harness sets `document` but not `Document`, so the fallback path threw a ReferenceError
 * out of the first acquire and took the element with it. A nodeType is a number; it has no realm.
 */
const isDocument = (root: SheetRoot): root is Document => root.nodeType === 9;

/**
 * `data-vm-sheet`, deliberately OUTSIDE the `data-vd-*` prefix: the engine scans that namespace
 * for directives, and the first marker (`data-vd-sheet`) was picked up and refused as an unknown
 * directive — infrastructure leaking into the vocabulary it delivers. Found by a probe's rejection
 * list, which is what rejection lists are for.
 */
const fallbackStyleIn = (root: SheetRoot): HTMLStyleElement | null => {
  const doc = isDocument(root) ? root : root.ownerDocument;
  for (const child of (isDocument(root) ? root.head : root).children) {
    if ((child as HTMLElement).dataset?.['vmSheet'] === 'motion') return child as HTMLStyleElement;
  }
  const style = doc.createElement('style');
  style.dataset['vmSheet'] = 'motion';
  (isDocument(root) ? root.head : root).appendChild(style);
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
  usable ??= constructed(root);

  const entry = entries.get(hash);
  if (entry) {
    /**
     * **INSURANCE, not the fix, and no longer the bug-catcher it briefly was.** Two things keep
     * distinct bodies from arriving here under one name, and both are upstream: the name is 64 bits
     * (so accidents are ~1 in 370 billion at ten thousand rules), and `generate.ts` derives it from
     * the RULES THEMSELVES rather than from a curated summary of the parse (so a body cannot depend
     * on something the name does not cover).
     *
     * That second property is what this check earned its place finding. Before it, `animation-range`
     * read `scroll` while the name did not, and two elements differing only in scroll range shared
     * one name — the second's rule discarded, the element silently wearing the first's range. That
     * class is now closed by construction, which downgrades this from a guard against a LIKELY
     * failure to a guard against an impossible one.
     *
     * It stays because the failure is invisible by nature — the alternative to a cheap assertion is
     * never finding out — and because it is nearly free: ~12 ns on the DEDUPE path (the common one;
     * two hundred elements sharing an animation are 199 hits) against the 440 ns already spent
     * hashing that same body. Under 3% of work the code does anyway.
     *
     * Refusing rather than renaming is forced and deliberate: by now the name is inside this
     * rule's selector, inside the `animation-name` that references it, and on the element's
     * marker. A rename here would have to reach all three, and deciding WHICH body renames cannot
     * be done without state — which activation order makes unusable (see
     * `tests/motion-order-independence.test.mjs`).
     */
    if (entry.cssText !== cssText) {
      pageProblem('motion-rule-name-collision', [hash]);
      return;
    }
    entry.count++;
  } else {
    entries.set(hash, { count: 1, cssText });
    order.push(hash);
    if (usable) {
      shared ??= new CSSStyleSheet();
      /** Before the tails, always — their position IS their function. */
      shared.insertRule(cssText, shared.cssRules.length - tails.length);
    }
  }

  const sameRealm = sheetDocument === null || sheetDocument === documentOf(root);
  if (usable && sameRealm) {
    sheetDocument ??= documentOf(root);
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
