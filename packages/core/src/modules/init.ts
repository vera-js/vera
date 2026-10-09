import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { InitInsert } from '@verajs/inserts';
import { currentInstance } from '../store/store.js';
import { adoptProps } from './adoptProps.js';
import { runCleanup } from '../hooks/coalesce.js';
import type { ComponentElement } from '../types.js';

/**
 * Opens a component's setup: hooks registered from here attach to `element`, until the `render()`
 * that commits it. Attaches a shadow root when `shadowProps` asks for one; without them the
 * component renders into its light DOM.
 *
 * The returned root is **kept** on `_root`, because `element.shadowRoot` is null for a closed one.
 *
 * @param element The element to init
 * @param shadowProps Any desired shadowProps. Passing in null will create a light DOM instance
 */
/**
 * **Setup ends at the end of the microtask turn `init()` ran in** — ONE shared microtask per turn, armed only when not
 * already armed. A hook created after the first `await` in setup then always finds no component (and throws, naming
 * the fix), whatever connected in between; before, it attached to whichever component was set up last, or was dropped.
 */
let ending = false;

/**
 * Development: markup addressed to a module nobody wired (`data-vd-*` with no directives engine) is said once (main had
 * this; the lean rebuild dropped the reading half — `@verajs/directives` still claims `data-vd-` from both its doors).
 * `Symbol.for` because the two packages share no runtime; the `Symbol.for` sits INSIDE the function so production —
 * where every caller folds away — drops it whole (a top-level one survives: a call with effects terser cannot prove).
 */
let warnedAboutClaims = false;
const claimed = (prefix: string): boolean =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.claims')] as Set<string> | undefined)?.has(prefix) === true;
/**
 * Development, a microtask after `init()`: a setup that registered hooks and was never committed — neither `render()`
 * nor `mount()` — runs none of them, silently (main had this; it read the current instance, which the setup-end
 * microtask now clears, so `commit` marks the generation instead). Then the unclaimed-markup check.
 */
const afterSetup = (element: ComponentElement) => {
  const hooks = element._hooks?.reduce((n, set) => n + set.size, 0) ?? 0;
  if (hooks && (element as { _committed?: number })._committed !== element._gen)
    console.warn(diagnostic('core', `<${element.localName}>`, 'setup-uncommitted', __DEV__ && PROSE['setup-uncommitted'](String(hooks))));
  unclaimedMarkup(element);
};
const unclaimedMarkup = (element: ComponentElement) => {
  if (warnedAboutClaims || claimed('data-vd-')) return;
  const root = element.shadowRoot ?? element._root ?? element;
  for (const node of (root as ParentNode).querySelectorAll('*')) {
    const hit = [...node.attributes].find((a) => a.name.startsWith('data-vd-'));
    if (!hit) continue;
    warnedAboutClaims = true;
    console.warn(diagnostic('core', `<${element.localName}>`, 'unwired-directives', __DEV__ && PROSE['unwired-directives'](hit.name)));
    return;
  }
};
const endSetup = () => {
  ending = false;
  currentInstance.element = null;
};

export const init = (element: ComponentElement, shadowProps?: ShadowRootInit) => {
  const current = currentInstance.element;
  if (__DEV__ && (element as Partial<Node> | null)?.nodeType !== 1)
    throw new TypeError(misuse('init', 'init-not-element', __DEV__ && PROSE['init-not-element'](String(element))));
  currentInstance.element = element;
  mine.add(element);
  /**
   * **Development: a second `init()` in one setup discards the hooks registered since the first**, silently — correct
   * on a reconnect (a fresh generation is what stops effects doubling), a mistake within one setup (main had this).
   */
  if (__DEV__ && current === element && element._hooks?.length) {
    const count = element._hooks.reduce((n, set) => n + set.size, 0);
    console.warn(diagnostic('core', `<${element.localName}>`, 'init-twice', __DEV__ && PROSE['init-twice'](String(count))));
  }
  /** After the synchronous setup, so the first render has committed and there is a subtree to look at. */
  if (__DEV__) queueMicrotask(() => afterSetup(element));
  if (!ending) {
    ending = true;
    queueMicrotask(endSetup);
  }
  /** A new generation: the previous connection's hooks go inert — see `createHook`. */
  element._gen = (element._gen ?? 0) + 1;
  element._hooks = [];
  element._hookPriorities = [];
  /** A fresh connection: cleanups registered from here are owed a later removal again. */
  element._cleanups = new Set();
  element._removed = false;
  /** The document it was set up in: a move into another one is a teardown and a fresh setup (see the wrapper below). */
  (element as Moving)._doc = element.ownerDocument;
  if (shadowProps && !element.shadowRoot && !element._root) element._root = element.attachShadow(shadowProps);
  adoptProps(element);
  /**
   * The `'init'` insert: every element as it comes to life, after its root exists and before its first
   * render — how `@verajs/styles` adopts `static styles`, and the place for instrumentation or
   * per-element registration. Core knows nothing about what is registered; with nothing, it is one
   * `Map.get` per element.
   */
  inserts.get('init')?.forEach((callback) => (callback as InitInsert)(element));
};

