/**
 * Turns attributes on an element into an animation object.
 *
 * Replaces the camelCase string surgery in createElements.js. That approach
 * read `element.dataset`, which forces every kebab attribute through a
 * camelCase round trip, then recovered the parts by splitting at capitals and
 * trimming known substrings. Reading `getAttributeNames()` instead keeps the
 * authored spelling, so the grammar in schema.ts can be matched directly and
 * there is no string surgery at all.
 *
 * Validation is not a formatting concern here. In a CMS anyone who can edit
 * a block can set these values, so every one is checked against the schema and
 * a failure drops that animation rather than guessing (principle #8).
 */
import {
  ATTRIBUTE_PREFIX, SUB_PREFIX, SCROLL_TARGET_ATTRIBUTE, PRESETS, getSetting,
  getProperty, isPreset, isSetting,
  parseAttributeName, parseBandedList, parseSelector, parseEasing, parseOrigin,
  parseOffset, parsePosition, properties, settings,
} from './schema.js';
import type { PropertyDef, Unit, RawKeyframe, PositionUnit, Band, Range } from './schema.js';


export interface ElementMotion {
  readonly property: PropertyDef;
  readonly unit: Unit;
  /**
   * Positions are still in their authored units. Normalising them needs the
   * element's size and the viewport, which parse has no business knowing —
   * so the curve is built by the runtime and rebuilt on resize when any
   * position depends on geometry. See docs/KEYFRAME-SYNTAX.md.
   */
  readonly keyframes: readonly RawKeyframe[];
  /**
   * Width-ranged overrides that merge onto the base.
   *
   * From an inline `[0-500]: …` or from a name suffix whose range was
   * registered on the instance — both resolve to a range here, so the runtime
   * only ever deals in ranges and never in names.
   */
  readonly bands: readonly Band[];
  /** True when a position uses anything but `%`, so the curve must be rebuilt on resize. */
  readonly geometryDependent: boolean;
}

export interface ParseContext {
  /**
   * Named width ranges, so `data-vera-motion-opacity-mobile` can mean whatever this
   * site calls mobile. A name is only ever an alias for a range.
   */
  readonly breakpoints?: ReadonlyMap<string, Range>;
  /**
   * Where diagnostics go for an element that is dropped entirely.
   *
   * An element whose *every* animation failed to validate has no
   * `ParsedElement` to carry its `rejected` list, so the reasons used to be
   * discarded — and that is precisely the element someone is debugging when
   * they ask why nothing is animating. Optional, so a caller that does not
   * want diagnostics allocates nothing.
   */
  readonly dropped?: DroppedElement[];
  /**
   * The instance's own `inertia`, for the one refusal that cannot be decided
   * from an element's attributes alone: `inertia-ease` with nothing to ease.
   * An element that writes neither `inertia` nor a category override inherits
   * this, and at 0 there is no transition for the easing to shape.
   */
  readonly inertia?: number;
}

/**
 * One element's diagnostics, for `MotionInstance.rejected`.
 *
 * `node` is `null` for a problem with the *configuration* rather than with an
 * element — a `createMotion` option the runtime refused and fell back on.
 * `scroll-to` has reported its own configuration that way since it gained
 * diagnostics, and one GUI reads both lists; motion's held only attributes, so
 * every bad option went to a console that GUI cannot read. It is the thing most
 * likely to write a bad option, because it generates them.
 *
 * Consumers iterating this must expect the null. There is at most one such
 * entry, and it sorts first.
 */
export interface RejectedElement {
  readonly node: Element | null;
  readonly rejected: readonly string[];
}

/**
 * The same, for an element rather than for the configuration.
 *
 * Every entry in `dropped` is about a node, and narrowing it here rather than
 * asserting at each use keeps the nullability where it belongs — on the one
 * entry that genuinely has no element.
 */
export interface DroppedElement extends RejectedElement {
  readonly node: Element;
}

export interface ParsedElement {
  readonly node: Element;
  readonly animations: readonly ElementMotion[];
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  /**
   * How far this element's keyframes shift, from a `stagger` on an ancestor.
   *
   * Left in its authored unit rather than resolved here, for the same reason
   * keyframe positions are: `40px` of stagger and a `50%` keyframe normalise
   * against different quantities, so they can only be added once both are
   * timeline fractions. The runtime does that.
   */
  readonly stagger?: { readonly position: number; readonly positionUnit: PositionUnit };
  /** Values the schema could not accept, for diagnostics. Empty on a clean parse. */
  readonly rejected: readonly string[];
}

