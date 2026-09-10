/**
 * Generation — a parsed animation becomes CSS text, once, at activation.
 *
 * The write path's stage 3, scoped to the SIMPLE case on purpose: no bands, no per-property ease,
 * no discrete holds, no geometry-dependent positions, no pack properties with their own machinery.
 * `generateSimple` answers null outside that scope and the caller keeps the old path — the gate
 * that lets both paths coexist while parity is proven, rather than a flag nobody remembers.
 *
 * Reuse over rewrite, and one deliberate exception. The stop values come from the same
 * `composeTransform`/`composeFilter`/`format` the runtime writes with, so the generated text cannot
 * drift from what the old path would have painted — that agreement is asserted engine-side by the
 * parity suite. The exception is a ten-line linear `valueAt` instead of `curve.ts`: the curve
 * machinery is per-frame-optimised (arena views, persistent slopes) and slated for deletion, and
 * threading its arena through a once-per-activation loop would preserve exactly the code this
 * rewrite exists to remove.
 *
 * Easing maps verbatim: our `ease` shapes each SEGMENT (`curve.ts` measures it so), and CSS's
 * `animation-timing-function` applies per keyframe interval — the same model, so the authored
 * string is emitted as-is and the browser's solver replaces ours.
 */
import type { ElementMotion, ParsedElement } from './parse.js';
import type { RawKeyframe, Band } from './schema.js';
import { parseMotion } from './parse.js';
import { composeTransform, composeFilter, format, sortForApply } from './apply.js';
import { contentHash, PROGRESS_PROPERTY } from './registry.js';

/**
 * Band merge for one width — THE band semantics, shared with the runtime (it imports this; the
 * reverse would cycle). Per keyframe: a band entry REPLACES the base entry at its position or is
 * pushed; overlapping bands apply in authored order, later winning per position. Generation and
 * the old path calling one function is what makes the @media output and the resize path agree by
 * construction instead of by parallel maintenance.
 */
export const mergeBandsForWidth = (
  keyframes: readonly RawKeyframe[],
  bands: readonly Band[],
  width: number
): RawKeyframe[] => {
  const merged: RawKeyframe[] = [...keyframes];
  for (const band of bands) {
    if (width < band.min || width > band.max) continue;
    for (const k of band.keyframes) {
      /** Linear scan, not a keyed map: keyframe counts are 2-6, and this is smaller. */
      const at = merged.findIndex((m) => m.position === k.position && m.positionUnit === k.positionUnit);
      if (at < 0) merged.push(k);
      else merged[at] = k;
    }
  }
  return merged;
};

/** One easing group: the animations sharing one timing function and one seek variable, emitted
 *  as one `@keyframes` rule and one entry in the element's `animation` list. */
export interface GeneratedGroup {
  /** Content hash of this group's base body — the registry key its rule is acquired under. */
  readonly hash: string;
  /** The animation name, `vd-<hash>` — derived, carried so no caller re-derives it differently. */
  readonly name: string;
  /** The complete `@keyframes` rule, ready for `acquire`. */
  readonly rule: string;
  /** The effective timing function, verbatim — the authored per-property ease, else the element's. */
  readonly ease: string;
  /** The variable THIS group seeks by — the base variable, or a per-category one. */
  readonly varName: string;
}

