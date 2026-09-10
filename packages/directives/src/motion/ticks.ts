/**
 * The tick registry — the named door for everything CSS cannot do.
 *
 * The third destination for the element's one number: the default aims it at generated CSS,
 * `progress: '--p'` at a custom property, `tick: 'name'` at a registered JavaScript function.
 * **The attribute names a function and never contains one** — the package's existing grammar, and
 * a security boundary rather than a style preference: attribute text is CMS-editable, and a value
 * that could carry a function body would hand it the whole DOM API.
 *
 * **Its own registry, NOT `wireActions`.** Actions deliberately run only while a handler is
 * firing, so a reflection cannot trigger one on every render. A per-frame tick is exactly what
 * that rule forbids — reusing the actions registry would mean widening a security boundary to fit
 * a feature. Same shape, different guarantee, separate map.
 *
 * **It is the escape hatch, not the road.** A tick is a per-frame JavaScript call, which is the
 * cost the generated write path exists to remove — correct where CSS genuinely cannot reach
 * (a canvas, text content, WebGL, audio), wrong as a general alternative to `keyframes`.
 */
import { pageProblem } from './schema.js';

/** What a tick receives: the element and how far through its range it is. Nothing else — no
 *  scroll position (the framework's business), no curve (there is none), no return value. */
export type TickFunction = (node: HTMLElement, progress: number) => void;

/**
 * A tick with a lifecycle — for consumers holding per-element resources (a canvas decoder, an
 * audio node). `setup` runs once at the element's activation with its parsed settings and its
 * refusal channel, and the teardown it returns runs when the element leaves or its value is
 * edited — the engine's rebuild-on-edit is the staleness story, exactly as it was for property
 * modules. A bare function is the common case; the descriptor is the one shape richer.
 */
export interface TickModule {
  readonly tick: TickFunction;
  readonly setup?: (
    node: HTMLElement,
    settings: Readonly<Record<string, string | number | boolean>>,
    reject: (code: string, args?: readonly string[]) => void
  ) => (() => void) | void;
}

const ticks = new Map<string, TickModule>();

/**
 * Registers named ticks: `wireTicks({ drawFrame: (el, p) => … })`, or the `{ tick, setup }`
 * descriptor where a resource needs a lifecycle. Merging, like `presets(table)` — a page
 * registers from more than one module. A name already taken is REFUSED and reported, first
 * registration wins: the insert-chain rule everywhere else in this pack, and silent last-wins is
 * how two modules each believe their tick is running.
 */
export const wireTicks = (table: Readonly<Record<string, TickFunction | TickModule>>): void => {
  for (const [name, entry] of Object.entries(table)) {
    const module: TickModule | null =
      typeof entry === 'function' ? { tick: entry }
      : entry && typeof entry.tick === 'function' ? entry
      : null;
    if (!module) {
      pageProblem('motion-tick-not-function', [name, typeof entry]);
      continue;
    }
    if (ticks.has(name)) {
      pageProblem('motion-tick-redefined', [name]);
      continue;
    }
    ticks.set(name, module);
  }
};

/** Activation-time lookup — once per element, never per frame; the caller binds the closure. */
export const tickFor = (name: string): TickModule | null => ticks.get(name) ?? null;