/**
 * Removal runs every cleanup an element's effects returned. This must live on the **prototype at
 * definition time**: the custom-elements reaction system snapshots lifecycle callbacks when `define()`
 * runs, so an instance property assigned later is never invoked. Wrapping `customElements.define` is
 * therefore the one seam a framework with no base class has. The author's own `disconnectedCallback`
 * runs first, while subscriptions are still live; an element that never called `init()` pays one
 * undefined-property read. Guarded for environments with no custom elements (a server importing core).
 *
 * **A move is not a removal.** Moving a connected component in ONE operation — `append`/`insertBefore`
 * from one place in the page to another: light-DOM slots placing a slotted component, a keyed reorder,
 * a drag-and-drop library — used to run its whole teardown and then its whole setup again: a component
 * that fetched in its setup fetched twice. Now neither its `disconnectedCallback` nor its
 * `connectedCallback` runs and it keeps its state, as `moveBefore()` defines a move. A real removal
 * (to nowhere, or into a fragment) is torn down synchronously, exactly as before, and so is a move into
 * ANOTHER document (a pop-out window) once it connects there: its listeners and frame clock belong to
 * the old window.
 *
 * `_removed` is set after the teardown, so a cleanup registered from then on — an effect that removed
 * its own element and has not returned yet — runs at once instead of into a set nothing drains again.
 */
type Moving = ComponentElement & { _moved?: boolean; _doc?: Document };
/**
 * **The components THIS copy of core initialized** — what its `customElements.define` wrapper may tear down. A page can
 * hold two copies (a production bundle that inlines core, as `@verajs/directives` does for its standalone fallback): each
 * copy installs a wrapper, and each mangles its internal fields differently, so a copy reading another's element read
 * fields that were never set — removing a component that rendered directives threw `reading 'forEach'` in production
 * (measured 2026-10-09). `_$adopt$` stays the cross-copy brand of "a component" for everything else; teardown is mine.
 */
const mine = new WeakSet<Element>();
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as Moving & { connectedCallback?: () => unknown };
    const own = proto.disconnectedCallback;
    const connected = proto.connectedCallback;
    const teardown = (element: Moving) => {
      own?.call(element);
      element._cleanups!.forEach((cleanup) => runCleanup(cleanup, element));
      element._cleanups!.clear();
      element._removed = true;
    };
    /**
     * **Only a COMPONENT is touched** — an element `init` ran on, known by `_$adopt$` (installed by `init`, sigiled, never
     * mangled — a brand no other library has). The wrapper sees every class defined after core loads, a third party's
     * included: the fields it keeps are mangled to single letters in production, where a minified library keeps fields
     * of its own, and its unmangled ones (`_cleanups`) are ordinary names another base class may own — so neither can be
     * the test. Anything else gets exactly its own callbacks; nothing is read from it, written to it, or called.
     *
     * **Still connected at its disconnect, a component is being MOVED** — `append`/`insertBefore` of a connected node,
     * in one operation: the platform runs the callbacks after the operation, so the node already sits in its new place
     * (measured in Chrome, Firefox and Safari). Nothing is torn down, and the reconnect that follows sets nothing up. A
     * real removal also clears any stale mark, so a move that never reconnected cannot skip a later setup.
     */
    proto.disconnectedCallback = function (this: Moving) {
      if (!mine.has(this)) return own?.call(this);
      this._moved = this.isConnected;
      if (!this._moved) teardown(this);
    };
    /**
     * A move into ANOTHER document (a pop-out window) is not kept: its listeners and frame clock belong to the old one.
     * The document is the one `init` ran in — inserting into another document adopts the node first.
     *
     * On a FIRST connect `_$adopt$` is still undefined here — the author's `connectedCallback`, below, is what runs `init`
     * — and that is correct: a first connect has nothing to keep. Do not move `init` earlier to "fix" it.
     */
    proto.connectedCallback = function (this: Moving) {
      if (mine.has(this) && this._moved) {
        this._moved = false;
        if (this.ownerDocument === this._doc) return;
        teardown(this);
      }
      /** Its result is returned: a server render awaits the promise an `async connectedCallback` gives. */
      return connected?.call(this);
    };
    return nativeDefine(name, Class, options);
  };
}
