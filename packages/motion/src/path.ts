/**
 * `@verajs/motion/path` — follow an SVG path.
 *
 * A property-plus-setup module: `path` animates `offset-distance`, an ordinary
 * numeric percentage the runtime interpolates and the transition damps like
 * anything else — no per-frame `getPointAtLength()`. What makes it *follow*
 * something is `offset-path`, resolved **once** from the `<path>` named by
 * `path-selector` and written here, in the `prepare` insert, before the
 * runtime collects the root.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { path } from '@verajs/motion/path';
 *
 * wireMotion(path);
 * createMotion().init();
 * ```
 *
 * Take `wireMotion` from `@verajs/motion`. This module exports descriptors and
 * never registers itself — a module that imported its own copy of the schema
 * would write to a table the runtime never reads, and it would not throw.
 */
import type { Insert, PropertyDef, SettingDef } from './modules/schema.js';
import { parseSelector, reject } from '@verajs/motion';
import { ATTRIBUTE_PREFIX } from './modules/namespace.js';

/**
 * What a GUI panel tells an author to import to make these attributes work.
 * One constant, so the specifier is one string in the bundle rather than one
 * per definition. See `PropertyDef.from`.
 */
const FROM = '@verajs/motion/path';

const SELECTOR_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-path-selector`;
const ROTATE_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-path-rotate`;

/**
 * Validates SVG path data before it is interpolated into a CSS `path()`.
 *
 * The `d` attribute is author-controlled, and it ends up inside a quoted CSS
 * function — a stray quote or parenthesis would break out of it. Restricting
 * the alphabet to what path data can legally contain closes that off without
 * needing to parse the grammar (principle #8).
 */
export const parsePathData = (raw: string): string | null => {
  const value = raw.trim();
  if (value === '' || value.length > 20000) return null;

  /** Path commands, numbers (including exponents), separators. Nothing else. */
  if (!/^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-.,\s]+$/.test(value)) return null;

  /** Must begin with a moveto, as the SVG grammar requires. */
  if (!/^[\s]*[Mm]/.test(value)) return null;

  return value;
};

/**
 * What each node's inline `offset-path`/`offset-rotate` were before this
 * module wrote them, captured on the first write so `release`/`teardown` can
 * put them back. Keyed strongly, and bounded by it: every entry is removed in
 * `release` (the runtime calls it for each departing node) or `teardown`.
 */
const written = new Map<HTMLElement, { readonly path: string; readonly rotate: string }>();

const restore = (target: Element): void => {
  const node = target as HTMLElement;
  const prior = written.get(node);
  if (!prior) return;
  written.delete(node);
  if (prior.path) node.style.setProperty('offset-path', prior.path);
  else node.style.removeProperty('offset-path');
  if (prior.rotate) node.style.setProperty('offset-rotate', prior.rotate);
  else node.style.removeProperty('offset-rotate');
};

const setUp = (node: HTMLElement): void => {
  const selector = parseSelector(node.getAttribute(SELECTOR_ATTRIBUTE) ?? '');
  /** An unparsable selector was already refused at parse time; nothing to add. */
  if (selector === null) return;

  /**
   * The element's own root, not the document — a path inside a shadow root is
   * invisible to `document.querySelector`. Same bug the smooth-scroll module
   * had (audit SC2).
   */
  const scope = node.getRootNode() as Document | ShadowRoot;
  const source = scope.querySelector(selector);
  const data = source?.getAttribute('d');
  const cleaned = data ? parsePathData(data) : null;
  /**
   * `parsePathData` restricts the *alphabet* and says so — it deliberately
   * does not parse the grammar, because the threat it exists for is a quote
   * or a parenthesis breaking out of the `path("…")` string. That leaves
   * shapes CSS refuses: `MMM`, a lone `M`, `M0 0 L`. Each one passed, was
   * written as an `offset-path`, and was dropped by the engine — so `path`
   * animated `offset-distance` along nothing at all, in silence, which is the
   * one outcome the refusal below already exists to prevent. `CSS.supports`
   * is the second reader for exactly that reason.
   *
   * `CSS.supports` always answers true in happy-dom, which is why this is
   * verified in a browser by `spikes/path-validity.mjs` rather than in the
   * suite — the same arrangement `paint` has.
   */
  const safe =
    cleaned !== null &&
    (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('offset-path', `path("${cleaned}")`))
      ? cleaned
      : null;
  if (safe) {
    if (!written.has(node)) {
      written.set(node, {
        path: node.style.getPropertyValue('offset-path'),
        rotate: node.style.getPropertyValue('offset-rotate'),
      });
    }
    node.style.offsetPath = `path("${safe}")`;
    /** Otherwise the element is also rotated to follow the path's tangent. */
    node.style.offsetRotate = node.getAttribute(ROTATE_ATTRIBUTE) ?? '0deg';
  } else {
    /**
     * In `rejected` as well as the console — the GUI renders `rejected` and
     * cannot read a console, and the README sends anyone whose element is not
     * animating there. Which of the three ways it failed, because they are
     * fixed differently: a selector matching nothing is a typo or a path in
     * another root, an element without `d` is the wrong element, and a `d`
     * this refuses is a path the sanitiser would not pass through.
     */
    const why = !source
      ? 'matched no element'
      : data === null
        ? 'matched an element with no d attribute'
        : 'matched a path whose d attribute is not usable';
    reject(node, `${SELECTOR_ATTRIBUTE}="${selector}" ${why}${__DEV__ ? `; ${ATTRIBUTE_PREFIX}-path does nothing.` : ''}`);
    console.warn(`@verajs/motion: no usable path found for "${selector}".`);
  }
};

