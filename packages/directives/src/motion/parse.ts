/**
 * Turns one `data-vd-motion` value into an animation object.
 *
 * Ported from what was `@verajs/motion`'s element parser in the phase-4 fold-in. The
 * input changed shape — an element's whole animation is ONE value now, a
 * preset literal (`"fade-up"`) or a braced object — and everything else
 * survives: the validation rules, the diagnostic sentences, the measured
 * traps in the comments. What died is what the directives engine now does:
 * `findElements` (the engine discovers elements), the attribute-name scan
 * (there is one attribute), and the unknown-ATTRIBUTE reporting (unknown
 * KEYS inside the object get the same treatment below).
 *
 * The value is parsed with the directives BASE grammar (`parseValue`),
 * deliberately never the expression tier: motion's grammar is its own, and
 * `data-vd-motion="fade-up"` must mean the same thing whether or not the
 * expressions connector is wired. The directive declares `value: 'literal'`
 * and hands the raw text here — literal means literal, and motion interprets.
 *
 * Validation is not a formatting concern here. In a CMS anyone who can edit
 * a block can set these values, so every one is checked against the schema
 * and a failure drops that animation rather than guessing.
 */
import type { Refusal } from './schema.js';
import { at } from './schema.js';
import {
  getSetting, getProperty, insert,
  parseBandedList, retiredSuffix, parseSelector, parseEasing, parseOrigin,
  parseOffset, parsePosition, properties, settings as allSettings,
} from './schema.js';
import type { PropertyDef, Unit, RawKeyframe, PositionUnit, Band, Range, Easing } from './schema.js';
import { parseValue, isObject, isPath } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';

/** The one attribute. Exported so runtime walks (`stagger`) select by it. */
export const MOTION_ATTR = 'data-vd-motion';

export interface ElementMotion {
  readonly property: PropertyDef;
  readonly unit: Unit;
  /**
   * Positions are still in their authored units. Normalising them needs the
   * element's size and the viewport, which parse has no business knowing —
   * so the curve is built by the runtime and rebuilt on resize when any
   * position depends on geometry.
   */
  readonly keyframes: readonly RawKeyframe[];
  /**
   * Width-ranged overrides that merge onto the base. From an inline
   * `[0-500]: …` or from a `-name` key suffix whose range was registered on
   * the region — both resolve to a range here, so the runtime only ever
   * deals in ranges and never in names.
   */
  readonly bands: readonly Band[];
  /** True when a position uses anything but `%`, so the curve must be rebuilt on resize. */
  readonly geometryDependent: boolean;
  /**
   * This property's own curve shaper, from the nested value form —
   * `opacity: { frames: '…', ease: 'ease-in' }` — overriding the element's
   * `ease` for this property alone. The fold-in's addition: the curve engine
   * always took an ease per curve; the old attribute grammar had nowhere to
   * write one. Resolved by the runtime through the easings module, exactly
   * as the element-level value is; carried here as the validated STRING.
   */
  readonly ease?: string;
}

export interface ParseContext {
  /**
   * Named width ranges, so `opacity-mobile` can mean whatever this site
   * calls mobile. A name is only ever an alias for a range.
   */
  readonly breakpoints?: ReadonlyMap<string, Range>;
  /**
   * Where diagnostics go for an element that is dropped entirely. An element
   * whose *every* animation failed to validate has no `ParsedElement` to
   * carry its `rejected` list, so the reasons used to be discarded — and
   * that is precisely the element someone is debugging when they ask why
   * nothing is animating.
   */
  readonly dropped?: DroppedElement[];
  /**
   * The region's own `inertia`, for the one refusal that cannot be decided
   * from an element's value alone: `inertia-ease` with nothing to ease. An
   * element that writes neither `inertia` nor a category override inherits
   * this, and at 0 there is no transition for the easing to shape.
   */
  readonly inertia?: number;
}

/**
 * One element's diagnostics. `node` is `null` for a problem with the
 * *configuration* rather than with an element — a region option the runtime
 * refused and fell back on. Consumers iterating this must expect the null;
 * there is at most one such entry, and it sorts first.
 */
export interface RejectedElement {
  readonly node: Element | null;
  readonly rejected: readonly Refusal[];
}

/** The same, for an element rather than for the configuration. */
export interface DroppedElement extends RejectedElement {
  readonly node: Element;
}

export interface ParsedElement {
  readonly node: Element;
  readonly animations: readonly ElementMotion[];
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  /**
   * How far this element's keyframes shift, from a `stagger` on an ancestor.
   * Left in its authored unit rather than resolved here, for the same reason
   * keyframe positions are: `40px` of stagger and a `50%` keyframe normalise
   * against different quantities, so they can only be added once both are
   * timeline fractions. The runtime does that.
   */
  readonly stagger?: { readonly position: number; readonly positionUnit: PositionUnit };
  /** Values the schema could not accept, for diagnostics. Empty on a clean parse. */
  readonly rejected: readonly Refusal[];
}

