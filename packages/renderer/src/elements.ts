/**
 * **`@verajs/renderer/elements` — attach behavior to elements in templates.**
 *
 * ```js
 * const autofocus = { mount: (element) => element.focus() };
 * wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('autofocus') ? autofocus : undefined) }]);
 * ```
 *
 * Every `'element'` claimant is asked about each element of a template ONCE — at the template's first
 * instance, on its fresh, inert fragment, so a tag and its static attributes are real and bindings
 * are not yet applied. What the claimants answered is recorded as two flat lists, element POSITIONS
 * (in walk order) and their behaviors, shared by every instance; each later instance finds its claimed
 * elements with one short walk to those positions. After an instance's first update each behavior's
 * `mount` runs, and what it returns is handed to `unmount` at teardown. Nothing runs for a template
 * nobody claimed anything in, and nothing runs per update.
 *
 * Built on the renderer's `'template'` insert and its instance hook (`InstanceHook`): the renderer
 * knows nothing of claims, and an app that does not wire this pays nothing. The shape — flat lists,
 * no object per claimed element, state kept on the instance — is the one measured on 2026-09-27 as
 * costing nothing on Firefox, where a class per claimed element cost ~2.8% of slotted creation.
 *
 * Imports nothing: the registry arrives through the connector, like every module that reads claims.
 */
import type { ElementBehavior, InstanceHook } from './types.js';

type Claim = (element: Element) => ElementBehavior | undefined;

let registered: Map<string, unknown[]> | null = null;
let claimWalker: TreeWalker | undefined;

/** What `$c` found for one instance: claimed elements and their behaviors, interleaved. */
type Found = (Element | ElementBehavior)[];
/** What `$m` keeps for teardown: element, behavior and what `mount` returned, in threes. */
type Kept = unknown[];

const hookFor = (template: { _$inst$?: InstanceHook }): InstanceHook => {
  /** Walk positions of claimed elements, and each one's behavior — learned once, shared. */
  let positions: number[] | undefined;
  let behaviors: ElementBehavior[] | undefined;
  return {
    $c: (fragment) => {
      /** Created in the first template's first use, not at module scope: a server imports this. */
      const walker = (claimWalker ??= document.createTreeWalker(document, 1 /* ELEMENT */));
      walker.currentNode = fragment;
      let node: Node | null;
      let at = -1;
      if (positions === undefined) {
        positions = [];
        behaviors = [];
        const claims = (registered?.get('element') ?? []) as Claim[];
        while ((node = walker.nextNode()) !== null) {
          at++;
          for (let i = 0; i < claims.length; i++) {
            const behavior = claims[i](node as Element);
            if (behavior !== undefined) {
              positions.push(at);
              behaviors.push(behavior);
            }
          }
        }
        /** Nobody claimed anything here: stop asking, for every later instance. */
        if (positions.length === 0) {
          template._$inst$ = undefined;
          return undefined;
        }
      }
      const found: Found = [];
      walker.currentNode = fragment;
      at = -1;
      node = null;
      for (let k = 0; k < positions.length; k++) {
        while (at < positions[k]) {
          node = walker.nextNode();
          at++;
        }
        found.push(node as Element, behaviors![k]);
      }
      return found;
    },
    $m: (state, root) => {
      const found = state as Found;
      let kept: Kept | undefined;
      const context = { root, adopted: false };
      for (let i = 0; i < found.length; i += 2) {
        const element = found[i] as Element;
        const behavior = found[i + 1] as ElementBehavior;
        const value = behavior.mount?.(element, context);
        if (value !== undefined && behavior.unmount !== undefined) (kept ??= []).push(element, behavior, value);
      }
      return kept;
    },
    $q: (state) => {
      const kept = state as Kept;
      for (let i = 0; i < kept.length; i += 3) (kept[i + 1] as ElementBehavior).unmount!(kept[i + 2], kept[i] as Element);
    },
  };
};

/**
 * Gives a template the instance hook — only when some claimant is wired, so an app with claimants for
 * nothing but `<slot>` still pays one walk per NEW template, and an app with none pays nothing at all.
 */
const markTemplate = (built: object) => {
  if (!registered?.get('element')?.length) return;
  const template = built as { _$inst$?: InstanceHook };
  if (__DEV__ && template._$inst$ !== undefined)
    console.warn(
      "[vera] elements: a 'template' hook set an instance hook before `elements` (priority 10) and is " +
        'replaced. Claim elements through the `element` insert instead of a second instance hook.'
    );
  template._$inst$ = hookFor(template);
};

/** Wire it as `wire([renderer, elements, …claims])`. A bare module: it has no options. */
export const elements = [
  (registry: Map<string, unknown[]>) => {
    registered = registry;
  },
  { name: '@verajs/renderer/elements', on: 'template' as const, fn: markTemplate, priority: 10 },
];

export type { ElementBehavior } from './types.js';
