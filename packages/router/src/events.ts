import type { RouteSnapshot, RouteEvent, RouteEventHandler } from './types.js';
import { getOrCreate, handlers } from './state.js';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/**
 * Development: a guard returned a path — the Vue Router habit, which does not redirect here. A string is truthy, so
 * the route is allowed, which in an auth guard defeats the guard. One message for every guard that can cancel —
 * `beforeEnter` and the `before-leave`/`before-route` handlers — because the README promises it of "a guard", and only
 * `beforeEnter` said it until 2026-10-09. `redirect` is offered only where a route can carry one.
 */
export const saidString = (guard: string, path: RouteSnapshot['path'] | undefined, verdict: string, redirectable: boolean) =>
  console.warn(
    diagnostic('router', `${guard} on "${path}"`, 'router-string-guard',
      __DEV__ &&
        PROSE['router-string-guard'](
          verdict,
          'To send someone elsewhere, ' +
            (redirectable
              ? `either set \`redirect: "${verdict}"\` on the route — which settles inside the promise \`navigate()\` returns — or call`
              : 'call') +
            ` \`navigate("${verdict}")\` and return \`false\`, which starts a separate navigation that promise does not cover.`
        ))
  );

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
      const verdict = await handler(to, from);
      if (verdict === false) interrupted = true;
      else if (__DEV__ && typeof verdict === 'string' && event !== 'after-route')
        saidString(`a \`${event}\` handler`, to.path, verdict, false);
    } catch (error) {
      interrupted = true;
      console.error(diagnostic('router', `a ${event} handler`, 'router-handler-threw', __DEV__ && PROSE['router-handler-threw']()), error);
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
  getOrCreate(
    getOrCreate(handlers, element, () => new Map<string, Set<RouteEventHandler>>()),
    event,
    () => new Set<RouteEventHandler>()
  ).add(handler);
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