/** What generation hands the caller: the rules to acquire, and the declarations the element carries. */
export interface Generated {
  /** The MARKER — content hash over the whole identity (groups × segments), the `data-vd-a` value. */
  readonly hash: string;
  /**
   * Easing groups, author order. One group is the common case; a value whose properties carry
   * their own `ease`, or whose categories smooth at their own `inertia`, splits — `animation-name`
   * takes a list, and each group is one entry with its own timing function and seek variable.
   * The split is bounded by CSS itself: two entries cannot write one property, so a split that
   * would collide (two eases inside `filter`, say) answers null and keeps the old path.
   */
  readonly groups: readonly GeneratedGroup[];
  /**
   * Width-band segments beyond the base: per interval, the keyframes rules to acquire (deduped by
   * content hash — a group a band never touches re-hashes to its base rule) and the `@media` block
   * that switches the element's whole `animation-name` list. Base applies outside every band.
   */
  readonly segments: readonly { readonly min: number; readonly max: number;
    readonly rules: readonly { readonly hash: string; readonly rule: string }[];
    readonly media: string }[];
  /**
   * The distinct seek variables, each named with the setting that times it — what the runtime
   * registers and builds one driver slice per. Per-category variables exist only when their
   * override does; the common case is one entry carrying `inertia`.
   */
  readonly vars: readonly { readonly name: string;
    readonly inertiaKey: 'inertia' | 'transform-inertia' | 'filter-inertia' }[];
  /** The base variable — `--vd-p`, or the author's `progress` rename. The author-visible one. */
  readonly varName: string;
  /** The element's own declarations: the paused animation list, seeked by the progress properties. */
  readonly elementStyle: string;
  /**
   * The same declarations as a SHEET RULE on the doubled-attribute selector — 0-2-0, beating an
   * author's single-class tie for free — which is what lets bands and easing groups switch
   * `animation-name` under `@media`. `elementStyle` stays for consumers that inline (the parity
   * twin); the runtime delivers THIS.
   */
  readonly elementRule: string;
}

/** Linear value of one animation at `position`, clamped at the authored ends — the same math
 *  `evaluate` does on its straight-line path, without the per-frame arena it carries. */
const valueAtFrames = (frames: readonly RawKeyframe[], position: number): number => {
  if (position <= frames[0]!.position) return frames[0]!.value;
  const last = frames[frames.length - 1]!;
  if (position >= last.position) return last.value;
  for (let i = frames.length - 2; i >= 0; i--) {
    const a = frames[i]!;
    if (position < a.position) continue;
    const b = frames[i + 1]!;
    const run = b.position - a.position;
    return run === 0 ? b.value : a.value + ((position - a.position) / run) * (b.value - a.value);
  }
  return frames[0]!.value;
};

/** One group's working state while its rules are composed. */
interface Grouped {
  readonly ease: string;
  readonly varName: string;
  readonly members: ElementMotion[];
}

/**
 * The simple case, or null.
 *
 * Null is the contract, not a failure: it routes the element to the old write path, which stays
 * authoritative for everything outside this scope until later stages widen it.
 */