/** Declared once: the check above and `staggerFor` below both need it. */
const STAGGER_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-stagger`;

let staggerGeneration = 0;
const staggerIndices = new WeakMap<Element, { gen: number; index: Map<Element, number> }>();

/**
 * Drops the stagger indices learned for the current batch.
 *
 * Same shape and the same reason as `forgetSticky`: the answer is a fact about
 * the DOM as it is now, so it is cached for the length of one pass and dropped
 * at the start of the next. Every path that parses a batch calls this first —
 * `collect()`, `reparse()` and `parseAll()`.
 */
export const forgetStagger = (): void => {
  staggerGeneration++;
};

/**
 * Where `node` sits among the descendants `host` staggers, in document order.
 *
 * The group is walked once and every member's index recorded, because every
 * member is about to ask. The `closest` per candidate is what makes a nested
 * group resolve against its own host rather than being counted twice — see
 * `staggerFor`.
 */
const indexIn = (host: Element, node: Element): number => {
  const seen = staggerIndices.get(host);
  if (seen && seen.gen === staggerGeneration) return seen.index.get(node) ?? 0;

  const index = new Map<Element, number>();
  let at = 0;
  for (const candidate of host.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) {
    if (candidate.parentElement?.closest(`[${STAGGER_ATTRIBUTE}]`) === host) index.set(candidate, at++);
  }
  staggerIndices.set(host, { gen: staggerGeneration, index });
  /**
   * A node the walk did not reach is not one of this host's staggered
   * descendants and gets no offset. **Currently unreachable**: `host` came
   * from this node's own `closest`, and `staggerFor` runs only for a node
   * carrying the marker, which is exactly what the walk selects.
   */
  return index.get(node) ?? 0;
};
const SPLIT_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-split`;