let staggerGeneration = 0;
const staggerIndices = new WeakMap<Element, { gen: number; index: Map<Element, number> }>();

/**
 * Drops the stagger indices learned for the current batch. The answer is a
 * fact about the DOM as it is now, so it is cached for the length of one
 * pass and dropped at the start of the next.
 */
export const forgetStagger = (): void => {
  staggerGeneration++;
};

/**
 * The raw motion text on an element, or null. One helper so the two callers
 * that read the attribute (`staggerFor`'s host checks, the runtime) cannot
 * drift on the name.
 */
const motionText = (el: Element): string | null => el.getAttribute(MOTION_ATTR);

/**
 * Whether an element's motion value carries a `stagger` key — read through
 * the base grammar's per-source cache, so walking ancestors re-parses
 * nothing. A preset literal never staggers; a value that does not parse
 * staggers nothing (its own activation reports why).
 */
const declaresStagger = (el: Element): string | null => {
  const raw = motionText(el);
  if (raw === null || !raw.trimStart().startsWith('{')) return null;
  try {
    const parsed = parseValue(raw);
    if (isObject(parsed)) {
      const step = (parsed as ParsedObject)['stagger'];
      if (typeof step === 'string' || typeof step === 'number') return String(step);
    }
  } catch {
    /* its own activation reports the parse failure */
  }
  return null;
};

/** The nearest ancestor whose motion value staggers, or null. Exported for the
 *  pack's group-churn handling — a member joining or leaving refreshes its host's group. */
const above = (el: Element): Element | null => el.parentElement?.closest(`[${MOTION_ATTR}]`) ?? null;
export const staggerHost = (node: Element): Element | null => {
  for (let host = above(node); host; host = above(host)) {
    if (declaresStagger(host) !== null) return host;
  }
  return null;
};

/**
 * Where `node` sits among the descendants `host` staggers, in document
 * order. The group is walked once and every member's index recorded,
 * because every member is about to ask. The nearest-host check per candidate
 * is what makes a nested group resolve against its own host rather than
 * being counted twice.
 *
 * Indexed once per host per batch, not once per element — counting up to
 * the node per element sums to the square of the group: measured, 2,000
 * elements under one `stagger` took **350ms** to parse, against 27ms for
 * the same page without it.
 */
const indexIn = (host: Element, node: Element): number => {
  const seen = staggerIndices.get(host);
  if (seen && seen.gen === staggerGeneration) return seen.index.get(node) ?? 0;

  const index = new Map<Element, number>();
  let at = 0;
  for (const candidate of host.querySelectorAll(`[${MOTION_ATTR}]`)) {
    if (staggerHost(candidate) === host) index.set(candidate, at++);
  }
  staggerIndices.set(host, { gen: staggerGeneration, index });
  return index.get(node) ?? 0;
};

/** What one property collected from the keys inside `keyframes`. */
interface Collected {
  base?: string;
  /** The nested form's per-property ease, validated. */
  ease?: string;
}

/** The shipped packs' keys, by pack — for the refusal above only. Literal, never imported (the
 *  additive-bundle rule), and pinned against motion-vocabulary.json by the drift test. */
const SHIPPED_PACK_KEYS: Record<string, string> = {
  background: 'paint', color: 'paint', 'border-color': 'paint', shadow: 'paint', 'text-shadow': 'paint',
  path: 'path', 'path-selector': 'path', 'path-rotate': 'path',
  frame: 'sequence', 'frame-url': 'sequence', 'frame-count': 'sequence', 'frame-ext': 'sequence',
  'frame-pad': 'sequence', 'frame-tween': 'sequence',
};

const slotFor = (into: Map<string, Collected>, property: string): Collected => {
  let slot = into.get(property);
  if (!slot) {
    slot = {};
    into.set(property, slot);
  }
  return slot;
};

/**
 * The key an unknown name was probably meant to be, or null. Only the
 * shapes a *spelling* system produces, not a general fuzzy match: strip
 * everything that is not a letter or digit and compare. That catches the
 * whole copy-paste family in one comparison — `translateY`, `translate_y`,
 * `translatey`. A missing or wrong *letter* is deliberately not guessed at:
 * edit distance would need a threshold, and a confident wrong suggestion
 * costs more than none. Reads the live registry, so a module's keys are
 * suggestible the moment it is wired. `__DEV__` only.
 */
const probablyMeant = (name: string): string | null => {
  if (!__DEV__) return null;
  const flatten = (text: string) => text.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const target = flatten(name);
  for (const entry of [...properties(), ...allSettings()]) {
    if (flatten(entry.key) === target) return entry.key;
  }
  return null;
};

