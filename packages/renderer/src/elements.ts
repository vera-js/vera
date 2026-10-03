/**
 * **`@verajs/renderer/elements` — attach behavior to elements in templates.**
 *
 * ```js
 * const autofocus = { mount: (element) => element.focus() };
 * wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('autofocus') ? autofocus : undefined) }]);
 * ```
 *
 * Every `'element'` claimant is asked about each element of a template ONCE, as the template is BUILT — on its
 * canonical content, so a tag and its static attributes are real and no binding is ever applied (a hydrated first
 * instance, whose elements are the server's with bound values in them, changes nothing). The answers are two flat
 * lists shared by every instance: element positions in document pre-order, and their behaviors. A template nobody
 * claimed anything in gets no instance hook at all. Each instance finds its claimed elements with one short walk to
 * those positions; once the render that created it has finished, each behavior's `mount` runs, and what it returns is
 * handed to `unmount` at teardown. Nothing runs per update.
 *
 * Built on the renderer's `'template'` insert and instance hook (`InstanceHook`); it imports nothing — the registry
 * arrives through its connector. An app that does not wire it pays nothing.
 */
import type { ElementBehavior, InstanceHook } from './types.js';

type Claim = (element: Element) => ElementBehavior | undefined;

let registered: Map<string, unknown[]> | null = null;

/**
 * **The next element of an instance in document pre-order, never leaving it.** A root is a fragment, or — for a
 * single-root template — its one element, which is then position 0. Bounded by the root rather than by the tree it
 * sits in, because a hydrated instance is already in the page.
 */
const firstIn = (root: Node): Element | null => (root.nodeType === 1 ? (root as Element) : (root as ParentNode).firstElementChild);
const nextIn = (node: Element, root: Node): Element | null => {
  if (node.firstElementChild !== null) return node.firstElementChild;
  for (let at: Element | null = node; at !== null && at !== root; at = at.parentElement)
    if (at.nextElementSibling !== null) return at.nextElementSibling;
  return null;
};

/**
 * One instance's claims until it mounts — its claimed elements and their behaviors, interleaved, where it rendered,
 * whether it was adopted — and then only what `unmount` needs. **The elements are released at mount**: per-instance
 * state that keeps DOM references past the moment it needs them costs every operation on the page (measured: ~7% on
 * select and swap of a table whose every row was claimed, operations that never touch it).
 */
type State = { f: (Element | ElementBehavior)[] | null; r: Node | null; a: boolean; k: unknown[] | undefined; d: boolean };

/** The instance hook for one template, from the positions and behaviors its claimants answered. */
const hookFor = (positions: number[], behaviors: ElementBehavior[]): InstanceHook => ({
  $c: (instance, root, adopted) => {
    const found: (Element | ElementBehavior)[] = [];
    /**
     * ADOPTED, the instance arrives as its elements in template order (hydration pairs them): its live root already
     * holds what its nested parts rendered, so counting there would land on the wrong element.
     */
    const listed = Array.isArray(instance);
    let node = listed ? null : firstIn(instance as Node);
    let at = 0;
    for (let k = 0; k < positions.length; k++) {
      if (listed) node = (instance as readonly Element[])[positions[k]];
      else for (; at < positions[k]; at++) node = nextIn(node!, instance as Node);
      found.push(node!, behaviors[k]);
      /** At creation — before the first update, and before the instance is connected anywhere. */
      behaviors[k].create?.(node!, adopted);
    }
    return { f: found, r: root, a: adopted, k: undefined, d: false } as State;
  },
  $m: (given) => {
    const state = given as State;
    /** Torn down before its render finished: it never mounts. */
    if (state.d) return;
    const found = state.f!;
    const context = { root: state.r, adopted: state.a };
    state.f = null;
    for (let i = 0; i < found.length; i += 2) {
      const behavior = found[i + 1] as ElementBehavior;
      const value = behavior.mount?.(found[i] as Element, context);
      if (value !== undefined && behavior.unmount !== undefined) (state.k ??= []).push(found[i], behavior, value);
    }
  },
  $q: (given) => {
    const state = given as State;
    state.d = true;
    const kept = state.k;
    if (kept !== undefined) for (let i = 0; i < kept.length; i += 3) (kept[i + 1] as ElementBehavior).unmount!(kept[i + 2], kept[i] as Element);
  },
});

/**
 * Asks the claimants about the template's canonical content, once, as it is built — and gives it an instance hook
 * only if something was claimed. The content is READ, never changed (see the `'template'` insert's contract).
 */
const claimTemplate = (built: object, _result: unknown, _readScope: unknown, root: Node) => {
  const claims = registered?.get('element') as Claim[] | undefined;
  if (claims === undefined || claims.length === 0) return;
  const template = built as { _$inst$?: InstanceHook };
  if (__DEV__ && template._$inst$ !== undefined)
    console.warn(
      "[vera] elements: a 'template' hook set an instance hook before `elements` (priority 10) and is " +
        'replaced. Claim elements through the `element` insert instead of a second instance hook.'
    );
  const positions: number[] = [];
  const behaviors: ElementBehavior[] = [];
  let at = 0;
  for (let node = firstIn(root); node !== null; node = nextIn(node, root), at++)
    for (let i = 0; i < claims.length; i++) {
      const behavior = claims[i](node);
      if (behavior !== undefined) {
        positions.push(at);
        behaviors.push(behavior);
      }
    }
  if (positions.length > 0) template._$inst$ = hookFor(positions, behaviors);
};

/** Wire it as `wire([renderer, elements, …claims])`. A bare module: it has no options. */
export const elements = [
  (registry: Map<string, unknown[]>) => {
    registered = registry;
  },
  { name: '@verajs/renderer/elements', on: 'template' as const, fn: claimTemplate, priority: 10 },
];

export type { ElementBehavior } from './types.js';