/** Every element the runtime should animate. */
export const findElements = (root: ParentNode = document): Element[] => {
  const found = Array.from(root.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`));
  /**
   * **The root counts as one of its own elements.**
   *
   * `querySelectorAll` does not match the node it is called on, so an element
   * handed to `root:` or to `observe()` used to be the single node in its own
   * subtree that could never animate — marker, attributes, everything correct,
   * and an empty `elements` with an empty `rejected`.
   *
   * That was never a decision. Until 2026-08-31 the README said only "where to
   * look for animated elements", and the limitation fell out of the selector's
   * semantics rather than out of anything anyone chose.
   * `createMotion({ root: section })` where the section fades in and its
   * children stagger is an ordinary thing to write, and the author has put the
   * marker on it *and* handed it over: the intent is not ambiguous.
   *
   * First, because document order is what `stagger` indexes by.
   *
   * A `Document` and a `ShadowRoot` carry no attributes and answer `nodeType`
   * 9 and 11, so this only ever reaches the element case.
   */
  const self = root as Element;
  if (self.nodeType === 1 && self.hasAttribute(ATTRIBUTE_PREFIX)) found.unshift(self);
  return found;
};

/**
 * What one property collected from an element's attributes: the unsuffixed
 * value, plus any `-name`-suffixed ones with the range that name stands for.
 */
interface Collected {
  base?: string;
  readonly named: Array<{ readonly range: Range; readonly raw: string }>;
}

const slotFor = (into: Map<string, Collected>, property: string): Collected => {
  let slot = into.get(property);
  if (!slot) {
    slot = { named: [] };
    into.set(property, slot);
  }
  return slot;
};

/**
 * Parses one element's settings.
 *
 * (This used to claim settings are read first because url settings validate
 * animation values — true when `frame-url` lived in core, and not since it
 * moved to `@verajs/motion/sequence`. The order is now only the natural one:
 * settings feed the cross-checks `parseElement` runs after building
 * animations.)
 */
/**
 * The attribute an unknown name was probably meant to be, or null.
 *
 * Only the shapes a *spelling* system produces, not a general fuzzy match:
 * strip everything that is not a letter or digit and compare. That catches the
 * whole copy-paste family in one comparison — `translateY` (the DOM has
 * already lowercased it to `translatey`), `translate_y`, `translatey` — which
 * is what an author transcribing a CSS or JS name actually writes. A missing
 * or wrong *letter* is deliberately not guessed at: edit distance would need a
 * threshold, and a confident wrong suggestion costs more than none.
 *
 * Reads the live registry, so a module's attributes are suggestible the moment
 * it is wired, and nothing here names an attribute.
 *
 * `__DEV__` only — production says `unknown attribute` and pays nothing for
 * this, which is why it can afford to be generous.
 */
const probablyMeant = (name: string): string | null => {
  if (!__DEV__) return null;
  const flatten = (text: string) => text.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const target = flatten(name);
  for (const entry of [...properties(), ...settings()]) {
    if (flatten(entry.attribute) === target) return entry.attribute;
  }
  return null;
};

/**
 * Why a setting of each type was refused, in one place.
 *
 * Read by both paths that can refuse one: the switch below, and the branch for
 * a setting carrying its own `parse`. `when` is the only **core** setting in
 * the second — `parse: (raw) => parseSelector(raw, true)` — so wording that
 * branch as "the module that owns it refused the value" was wrong about the
 * one core case it actually had. A module with a type this does not know still
 * gets that sentence, which is the honest answer there.
 *
 * `number` and `string` are absent on purpose: their reasons quote the range
 * and the allowed list, so they are built where those are in scope.
 */
const WHY: Record<string, string> = __DEV__ ? {
  boolean: 'must be true or false, or present with no value for true',
  easing: 'is not an easing name or a cubic-bezier()',
  origin: 'is not a transform-origin',
  offset: 'is not a length or a percentage',
  selector: 'is not a selector this library will use — :has() and a few others are refused',
  length: 'is not a length — use px, rem, em, %, vh or vw',
} : {
  boolean: 'not a boolean',
  easing: 'not an easing',
  origin: 'not an origin',
  offset: 'not an offset',
  selector: 'not a usable selector',
  length: 'not a length',
};

const parseSettings = (
  node: Element,
  rejected: string[]
): Record<string, string | number | boolean> => {
  const settings: Record<string, string | number | boolean> = {};

  for (const name of node.getAttributeNames()) {
    if (!name.startsWith(SUB_PREFIX)) continue;

    const key = name.slice(SUB_PREFIX.length);
    const def = getSetting(key);
    if (!def) continue;

    const raw = (node.getAttribute(name) ?? '').trim();

    /**
     * Why, not just what.
     *
     * Every branch below used to push the bare attribute name, so a GUI
     * rendering `rejected` showed `data-vera-motion-when` and nothing else for
     * a `:has()` selector, `data-vera-motion-run-once` for `run-once="yes"`,
     * and so on for all ten. A *property* refusal has always carried a
     * sentence — `translate-y: more than 256 keyframes` — and the README
     * describes this array as "reasons" and sends anyone whose element is not
     * animating to read it. A name is not a reason.
     *
     * The raw value is deliberately not quoted back: it can be a 4 KB keyframe
     * list, and the attribute name is enough to find it. Same `name: why`
     * shape the property refusals use, so a reader sees one kind of sentence.
     */
    const no = (why: string): void => { rejected.push(`${name}: ${why}`); };

    /** A module validates its own settings; the built-in types follow. */
    if (def.parse) {
      /** A throw is the same answer as `null` — see `parseMeasure`. */
      let parsed: ReturnType<NonNullable<typeof def.parse>> = null;
      try { parsed = def.parse(raw); } catch { /* refused */ }
      /**
       * The module owning this setting is the only thing that knows the real
       * reason, and it can say so with `reject()` — which merges into the same
       * list. This is the fallback for one that does not.
       */
      if (parsed === null) no(WHY[def.type] ?? (__DEV__ ? 'was refused by the module that owns it' : 'refused'));
      else settings[key] = parsed;
      continue;
    }

    switch (def.type) {
      case 'boolean':
        /**
         * A bare attribute reads as true, which is how HTML boolean attributes
         * behave. `"true"` and `"false"` are spelled out because a GUI writing
         * these needs a way to say *off* that survives a round trip.
         *
         * Anything else is refused rather than read as false. `run-once="yes"`
         * and `run-once="1"` both meant "on" to whoever wrote them and both
         * came out **off**, silently — and these attributes are written by
         * people and by AI as well as by the GUI. Being wrong about a boolean
         * is quiet in a way being wrong about a number is not: nothing looks
         * broken, the animation simply repeats when it was asked not to.
         */
        if (raw === '' || raw === 'true') settings[key] = true;
        else if (raw === 'false') settings[key] = false;
        else no(WHY['boolean']!);
        break;
      case 'number': {
        const value = Number(raw);
        /**
         * Range-checked like every property value is. Without the bounds an
         * attribute could set a transition of 1e8 seconds, or a zero-pad width
         * that allocates a 10 MB string per drawn frame.
         */
        const out =
          raw !== '' &&
          Number.isFinite(value) &&
          !(def.min !== undefined && value < def.min) &&
          !(def.max !== undefined && value > def.max);
        if (out) settings[key] = value;
        else {
          /**
           * Each bound spoken for only when it exists. Every built-in number setting carries
           * both, but a module's registration is not obliged to — and `from 0 to undefined`
           * in a diagnostic a GUI renders is the message equivalent of the bug it reports.
           */
          const range =
            def.min !== undefined && def.max !== undefined ? ` from ${def.min} to ${def.max}`
            : def.min !== undefined ? ` of at least ${def.min}`
            : def.max !== undefined ? ` of at most ${def.max}`
            : '';
          no(`must be a number${range}`);
        }
        break;
      }
      case 'easing': {
        const easing = parseEasing(raw);
        if (easing === null) no(WHY['easing']!);
        else settings[key] = easing;
        break;
      }
      case 'origin': {
        const origin = parseOrigin(raw);
        if (origin === null) no(WHY['origin']!);
        else settings[key] = origin;
        break;
      }
      case 'offset': {
        const offset = parseOffset(raw);
        if (offset === null) no(WHY['offset']!);
        else settings[key] = offset;
        break;
      }
      case 'selector': {
        const selector = parseSelector(raw);
        /**
         * A comma is the one refusal here with a reason of its own, and the one
         * an author is most likely to hit. This setting is handed to
         * `querySelector`, which returns the first match of *any* branch rather
         * than requiring all of them — not what `a, b` is written to mean — so
         * a list is refused for it and allowed for `when`, which is handed to
         * `matches()`.
         *
         * Without this the generic reason pointed at `:has()`, which was not
         * the problem and would not have fixed it. A reason that misdirects is
         * worse than the silence it replaced.
         */
        if (selector === null && raw.includes(',')) {
          no(__DEV__
            ? 'is one selector, not a list — it is handed to querySelector, which would take ' +
              'whichever matched first'
            : 'not one selector');
        }
        else if (selector === null) no(WHY['selector']!);
        else settings[key] = selector;
        break;
      }
      case 'length': {
        /** A CSS length: a number with an optional unit from the allowlist. */
        const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vh|vw)?$/.exec(raw);
        if (!match) no(WHY['length']!);
        else settings[key] = `${match[1]}${match[2] ?? 'px'}`;
        break;
      }
      case 'string':
        if (def.allowed && !def.allowed.includes(raw)) no(`must be one of: ${def.allowed.join(', ')}`);
        else settings[key] = raw;
        break;
      /**
       * A type this switch does not speak, on a registration with no `parse` of its own —
       * `url` is in the union for module settings that always carry a validator, and a module
       * inventing a type is the same shape. Falling out of the switch silently dropped the
       * attribute: not stored, not refused, invisible on the one channel the README points at.
       */
      default:
        no(__DEV__ ? `could not be read — its type ("${def.type}") needs the owning module's own parse` : 'needs its module');
    }
  }

  return settings;
};

