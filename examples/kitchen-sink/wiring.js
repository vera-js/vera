/**
 * Everything an app wires once, in the order it has to be wired.
 *
 * Shared by all three modes on purpose: the server, a client-only render and a hydrating client
 * must run the *same* application, or a difference between their output says nothing about Vera.
 * Only the renderer differs, which is why it is a parameter.
 *
 * `insert` comes from `@verajs/core`, never from `@verajs/inserts` — a production bundle inlines
 * the registry, so registering through your own copy writes to a map core never reads. It works in
 * development and silently does nothing in production, which is the worst way for this to fail.
 */
import { wire, setAutoloader } from '@verajs/core';
import { connectRouter } from '@verajs/router';
import { adoptStyles } from '@verajs/styles';
import { initAutoloader } from '@verajs/autoloader';
import { installSinkInserts } from './components/sink-inserts.js';

/**
 * @param {unknown} renderer The DOM renderer for this mode — plain, hydrating, or none server-side,
 *   where `@verajs/ssr` has already registered its own.
 */
export const wireApp = (renderer) => {
  if (renderer) wire({ on: 'render', fn: /** @type {never} */ (renderer), priority: 50 });
  wire([
    /**
     * The router imports no registry of its own, so it has to be handed this one. It used to share
     * core's by accident — under the `development` condition both resolve to a single
     * `@verajs/inserts`, so nothing was wired and everything worked, until a production build gave
     * them one registry each and the routes silently stopped rendering.
     */
    connectRouter,
    /** `static styles` left core in 0.2.0; a component using it renders unstyled without this. */
    { on: 'init', fn: adoptStyles, priority: 50 },
  ]);
  installSinkInserts();
};

/**
 * Browser-only: the autoloader observes the DOM, which a server does not have.
 *
 * `lazy` rather than the components directory, so the URL the autoloader builds is itself under
 * test — everything eagerly imported would load whether or not discovery worked.
 */
export const wireAutoloader = (base) => {
  const autoload = initAutoloader(base, 'lazy');
  setAutoloader(autoload);
  return autoload;
};
