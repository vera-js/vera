import { RouteSnapshot, RouteEvent, RouteEventHandler } from './types.js';
import { handlers } from './state.js';
import { get } from '@verajs/shared-utils';

/**
 * Emits an event that can be watched with on and interrupted by returning false. Handler can
 * do anything else such as retrieving api info, updating state, etc.
 *
 * Semantics, deliberate: every handler always runs (an interrupt does not stop the others), the
 * results aggregate, and a **throwing** handler counts as an interrupt — fail-closed, so an error
 * in a guard cannot let a navigation slip through it.
 *
 * @param element Element to get handlers for
 * @param event Event type to get handlers for
 * @param to Route we're going to
 * @param from Route we're coming from
 * @return false if the handler was interrupted by explicitly returning false
 */
export const emit = async (
  element: HTMLElement | Document,
  event: RouteEvent,
  to: RouteSnapshot,
  from?: RouteSnapshot
): Promise<boolean> => {
  const handlersForEvent = handlers.get(element)?.get(event);
  if (!handlersForEvent) return true;

  let interrupted = false;

  for (const handler of handlersForEvent) {
    try {
      if ((await handler(to, from)) === false) {
        interrupted = true;
      }
    } catch (error) {
      interrupted = true;
      console.error(`Error executing handler for event ${event}:`, error);
    }
  }

  return !interrupted;
};

/**
 * Adds a handler.
 *
 * @param element Element to add handler to
 * @param event Event type to add handler to
 * @param handler Handler function to add
 */
export const on = (element: HTMLElement, event: RouteEvent, handler: RouteEventHandler) => {
  get(handlers)
    .get(element, new Map<RouteEvent, Set<RouteEventHandler>>())
    .get(event, new Set<RouteEventHandler>())
    .value.add(handler);
};

/**
 * Removes a handler.
 *
 * @param element Element to remove handler from
 * @param event Event type to remove handler from
 * @param handler Handler function to remove
 */
export const off = (element: HTMLElement, event: RouteEvent, handler: RouteEventHandler) => {
  handlers.get(element)?.get(event)?.delete(handler);
};
