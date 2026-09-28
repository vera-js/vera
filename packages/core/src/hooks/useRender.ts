import type { ComponentElement, RenderTemplate } from '../types.js';
import { RENDER_PRIORITY } from '../modules/createHook.js';
import { coalesce, deferred } from './coalesce.js';
import { inserts } from '@verajs/inserts';
import type { Renderer } from '@verajs/shared-types';

/**
 * Registers `element`'s render hook: it draws the template through every `'render'` insert, and a
 * change to anything it read draws it again on the next animation frame — once, however many writes
 * land before it (`coalesce`).
 */
export const useRender = (template: unknown, element: ComponentElement, ...args: unknown[]) =>
  coalesce(
    (signal) => {
      const result = typeof template === 'function' ? (template as RenderTemplate)(signal) : template;
      const target = element._root ?? element.shadowRoot ?? element;
      inserts.get('render')?.forEach((renderer) => (renderer as Renderer)(result, target, ...args));
    },
    RENDER_PRIORITY,
    deferred,
    element
  );