/**
 * Expands the preset named on the marker attribute into keyframes.
 *
 * Presets are only keyframes, so they are never a special case downstream —
 * an explicit attribute for the same property simply replaces the preset's
 * contribution wholesale, which is more predictable than merging per keyframe.
 *
 * `PRESETS`, the static table, and not a live registry — deliberately, and
 * this is the one place in the codebase where reading a static table is
 * correct. A module can register a property, a setting or an insert;
 * `Wirable` has no preset variant, so the built-in table *is* every preset
 * there is. If that ever changes, this read and the reference generator's
 * both become one more hand-held copy of a live table — the drift this
 * codebase keeps refinding.
 */
const applyPreset = (name: string, into: Map<string, Collected>): void => {
  const preset = PRESETS[name];
  if (!preset) return;

  for (const [property, value] of Object.entries(preset)) {
    /**
     * An explicit *base* for the same property wins outright — but a
     * `-mobile`-style band is not a base.
     *
     * Testing whether the property had been seen at all meant a band-suffixed
     * override suppressed the preset entirely: `data-vera-motion="fade"` with
     * `data-vera-motion-opacity-mobile="0% 0.5, 100% 1"` produced no base
     * keyframes, so the element did not fade at any width except that band.
     * The attribute says at which widths it differs; it does not say the
     * preset was a mistake.
     *
     * A band written *inline* — `opacity="[0-700]: 0% 0.5, 100% 1"` — still
     * wins outright, because that is an explicit attribute for the property
     * and the documented rule is that one replaces the preset's contribution
     * wholesale. The suffix form is a different attribute name that can only
     * ever mean "at this band".
     */
    if (into.get(property)?.base !== undefined) continue;
    slotFor(into, property).base = value;
  }
};

/** An open-ended range reads as `640+`, not `640-Infinity`. */
const bound = (max: number): string => (max === Infinity ? '+' : String(max));

/**
 * Builds one animation from collected keyframes, or null if nothing valid
 * survives validation.
 */
