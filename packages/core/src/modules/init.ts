import { inserts } from '@verajs/inserts';
import type { InitInsert } from '@verajs/inserts';
import { currentInstance } from '../store/store.js';
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
export const init = (element: ComponentElement, shadowProps?: ShadowRootInit) => {
  currentInstance.element = element;
  /** A new generation: the previous connection's hooks go inert — see `createHook`. */
  element._gen = (element._gen ?? 0) + 1;
  element._hooks = [];
  element._hookPriorities = [];
  /** A fresh connection: cleanups registered from here are owed a later removal again. */
  element._cleanups = new Set();
  element._removed = false;
  if (shadowProps && !element.shadowRoot && !element._root) element._root = element.attachShadow(shadowProps);
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
 * `_removed` is set after the sweep, so a cleanup registered from then on — an effect that removed its
 * own element and has not returned yet — runs at once instead of into a set nothing drains again.
 */
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as ComponentElement;
    const own = proto.disconnectedCallback;
    proto.disconnectedCallback = function (this: ComponentElement) {
      own?.call(this);
      this._cleanups?.forEach((cleanup) => runCleanup(cleanup, this));
      this._cleanups?.clear();
      this._removed = true;
    };
    return nativeDefine(name, Class, options);
  };
}
