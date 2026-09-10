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
import { parseMotion } from './parse.js';
import { composeTransform, composeFilter, format, sortForApply } from './apply.js';
import { contentHash, PROGRESS_PROPERTY } from './registry.js';

/** What generation hands the caller: the rule to acquire, and the declarations the element carries. */
export interface Generated {
  /** Content hash of `keyframesRule` — the registry key and the `data-vd-a` marker value. */
  readonly hash: string;
  /** The animation name, `vd-<hash>` — derived, carried so no caller re-derives it differently. */
  readonly name: string;
  /** The complete `@keyframes` rule, ready for `acquire`. */
  readonly keyframesRule: string;
  /** The variable the animation seeks by — `--vd-p`, or the author's `progress` rename. One name,
   *  decided here once, so the driver and the declarations cannot disagree. */
  readonly varName: string;
  /** The element's own declarations: the paused animation, seeked by the progress property. */
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
const valueAt = (animation: ElementMotion, position: number): number => {
  const frames = animation.keyframes;
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

/**
 * The simple case, or null.
 *
 * Null is the contract, not a failure: it routes the element to the old write path, which stays
 * authoritative for everything outside this scope until later stages widen it.
 */
export const generateSimple = (parsed: ParsedElement): Generated | null => {
  if (parsed.stagger) return null;
  if (!parsed.animations.length) return null;

  /**
   * `progress: '--x'` renames the variable — one write serves the animation AND the author's CSS.
   * The bare-identifier form is the STATE destination, which does not exist yet; those elements
   * stay on the old path, whose `progressProperty` machinery they never used anyway.
   */
  /** Per-category smoothing needs one variable per category — stage 5. Until then, old path. */
  if (parsed.settings['transform-inertia'] !== undefined ||
      parsed.settings['filter-inertia'] !== undefined) return null;

  const progress = parsed.settings['progress'];
  if (typeof progress === 'string' && !progress.startsWith('--')) return null;
  const varName = typeof progress === 'string' ? progress : PROGRESS_PROPERTY;

  const ease = parsed.settings['ease'];
  const eased = typeof ease === 'string' && ease !== 'linear' ? ease : null;

  for (const animation of parsed.animations) {
    if (animation.bands.length || animation.ease !== undefined) return null;
    if (animation.property.setup || animation.property.apply || animation.property.discrete) return null;
    if (animation.keyframes.some((frame) => frame.positionUnit !== '%')) return null;
  }

  /**
   * The union of every property's stops. With linear easing a split segment keeps its shape, so
   * misaligned stops union freely; a SEGMENT easing reshapes each interval, so splitting one would
   * change what the author wrote — aligned stops only, then.
   */
  const stops = [...new Set(parsed.animations.flatMap((a) => a.keyframes.map((f) => f.position)))]
    .sort((a, b) => a - b);
  if (eased) {
    for (const animation of parsed.animations) {
      if (animation.keyframes.length !== stops.length) return null;
    }
  }

  const transform = sortForApply(parsed.animations.filter((a) => a.property.category === 'transform'));
  const filter = sortForApply(parsed.animations.filter((a) => a.property.category === 'filter'));
  const plain = parsed.animations.filter((a) => a.property.cssProperty);

  const blocks = stops.map((stop) => {
    const declarations: string[] = [];
    if (transform.length) {
      declarations.push(`transform: ${composeTransform(
        { animations: transform, values: transform.map((a) => valueAt(a, stop)) })}`);
    }
    if (filter.length) {
      declarations.push(`filter: ${composeFilter(
        { animations: filter, values: filter.map((a) => valueAt(a, stop)) })}`);
    }
    for (const animation of plain) {
      declarations.push(
        `${animation.property.cssProperty}: ${format(valueAt(animation, stop))}${animation.unit}`);
    }
    return `${format(stop)}% { ${declarations.join('; ')} }`;
  });

  /**
   * The name hashes the BODY, not the finished rule — the name contains the hash, so hashing text
   * that contains the name would chase its own tail. Determinism note for SSR: `format` is shared
   * with the runtime and pure, so the server derives the same text and therefore the same name.
   */
  const body = blocks.join(' ');
  const hash = contentHash(body);
  const name = `vd-${hash}`;

  return {
    hash,
    name,
    keyframesRule: `@keyframes ${name} { ${body} }`,
    /**
     * Seeked, never played: 1s is the seek SPACE (progress 0-1 maps to 0-1s), `paused` pins it, and
     * `both` paints the ends outside 0-1. The timing function is the authored ease, verbatim — the
     * per-segment model on both sides. The timeline source is this one substitutable block, per the
     * spec's ceding constraint: swap the delay-seek for `animation-timeline: view()` and nothing
     * else here changes.
     */
    varName,
    elementRule:
      `[data-vd-a="${hash}"][data-vd-a] { animation: ${name} 1s ${eased ?? 'linear'} both paused; ` +
      `animation-delay: calc(var(${varName}, 0) * -1s); }`,
    elementStyle:
      `animation: ${name} 1s ${eased ?? 'linear'} both paused; ` +
      `animation-delay: calc(var(${varName}, 0) * -1s);`,
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