const buildAnimation = (
  property: PropertyDef,
  collected: Collected,
  rejected: string[]
): ElementMotion | null => {
  /**
   * No base at all is a shape, not a mistake — "only animate on small screens"
   * is an ordinary thing to want, and the inline spelling has always allowed
   * it: `opacity="[0-700]: 0% 0, 100% 1"` builds a band and no base, silently.
   *
   * Writing the same thing as `opacity-small="0% 0, 100% 1"` left this parsing
   * an empty string for the base, which is an empty *value* and refused as one.
   * The two spellings produced identical animations and only one of them was
   * accused of having no keyframes.
   */
  const { base, bands, rejected: bad } = collected.base === undefined && collected.named.length
    ? { base: { keyframes: [], rejected: [], geometryDependent: false }, bands: [], rejected: [] }
    : parseBandedList(collected.base ?? '', property);
  for (const entry of bad) rejected.push(`${property.attribute}: ${entry}`);

  const all: Band[] = [...bands];
  /** A `-name` attribute is one more band, with the range that name registered. */
  for (const { range, raw } of collected.named) {
    const parsed = parseBandedList(raw, property);
    for (const entry of parsed.rejected) rejected.push(`${property.attribute}: ${entry}`);
    if (parsed.base.keyframes.length) {
      all.push({ ...range, keyframes: parsed.base.keyframes, geometryDependent: parsed.base.geometryDependent });
    }
    /** Nested bands inside a named one are intersected, narrowest wins. */
    for (const band of parsed.bands) {
      const min = Math.max(band.min, range.min);
      const max = Math.min(band.max, range.max);
      /**
       * And an intersection that is empty is an attribute that can never
       * apply, at any width. `opacity-mobile="[800-1200]: 0% 0, 100% 1"` with
       * `mobile` registered as 0-640 built a band of `{min: 800, max: 640}`,
       * kept it, and matched no viewport ever — the element animated nothing,
       * anywhere, and `rejected` was empty.
       *
       * Reported and dropped rather than reported and kept: an impossible band
       * downstream is a shape every later reader has to think about, for a
       * case that is always a mistake.
       */
      if (min > max) {
        rejected.push(__DEV__
          ? `${property.attribute}: [${band.min}-${bound(band.max)}] is outside ` +
            `[${range.min}-${bound(range.max)}], the range this attribute names; it can never apply.`
          : `${property.attribute}: band never applies`);
        continue;
      }
      all.push({ ...band, min, max });
    }
  }

  if (!base.keyframes.length && !all.length) return null;

  /** The first keyframe carrying an explicit unit sets it for the whole curve. */
  const unit: Unit =
    base.keyframes.find((k) => k.unit !== '')?.unit ??
    all.flatMap((b) => b.keyframes).find((k) => k.unit !== '')?.unit ??
    property.defaultUnit;

  /**
   * And a later keyframe that carries a *different* one is a contradiction,
   * not an omission.
   *
   * One unit per curve is right — the values are interpolated against each
   * other and a curve running from rem to vh means nothing — and a bare number
   * has to inherit from somewhere. But `"0% 0px, 100% 40rem"` was read as
   * `translateY(40px)` in silence: the author asked for sixteen times what they
   * got, and the channel the README sends them to said nothing.
   *
   * The value still resolves the same way. What changes is that they are told.
   */
  for (const keyframe of [...base.keyframes, ...all.flatMap((b) => b.keyframes)]) {
    if (keyframe.unit !== '' && keyframe.unit !== unit) {
      rejected.push(__DEV__
        ? `${property.attribute}: ${keyframe.unit} and ${unit} in one animation; ` +
          `${unit} is used throughout`
        : `${property.attribute}: ${keyframe.unit} vs ${unit}`);
      break;
    }
  }

  return {
    property,
    unit,
    keyframes: base.keyframes,
    bands: all,
    geometryDependent: base.geometryDependent || all.some((b) => b.geometryDependent),
  };
};

/**
 * Parses a single element.
 *
 * @returns the parsed element, or null when nothing valid was found — the
 * caller skips it and the content stays in its natural, readable state.
 */
