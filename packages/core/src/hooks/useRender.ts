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
export const useRender = (template: unknown, element: ComponentElement, ...args: unknown[]) =>
  coalesce(
    (signal) => {
      const result = typeof template === 'function' ? (template as RenderTemplate)(signal) : template;
      const target = element._root ?? element.shadowRoot ?? element;
      const renderers = inserts.get('render');
      if (!renderers?.length) {
        if (!warnedNoRenderer) {
          warnedNoRenderer = true;
          console.warn(diagnostic('core', 'render()', 'no-renderer', __DEV__ && PROSE['no-renderer']()));
        }
        return;
      }
      renderers.forEach((renderer) => (renderer as Renderer)(result, target, ...args));
    },
    RENDER_PRIORITY,
    false
  );
