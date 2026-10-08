import type { ComponentElement, RenderTemplate } from '../types.js';
import { RENDER_PRIORITY } from '../modules/createHook.js';
import { coalesce } from './coalesce.js';
import { inserts } from '@verajs/inserts';
import type { Renderer } from '@verajs/shared-types';

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
      inserts.get('render')?.forEach((renderer) => (renderer as Renderer)(result, target, ...args));
    },
    RENDER_PRIORITY,
    false
  );
