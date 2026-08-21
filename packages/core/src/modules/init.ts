import { adoptStyles } from './adoptStyles.js';
import { currentInstance } from '../store/store.js';
import { ComponentElement } from '../types.js';
import { reportHookError } from './createHook.js';

/**
 * Inits the component, setting up an instanceInit reference in the instanceInit array,
 * sets up the shadowRoot if it doesn't already exist, sets up the cleanUp function for
 * the element and adopts styles if a static styles property exists
 *
 * @param element The element to init
 * @param shadowProps Any desired shadowProps. Passing in null will create a light DOM instance
 */
export const init = (element: ComponentElement, shadowProps?: ShadowRootInit) => {
  if (!element) throw new Error('init: element required');
  const shadowRoot = element.shadowRoot;

  currentInstance.element = new WeakRef(element);

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

  adoptStyles(element);
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