/**
 * Why a setting of each type was refused, in one place. `number` and
 * `string` are absent on purpose: their reasons quote the range and the
 * allowed list, so they are built where those are in scope.
 */
/**
 * A setting's type → the CODE for "that is not one of those". The words moved to `diagnostics.ts`
 * with every other pack's, so the `__DEV__`/production pair of fragment tables this used to be —
 * the short one still shipping — is gone.
 */
const WHY: Record<string, string> = {
  boolean: 'motion-setting-boolean',
  easing: 'motion-setting-easing',
  origin: 'motion-setting-origin',
  offset: 'motion-setting-offset',
  selector: 'motion-setting-selector',
  length: 'motion-setting-length',
  alignment: 'motion-setting-alignment',
  range: 'motion-setting-range',
};

/**
 * Reads one setting key's value. Authored types arrive as themselves now —
 * `inertia: 0.1` is a NUMBER out of the object grammar, `run-once: true` a
 * boolean — so the string round-trips of the attribute era are gone, and
 * each branch checks the authored type before its grammar.
 */
const readSetting = (
  key: string,
  def: NonNullable<ReturnType<typeof getSetting>>,
  value: string | number | boolean,
  no: (why: string, args?: readonly string[]) => void,
  out: Record<string, string | number | boolean>
): void => {
  /** A module validates its own settings; the built-in types follow. */
  if (def.parse) {
    /** A throw is the same answer as `null` — see `parseMeasure`. */
    let parsed: string | number | boolean | null = null;
    try { parsed = def.parse(String(value)); } catch { /* refused */ }
    if (parsed === null) no(def.code ?? WHY[def.type] ?? 'motion-setting-module-refused');
    else out[key] = parsed;
    return;
  }

  switch (def.type) {
    case 'boolean':
      /**
       * `true`/`false` as authored booleans are the ordinary spelling now;
       * the strings survive because a GUI writing into a serialized object
       * needs an off that round-trips. Anything else is refused rather than
       * read as false — being wrong about a boolean is quiet in a way being
       * wrong about a number is not.
       */
      if (value === true || value === 'true') out[key] = true;
      else if (value === false || value === 'false') out[key] = false;
      else no(WHY['boolean']!);
      break;
    case 'number': {
      const number = typeof value === 'number' ? value : Number(value);
      /**
       * Range-checked like every property value is. Without the bounds a
       * value could set a transition of 1e8 seconds, or a zero-pad width
       * that allocates a 10 MB string per drawn frame.
       */
      const ok =
        value !== '' && typeof value !== 'boolean' &&
        Number.isFinite(number) &&
        !(def.min !== undefined && number < def.min) &&
        !(def.max !== undefined && number > def.max);
      if (ok) out[key] = number;
      else {
        /** Each bound spoken for only when it exists — `from 0 to undefined`
         *  in a diagnostic is the message equivalent of the bug it reports. */
        const range =
          def.min !== undefined && def.max !== undefined ? ` from ${def.min} to ${def.max}`
          : def.min !== undefined ? ` of at least ${def.min}`
          : def.max !== undefined ? ` of at most ${def.max}`
          : '';
        no('motion-setting-number', [range]);
      }
      break;
    }
    case 'easing': {
      const easing = typeof value === 'string' ? parseEasing(value) : null;
      if (easing === null) no(WHY['easing']!);
      else out[key] = easing;
      break;
    }
    case 'origin': {
      const origin = typeof value === 'string' ? parseOrigin(value) : null;
      if (origin === null) no(WHY['origin']!);
      else out[key] = origin;
      break;
    }
    case 'offset': {
      const offset = parseOffset(String(value));
      if (offset === null) no(WHY['offset']!);
      else out[key] = offset;
      break;
    }
    case 'selector': {
      const selector = typeof value === 'string' ? parseSelector(value) : null;
      /**
       * A comma is the one refusal here with a reason of its own. This
       * setting is handed to `querySelector`, which returns the first match
       * of *any* branch rather than requiring all of them — not what `a, b`
       * is written to mean — so a list is refused for it and allowed for
       * `when`, which is handed to `matches()`. A reason that misdirects is
       * worse than the silence it replaced.
       */
      if (selector === null && typeof value === 'string' && value.includes(',')) {
        no(__DEV__
          ? 'is one selector, not a list — it is handed to querySelector, which would take ' +
            'whichever matched first'
          : 'not one selector');
      }
      else if (selector === null) no(WHY['selector']!);
      else out[key] = selector;
      break;
    }
    case 'length': {
      /** A CSS length: a number with an optional unit from the allowlist. */
      const text = String(value);
      const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vh|vw)?$/.exec(text);
      if (!match) no(WHY['length']!);
      else out[key] = `${match[1]}${match[2] ?? 'px'}`;
      break;
    }
    case 'string':
      if (typeof value !== 'string') no('must be a string');
      else if (def.allowed && !def.allowed.includes(value)) no(`must be one of: ${def.allowed.join(', ')}`);
      else out[key] = value;
      break;
    /**
     * A type this switch does not speak, on a registration with no `parse`
     * of its own — `url` is in the union for module settings that always
     * carry a validator, and a module inventing a type is the same shape.
     * Falling out silently dropped the key: not stored, not refused,
     * invisible on the one channel diagnostics point at.
     */
    default:
      no(__DEV__ ? `could not be read — its type ("${def.type}") needs the owning module's own parse` : 'needs its module');
  }
};