export const parseElement = (
  node: Element,
  context: ParseContext
): ParsedElement | null => {
  const rejected: string[] = [];
  const settings = parseSettings(node, rejected);

  /**
   * An element this library cannot measure.
   *
   * Every geometry reading here is `offsetTop` / `offsetHeight` / `offsetParent`,
   * which are `HTMLElement` properties. An **SVG** element has none of them, so
   * a marked `<rect>` was adopted, measured to `start: null`, and written
   * `transform: translateY(NaNpx)` every frame — a declaration the CSSOM drops,
   * so nothing moved, nothing was reported, and the attributes looked right.
   * Marking a shape inside an `<svg>` is an ordinary thing to try; `path-selector`
   * already takes an SVG path, so the namespace is plainly in an author's mind.
   *
   * Refused rather than supported: measuring these means `getBoundingClientRect`
   * on a different code path, and adding a feature is not what a refusal is for.
   * `@verajs/motion/sequence` checks its element the same way, one line of
   * `instanceof`.
   *
   * **A realm caveat, written down rather than worked around.** `instanceof`
   * asks about *this* realm's `HTMLElement`, so an element adopted from an
   * iframe would be refused with advice that does not apply to it. Duck-typing
   * on `offsetTop` instead is worse: happy-dom does not define it on an
   * ordinary element until a test does, so that test refuses everything in the
   * environment the suite runs in. The rare wrong answer is the better one, and
   * this is where it is recorded.
   *
   * **`typeof` first, because `parseElement` runs outside a browser.**
   * `scripts/check-examples.js` parses every documented example under plain
   * Node, where `HTMLElement` is not a global, and a bare `instanceof` threw
   * `ReferenceError` out of the parser — which is the same argument audit rule
   * 9 makes about the entry points importing outside a browser. Where the
   * global is absent nothing is measuring anything, so refusing nothing is the
   * right answer there.
   */
  if (typeof HTMLElement === 'function' && !(node instanceof HTMLElement)) {
    rejected.push(__DEV__
      ? `${ATTRIBUTE_PREFIX} is on a <${node.tagName.toLowerCase()}>, which this library cannot ` +
        'measure — it reads offsetTop and offsetHeight, which only HTML elements have. Animate a ' +
        'wrapper around it instead.'
      : `${ATTRIBUTE_PREFIX}: not an HTML element`);
    context.dropped?.push({ node, rejected });
    return null;
  }

  const collected = new Map<string, Collected>();

  for (const name of node.getAttributeNames()) {
    const parsed = parseAttributeName(name, context.breakpoints);
    if (!parsed) {
      /**
       * Report it rather than ignoring it.
       *
       * A misspelled property, an unknown setting, or a breakpoint alias the
       * instance never registered all used to vanish here without a trace —
       * on the very channel the README tells an agent to check when nothing
       * animates. A typo is the likeliest authoring mistake there is, and it
       * was the one thing this parser said nothing about.
       *
       * Settings are matched separately by `parseSettings`, so they are not
       * strangers; anything else prefixed with our namespace is — except the
       * one this library writes itself.
       *
       * `scroll-to` marks every element one of its links points at, in the
       * shared namespace, and the two entry points do not import each other.
       * So a page using both — the intended combination — had every animated
       * scroll-to target carrying a spurious unknown-attribute refusal. The
       * rule is about an attribute *an author wrote* that nothing understands;
       * a marker this library put there is not one.
       */
      if (
        name.startsWith(SUB_PREFIX) &&
        name !== SCROLL_TARGET_ATTRIBUTE &&
        !isSetting(name.slice(SUB_PREFIX.length))
      ) {
        /**
         * Says *which* kind of wrong it is. The name alone was the whole entry,
         * and beside a refused setting — which now carries a sentence — a
         * reader could not tell "this attribute does not exist" from "this
         * value was rejected". Those want opposite fixes.
         */
        /**
         * **Not "this library has no such attribute"**, which it used to say
         * and which is false in the commonest case there is: an attribute
         * belonging to a module nobody wired. `background` and `split` are
         * real, spelled correctly, and reported as misspellings — sending an
         * author to hunt for a typo in the one thing that is not wrong.
         * Forgetting `wireMotion` is the ordinary mistake with a modular
         * library, and the reference already promises this is where it
         * surfaces. Core cannot name *which* module without a hard-coded list
         * of every module's attributes — which would drift, and which the
         * generated reference deliberately avoids — so it names the two
         * possibilities honestly instead.
         */
        if (__DEV__) {
          /**
           * Inside the branch, not before it: computed outside, production
           * still called a function whose whole body folds away, and the
           * call plus the dead export cost 31 bytes of the bundle for a
           * string production never builds. Measured.
           */
          const meant = probablyMeant(name.slice(SUB_PREFIX.length));
          /**
           * **Kept short deliberately.** `hostile-new-surface` floods an
           * element with 500 unknown attributes and bounds every reason under
           * 120 characters, because `rejected` is memory an attacker can make
           * the page hold — the first wording of this message was ~140 and
           * that test caught it. Short enough to be safe, long enough to name
           * the two things that are actually wrong.
           */
          rejected.push(meant
            ? `${name}: no such attribute — did you mean ${ATTRIBUTE_PREFIX}-${meant}?`
            : `${name}: no such attribute — check the spelling, or wire the module that provides it.`);
        } else {
          rejected.push(`${name}: unknown attribute`);
        }
      }
      continue;
    }
    const slot = slotFor(collected, parsed.property.attribute);
    const raw = (node.getAttribute(name) ?? '').trim();
    if (parsed.range) slot.named.push({ range: parsed.range, raw });
    else slot.base = raw;
  }

  const marker = (node.getAttribute(ATTRIBUTE_PREFIX) ?? '').trim();
  if (marker !== '') {
    if (isPreset(marker)) applyPreset(marker, collected);
    /** A sentence, not a name — the same rule every setting refusal follows above. */
    else if (__DEV__) {
      /** The same slip as an attribute's, so the same suggestion — and, like it, entirely inside this branch. */
      const flat = marker.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const near = Object.keys(PRESETS)
        .find((one) => one.replace(/[^a-z0-9]/gi, '').toLowerCase() === flat);
      rejected.push(near
        ? `${ATTRIBUTE_PREFIX}="${marker}": not a preset this library has — did you mean "${near}"?`
        : `${ATTRIBUTE_PREFIX}="${marker}": not a preset this library has — check the spelling`);
    } else {
      rejected.push(`${ATTRIBUTE_PREFIX}="${marker}": unknown preset`);
    }
  }

  const animations: ElementMotion[] = [];
  for (const [propertyName, slot] of collected) {
    const property = getProperty(propertyName);
    if (!property) continue;
    const animation = buildAnimation(property, slot, rejected);
    if (animation) animations.push(animation);
  }

  if (!animations.length) {
    if (rejected.length) context.dropped?.push({ node, rejected });
    return null;
  }

  /**
   * `stagger` is the only attribute that belongs on the *parent*, and putting
   * it on the element you want staggered is the obvious mistake. It does
   * nothing there and says nothing, so it is reported: an element declaring a
   * stagger with no animated descendants is almost certainly the child.
   */
  if (
    node.hasAttribute(STAGGER_ATTRIBUTE) &&
    /**
     * Unless it is also being split — those descendants do not exist yet. This
     * is the documented pairing (`split` plus `stagger` on one heading), and
     * the check flagged the README's own example until it knew that. The
     * runtime happened to hide it, because a split container is never adopted
     * and its diagnostics never surface; `check:examples` parses the element
     * directly and had no such luck.
     */
    !node.hasAttribute(SPLIT_ATTRIBUTE) &&
    !node.querySelector(`[${ATTRIBUTE_PREFIX}]`)
  ) {
    rejected.push(__DEV__ ? `${STAGGER_ATTRIBUTE} needs animated descendants — it goes on the parent` : `${STAGGER_ATTRIBUTE}: no animated descendants`);
  }

  const stagger = staggerFor(node, rejected);

  /**
   * Stagger works by shifting an element's keyframes along the *scroll*
   * timeline, and `when` replaces the scroll driver entirely — a state-driven
   * element jumps to its end or its start, wherever its keyframes sit. So the
   * offset is computed, carried, and never has anything to act on.
   *
   * Measured: three `when` children under a `stagger` parent, with inertia, all
   * rest at the same value, get identical transitions with no per-element
   * offset, and land together. The reference promises stagger makes "a row
   * arrive one after another instead of in unison", and for this driver it
   * silently does not.
   *
   * Reported on the child rather than the parent, because a parent may hold a
   * mix of scroll-driven and state-driven children and the offset is only
   * pointless for the second kind.
   */
  /**
   * `ease` shapes the curve *between* keyframes, and a `when` element is never
   * between them: it sits at `lowestStart` or `highestEnd` and steps from one
   * to the other. So the easing is evaluated at an endpoint every time, where
   * it cannot change the answer — silently, and on the attribute
   * an earlier audit already called "the most likely thing in the whole
   * attribute set to be misread".
   *
   * The message names the one that does work. `inertia-ease` shapes the
   * *change* between the two states and is handed to CSS, so it applies to a
   * `when` element exactly as it does to a scrolled one — verified, along with
   * `transform-inertia` and `filter-inertia`, which are also unaffected. This
   * is the same refusal `stagger` gets below and for the same reason: `when`
   * replaces the scroll driver, and what depended on the driver goes with it.
   */
  /**
   * A `when` selector this library cannot be told about.
   *
   * `when` is re-evaluated when an **attribute** changes, because that is what
   * the mutation observer can see. `:hover`, `:focus`, `:active`, `:target` and
   * `:checked` are none of them attribute state — hovering writes nothing,
   * focus writes nothing, `:target` follows the fragment, and a checkbox's
   * `checked` *property* moves without its attribute. So the selector parses,
   * matches nothing at the moments anyone looks, and the element sits at one
   * end of its animation for ever.
   *
   * `ATTRIBUTE-REFERENCE.md` has said exactly this — "will not be noticed — use
   * CSS for those" — while the runtime accepted it in silence, which is the
   * same shape as `translate-z` without a perspective: documented as not
   * working, and allowed anyway.
   *
   * The setting is dropped, so the element animates on scroll like any other,
   * which is what a refused setting does everywhere else here. Said out loud in
   * the message, because it is a visible consequence rather than a quiet one.
   */
  /**
   * A `perspective` CSS will not take — and it takes the transform with it.
   *
   * `perspective()` requires a **non-negative length**: a percentage is invalid
   * and so is a negative one. The `length` setting type allows both, because it
   * is shared with `pin`, where `top: -20px` is perfectly ordinary.
   *
   * The consequence is worse than the usual one. This function is composed at
   * the *front* of the element's transform, and an invalid function invalidates
   * the whole declaration — so `perspective="50%"` dropped the element's
   * translate, rotate and scale along with it. The element did not animate at
   * all, and `rejected` was empty. Verified in three engines:
   * `CSS.supports('transform', 'perspective(-100px) translateY(10px)')` is
   * false.
   *
   * `0px` is valid and left alone; it flattens rather than fails.
   */
  const perspective = settings['perspective'];
  if (typeof perspective === 'string' && (perspective.startsWith('-') || perspective.endsWith('%'))) {
    delete settings['perspective'];
    rejected.push(__DEV__
      ? `${ATTRIBUTE_PREFIX}-perspective="${perspective}" is not a length CSS will take — it must ` +
        'not be negative or a percentage. An invalid perspective() drops the whole transform, so ' +
        'nothing on this element would animate.'
      : `${ATTRIBUTE_PREFIX}-perspective="${perspective}": not a usable length`);
  }

  const when = settings['when'];
  if (typeof when === 'string') {
    /**
     * Longest first. An alternation is ordered, so `focus` before
     * `focus-within` matched the shorter one and reported `:focus` for a
     * `:focus-within` selector — right about the refusal and wrong about the
     * word, in a message whose whole job is to name what it found.
     */
    const blind = /:(hover|active|focus-within|focus-visible|focus|target|checked|visited)\b/i.exec(when);
    if (blind) {
      delete settings['when'];
      rejected.push(__DEV__
        ? `${ATTRIBUTE_PREFIX}-when="${when}" uses ${blind[0]}, which this library cannot be told ` +
          'about — it re-reads a selector when an attribute changes, and that state is not an ' +
          'attribute. Use CSS for it. This element animates on scroll instead.'
        : `${ATTRIBUTE_PREFIX}-when: ${blind[0]} is not an attribute`);
    }
  }

  if (typeof settings['ease'] === 'string' && typeof settings['when'] === 'string') {
    rejected.push(__DEV__
      ? `${ATTRIBUTE_PREFIX}-ease does nothing on a ${ATTRIBUTE_PREFIX}-when element — ` +
        'it shapes the curve between keyframes, and `when` holds the element at one end or the ' +
        'other. Use `inertia-ease` to shape the change between them'
      : `${ATTRIBUTE_PREFIX}-ease does nothing with -when`);
  }

  /**
   * And the other half of that pair, which nothing had asked about:
   * `inertia-ease` shapes the **catch-up**, and at `inertia: 0` there is no
   * catch-up to shape. `transitionFor` builds a transition per animated
   * category and skips every one whose speed is 0, so with all of them at 0 it
   * returns `null` and the easing string is read and then dropped.
   *
   * A per-category override is the one thing that can rescue it —
   * `inertia="0"` with `transform-inertia="0.3"` still transitions the
   * transform, because `speedFor` reads the override before the base — so any
   * override above zero means say nothing.
   *
   * The instance's `inertia` is consulted when the element writes none, which
   * is the whole reason `ParseContext` carries it: `createMotion({ inertia: 0 })`
   * with `inertia-ease` in the markup is the same mistake made one level up,
   * and deciding from the element's attributes alone would miss it.
   *
   * Found by asking where else the just-fixed mistake could be living. `ease`
   * beside `when` was fixed one pair at a time; this is the neighbouring pair
   * of the same two attributes, and it was inert and silent for exactly as
   * long.
   */
  const effectiveInertia = settings['inertia'] ?? context.inertia;
  if (typeof settings['inertia-ease'] === 'string' && Number(effectiveInertia) === 0) {
    const rescued = Object.keys(settings).some(
      (name) => name.endsWith('-inertia') && Number(settings[name]) > 0
    );
    if (!rescued) {
      rejected.push(__DEV__
        ? `${ATTRIBUTE_PREFIX}-inertia-ease does nothing at ${ATTRIBUTE_PREFIX}-inertia="0" — ` +
          'it shapes the catch-up, and 0 means the values track scroll exactly with no transition ' +
          'to shape. Raise `inertia`, or use `ease` to shape the curve between keyframes'
        : `${ATTRIBUTE_PREFIX}-inertia-ease does nothing at inertia 0`);
    }
  }

  if (stagger && typeof settings['when'] === 'string') {
    rejected.push(__DEV__
      ? `${STAGGER_ATTRIBUTE} does nothing on a ${ATTRIBUTE_PREFIX}-when element — ` +
        'it offsets a scroll timeline, and `when` replaces the scroll driver'
      : `${STAGGER_ATTRIBUTE} does nothing with -when`);
  }

  return {
    node,
    animations,
    settings,
    ...(stagger ? { stagger } : {}),
    rejected,
  };
};

