import { ComponentElement, RenderTemplate, Signal } from '../types.js';
import { createHook, deferInHookContext } from '../modules/createHook.js';
import { inserts } from '@verajs/inserts';
import { renderScheduler } from '../modules/setRenderScheduler.js';
import { Renderer } from '@verajs/shared-types';

export const useRender = (template: unknown, element: ComponentElement, ...args: unknown[]) => {
  /** Set while a pass is queued, so N writes in a tick still produce one render. */
  let queued = false;

  createHook({
    callback: <V>(props?: Signal<V>, init?: boolean) => {
      /** Wrapped so the deferred rAF pass still registers the properties the template reads. */
      const interiorCallback = deferInHookContext(<V>(props?: Signal<V>) => {
        /** `typeof`, not `instanceof Function` — realm-safe (iframes, vm) and cheaper. */
        const _template = typeof template === 'function' ? (template as RenderTemplate)(props) : template;
        inserts.get('render')?.forEach((callback) => {
          (callback as Renderer)?.(_template, element, ...args);
        });
      });

      if (init) {
        interiorCallback(props);
        return;
      }

      /**
       * Coalesced with a flag rather than cancel-and-reschedule. Cancelling meant a `cancel` plus a
       * fresh `schedule` per write; a flag skips both for every write after the first, and works
       * whatever the scheduler is — a microtask has nothing to cancel.
       */
      if (queued) return;
      queued = true;
      renderScheduler(() => {
        queued = false;
        interiorCallback(props);
      });
    },
    priority: 50,
  });
};