/**
 * The distance along the path, as a plain animatable property. The runtime
 * writes `offset-distance` like any other `cssProperty` — this module's whole
 * job is making sure there is an `offset-path` for it to travel.
 */
const distance: PropertyDef = {
  attribute: 'path',
  from: FROM,
  category: 'svgPath',
  cssProperty: 'offset-distance',
  defaultUnit: '%',
  units: ['%'],
  min: 0,
  max: 100,
  initial: 0,
};

/**
 * Registered so parse validates and reports it like any built-in setting. No
 * `parse` of its own, deliberately: the built-in `selector` type runs core's
 * `parseSelector` — the same function `setUp` imports — with the reasons the
 * switch already words (a list gets the list sentence, not the generic one),
 * so the two call points can never disagree about what a selector is. The
 * type's default (no lists) is right here: the value is handed to
 * `querySelector`, where `a, b` means "first match of any branch" rather
 * than what a list is written to mean.
 */
const selectorSetting: SettingDef = {
  attribute: 'path-selector',
  from: FROM,
  type: 'selector',
};

/**
 * How the element is oriented along the path. `auto` turns it to follow the
 * tangent; the default keeps it upright, which is what the pre-rewrite
 * behaviour did by only translating.
 */
const rotateSetting: SettingDef = {
  attribute: 'path-rotate',
  from: FROM,
  type: 'string',
  allowed: ['auto', 'reverse', '0deg'],
};

const inserts: readonly Insert[] = [
  {
    on: 'prepare',
    /**
     * Before collection, so the `offset-path` is in place when the runtime
     * takes its first reading — and again on every re-collect, which is what
     * tracks an edited selector or a rewritten `d`. Nothing to write when
     * nothing will animate (reduced motion, disabled); `teardown` has already
     * put back anything from an earlier enabled run.
     */
    fn: (root: ParentNode, enabled: boolean): void => {
      if (!enabled) return;
      /**
       * First, the nodes this module wrote that no longer ask for a path.
       * The runtime used to strip `offset-path` in `clearElement` on every
       * re-parse; module-owned styles are outside that now, and `release`
       * only fires on removal — so an author editing `path-selector` *away*
       * kept the stale offset-path for the life of the element. The roster
       * is `written`, which is exactly the set of nodes with something to
       * take back.
       */
      for (const node of [...written.keys()]) {
        if ((root === node || root.contains(node)) && !node.hasAttribute(SELECTOR_ATTRIBUTE)) {
          restore(node);
        }
      }
      for (const node of root.querySelectorAll<HTMLElement>(`[${SELECTOR_ATTRIBUTE}]`)) {
        setUp(node);
      }
      /**
       * `path` drives `offset-distance`, which does nothing without an
       * `offset-path` to travel along — and that comes from `path-selector`.
       * Without one the element wrote `offset-distance: 100%` every frame,
       * moved nowhere, and said nothing. A selector that resolves to no path
       * already warns above, so the only silent case is forgetting the
       * attribute altogether.
       */
      for (const node of root.querySelectorAll<HTMLElement>(
        `[${ATTRIBUTE_PREFIX}-path]:not([${SELECTOR_ATTRIBUTE}])`
      )) {
        reject(node, `${ATTRIBUTE_PREFIX}-path needs ${SELECTOR_ATTRIBUTE}`);
      }
    },
  },
  { on: 'release', fn: restore },
  {
    on: 'teardown',
    fn: (owns: (node: Node) => boolean): void => {
      for (const node of [...written.keys()]) if (owns(node)) restore(node);
    },
  },
];

/** Hand this to `wireMotion`. */
export const path: readonly (PropertyDef | SettingDef | Insert)[] = [
  distance,
  selectorSetting,
  rotateSetting,
  ...inserts,
];
