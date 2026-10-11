import type { ComponentElement, RenderTemplate } from '../types.js';
import { RENDER_PRIORITY } from '../modules/createHook.js';
import { coalesce } from './coalesce.js';
import { inserts } from '@verajs/inserts';
import type { Renderer } from '@verajs/shared-types';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';

/**
 * **No renderer wired: said once per page, in EVERY build** (main had this; the lean rebuild dropped it). Core ships no
 * renderer, so a blank page is the expected first mistake — and a page pasting `vera.min.js` from a CDN never runs a
 * development build, so a development-only warning left it in complete silence. Only the explanation folds away.
 */
let warnedNoRenderer = false;

/**
 * Registers a render hook on the component being set up that draws the template into `element` through
 * every `'render'` insert, and draws it again when anything it read changes — once, however many writes
 * land before it (`coalesce`). The hook belongs to the component being set up, whose lifecycle drives
 * it; `element` is only where it draws — usually the same element, and deliberately allowed not to be.
 */
export const useRender = (template: unknown, element: ComponentElement) => {
  /**
   * The render target, found on the FIRST render and kept: a hook lives one generation, and the root is attached before
   * its setup — so the `_$r$` miss (a light component's walk down the DOM prototype chain) and the `shadowRoot` getter are
   * paid once, not on every render.
   */
  let target: ShadowRoot | HTMLElement | undefined;
  return coalesce(
    (signal) => {
      const result = typeof template === 'function' ? (template as RenderTemplate)(signal) : template;
      target ??= element._$r$ ?? element.shadowRoot ?? element;
      const renderers = inserts.get('render');
      if (!renderers?.length) {
        if (!warnedNoRenderer) {
          warnedNoRenderer = true;
          console.warn(diagnostic('core', `<${element.localName}>`, 'no-renderer', __DEV__ && PROSE['no-renderer']()));
        }
        return;
      }
      /** A plain loop — a `forEach` arrow here was a closure on every render of every component. */
      for (let i = 0; i < renderers.length; i++) (renderers[i] as Renderer)(result, target);
    },
    RENDER_PRIORITY,
    false
  );
};
