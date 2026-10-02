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
 * **A move is not a removal** (same-tick keep-alive). Taking an element out and putting it back in the
 * same task — light-DOM slots placing a slotted component, a keyed reorder, a drag-and-drop library —
 * used to run its whole teardown and then its whole setup again: a component that fetched in its setup
 * fetched twice. A disconnect now parks the element and schedules ONE microtask for everything parked;
 * an element that reconnects before it, in the same document, was moved — neither its
 * `disconnectedCallback` nor its `connectedCallback` runs, and it keeps its state, as `moveBefore()`
 * defines a move. Reconnected in ANOTHER document (a pop-out window), it is torn down and set up
 * again: its listeners and frame clock belong to the old window. Whatever is still disconnected at the
 * microtask is torn down then, in disconnect order — today's order, one microtask later.
 *
 * `_removed` is set after the sweep, so a cleanup registered from then on — an effect that removed its
 * own element and has not returned yet — runs at once instead of into a set nothing drains again; one
 * registered between the disconnect and the microtask runs in the sweep, exactly once.
 */
type Parting = ComponentElement & { _down(): void; _doc?: Document };
const parting = new Set<Parting>();
/** Tears down everything still parted. The server's render end calls it too: there, nothing waits for a microtask. */
export const flushParting = () => {
  for (const element of parting) {
    parting.delete(element);
    element._down();
  }
};
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as Parting & { connectedCallback?: () => void };
    const own = proto.disconnectedCallback;
    const connected = proto.connectedCallback;
    /** The real teardown — the author's own first, while subscriptions are still live — kept with the class it wraps. */
    proto._down = function (this: Parting) {
      own?.call(this);
      this._cleanups?.forEach((cleanup) => runCleanup(cleanup, this));
      this._cleanups?.clear();
      this._removed = true;
    };
    proto.disconnectedCallback = function (this: Parting) {
      if (parting.size === 0) queueMicrotask(flushParting);
      parting.add(this);
    };
    /**
     * Back before the microtask, in the document it last CONNECTED in, it was moved. That document is recorded at
     * connect: inserting into another document adopts the node first, so by its `disconnectedCallback` its
     * `ownerDocument` is already the new one.
     */
    proto.connectedCallback = function (this: Parting) {
      if (parting.delete(this)) {
        if (this.ownerDocument === this._doc) return;
        this._down();
      }
      this._doc = this.ownerDocument;
      connected?.call(this);
    };
    return nativeDefine(name, Class, options);
  };
}
