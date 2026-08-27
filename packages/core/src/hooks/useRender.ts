import { ComponentElement, RenderTemplate, Signal } from '../types.js';
import { createHook, deferInHookContext } from '../modules/createHook.js';
import { guardPass, noteWrite } from '../modules/allowRenderLoop.js';
import { inserts } from '@verajs/inserts';
import { renderScheduler } from '../modules/setRenderScheduler.js';
import { Renderer } from '@verajs/shared-types';

/** One warning per page, not per render. */
let warnedNoRenderer = false;

export const useRender = (template: unknown, element: ComponentElement, ...args: unknown[]) => {
  /** Set while a pass is queued, so N writes in a tick still produce one render. */
  let queued = false;

  createHook({
    callback: <V>(props?: Signal<V>, init?: boolean) => {
      /** Wrapped so the deferred rAF pass still registers the properties the template reads. */
      const pass = <V>(props?: Signal<V>) => {
        /** `typeof`, not `instanceof Function` — realm-safe (iframes, vm) and cheaper. */
        const _template = typeof template === 'function' ? (template as RenderTemplate)(props) : template;
        const renderers = inserts.get('render');

        if (__DEV__) {
          /**
           * Core ships no renderer of its own, so nothing rendering is the expected first mistake.
           * Silence here looks like a broken component; this names the two missing lines instead.
           */
          if (!renderers?.length && !warnedNoRenderer) {
            warnedNoRenderer = true;
            console.warn(
              `[vera] render() called with no renderer registered — nothing will appear.\n` +
                `Wire one once, at your app entry:\n\n` +
                `  import { wire } from '@verajs/core';\n` +
                `  import { renderer } from '@verajs/renderer';\n` +
                `  wire([renderer]);\n`
            );
          }
        }

        /**
         * The root is resolved **here**, not when a renderer registers.
         *
         * `_root` first: a closed shadow root is not reachable through `element.shadowRoot`, and
         * that applies to the framework too. This used to live inside `setRenderer`'s wrapper, so
         * a renderer wired any other way silently rendered into the light DOM instead — the
         * resolution belonged to one registration path rather than to the act of rendering.
         */
        const target =
          (element as HTMLElement & { _root?: ShadowRoot })._root ?? element.shadowRoot ?? element;

        renderers?.forEach((callback) => {
          (callback as Renderer)?.(_template, target, ...args);
        });
      };

      /**
       * The guard wraps the pass **behind the ternary**, not inside it — see the same note in
       * `coalesce`. `deferInHookContext` stays outermost so the guard runs with the hook's entry on
       * the queue, which is how it names the element without being handed one.
       */
      const interiorCallback = deferInHookContext(__DEV__ ? guardPass(pass, 'a template') : pass);

      if (init) {
        interiorCallback(props);
        return;
      }

      /**
       * Before the `queued` short-circuit, not after. A write landing while a pass is in flight is
       * what makes that pass self-feeding, and the second write of a tick is exactly the one the
       * flag would otherwise swallow.
       */
      if (__DEV__) noteWrite();

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