/**
 * The motion value a preset name stands for, from the first wired pack that knows it, or null.
 *
 * The chain returns values, so a link that throws or answers nonsense is contained here rather than
 * costing the page — the same rule the `easing` chain follows, and for the same reason: these are the
 * two insert points whose links are asked a question instead of told something.
 */
const resolvePreset = (name: string, rejected: Refusal[]): Readonly<Record<string, unknown>> | null => {
  for (const resolve of insert('preset')) {
    try {
      const found = resolve(name);
      if (found && typeof found === 'object') return found;
      /** A truthy non-object is a broken pack, and gets a pack's refusal rather than a name's. */
      if (found) rejected.push({ code: 'motion-preset-pack-broken', where: 'preset', args: [name] });
    } catch {
      rejected.push({ code: 'motion-preset-pack-broken', where: 'preset', args: [name] });
    }
  }
  return null;
};

/**
 * Why a name resolved to nothing, which is TWO different mistakes.
 *
 * With no pack wired at all the name is not misspelled and no suggestion would help — the rule
 * already written for unknown KEYS, that "this library has no such thing" is false in the commonest
 * case because the thing belongs to a module nobody wired. `fade-up` is real and correctly spelled;
 * telling its author to check the spelling sends them to hunt in the one place nothing is wrong.
 *
 * The misspelling suggestion the shipped table used to compute is gone with the table: a wired pack
 * exposes a resolver, not an enumeration, so there is nothing to scan. Worth the trade — the packs
 * are now the extension point, and a mechanism that only worked for ours would be the wrong shape.
 */
const noSuchPreset = (name: string, rejected: Refusal[]): void => {
  rejected.push(insert('preset').length
    ? { code: 'motion-preset-unknown', where: 'preset', args: [name] }
    : { code: 'motion-presets-unwired', where: 'preset', args: [name] });
};

/**
 * Expands a preset into keyframes AND settings — it is shaped exactly like the value it stands for,
 * so a pack can encode a whole motion character under one word.
 *
 * **Written unconditionally, because this runs FIRST.** Every other key is read afterwards and
 * overwrites what lands here, which is what makes "explicit always wins" true with no ordering
 * caveat. It used to run at the `preset` key's own position and got away with it: `applyPreset`
 * skipped a property whose base was already set, and explicit assignment overwrote, so keyframes
 * came out right either way. Settings had no such guard, so the moment a preset could carry one,
 * `{ inertia: 0.5, preset: 'x' }` and `{ preset: 'x', inertia: 0.5 }` would have differed.
 */
const applyPreset = (
  preset: Readonly<Record<string, unknown>>,
  into: Map<string, Collected>,
  settings: Record<string, string | number | boolean>,
  rejected: Refusal[]
): void => {
  for (const [key, value] of Object.entries(preset)) {
    if (key === 'keyframes') {
      if (!value || typeof value !== 'object') {
        rejected.push({ code: 'motion-keyframes-not-object', where: 'preset', args: [] });
        continue;
      }
      for (const [property, frames] of Object.entries(value as Record<string, unknown>)) {
        if (getProperty(property)) slotFor(into, property).base = String(frames);
        else rejected.push({ code: 'motion-no-such-key', where: `preset: ${property}`, args: [''] });
      }
      continue;
    }
    const def = getSetting(key);
    if (!def) {
      rejected.push({ code: 'motion-no-such-key', where: `preset: ${key}`, args: [''] });
      continue;
    }
    /** Validated exactly as an authored one is. A pack is code, but it is code the page did not
     *  write, and a preset that sets a nonsense ease should say so rather than reach the runtime. */
    const no = (code: string, args: readonly string[] = []): void => {
      rejected.push({ code, args, where: `preset: ${key}` });
    };
    readSetting(key, def, value as string | number | boolean, no, settings);
  }
};

/**
 * Builds one animation from collected keyframes, or null if nothing valid
 * survives validation.
 */
