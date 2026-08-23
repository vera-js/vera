import { inserts, InitInsert } from '@verajs/inserts';
import { currentInstance } from '../store/store.js';
import { ComponentElement } from '../types.js';
import { reportHookError } from './createHook.js';

/** Dev-only, and once per page: a missing `@verajs/styles` is silent otherwise. */
let warnedAboutStyles = false;

/**
 * Inits the component, setting up an instanceInit reference in the instanceInit array,
 * sets up the shadowRoot if it doesn't already exist, and sets up the cleanUp function for
 * the element.
 *
 * `static styles` is **not** core's job — the `'init'` insert chain runs last, and
 * `@verajs/styles` registers into it. Core costs one `Map.get` per element when nothing is
 * registered, instead of carrying 307 B of stylesheet handling every app pays for.
 *
 * @param element The element to init
 * @param shadowProps Any desired shadowProps. Passing in null will create a light DOM instance
 */
export const init = (element: ComponentElement, shadowProps?: ShadowRootInit) => {
  if (!element) throw new Error('init: element required');
  const shadowRoot = element.shadowRoot;

  currentInstance.element = new WeakRef(element);

  /**
   * `render()` is what drives the first pass of every hook — it calls `runHooks()` and then clears
   * `currentInstance.element`. A component that registers effects and never renders therefore does
   * nothing at all: the hooks exist, and nobody ever runs them. Silent, and easy to write, because a
   * component whose whole job is a side effect — analytics, syncing, focus management — has no
   * obvious reason to render anything.
   *
   * Detected for free rather than with a flag: if this element is still the current instance once
   * the synchronous `connectedCallback` has finished, `render()` was never reached. A component that
   * mounted after this one moves the pointer, so this can miss a case, but it cannot invent one.
   *
   * `__DEV__`-only; production carries neither the check nor the message.
   */
  if (__DEV__) {
    queueMicrotask(() => {
      if (currentInstance.element?.deref() === element && element._hooks?.length) {
        console.warn(
          `[vera] <${element.localName}> registered ${element._hooks.length} hook(s) but never ` +
            `called render(), so none of them will ever run.\n` +
            `render() drives the first pass. A component with no markup still needs one:\n\n` +
            `  render(() => html\`\`);\n`
        );
      }
    });
  }

  element._hooks = [];
  element._hookPriorities = [];
  element.runHooks = () => {
    element._hooks?.forEach((hooks) => {
      for (const hook of hooks) {
        if (!hook) continue;
        hook?.({}, true);
      }
    });
  };

  if (shadowProps && !shadowRoot) {
    element.attachShadow(shadowProps);
  }

  element._cleanups = new Set();

  const initInserts = inserts.get('init');
  initInserts?.forEach((callback) => (callback as InitInsert)(element));

  if (__DEV__) {
    /**
     * `static styles` with no adopter registered used to Just Work, so silence here would read as
     * a styling bug rather than a missing import. Warns once, and never in production.
     */
    if (
      !warnedAboutStyles &&
      !initInserts?.length &&
      (element.constructor as unknown as { styles?: unknown }).styles !== undefined
    ) {
      warnedAboutStyles = true;
      console.warn(
        `[vera] <${element.localName}> declares \`static styles\`, but nothing is adopting them.\n` +
          `Style adoption moved out of core. Wire it once at your app entry:\n\n` +
          `  import { insert } from '@verajs/core';\n` +
          `  import { adoptStyles } from '@verajs/styles';\n` +
          `  insert('init', adoptStyles, 50);\n`
      );
    }
  }
};

/**
 * Removal runs every cleanup an element's effects returned — the no-base-class replacement for
 * the old `EchoElement.disconnectedCallback` teardown, orphaned when the base class was removed.
 *
 * This must live on the **prototype at definition time**: the custom-elements reaction system
 * snapshots lifecycle callbacks when `define()` runs, so an instance property assigned later is
 * never invoked (verified empirically). Wrapping `customElements.define` is therefore the one
 * seam a no-base-class framework has. The author's own `disconnectedCallback` is chained first,
 * while subscriptions are still live. Non-Vera elements defined on the same page pass through
 * with a single undefined-property check on removal. Guarded for Node so SSR imports stay clean.
 */
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as ComponentElement;
    const own = proto.disconnectedCallback;
    proto.disconnectedCallback = function (this: ComponentElement) {
      own?.call(this);
      this._cleanups?.forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          reportHookError(error, this);
        }
      });
      this._cleanups?.clear();
    };
    return nativeDefine(name, Class, options);
  };
}
