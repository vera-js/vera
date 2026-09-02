/**
 * `@verajs/motion/vera` — animate inside Vera components, closed shadow roots
 * included.
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { renderer } from '@verajs/renderer';
 * import { autoloader } from '@verajs/autoloader';
 * import { motion } from '@verajs/motion/vera';
 *
 * wire([renderer, autoloader, motion]);
 * ```
 *
 * One name in the list, like every other Vera module — it creates its own
 * instance, starts it, and needs nothing else said. Call it to configure:
 * `motion({ inertia: 0.3 })`, or `motion(options, priority)` to move it in the
 * `'init'` chain. That a module can be **both a function and a descriptor** is
 * Vera's own allowance, which `@verajs/autoloader` uses for the same reason:
 * configuring it and registering it are one call. This library makes it too —
 * `wireMotion(sequence)` against `wireMotion(sequence({ allowedOrigins }))`.
 *
 * **A closed shadow root cannot be discovered from outside.**
 * `element.shadowRoot` is `null` for one, which is what closed means, so no
 * selector, walk, `XPath` or `MutationObserver` will ever reach it — verified
 * in Chromium, WebKit and Firefox. The root has to come from whoever created
 * it. That is not a limitation to engineer around; it is the definition of the
 * feature.
 *
 * Vera keeps it: `element._root` is the root a component renders into, held
 * precisely because `shadowRoot` is null for a closed one, and its own types
 * call it "a cross-boundary contract like `_hooks` [that] must never be
 * mangled". Vera's `'init'` insert is handed every component element as it
 * initialises, at every depth, and `element._cleanups` is drained on
 * `disconnectedCallback`. This module is those three facts, wired together.
 *
 * **It imports nothing from Vera.** The three properties and the descriptor
 * shape are read structurally, so this artifact carries no dependency on the
 * framework's version, its build, or its types. It imports `createMotion` from
 * the runtime and that import stays **external**: `dist/vera.js` references
 * `@verajs/motion` rather than inlining a second copy of it.
 */
import { createMotion } from '@verajs/motion';
import type { MotionInstance, MotionOptions } from './modules/createMotion.js';

/**
 * What this module needs a Vera element to have. Structural, and matching the
 * names Vera documents as cross-boundary contracts.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface VeraElement extends HTMLElement {
  /** The root the component renders into. Absent for a light-DOM component. */
  _root?: ShadowRoot;
  /** Drained on `disconnectedCallback`; where the matching `unobserve` goes. */
  _cleanups?: Set<() => void>;
}

/**
 * The module Vera's `wire()` takes: a descriptor that is also a factory.
 *
 * `on`, `fn`, `priority` and `connect` are the four keys `wire()` reads;
 * `name` only names the module in a collision message. Declared here rather
 * than imported so the artifact stays free of `@verajs/inserts`.
 */
export interface VeraMotion {
  /** Configure it. `motion({ inertia: 0.3 })`, or a different chain position. */
  (options?: MotionOptions, priority?: number): VeraMotion;
  readonly on: 'init';
  readonly name: string;
  readonly priority: number;
  readonly fn: (element: HTMLElement) => void;
  /** Called by `wire()` as this is registered; where the instance is started. */
  readonly connect: () => void;
  /**
   * The instance, once wired — for a page that wants `rejected`, `disable()` or
   * `refresh()`. `null` until `wire()` has run, because nothing exists before
   * then.
   */
  readonly instance: MotionInstance | null;
}

const build = (options?: MotionOptions, priority = 60): VeraMotion => {
  let instance: MotionInstance | null = null;

  /**
   * Built mutably and handed back as the readonly shape. A descriptor is a
   * function carrying four properties, and there is no way to write that as one
   * expression without losing either the call signature or the keys.
   */
  const module = ((next?: MotionOptions, at = priority) =>
    build(next, at)) as unknown as Mutable<VeraMotion>;

  module.on = 'init';
  module.priority = priority;
  /**
   * `defineProperty`, because a function's `name` is a non-writable own
   * property and assigning it throws in a module, which is always strict. Vera
   * reads it only to name the module in a collision message — "two things were
   * wired to 'init' at priority 60" is not actionable without it.
   */
  Object.defineProperty(module, 'name', { value: '@verajs/motion' });

  /**
   * Started here, as `wire()` registers it, and not on the first component.
   *
   * A page's light DOM is animated too, and a page with no components at all
   * would otherwise never start. `wire()` calls this before adding the callback
   * to the chain, so the instance exists by the time any component reaches
   * `fn`.
   *
   * Wiring the same module twice starts one instance, not two — Vera's own
   * registration replaces at a taken priority rather than stacking, and an app
   * whose entry points share a wiring module calls `wire` from each of them.
   */
  module.connect = (): void => {
    if (!instance) {
      instance = createMotion(options);
      instance.init();
    }
  };

  module.fn = (element: HTMLElement): void => {
    const { _root: root, _cleanups: cleanups } = element as VeraElement;
    /**
     * A light-DOM component has no root of its own and is already inside a tree
     * the instance scans. Registering `undefined` would be refused and
     * reported, which would be a diagnostic about every such component.
     */
    if (!root || !instance) return;
    instance.observe(root);
    /**
     * The matching release. Without it the root stays registered after the
     * component unmounts — `collect()` drops a root whose host has left, so
     * nothing leaks permanently, but until then it is scanned and its elements
     * are updated every frame.
     */
    const held = instance;
    cleanups?.add(() => held.unobserve(root));
  };

  Object.defineProperty(module, 'instance', { get: () => instance });
  return module as VeraMotion;
};

/**
 * Wire it: `wire([renderer, autoloader, motion])`.
 *
 * Wire it **before** the components that use it. `fn` is called for each
 * component as it initialises, so one that upgraded earlier was never handed
 * over — and its root, if closed, cannot be found afterwards by anything.
 */
export const motion: VeraMotion = build();