const buildAnimation = (
  property: PropertyDef,
  collected: Collected,
  rejected: Refusal[],
  breakpoints?: ReadonlyMap<string, Range>
): ElementMotion | null => {
  /**
   * No base at all is a shape, not a mistake — "only animate on small screens" is an ordinary thing
   * to want, and a value that is nothing but bands (`'[mobile]: 0% 0, 100% 1'`) says it. That used
   * to need the retired key-suffix form; `parseBandedList` returns an empty base for it directly.
   */
  const { base, bands, rejected: bad } = parseBandedList(collected.base ?? '', property, breakpoints);
  for (const entry of bad) rejected.push(at(property.key, entry));

  const all: Band[] = [...bands];

  if (!base.keyframes.length && !all.length) return null;

  /** The first keyframe carrying an explicit unit sets it for the whole curve. */
  const unit: Unit =
    base.keyframes.find((k) => k.unit !== '')?.unit ??
    all.flatMap((b) => b.keyframes).find((k) => k.unit !== '')?.unit ??
    property.defaultUnit;

  /**
   * And a later keyframe that carries a *different* one is a contradiction,
   * not an omission. One unit per curve is right — the values are
   * interpolated against each other and a curve running from rem to vh
   * means nothing — but `'0% 0px, 100% 40rem'` was read as `translateY(
   * 40px)` in silence: the author asked for sixteen times what they got.
   * The value still resolves the same way; what changes is that they are
   * told.
   */
  for (const keyframe of [...base.keyframes, ...all.flatMap((b) => b.keyframes)]) {
    if (keyframe.unit !== '' && keyframe.unit !== unit) {
      rejected.push({ code: 'motion-mixed-units', where: property.key, args: [keyframe.unit, unit] });
      break;
    }
  }

  return {
    property,
    unit,
    keyframes: base.keyframes,
    bands: all,
    geometryDependent: base.geometryDependent || all.some((b) => b.geometryDependent),
    ...(collected.ease !== undefined ? { ease: collected.ease } : {}),
  };
};

/**
 * Parses one element's `data-vd-motion` value.
 *
 * @param raw the attribute's raw text — a preset name, or a braced object
 * @returns the parsed element, or null when nothing valid was found — the
 * caller skips it and the content stays in its natural, readable state.
 */
