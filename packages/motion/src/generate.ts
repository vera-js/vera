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
import { parseMotion } from './parse.js';

import { composeTransform, composeFilter, format, sortForApply } from './apply.js';

import { contentHash, PROGRESS_PROPERTY, STAGGER_PROPERTY, SCROLL_PROPERTY, RANGE_START_PROPERTY, RANGE_SIZE_PROPERTY } from './registry.js';

import { normalisePosition } from './dom.js';
import type { Band, ElementMotion, Generated, GeneratedGroup, GeometryContext, ParsedElement, RawKeyframe } from './types.js';


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


export const generateSimple = (parsed: ParsedElement, geometry?: GeometryContext): Generated | null => {
  /** A TICK-ONLY element is a real shape — `{ scroll: '…', function: 'drawFrame' }` — and generates
   *  no CSS at all: zero groups, zero rules. It rides this path for the drive machinery (chase,
   *  ramp, the variable write) aimed at its function. Anything else with no animations is the
   *  old path's problem. */
  if (!parsed.animations.length && typeof parsed.settings['function'] !== 'string') return null;

  /**
   * `progress: '--x'` renames the variable — one write serves the animation AND the author's CSS.
   * The bare-identifier form is the STATE destination, which does not exist yet; those elements
   * stay on the old path, whose `progressProperty` machinery they never used anyway.
   */
  /** The bare-identifier progress form is refused at PARSE (motion-setting-progress guards the
   *  name grammar), so no gate is needed here — the setting is always a custom property name. */
  const progress = parsed.settings['progress'];
  const varName = typeof progress === 'string' ? progress : PROGRESS_PROPERTY;

  for (const animation of parsed.animations) {
    /** `setup` is NOT a gate (8b): it runs at activation through the directive layer regardless
     *  of write path. `discrete` still refuses — a third-party module may hold values the
     *  browser must not blend; nothing shipped carries it since paint went native (8c). */
    if (animation.property.discrete) return null;
    /** Geometry positions generate WITH geometry (8d) and wait for the client without it. */
    if (!geometry &&
      (animation.keyframes.some((frame) => frame.positionUnit !== '%') ||
        animation.bands.some((b) => b.keyframes.some((frame) => frame.positionUnit !== '%')))) return null;
  }

  const ease = parsed.settings['ease'];
  const elementEase = typeof ease === 'string' ? ease : 'linear';
  /**
   * Per-category smoothing seeks a category's animations by its OWN variable — `--vm-p-transform`
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
  /**
   * `perspective` is a transform FUNCTION, so on the generated path it must live INSIDE the
   * composed keyframes — an inline prefix loses to the animation outright. (The inline path
   * carried it as a per-frame prefix; that path is gone, and this closes the gap the flip had
   * silently opened.) It has no independent-property spelling, so it refuses the flip.
   */
  const perspective = parsed.settings['perspective'];
  /** GATED on a 3D member: with only 2D functions after it, perspective() is visually inert —
   *  noise bytes and a rendering-context trigger for nothing. (Parity-agreed with omni; both
   *  emissions carry this gate.) */
  const wantsDepth = parsed.animations.some((a) =>
    a.property.key === 'translate-z' || a.property.key === 'rotate-x' || a.property.key === 'rotate-y');
  /**
   * PERSPECTIVE AS A VARIABLE (owner-ratified 2026-09-10, deferral overruled: pre-adoption
   * churn is cheap, post-adoption churn breaks builds): the authored value becomes the
   * FALLBACK, so a container retunes a whole scene with one line of ordinary CSS —
   * `.scene { --vera-perspective: 1400px }` — no new grammar, no JS. AUTHOR-namespaced
   * (--vera-*), deliberately: the override door is authored surface BY DEFINITION, and naming
   * it vm would have made "if a name appears in an author's code, it is not vm" false — the
   * doctrine's negative test stays absolute and machine-checkable (omni's catch, same hour).
   * Machine emission READING an authored variable breaks no rule; that is what var() is for.
   */
  const transformPrefix = perspective !== undefined && wantsDepth
    ? `perspective(var(--vera-perspective, ${perspective})) ` : '';

  /* ── TRANSITION-MODE PLAY (compile-time dispatch, no authoring surface) ──────────────────────
   *
   * A play whose value CSS transitions can express skips keyframes entirely: base declarations
   * plus an active state, one attribute flip, the compositor owning the clock (measured: under
   * main-thread load at scale, transitions held vsync where the ramp dropped to ~26fps — the
   * jank harness in the decision log). The RAMP FALLBACK stays for what transitions cannot
   * carry: progress/tick riders (no live number exists during a transition), pulse shapes
   * (first==last — no net change, nothing fires), width bands and geometry positions (v1),
   * per-category smoothing, and any multi-member target mixing shapes (refuse-don't-distort).
   * Dispatch matrix is parity-agreed with omni's shipped v1.
   */
  const transitionEmission = ((): Generated | null => {
    const play = parsed.settings['play'];
    if (typeof play !== 'number') return null;
    if (typeof parsed.settings['function'] === 'string' || parsed.settings['progress'] !== undefined) return null;
    if (wantsTransformVar || wantsFilterVar) return null;
    if (!parsed.animations.length) return null;
    for (const a of parsed.animations) {
      if (a.bands.length) return null;
      if (a.keyframes.some((f) => f.positionUnit !== '%')) return null;
    }

    /** Targets: the CSS property each member writes — transform and filter composite. */
    const buckets = new Map<string, ElementMotion[]>();
    for (const member of parsed.animations) {
      const target = member.property.category === 'transform' ? 'transform'
        : member.property.category === 'filter' ? 'filter'
        : member.property.cssProperty!;
      const bucket = buckets.get(target);
      if (bucket) bucket.push(member);
      else buckets.set(target, [member]);
    }

    const plainMember = (m: ElementMotion): boolean =>
      m.keyframes.length <= 2 &&
      m.keyframes.every((f) => f.position === 0 || f.position === 100);

    const at = (m: ElementMotion, stop: number): number => valueAtFrames(m.keyframes, stop);
    const composedAt = (target: string, members: ElementMotion[], stop: number): string => {
      if (target === 'transform') {
        const sorted = sortForApply(members);
        return `${transformPrefix}${composeTransform(
          { animations: sorted, values: sorted.map((m) => at(m, stop)) })}`;
      }
      if (target === 'filter') {
        const sorted = sortForApply(members);
        return composeFilter({ animations: sorted, values: sorted.map((m) => at(m, stop)) });
      }
      const m = members[0]!;
      if (m.property.parseText) {
        const frame = stop === 0 ? m.keyframes[0]! : m.keyframes[m.keyframes.length - 1]!;
        return frame.text ?? '';
      }
      return `${format(at(m, stop))}${m.unit}`;
    };

    /** The synthesized easing: a shaped member's value trajectory as linear() control points —
     *  normalised (v−v0)/(vN−v0), overshoot legal, ends pinned at 0% and 100%. LONGHAND
     *  emission only: the shorthand carrying linear() diverges across engines (measured). */
    const linearFor = (m: ElementMotion): string | null => {
      const frames = [...m.keyframes].sort((x, y) => x.position - y.position);
      const v0 = frames[0]!.value;
      const vN = frames[frames.length - 1]!.value;
      if (v0 === vN) return null;
      const points = frames.map((f) =>
        `${format((f.value - v0) / (vN - v0))} ${format(f.position)}%`);
      if (frames[0]!.position > 0) points.unshift(`0 0%`);
      if (frames[frames.length - 1]!.position < 100) points.push(`1 100%`);
      return `linear(${points.join(', ')})`;
    };

    const targets: { property: string; base: string; active: string; timing: string }[] = [];
    for (const [target, members] of buckets) {
      let timing: string | null;
      if (members.length === 1) {
        const m = members[0]!;
        if (m.property.parseText && !plainMember(m)) return null;
        timing = plainMember(m)
          ? (m.ease ?? elementEase)
          : linearFor(m);
        if (timing === null) return null;
      } else {
        /** Multi-member composite: every member strict from→to and ONE agreed timing, or the
         *  ramp keeps it — a shaped member's curve smeared over co-members is the distortion
         *  both engines refuse. */
        if (!members.every(plainMember)) return null;
        const eases = new Set(members.map((m) => m.ease ?? elementEase));
        if (eases.size > 1) return null;
        timing = [...eases][0]!;
      }
      const baseValue = composedAt(target, members, 0);
      const activeValue = composedAt(target, members, 100);
      if (baseValue === activeValue) return null;
      targets.push({ property: target, base: baseValue, active: activeValue, timing });
    }
    if (!targets.length) return null;

    const hint = parsed.settings['will-change'] === true
      ? ` will-change: ${targets.map((t) => t.property).join(', ')};` : '';
    const baseDecls = targets.map((t) => `${t.property}: ${t.base};`).join(' ') + hint;
    const activeDecls = targets.map((t) => `${t.property}: ${t.active};`).join(' ');
    const longhands =
      `transition-property: ${targets.map((t) => t.property).join(', ')}; ` +
      `transition-duration: ${targets.map(() => `${format(play)}s`).join(', ')}; ` +
      /**
       * The per-sibling STAGGER, in play mode: the same offset variable the scroll seek
       * subtracts becomes a positive delay scaled by the play duration — `stagger: '12%'` under
       * `play: 0.6` cascades siblings 72ms apart, entering AND leaving, with one shared rule
       * (the offset is a var, never a rule fork). An unstaggered element reads the fallback 0
       * and the calc collapses. This replaced the `motion-stagger-with-play` refusal, whose
       * "not built yet" text stopped being true here.
       */
      `transition-delay: ${targets.map(() => `calc(var(${STAGGER_PROPERTY}, 0) * ${format(play)}s)`).join(', ')}; ` +
      `transition-timing-function: ${targets.map((t) => t.timing).join(', ')};`;
    /**
     * THE WHEN-FOLD — the gate lives in the cascade. For a transition-mode element whose `when`
     * has no riders (`run-once` keeps the JS gate: a latch is a memory, and CSS has none), the
     * active rule's selector IS the author's condition: `:where(<when>)` contributes ZERO
     * specificity — one corpus row proves a wild `#id.class[attr]` still lands 0-2-0 — so the
     * doubled-marker arithmetic holds for any selector the screen admits (when's own validator:
     * engine-parsed, :has() refused, ≤200 chars — verbatim embedding is brace-safe because a
     * brace fails that parse). Consequences, each deliberate:
     * - the gate BEHAVES with no JavaScript at all — an SSR page toggling classes by any means
     *   (:hover included) animates before wire. The first emission that behaves rather than
     *   merely showing an end state; the SPEC's scripting section claims it, so `noJsRule` is
     *   EMPTY here — pinning an end state would fight the live gate.
     * - reduced-motion keeps both STATES reachable and removes only the MOTION: the per-hash
     *   block becomes `transition: none` alone, instant flips instead of a pinned end.
     * - the runtime keeps its gate WATCH (events, the oscillation breaker) but stops writing
     *   the on-marker: CSS owns the paint, JS keeps the guards. Nothing is lost.
     * The gate joins the hash: identical declarations under different conditions are different
     * identities, or the second element's gate would never reach the shared sheet.
     */
    const when = typeof parsed.settings['when'] === 'string' && parsed.settings['run-once'] !== true
      ? parsed.settings['when'] : null;
    const hash = contentHash(`${baseDecls} ${longhands}||${activeDecls}||${when ?? ''}`);

    return {
      hash,
      mode: 'transition',
      groups: [],
      segments: [],
      vars: [],
      varName: PROGRESS_PROPERTY,
      elementStyle: '',
      nativeRule: '',
      elementRule:
        `[data-vm-motion="${hash}"][data-vm-motion] { ${baseDecls} }`,
      armedRule:
        `[data-vm-motion="${hash}"][data-vm-armed] { ${longhands} }`,
      activeRule: when
        ? `:where(${when})[data-vm-motion="${hash}"][data-vm-motion] { ${activeDecls} }`
        : `[data-vm-motion="${hash}"][data-vm-on] { ${activeDecls} }`,
      noJsRule: when
        ? ''
        : `@media (scripting: none) { [data-vm-motion="${hash}"][data-vm-motion] { ${activeDecls} transition: none; } }`,
      reducedRule: when
        ? `@media (prefers-reduced-motion: reduce) { [data-vm-motion="${hash}"][data-vm-motion] { transition: none; } }`
        : `@media (prefers-reduced-motion: reduce) { [data-vm-motion="${hash}"][data-vm-motion] { ${activeDecls} transition: none; } }`,
    };
  })();
  if (transitionEmission) return transitionEmission;

  const transformMembers = parsed.animations.filter((a) => a.property.category === 'transform');
  const flip = new Set(transformMembers.map((a) => keyOf.get(a)!)).size > 1;
  if (flip) {
    if (transformPrefix) return null;
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
   * MISALIGNED STOPS UNDER ONE NON-LINEAR EASE split per TARGET property (8d). This shape used
   * to fall back to the JS easing solver; the solver is gone, and the split is byte-honest
   * where the solver was approximate: each property becomes its own animation with its own
   * aligned stops and the same ease — `ease` applies per segment, and no property's segments
   * gained a stop, so the curve is exactly what the author wrote. A COMPOSITE target (transform,
   * filter) whose own members still misalign cannot split further and refuses — the one shape
   * that genuinely has no CSS spelling.
   */
  const alignedIn = (members: readonly ElementMotion[]): boolean => {
    const union = new Set(members.flatMap((m) => m.keyframes.map((f) => f.position)));
    return members.every((m) => m.keyframes.length === union.size);
  };
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    if (group.ease === 'linear' || group.members.length < 2 || alignedIn(group.members)) continue;
    const buckets = new Map<string, ElementMotion[]>();
    for (const member of group.members) {
      const target = member.property.category === 'transform' ? 'transform'
        : member.property.category === 'filter' ? 'filter'
        : member.property.cssProperty!;
      const bucket = buckets.get(target);
      if (bucket) bucket.push(member);
      else buckets.set(target, [member]);
    }
    if (buckets.size < 2) return null;
    const subs = [...buckets.values()].map((members) =>
      ({ ease: group.ease, varName: group.varName, members }));
    for (const sub of subs) {
      if (sub.members.length > 1 && !alignedIn(sub.members)) return null;
    }
    groups.splice(i, 1, ...subs);
  }

  /**
   * One composer for one group's base and every width segment: hand it each property's EFFECTIVE
   * keyframes and it returns the body — stops re-unioned per group per segment, because a band may
   * add or remove stops and no other union is this one. Null when the group's non-linear ease
   * meets misaligned stops: a segment easing reshapes each interval, so splitting one would change
   * what the author wrote — aligned stops only, PER GROUP, which is exactly what lets a misaligned
   * pair graduate by each carrying its own ease.
   */
  /**
   * Geometry normalisation (8d): a length position becomes its timeline fraction against the
   * measured scroll window, clamped into the keyframe range — a stop past the timeline's end is
   * unreachable, and clamping to 100 with its authored value is what the old curve's clamped
   * evaluation painted there anyway. Sorted after, because normalisation can reorder mixed
   * authored units.
   */
  const percentised = (frames: readonly RawKeyframe[]): readonly RawKeyframe[] => {
    if (!geometry || !frames.some((f) => f.positionUnit !== '%')) return frames;
    return frames
      .map((f) => f.positionUnit === '%' ? f : {
        ...f,
        position: Math.min(100, Math.max(0,
          normalisePosition(f, geometry.scrollWindow, geometry.win, geometry.root) * 100)),
        positionUnit: '%' as const,
      })
      .slice()
      .sort((a, b) => a.position - b.position);
  };

  const composeGroupBody = (
    group: Grouped,
    framesOf: (a: ElementMotion) => readonly RawKeyframe[]
  ): string | null => {
    const raw = framesOf;
    /**
     * A member with NO keyframes at this width RESTS — the same fill runtime's `mergeForWidth`
     * performs, mirrored here because a BAND-ONLY property (`opacity: '[wide]: …'`, nothing at
     * base) hands the base build an empty list, and the sampler crashed on it
     * (`undefined.position` — found live on the demo page, silent in production). Two resting
     * stops, the property's initial: the band's own segments carry the real frames.
     */
    const resting = (a: ElementMotion): readonly RawKeyframe[] => [
      { value: a.property.initial, unit: a.unit, position: 0, positionUnit: '%' },
      { value: a.property.initial, unit: a.unit, position: 100, positionUnit: '%' },
    ];
    const framesOfN = (a: ElementMotion): readonly RawKeyframe[] => {
      const list = percentised(raw(a));
      return list.length ? list : resting(a);
    };
    framesOf = framesOfN;
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
        declarations.push(`transform: ${transformPrefix}${composeTransform(
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
        if (animation.property.parseText) {
          /**
           * TEXT values declare at their AUTHORED stops only — a keyframe that omits a property
           * interpolates across the gap natively, so union-resampling (a numbers-only need)
           * never has to invent a string it cannot compute. The browser blends in its own
           * colour-space rules.
           */
          const frame = framesOf(animation).find((f) => f.position === stop);
          if (frame?.text !== undefined) {
            declarations.push(`${animation.property.cssProperty}: ${frame.text}`);
          }
          continue;
        }
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
    generatedGroups.push({ hash: groupHash, name: `vm-${groupHash}`,
      rule: `@keyframes vm-${groupHash} { ${body} }`, ease: group.ease, varName: group.varName });
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
        names.push(`vm-${segHash}`);
        if (!rules.some((r) => r.hash === segHash)) {
          rules.push({ hash: segHash, rule: `@keyframes vm-${segHash} { ${segBody} }` });
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
      `@media ${query} { [data-vm-motion="${hash}"][data-vm-motion] { animation-name: ${segmentNames[i]!.join(', ')}; } }`;
  }

  /**
   * Seeked, never played: 1s is the seek SPACE (progress 0-1 maps to 0-1s), `paused` pins it, and
   * `both` paints the ends outside 0-1. Timing functions are the authored strings, verbatim — the
   * per-segment model on both sides. The timeline source is this one substitutable block, per the
   * spec's ceding constraint: swap the delay-seek for `animation-timeline: view()` and nothing
   * else here changes.
   */
  const animationList = generatedGroups.map((g) => `${g.name} 1s ${g.ease} both paused`).join(', ');
  /**
   * STAGGER rides the seek as a subtraction (stage 8a): the old path shifted every keyframe
   * position by the sibling offset; `base(t - offset)` is the same animation, and the offset is
   * a per-element CONSTANT var — so two hundred staggered siblings share every rule, and a
   * non-staggered element pays one `var()` fallback. Written by the runtime at measure time
   * (geometry staggers re-write on resize); `both` fill clamps outside 0-1 exactly as the old
   * clamped curve ends did.
   */
  const delayList = generatedGroups.map((g) =>
    `calc((var(${g.varName}, 0) - var(${STAGGER_PROPERTY}, 0)) * -1s)`).join(', ');
  /**
   * TIER C, unconditional: the base variable's DEFAULT is derived in the cascade from the
   * scroller's one written number and two per-element constants — clamped, because painting
   * clamps at the fill edges anyway. Elements the cascade cannot drive (inertia's chase, ticks,
   * plays, gates, a renamed progress whose consumers expect the unclamped number) write the
   * variable INLINE, which beats this rule by cascade origin — the tiers LAYER instead of
   * dispatching emission shapes, and every fallback keeps SSR's frame 0 at rest.
   */
  const cascade = `${varName}: clamp(0, calc((var(${SCROLL_PROPERTY}, 0) - ` +
    `var(${RANGE_START_PROPERTY}, 0)) / var(${RANGE_SIZE_PROPERTY}, 1)), 1); `;
  /**
   * `will-change` is AUTHOR OPT-IN only, emitted per hash (the vocabulary key existed and
   * routed nowhere — the accepted-and-inert find). Deliberately never a default: a page-wide
   * layer promotion held for page lifetime is the compositor-explosion the spec warns about,
   * and "a running animation promotes anyway" is only half-true on the seek path (a PAUSED
   * animation's promotion differs per engine — a measured follow-up may flip this one line).
   */
  const hints = parsed.settings['will-change'] === true
    ? `will-change: ${[...new Set(parsed.animations.map((a) =>
      a.property.category === 'transform' ? 'transform'
      : a.property.category === 'filter' ? 'filter'
      : a.property.cssProperty!))].join(', ')}; `
    : '';
  const declarations = `${cascade}${hints}animation: ${animationList}; animation-delay: ${delayList};`;

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


/**
 * TIER N FOR CUSTOM RANGES — the static mapping from `scroll`'s parsed alignments to CSS
 * `animation-range`, or null where none exists (the element keeps tier C, which is always
 * correct). Two families map, both against the DEFAULT document scroller:
 *
 * - TRANSIT pairs (`edge == 1 - viewport`, the family every plain `scroll: '100%, 0%'`-style
 *   spelling normalises into): position t along the transit is geometry-free, so
 *   `cover ${'${'}t*100}%`.
 * - VIEWPORT-LINE halves (`0 b` — the one-token form: "leading edge at viewport fraction b"):
 *   the distance from transit start is `(1-b)` viewports exactly, so `cover ${'${'}(1-b)*100}vh`
 *   — static in vh, valid only where the scrollport IS the viewport (regions keep tier C).
 *
 * Mixed families cannot be ORDERED statically (percent vs vh), so they answer null rather than
 * risk a reversed range CSS cannot play; reversed same-family ranges answer null for the same
 * reason. `anchor` measures a DIFFERENT element — view() cannot — so it always answers null.
 */
const nativeRangeFor = (parsed: ParsedElement): string | null => {
  if (parsed.settings['anchor'] !== undefined) return null;
  const raw = parsed.settings['scroll'];
  if (raw === undefined) return 'cover 0% cover 100%';
  if (typeof raw !== 'string') return null;
  const halves = raw.split(',');
  if (halves.length > 2) return null;
  const point = (half: string | undefined, fallback: readonly [number, number]):
    { kind: 'pct' | 'vh'; at: number } | null => {
    if (half === undefined || half === '') return { kind: 'pct', at: fallback[0] };
    const parts = half.trim().split(' ');
    if (parts.length !== 2) return null;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.abs(a - (1 - b)) < 1e-9) return { kind: 'pct', at: a };
    if (a === 0) return { kind: 'vh', at: 1 - b };
    return null;
  };
  const from = point(halves[0], [0, 1]);
  const to = point(halves[1], [1, 0]);
  if (!from || !to) return null;
  /**
   * ORDERING across families: same family compares directly; across them only the absolute
   * endpoints order — `cover 0%` precedes any positive vh point, and any vh point ≤ 1 viewport
   * precedes `cover 100%` (one viewport never exceeds the transit). The canonical spellings
   * live exactly there: `'100%, 0%'` is pct-0 → vh-1, `'70%'` is vh-0.3 → pct-1.
   */
  const ordered = from.kind === to.kind
    ? to.at > from.at
    : (from.kind === 'pct' && from.at === 0 && to.at > 0) ||
      (to.kind === 'pct' && to.at === 1 && from.at <= 1);
  if (!ordered) return null;
  const spell = (p: { kind: 'pct' | 'vh'; at: number }): string =>
    p.kind === 'pct' ? `cover ${format(p.at * 100)}%` : `cover ${format(p.at * 100)}vh`;
  return `${spell(from)} ${spell(to)}`;
};

  let nativeRange: string | null = null;
  const per = (value: string): string => generatedGroups.map(() => value).join(', ');
  return {
    hash,
    mode: 'seek',
    activeRule: '',
    armedRule: '',
    noJsRule: '',
    reducedRule: '',
    nativeRule: (generatedGroups.length && (nativeRange = nativeRangeFor(parsed)) !== null)
      ? `@supports (animation-timeline: view()) { [data-vm-motion="${hash}"][data-vm-native] { ` +
        `animation-delay: ${per('0s')}; animation-duration: ${per('auto')}; ` +
        `animation-play-state: ${per('running')}; ` +
        `animation-timeline: ${per('view(block)')}; ` +
        `animation-range: ${per(nativeRange)}; } }`
      : '',
    groups: generatedGroups,
    segments,
    vars,
    varName,
    /** Empty for a tick-only element — no animation list means no declarations to carry, and the
     *  runtime skips delivery entirely on zero groups. */
    elementStyle: generatedGroups.length ? declarations : '',
    elementRule: generatedGroups.length ? `[data-vm-motion="${hash}"][data-vm-motion] { ${declarations} }` : '',
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

/**
 * The INLINE assembly — every rule the shared-sheet path would acquire, as one stylesheet text,
 * in the same order (order is load-bearing twice: transition's base-then-active tie-break, and
 * the media switches after the element rule). The page-wide neutraliser tails ride along scoped
 * to this hash, because an inline block cannot rely on a shared sheet existing.
 *
 * This is the cache-escape hatch's engine: `motion({ inline: true })` and
 * `renderMotion(doc, { inline: true })` deliver THIS as a `<style data-vm-sheet="inline">` child
 * of the animated element, so a cached fragment carries its own CSS. The costs are documented at
 * the option: duplicate rules across same-hash elements (the shared registry's dedup is the
 * thing being traded away), a `:first-child`/`:nth-child` shift inside the element (the style IS
 * a child), and no `@property` can ride along (registration is document-global in every engine —
 * measured; the client registers via `CSS.registerProperty` at wire, and a no-JS page's seek
 * works untyped because `calc(var(--vm-p, 0) * -1s)` needs no registration).
 */
export const inlineCssFor = (generated: Generated): string => {
  if (generated.mode === 'transition') {
    return [generated.elementRule, generated.armedRule, generated.activeRule,
      generated.noJsRule, generated.reducedRule].filter(Boolean).join('\n');
  }
  const tail = `[data-vm-motion="${generated.hash}"][data-vm-motion] { animation: none; }`;
  return [
    ...generated.groups.map((group) => group.rule),
    ...generated.segments.flatMap((segment) => segment.rules.map((rule) => rule.rule)),
    generated.elementRule,
    ...generated.segments.map((segment) => segment.media),
    ...(generated.nativeRule ? [generated.nativeRule] : []),
    `@media (prefers-reduced-motion: reduce) { ${tail} }`,
    `@media (scripting: none) { ${tail} }`,
  ].filter(Boolean).join('\n');
};