export const generateSimple = (parsed: ParsedElement): Generated | null => {
  if (parsed.stagger) return null;
  /** A TICK-ONLY element is a real shape — `{ scroll: '…', tick: 'drawFrame' }` — and generates
   *  no CSS at all: zero groups, zero rules. It rides this path for the drive machinery (chase,
   *  ramp, the variable write) aimed at its function. Anything else with no animations is the
   *  old path's problem. */
  if (!parsed.animations.length && typeof parsed.settings['tick'] !== 'string') return null;

  /**
   * `progress: '--x'` renames the variable — one write serves the animation AND the author's CSS.
   * The bare-identifier form is the STATE destination, which does not exist yet; those elements
   * stay on the old path, whose `progressProperty` machinery they never used anyway.
   */
  const progress = parsed.settings['progress'];
  if (typeof progress === 'string' && !progress.startsWith('--')) return null;
  const varName = typeof progress === 'string' ? progress : PROGRESS_PROPERTY;

  for (const animation of parsed.animations) {
    if (animation.property.setup || animation.property.discrete || animation.property.css) return null;
    if (animation.keyframes.some((frame) => frame.positionUnit !== '%')) return null;
  }

  const ease = parsed.settings['ease'];
  const elementEase = typeof ease === 'string' ? ease : 'linear';
  /**
   * Per-category smoothing seeks a category's animations by its OWN variable — `--vd-p-transform`
   * chases at `transform-inertia`'s rate while everything else follows the base — so the variable
   * is part of the group key below. The per-category names are the engine's, never the renamed
   * base: the author's `progress` property keeps carrying the one unsmoothed number.
   */
  const wantsTransformVar = parsed.settings['transform-inertia'] !== undefined;
  const wantsFilterVar = parsed.settings['filter-inertia'] !== undefined;
  const varOf = (category: string): string =>
    category === 'transform' && wantsTransformVar ? `${PROGRESS_PROPERTY}-transform`
    : category === 'filter' && wantsFilterVar ? `${PROGRESS_PROPERTY}-filter`
    : varName;

  /**
   * EASING GROUPS. `animation-name` takes a list, so a value with two timing functions — or two
   * smoothing rates — is two `@keyframes` rules on one element, every entry seeked by its own
   * variable. The partition key is `(seek variable, effective ease)`: two axes that both force a
   * separate list entry, for different reasons.
   */
  const groups: Grouped[] = [];
  const groupByKey = new Map<string, Grouped>();
  const keyOf = new Map<ElementMotion, string>();
  for (const animation of parsed.animations) {
    const effectiveEase = animation.ease ?? elementEase;
    const seekVar = varOf(animation.property.category);
    const key = `${seekVar} ${effectiveEase}`;
    keyOf.set(animation, key);
    let group = groupByKey.get(key);
    if (!group) {
      group = { ease: effectiveEase, varName: seekVar, members: [] };
      groupByKey.set(key, group);
      groups.push(group);
    }
    group.members.push(animation);
  }

  /**
   * The constraint the whole split lives under: two animations in the list CANNOT write one CSS
   * property — the later wins outright, nothing composes. `filter` and each plain property must
   * therefore sit inside one group. `transform` gets one escape hatch below.
   */
  const owner = new Map<string, string>();
  const claim = (cssProperty: string, key: string): boolean => {
    const seen = owner.get(cssProperty);
    if (seen !== undefined && seen !== key) return false;
    owner.set(cssProperty, key);
    return true;
  };
  for (const animation of parsed.animations) {
    if (animation.property.category === 'filter') {
      if (!claim('filter', keyOf.get(animation)!)) return null;
    } else if (animation.property.cssProperty) {
      if (!claim(animation.property.cssProperty, keyOf.get(animation)!)) return null;
    }
  }

  /**
   * THE INDEPENDENT-TRANSFORM FLIP — the escape hatch that makes per-property ease on transforms
   * real. When transform-category members land in more than one group, the single `transform`
   * property cannot carry them; `translate` / `rotate` / `scale` can, because they are three CSS
   * properties applied in a FIXED order (translate → rotate → scale) that the schema's composition
   * order already matches — the flip is value-preserving by construction, verified by the parity
   * suite. Engaged ONLY when a split demands it, so the common case keeps its `transform` string,
   * its hashes and its instruments.
   *
   * "Where possible" (the spec's words) is checked, not assumed: `skew-*` has no independent
   * property; `rotate` holds ONE axis; `scale` beside `scale-x`/`scale-y` would need a per-stop
   * product, which linear interpolation between stops would then get wrong mid-interval. Each of
   * those answers null and keeps the old path.
   */
  const transformMembers = parsed.animations.filter((a) => a.property.category === 'transform');
  const flip = new Set(transformMembers.map((a) => keyOf.get(a)!)).size > 1;
  if (flip) {
    const fn = (a: ElementMotion): string => a.property.cssFunction!;
    if (transformMembers.some((a) => fn(a).startsWith('skew'))) return null;
    if (transformMembers.filter((a) => fn(a).startsWith('rotate')).length > 1) return null;
    const hasScale = transformMembers.some((a) => a.property.key === 'scale');
    const hasScaleAxis = transformMembers.some(
      (a) => a.property.key === 'scale-x' || a.property.key === 'scale-y');
    if (hasScale && hasScaleAxis) return null;
    for (const animation of transformMembers) {
      const target = fn(animation).startsWith('translate') ? 'translate'
        : fn(animation).startsWith('rotate') ? 'rotate' : 'scale';
      if (!claim(target, keyOf.get(animation)!)) return null;
    }
  }

  /**
   * One composer for one group's base and every width segment: hand it each property's EFFECTIVE
   * keyframes and it returns the body — stops re-unioned per group per segment, because a band may
   * add or remove stops and no other union is this one. Null when the group's non-linear ease
   * meets misaligned stops: a segment easing reshapes each interval, so splitting one would change
   * what the author wrote — aligned stops only, PER GROUP, which is exactly what lets a misaligned
   * pair graduate by each carrying its own ease.
   */
  const composeGroupBody = (
    group: Grouped,
    framesOf: (a: ElementMotion) => readonly RawKeyframe[]
  ): string | null => {
    const stops = [...new Set(group.members.flatMap((a) => framesOf(a).map((f) => f.position)))]
      .sort((x, y) => x - y);
    if (group.ease !== 'linear') {
      for (const member of group.members) {
        if (framesOf(member).length !== stops.length) return null;
      }
    }
    const at = (a: ElementMotion, stop: number): number => valueAtFrames(framesOf(a), stop);
    const transform = sortForApply(group.members.filter((a) => a.property.category === 'transform'));
    const filter = sortForApply(group.members.filter((a) => a.property.category === 'filter'));
    const plain = group.members.filter((a) => a.property.cssProperty);
    return stops.map((stop) => {
      const declarations: string[] = [];
      if (transform.length && !flip) {
        declarations.push(`transform: ${composeTransform(
          { animations: transform, values: transform.map((a) => at(a, stop)) })}`);
      } else if (transform.length) {
        const by = new Map(transform.map((a) => [a.property.key, a]));
        const part = (a: ElementMotion | undefined, stopAt: number, fallback: string): string =>
          a ? `${format(at(a, stopAt))}${a.unit}` : fallback;
        const tz = by.get('translate-z');
        if (by.has('translate-x') || by.has('translate-y') || tz) {
          declarations.push(`translate: ${part(by.get('translate-x'), stop, '0')} ${
            part(by.get('translate-y'), stop, '0')}${tz ? ` ${part(tz, stop, '0')}` : ''}`);
        }
        const rotate = transform.find((a) => a.property.cssFunction!.startsWith('rotate'));
        if (rotate) {
          const axis = rotate.property.key === 'rotate-x' ? 'x '
            : rotate.property.key === 'rotate-y' ? 'y ' : '';
          declarations.push(`rotate: ${axis}${format(at(rotate, stop))}${rotate.unit}`);
        }
        if (by.has('scale')) declarations.push(`scale: ${format(at(by.get('scale')!, stop))}`);
        else if (by.has('scale-x') || by.has('scale-y')) {
          declarations.push(`scale: ${part(by.get('scale-x'), stop, '1')} ${
            part(by.get('scale-y'), stop, '1')}`);
        }
      }
      if (filter.length) {
        declarations.push(`filter: ${composeFilter(
          { animations: filter, values: filter.map((a) => at(a, stop)) })}`);
      }
      for (const animation of plain) {
        declarations.push(
          `${animation.property.cssProperty}: ${format(at(animation, stop))}${animation.unit}`);
      }
      return `${format(stop)}% { ${declarations.join('; ')} }`;
    }).join(' ');
  };

  /**
   * Base bodies. The name hashes the BODY, not the finished rule — the name contains the hash, so
   * hashing text that contains the name would chase its own tail. Determinism note for SSR:
   * `format` is shared with the runtime and pure, so the server derives the same text and
   * therefore the same names. Two groups differing only in ease share one body, one hash, ONE
   * rule — the timing function lives on the element's list entry, not in the keyframes.
   */
  const generatedGroups: GeneratedGroup[] = [];
  for (const group of groups) {
    const body = composeGroupBody(group, (a) => a.keyframes);
    if (body === null) return null;
    const groupHash = contentHash(body);
    generatedGroups.push({ hash: groupHash, name: `vd-${groupHash}`,
      rule: `@keyframes vd-${groupHash} { ${body} }`, ease: group.ease, varName: group.varName });
  }

  /**
   * Width segments: every band edge cuts the axis; each interval composes every group with
   * `mergeBandsForWidth` at a representative width — the SAME function the resize path runs, so
   * the @media output and the old path agree by construction. Intervals no band covers are the
   * base and emit nothing. A group a band never touches re-hashes to its base body, so its rule
   * dedupes in the registry and the switch simply names it again.
   */
  const allBands = parsed.animations.flatMap((a) => a.bands);
  const segments: { min: number; max: number;
    rules: { hash: string; rule: string }[]; media: string }[] = [];
  const segmentNames: string[][] = [];
  if (allBands.length) {
    const edges = [...new Set([0, ...allBands.flatMap((b) =>
      [b.min, ...(Number.isFinite(b.max) ? [b.max + 1] : [])])])].sort((x, y) => x - y);
    for (let i = 0; i < edges.length; i++) {
      const min = edges[i]!;
      const max = i + 1 < edges.length ? edges[i + 1]! - 1 : Infinity;
      if (!allBands.some((b) => min >= b.min && min <= b.max)) continue;
      const rules: { hash: string; rule: string }[] = [];
      const names: string[] = [];
      for (const group of groups) {
        const segBody = composeGroupBody(group, (a) => mergeBandsForWidth(a.keyframes, a.bands, min));
        if (segBody === null) return null;
        const segHash = contentHash(segBody);
        names.push(`vd-${segHash}`);
        if (!rules.some((r) => r.hash === segHash)) {
          rules.push({ hash: segHash, rule: `@keyframes vd-${segHash} { ${segBody} }` });
        }
      }
      segments.push({ min, max, rules, media: '' });
      segmentNames.push(names);
    }
  }

  /** The MARKER hash covers every group's identity and the segment map, so two elements differing
   *  only in an ease, a smoothing rate or a band are two identities — while keyframes rules still
   *  dedupe under their own content hashes. */
  const hash = contentHash(
    generatedGroups.map((g) => `${g.hash}:${g.ease}:${g.varName}`).join('|') +
    segments.map((s, i) => `|${s.min}-${s.max}:${segmentNames[i]!.join(',')}`).join(''));

  /** One rule per insertRule call — each media switch is its OWN rule, filled here because its
   *  selector embeds the marker hash computed just above. It switches the WHOLE name list: every
   *  entry's timing function and delay stay positional, so the list length never changes. */
  for (const [i, segment] of segments.entries()) {
    const query = [segment.min > 0 ? `(min-width: ${segment.min}px)` : '',
      Number.isFinite(segment.max) ? `(max-width: ${segment.max}px)` : ''].filter(Boolean).join(' and ');
    segment.media =
      `@media ${query} { [data-vd-a="${hash}"][data-vd-a] { animation-name: ${segmentNames[i]!.join(', ')}; } }`;
  }

  /**
   * Seeked, never played: 1s is the seek SPACE (progress 0-1 maps to 0-1s), `paused` pins it, and
   * `both` paints the ends outside 0-1. Timing functions are the authored strings, verbatim — the
   * per-segment model on both sides. The timeline source is this one substitutable block, per the
   * spec's ceding constraint: swap the delay-seek for `animation-timeline: view()` and nothing
   * else here changes.
   */
  const animationList = generatedGroups.map((g) => `${g.name} 1s ${g.ease} both paused`).join(', ');
  const delayList = generatedGroups.map((g) => `calc(var(${g.varName}, 0) * -1s)`).join(', ');
  const declarations = `animation: ${animationList}; animation-delay: ${delayList};`;

  /**
   * The BASE variable is in the list unconditionally, not derived from the groups: a tick-only
   * element has no groups at all, and an element whose every category carries its own inertia
   * override has no GROUP seeking the base — but the base number is still the author-visible one
   * (the `progress` rename reads it, the tick rides it), so its driver slice must exist.
   */
  const vars = [...new Set([varName, ...generatedGroups.map((g) => g.varName)])].map((name) => ({
    name,
    inertiaKey: (name === `${PROGRESS_PROPERTY}-transform` && wantsTransformVar ? 'transform-inertia'
      : name === `${PROGRESS_PROPERTY}-filter` && wantsFilterVar ? 'filter-inertia'
      : 'inertia') as 'inertia' | 'transform-inertia' | 'filter-inertia',
  }));

  return {
    hash,
    groups: generatedGroups,
    segments,
    vars,
    varName,
    /** Empty for a tick-only element — no animation list means no declarations to carry, and the
     *  runtime skips delivery entirely on zero groups. */
    elementStyle: generatedGroups.length ? declarations : '',
    elementRule: generatedGroups.length ? `[data-vd-a="${hash}"][data-vd-a] { ${declarations} }` : '',
  };
};

/**
 * The parity suite's door: the real parser, then generation — so tests exercise the exact pipeline
 * an activating element will, rather than hand-built fixtures that drift from what parse produces.
 */
export const fromAttribute = (node: Element, raw: string): Generated | null => {
  const parsed = parseMotion(node, raw, {});
  return parsed ? generateSimple(parsed) : null;
};
