/**
 * The tick registry — the named door for everything CSS cannot do.
 *
 * The third destination for the element's one number: the default aims it at generated CSS,
 * `progress: '--p'` at a custom property, `function: 'name'` at a registered JavaScript function.
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
import type { MotionFunction, MotionFunctionModule } from './types.js';



const ticks = new Map<string, MotionFunctionModule>();

/**
 * Registers named ticks: `wireFunctions({ drawFrame: (el, p) => … })`, or the `{ tick, setup }`
 * descriptor where a resource needs a lifecycle. Merging, like `presets(table)` — a page
 * registers from more than one module. A name already taken is REFUSED and reported, first
 * registration wins: the insert-chain rule everywhere else in this pack, and silent last-wins is
 * how two modules each believe their tick is running.
 */
export const wireFunctions = (table: Readonly<Record<string, MotionFunction | MotionFunctionModule>>): void => {
  for (const [name, entry] of Object.entries(table)) {
    const module: MotionFunctionModule | null =
      typeof entry === 'function' ? { run: entry }
      : entry && typeof entry.run === 'function' ? entry
      : null;
    if (!module) {
      pageProblem('motion-function-not-function', [name, typeof entry]);
      continue;
    }
    if (ticks.has(name)) {
      pageProblem('motion-function-redefined', [name]);
      continue;
    }
    ticks.set(name, module);
  }
};

/** Activation-time lookup — once per element, never per frame; the caller binds the closure. */
export const functionFor = (name: string): MotionFunctionModule | null => ticks.get(name) ?? null;
