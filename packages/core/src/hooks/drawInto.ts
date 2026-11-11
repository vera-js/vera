import type { ComponentElement, RenderTemplate } from '../types.js';
import { RENDER_PRIORITY, settle } from '../modules/createHook.js';
import { currentInstance, tracking } from '../store/store.js';
import { coalesce } from './coalesce.js';
import { inserts } from '@verajs/inserts';
import type { Renderer } from '@verajs/shared-types';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';

/**
 * **No renderer wired: said once per page, in EVERY build**. Core ships no
 * renderer, so a blank page is the expected first mistake — and a page pasting `vera.min.js` from a CDN never runs a
 * development build, so a development-only warning left it in complete silence. Only the explanation folds away.
 */
let saidNoRenderer = false;

/**
 * The render hook. `owns` is the component's resolved `foreignNodes` — true for `'drop'`: the template owns its root —
 * and travels to the render insert WITH every render (its third argument), so the renderer never reads it from the DOM.
 * Whether a root CAN be owned (a shadow root, empty at its first render) is the renderer's decision. Only `init` passes
 * it; the public the setup's returned render below is this same function, typed without it.
 */
export const drawInto = (template: unknown, element: ComponentElement, owns?: boolean) => {
  /**
   * The render target, found on the FIRST render and kept: a hook lives one generation, and the root is attached before
   * its setup — so the `_$r$` miss (a light component's walk down the DOM prototype chain) and the `shadowRoot` getter are
   * paid once, not on every render.
   */
  let target: ShadowRoot | HTMLElement | undefined;
  /** NOT inlined (2026-10-23): its one caller here would be pasted as an IIFE — see `commit` in `init.ts`. */
  /*@__NOINLINE__*/ coalesce(
    (signal) => {
      /** This render's own hook, taken BEFORE the renderers run: settling it must not depend on every nested run restoring `tracking`. */
      const self = tracking.hook;
      const result = typeof template === 'function' ? (template as RenderTemplate)(signal) : template;
      target ??= element._$r$ ?? element.shadowRoot ?? element;
      const renderers = inserts.get('render');
      if (!renderers?.length) {
        if (!saidNoRenderer) {
          saidNoRenderer = true;
          console.warn(diagnostic('core', `<${element.localName}>`, 'no-renderer', __DEV__ && PROSE['no-renderer']()));
        }
        return;
      }
      /** A plain loop — a `forEach` arrow here was a closure on every render of every component. */
      for (let i = 0; i < renderers.length; i++) (renderers[i] as Renderer)(result, target, owns);
      /**
       * The render RETURNED and committed: what it owns and did not claim this time (an automatic `.map` list it hid or
       * no longer reaches) is disposed now, `.map` call or not. Here, once per component render — not at the
       * end of every hook's run.
       */
      settle(self);
    },
    RENDER_PRIORITY,
    false,
    /**
     * **The owner is the component being set up; `element` only when NONE is** (E5, 2026-10-22). During a setup the hook
     * stays the current component's even when it draws elsewhere (making the target the owner left it on an element
     * nothing commits — reverted 2026-09-28, the row in core-api). After an `await` in an async setup no component is
     * current, and the element given is then the owner, as `effect(fn, { owner })` takes it.
     */
    currentInstance.element ?? element
  );
};