export const parseMotion = (
  node: Element,
  raw: string,
  context: ParseContext
): ParsedElement | null => {
  const rejected: Refusal[] = [];

  /**
   * An element this library cannot measure. Every geometry reading is
   * `offsetTop` / `offsetHeight` / `offsetParent`, which are `HTMLElement`
   * properties. An **SVG** element has none of them, so a marked `<rect>`
   * was adopted, measured to `start: null`, and written `translateY(NaNpx)`
   * every frame — a declaration the CSSOM drops, so nothing moved, nothing
   * was reported, and the value looked right. Refused rather than
   * supported. (`typeof` first, because this can run outside a browser; a
   * realm caveat rides `instanceof`, recorded in the fold-in source.)
   */
  if (typeof HTMLElement === 'function' && !(node instanceof HTMLElement)) {
    rejected.push({ code: 'motion-not-html', args: [node.tagName.toLowerCase()] });
    context.dropped?.push({ node, rejected });
    return null;
  }

  const collected = new Map<string, Collected>();
  const settings: Record<string, string | number | boolean> = {};
  const text = raw.trim();

  if (!text.startsWith('{')) {
    /** The literal form: a preset name. An empty value has nothing to say. */
    if (text === '') {
      rejected.push({ code: 'motion-no-value', args: [] });
    } else {
      const preset = resolvePreset(text, rejected);
      if (preset) applyPreset(preset, collected, settings, rejected);
      else noSuchPreset(text, rejected);
    }
  } else {
    /** The object form, through the base grammar — never the expression tier. */
    let parsed: unknown;
    try {
      parsed = parseValue(text);
    } catch (error) {
      /**
       * The likeliest cause by far is an unquoted text value — `pin: 120px`,
       * `ease: ease-in` — and the grammar's own error ("expected , or }")
       * teaches nothing about that. The hint rides every syntax failure
       * because the false-positive cost is one clause in a message already
       * being read by someone whose element is not animating.
       */
      rejected.push({ code: 'motion-parse-failed', args: [String((error as Error).message ?? error)] });
      context.dropped?.push({ node, rejected });
      return null;
    }
    if (!isObject(parsed as Parsed)) {
      rejected.push({ code: 'motion-not-object', args: [] });
      context.dropped?.push({ node, rejected });
      return null;
    }

    /**
     * **The two halves, separated by where they are written.** Properties live in `keyframes: { … }`
     * and settings at the top level, and the split is the whole reason it exists: a `%` inside
     * `keyframes` is always progress along the animation, a `%` outside it is always a position on
     * the screen. They used to share one flat object, where `transform-origin`, `perspective` and
     * `will-change` — settings, all three of them real CSS property names — sat beside `translate-x`
     * and `rotate`, which are the ones that animate. Nothing but knowing the tables told them apart.
     *
     * Flattened into one list rather than parsed by a second walk so the interpretation below stays
     * a single loop; `inKeyframes` is what each guard needs and all it needs.
     */
    /**
     * **The preset expands FIRST, wherever its key sits.** Every other key is read below and
     * overwrites what it left, so "explicit always wins" holds with no ordering caveat — see
     * `applyPreset` for why position-order was safe for keyframes and would not have been for
     * settings.
     */
    const named = (parsed as ParsedObject)['preset'];
    if (named !== undefined) {
      if (typeof named !== 'string') {
        rejected.push({ code: 'motion-preset-unknown', where: 'preset', args: [String(named)] });
      } else {
        const preset = resolvePreset(named, rejected);
        if (preset) applyPreset(preset, collected, settings, rejected);
        else noSuchPreset(named, rejected);
      }
    }

    const entries: Array<[string, Parsed, boolean]> = [];
    for (const [key, value] of Object.entries(parsed as ParsedObject)) {
      if (key === 'preset') continue;
      if (key !== 'keyframes') {
        entries.push([key, value as Parsed, false]);
        continue;
      }
      /** `isPath` first: a bare word parses as a Path, which is an object, and would otherwise be
       *  walked as if it held properties. */
      if (typeof value !== 'object' || value === null || isPath(value as Parsed)) {
        rejected.push({ code: 'motion-keyframes-not-object', where: 'keyframes', args: [] });
        continue;
      }
      for (const [inner, frames] of Object.entries(value as ParsedObject)) {
        entries.push([inner, frames as Parsed, true]);
      }
    }

    for (const [key, value, inKeyframes] of entries) {
      const settingDef = getSetting(key);
      if (settingDef && inKeyframes) {
        /** A setting written among the keyframes. Named rather than treated as an unknown property,
         *  because the author knows exactly what they meant and only put it one level too deep. */
        rejected.push({ code: 'motion-setting-in-keyframes', where: key, args: [key] });
        continue;
      }
      if (!settingDef && !inKeyframes && getProperty(key)) {
        /**
         * A property at the top level: the shape this value had before the two halves were
         * separated. Its own code, with the move spelled out, because it is the one refusal every
         * existing value will hit and "no such key" would be actively misleading — the key is real,
         * it is simply written in the half that holds settings.
         */
        rejected.push({ code: 'motion-property-at-top-level', where: key, args: [key] });
        continue;
      }
      if (settingDef) {
        if (typeof value === 'object' && value !== null) {
          rejected.push({ code: 'motion-setting-not-plain', args: [], where: key });
          continue;
        }
        const no = (code: string, args: readonly string[] = []): void => { rejected.push({ code, args, where: key }); };
        readSetting(key, settingDef, value as string | number | boolean, no, settings);
        continue;
      }

      const named = getProperty(key);
      if (!named) {
        /**
         * Report it rather than ignoring it — a typo is the likeliest
         * authoring mistake there is. **Not "this library has no such
         * key"**, which is false in the commonest case: a key belonging to
         * a module nobody wired. `background` and `split` are real, spelled
         * correctly, and naming only "misspelling" sends an author to hunt
         * for a typo in the one thing that is not wrong.
         *
         * Kept short deliberately: `rejected` is memory an attacker can
         * make the page hold, and the hostile-surface bound is 120
         * characters per reason.
         */
        /** The retired `property-breakpoint` key, named before the generic refusal: the author
         *  knows what they meant and the band spelling says it in one line. */
        const retired = retiredSuffix(key, context.breakpoints);
        if (retired) {
          rejected.push({ code: 'motion-band-suffix-retired', where: key,
                          args: [retired.property, retired.band] });
          continue;
        }
        /**
         * A key belonging to a SHIPPED pack nobody wired gets its own code — the unwired-module
         * rule (`motion-presets-unwired` is the same rule for names): `background` is real and
         * correctly spelled, and "no such key" sends its author hunting for a typo in the one
         * thing that is not wrong. The map is a literal on purpose — importing the packs' row
         * tables here would drag every pack into the base bundle, undoing the per-entry sizes —
         * and a test pins it against the generated vocabulary so it cannot drift.
         */
        const pack = SHIPPED_PACK_KEYS[key];
        if (pack) {
          rejected.push({ code: 'motion-pack-unwired', where: key, args: [key, pack] });
          continue;
        }
        /** One code in both builds — see the preset branch above; only the SUGGESTION is dev-only,
         *  because computing it is a scan for a string production cannot print. */
        const meant = __DEV__ ? probablyMeant(key) : undefined;
        rejected.push({ code: 'motion-no-such-key', where: key, args: [meant ?? ''] });
        continue;
      }

      const slot = slotFor(collected, named.key);

      /**
       * A bare word parses as a PATH in the base grammar — `opacity: fade`
       * instead of `opacity: 'fade'` — and motion's values are never state
       * reads. Checked BEFORE the nested form, because a Path is an object
       * too and the nested branch would misread it as one missing frames.
       */
      if (isPath(value as Parsed)) {
        rejected.push({ code: 'motion-quote-the-value', where: key, args: [key] });
        continue;
      }

      /**
       * The nested value form — `{ frames: '…', ease: '…' }` — is the
       * per-property tier. Anything else nested is refused with the shape
       * spelled out, because "object where a string goes" has no other
       * reading here.
       */
      if (typeof value === 'object' && value !== null) {
        const nested = value as ParsedObject;
        const frames = nested['frames'];
        if (typeof frames !== 'string' && typeof frames !== 'number') {
          rejected.push({ code: 'motion-nested-needs-frames', where: key, args: [] });
          continue;
        }
        for (const extra of Object.keys(nested)) {
          if (extra !== 'frames' && extra !== 'ease') rejected.push({ code: 'motion-nested-unknown', args: [], where: `${key}.${extra}` });
        }
        const ease = nested['ease'];
        if (ease !== undefined) {
          const valid = typeof ease === 'string' ? parseEasing(ease) : null;
          if (valid === null) rejected.push({ code: 'motion-setting-easing', args: [], where: `${key}.ease` });
          else slot.ease = valid;
        }
        slot.base = String(frames);
        continue;
      }

      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        rejected.push({ code: 'motion-unusable-value', where: key, args: [] });
        continue;
      }

      /** A number is the end-value sugar: `opacity: 0` is `opacity: '0'`. */
      const rawText = String(value);
      slot.base = rawText;
    }
  }

  const animations: ElementMotion[] = [];
  for (const [propertyName, slot] of collected) {
    const property = getProperty(propertyName);
    if (!property) continue;
    const animation = buildAnimation(property, slot, rejected, context.breakpoints);
    if (animation) animations.push(animation);
  }

  if (!animations.length) {
    /**
     * A stagger-only parent is a real shape now — `data-vd-motion="{
     * stagger: '10%' }"` animates nothing itself and cascades its children —
     * so "no animations" is only a drop when nothing else was said either.
     */
    if (settings['stagger'] === undefined) {
      if (rejected.length) context.dropped?.push({ node, rejected });
      return null;
    }
  }

  /**
   * `stagger` belongs on the *parent*, and putting it on the element you
   * want staggered is the obvious mistake. An element declaring a stagger
   * with no animated descendants is almost certainly the child. (A split
   * container is exempt — those descendants do not exist yet; the split
   * module clears the flag through its own setup.)
   */
  if (
    settings['stagger'] !== undefined &&
    !node.hasAttribute('data-vd-split') &&
    !node.querySelector(`[${MOTION_ATTR}]`)
  ) {
    rejected.push({ code: 'motion-stagger-no-descendants', args: [] });
  }

  const stagger = staggerFor(node, rejected);

  /**
   * A `perspective` CSS will not take — and it takes the transform with it.
   * `perspective()` requires a **non-negative length**; the `length` type
   * allows both signs because it is shared with `pin`. This function is
   * composed at the *front* of the element's transform, and an invalid
   * function invalidates the whole declaration — so `perspective: '50%'`
   * dropped the element's translate, rotate and scale along with it.
   * Verified in three engines. `0px` is valid and left alone; it flattens
   * rather than fails.
   */
  const perspective = settings['perspective'];
  if (typeof perspective === 'string' && (perspective.startsWith('-') || perspective.endsWith('%'))) {
    delete settings['perspective'];
    rejected.push({ code: 'motion-perspective-bad', args: [perspective] });
  }

  /**
   * A `when` selector this library cannot be told about. `when` is
   * re-evaluated when an **attribute** changes, because that is what a
   * mutation observer can see. `:hover`, `:focus`, `:active`, `:target`
   * and `:checked` are none of them attribute state — hovering writes
   * nothing, and a checkbox's `checked` *property* moves without its
   * attribute. The setting is dropped, so the element animates on scroll
   * like any other; said out loud, because it is a visible consequence.
   */
  const when = settings['when'];
  if (typeof when === 'string') {
    /** Longest first — `focus` before `focus-within` matched the shorter
     *  one and reported `:focus` for a `:focus-within` selector. */
    const blind = /:(hover|active|focus-within|focus-visible|focus|target|checked|visited)\b/i.exec(when);
    if (blind) {
      delete settings['when'];
      rejected.push({ code: 'motion-when-blind', args: [when, String(blind[0])] });
    }
  }

  /**
   * `ease` shapes the curve *between* keyframes, and a PLAY is never between them: it steps the
   * timeline end-to-end and lets the transition carry the values, so intermediate keyframes are
   * never visited. `inertia-ease` is the one that works — it shapes that change, and applies to a
   * play exactly as to a scrub.
   *
   * This used to be refused for `when` rather than `play`, on the same reasoning, and the reasoning
   * moved with the behaviour: `when` now GATES a scrub instead of replacing it, so a gated element
   * is between keyframes like any other and `ease` is meaningful again.
   */
  if (typeof settings['ease'] === 'string' && settings['play'] !== undefined) {
    rejected.push({ code: 'motion-ease-with-play', args: [] });
  }

  /**
   * `play` and `inertia` name the SAME number — the transition that carries the values — so writing
   * both is a contradiction rather than a combination. Refused instead of ranked: silently
   * preferring one leaves an author tuning a value nothing reads.
   */
  if (settings['play'] !== undefined && settings['inertia'] !== undefined) {
    rejected.push({ code: 'motion-play-with-inertia', args: [] });
  }

  /**
   * And the neighbouring pair: `inertia-ease` shapes the **catch-up**, and
   * at an effective `inertia` of 0 there is no catch-up to shape. A
   * per-category override above zero rescues it. The region's `inertia` is
   * consulted when the element writes none — deciding from the element's
   * value alone would miss the same mistake made one level up.
   */
  const effectiveInertia = settings['inertia'] ?? context.inertia;
  if (typeof settings['inertia-ease'] === 'string' && Number(effectiveInertia) === 0) {
    const rescued = Object.keys(settings).some(
      (name) => name.endsWith('-inertia') && Number(settings[name]) > 0
    );
    if (!rescued) {
      rejected.push({ code: 'motion-inertia-ease-at-zero', args: [] });
    }
  }

  /**
   * Stagger shifts keyframes along the SCROLL timeline, which a play does not have — it crosses a
   * threshold and runs over time, so a position offset moves nothing. The equivalent for a play is a
   * time delay per sibling, which is a different mechanism and is not built yet; refused meanwhile,
   * because a stagger that parses and shifts nothing is exactly the quiet failure this package
   * refuses elsewhere.
   *
   * Reported on the CHILD rather than the parent, because a parent may hold a mix.
   */
  if (stagger && settings['play'] !== undefined) {
    rejected.push({ code: 'motion-stagger-with-play', args: [] });
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
 * Resolves an element's share of an ancestor's `stagger`. The element finds
 * its own offset rather than a parent handing them out, which keeps parsing
 * per-element and order-independent.
 *
 * `parentElement` first, so a container that is itself animated and
 * staggers its children does not stagger itself by its own index.
 */
const staggerFor = (
  node: Element,
  rejected: Refusal[]
): { position: number; positionUnit: PositionUnit } | null => {
  const host = staggerHost(node);
  if (!host) return null;

  const step = parseOffset(declaresStagger(host) ?? '');
  if (step === null) {
    /** The offset sentence `readSetting` uses, because that is what the step is. */
    rejected.push({ code: 'motion-setting-offset', where: 'stagger', args: [] });
    return null;
  }

  const index = indexIn(host, node);
  if (index <= 0) return null;

  const parsed = parsePosition(step);
  return parsed ? { position: parsed.position * index, positionUnit: parsed.positionUnit } : null;
};

/**
 * Serializes a parsed motion object back to attribute text, dropping the
 * named keys — split's pieces inherit the container's animation minus the
 * container-only keys (`stagger` stays on the host; `pin` cannot mean
 * anything on a piece). Values are the base grammar's own: strings quoted
 * with the quote the text does not contain, numbers and booleans bare, the
 * nested `{ frames, ease }` form recursed. Round-trips through `parseValue`
 * by construction — the piece's activation re-parses what this writes.
 */
export const serializeMotion = (
  object: Readonly<Record<string, unknown>>,
  omit: ReadonlySet<string>
): string => {
  const value = (v: unknown): string => {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v as Record<string, unknown>).map(([k, inner]) => `${k}: ${value(inner)}`);
      return `{ ${entries.join(', ')} }`;
    }
    const text = String(v);
    return text.includes("'") ? `"${text}"` : `'${text}'`;
  };
  const parts: string[] = [];
  for (const [key, v] of Object.entries(object)) {
    if (omit.has(key)) continue;
    parts.push(`${key}: ${value(v)}`);
  }
  return `{ ${parts.join(', ')} }`;
};

/** Re-exported for the runtime's use alongside the parse it feeds. */
export type { Easing };
