import type { ComponentElement, RenderTemplate } from '../types.js';
import { createHook, RENDER_PRIORITY } from '../modules/createHook.js';
import { inserts } from '@verajs/inserts';
import type { Renderer } from '@verajs/shared-types';

/**
 * Registers `element`'s render hook: it draws the template through every `'render'` insert, and a
 * change to anything it read schedules one more pass for the next animation frame — however many
 * writes land before it.
 *
 * The deferred pass re-enters through the hook itself rather than calling the renderer directly,
 * so it runs inside the hook's tracking context and a property first read on a later pass is
 * subscribed too.
 */
export const useRender = (template: unknown, element: ComponentElement, ...args: unknown[]) => {
  let queued = false;
  const hook = createHook({
    priority: RENDER_PRIORITY,
    callback: (signal, init) => {
      if (init) {
        const result = typeof template === 'function' ? (template as RenderTemplate)(signal) : template;
        const target = element._root ?? element.shadowRoot ?? element;
        inserts.get('render')?.forEach((renderer) => (renderer as Renderer)(result, target, ...args));
        return;
      }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        hook!(signal, true);
      });
    },
  });
};