/**
 * Resolves an element's share of an ancestor's `stagger`.
 *
 * The element finds its own offset rather than a parent handing them out,
 * which keeps parsing per-element and order-independent — nothing has to walk
 * the tree twice or coordinate between siblings.
 *
 * `parentElement` first, so a container that is itself animated and staggers
 * its children does not stagger itself by its own index.
 *
 * @returns the offset in its authored unit, or null when no ancestor staggers
 */
const staggerFor = (
  node: Element,
  rejected: string[]
): { position: number; positionUnit: PositionUnit } | null => {
  const host = node.parentElement?.closest(`[${STAGGER_ATTRIBUTE}]`);
  if (!host) return null;

  const step = parseOffset(host.getAttribute(STAGGER_ATTRIBUTE) ?? '');
  if (step === null) {
    /** The offset sentence `parseSettings` uses, because that is what the step is. */
    rejected.push(`${STAGGER_ATTRIBUTE}: is not a length or a percentage`);
    return null;
  }

  /**
   * Document order among the descendants **this host** staggers, which is the
   * visual order.
   *
   * Counting everything marked below the host instead counts the members of a
   * *nested* stagger group too — and those already resolve against their own
   * nearest host, so each one was used twice: once inside its own group, and
   * again to push every later sibling of the outer group along.
   *
   * Not an exotic shape, because of `@verajs/motion/split`: the split
   * container keeps its `stagger` and every piece it makes is marked, so a
   * staggered list holding one split paragraph moved whatever followed the
   * paragraph by a step per *word*. Adding a word changed an unrelated
   * element's animation.
   *
   * Indexed once per host per batch, not once per element. This counted up to
   * the node — a `querySelectorAll` over the host and a `closest` per
   * candidate, for every element in the group. Proportional to the element's
   * position sounds modest and sums to the square of the group: 2,000 elements
   * under one `stagger` took **350ms** to parse, against 27ms for the same
   * page without it and 27ms for 500 of them with it.
   */
  const index = indexIn(host, node);
  if (index <= 0) return null;

  const parsed = parsePosition(step);
  return parsed ? { position: parsed.position * index, positionUnit: parsed.positionUnit } : null;
};

/** Parses every animated element under `root`. */
export const parseAll = (context: ParseContext, root: ParentNode = document): ParsedElement[] => {
  forgetStagger();
  return findElements(root)
    .map((node) => parseElement(node, context))
    .filter((element): element is ParsedElement => element !== null);
};
