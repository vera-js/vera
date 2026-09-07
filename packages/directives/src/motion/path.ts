/**
 * Path — follow an SVG path, for the motion object.
 *
 * `path` animates `offset-distance`, an ordinary numeric percentage the
 * runtime interpolates and the transition damps like anything else — no
 * per-frame `getPointAtLength()`. What makes it *follow* something is
 * `offset-path`, resolved **once** from the `<path>` named by
 * `path-selector` — in the property's own per-element `setup` now, which is
 * the fold-in's redesign: the old `prepare`-insert dance existed to track an
 * edited selector across re-collects, and the engine's rebuild-on-edit does
 * that by construction — an edited value re-activates the element, the
 * teardown restores what was written, the setup re-resolves. The stale
 * offset-path bug class is structurally gone.
 *
 * ```js
 * import { wireDirectives } from '@verajs/directives';
 * import { motion, path } from '@verajs/directives/motion';
 * wireDirectives([motion, path]);
 * ```
 */
import type { PropertyDef, SettingDef, WirableTree } from './schema.js';

const FROM = '@verajs/directives/motion';

/**
 * Validates SVG path data before it is interpolated into a CSS `path()`.
 * The `d` attribute is author-controlled, and it ends up inside a quoted
 * CSS function — a stray quote or parenthesis would break out of it.
 * Restricting the alphabet to what path data can legally contain closes
 * that off without needing to parse the grammar.
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
 * The distance along the path, as a plain animatable property — the runtime
 * writes `offset-distance` like any other `cssProperty`. This module's whole
 * job is making sure there is an `offset-path` for it to travel, which is
 * what `setup` does.
 */
const distance: PropertyDef = {
  key: 'path',
  from: FROM,
  category: 'svgPath',
  cssProperty: 'offset-distance',
  defaultUnit: '%',
  units: ['%'],
  min: 0,
  max: 100,
  initial: 0,

  setup(node, settings, reject) {
    const selector = settings['path-selector'];
    /**
     * `path` drives `offset-distance`, which does nothing without an
     * `offset-path` to travel along. A selector that resolves badly is
     * refused below with which of the three ways it failed; the only silent
     * case would be forgetting the key altogether, so that one is said too.
     */
    if (typeof selector !== 'string') {
      reject('path needs path-selector — offset-distance travels along nothing without it.');
      return;
    }

    /**
     * The element's own root, not the document — a path inside a shadow
     * root is invisible to `document.querySelector`.
     */
    const scope = node.getRootNode() as Document | ShadowRoot;
    const source = scope.querySelector(selector);
    const data = source?.getAttribute('d') ?? null;
    const cleaned = data !== null ? parsePathData(data) : null;
    /**
     * `parsePathData` restricts the *alphabet* and says so — it deliberately
     * does not parse the grammar. That leaves shapes CSS refuses (`MMM`, a
     * lone `M`), which passed, were written, and were dropped by the engine —
     * so `path` animated along nothing at all, in silence. `CSS.supports` is
     * the second reader for exactly that reason. (It answers true for
     * anything under jsdom/happy-dom; browser-verified.)
     */
    const safe =
      cleaned !== null &&
      (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('offset-path', `path("${cleaned}")`))
        ? cleaned
        : null;

    if (!safe) {
      /** Which of the three ways it failed, because they are fixed differently. */
      const why = !source
        ? 'matched no element'
        : data === null
          ? 'matched an element with no d attribute'
          : 'matched a path whose d attribute is not usable';
      reject(`path-selector '${selector}' ${why}${__DEV__ ? '; path does nothing.' : ''}`);
      return;
    }

    /** What was inline before this wrote, so teardown puts it back exactly. */
    const prior = {
      path: node.style.getPropertyValue('offset-path'),
      rotate: node.style.getPropertyValue('offset-rotate'),
    };
    node.style.offsetPath = `path("${safe}")`;
    /** Otherwise the element is also rotated to follow the path's tangent. */
    const rotate = settings['path-rotate'];
    node.style.offsetRotate = typeof rotate === 'string' ? rotate : '0deg';

    return () => {
      if (prior.path) node.style.setProperty('offset-path', prior.path);
      else node.style.removeProperty('offset-path');
      if (prior.rotate) node.style.setProperty('offset-rotate', prior.rotate);
      else node.style.removeProperty('offset-rotate');
    };
  },
};

/**
 * Registered so parse validates and reports it like any built-in setting.
 * No `parse` of its own, deliberately: the built-in `selector` type runs
 * the shared `parseSelector` — the same function everywhere — with its
 * default (no lists), which is right here: the value is handed to
 * `querySelector`, where `a, b` means "first match of any branch".
 */
const selectorSetting: SettingDef = {
  key: 'path-selector',
  from: FROM,
  type: 'selector',
};

/**
 * How the element is oriented along the path. `auto` turns it to follow the
 * tangent; the default keeps it upright.
 */
const rotateSetting: SettingDef = {
  key: 'path-rotate',
  from: FROM,
  type: 'string',
  allowed: ['auto', 'reverse', '0deg'],
};

/** The vocabulary rows — `wireDirectives([motion, path])` registers them. */
export const pathRows: WirableTree = [distance, selectorSetting, rotateSetting];
