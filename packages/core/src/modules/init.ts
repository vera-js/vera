import { currentInstance } from '../store/store.js';
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
  element._hooks = new Set();
  if (shadowProps && !element.shadowRoot && !element._root) element._root = element.attachShadow(shadowProps);
};
