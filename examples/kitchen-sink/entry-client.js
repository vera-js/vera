/**
 * The client entry, for both modes.
 *
 * The renderer is chosen by the importmap or the query string rather than here: a hydrating app
 * swaps one import and nothing else, which is the claim, and an entry that branched on a flag would
 * quietly prove something weaker.
 */
import { wireApp, wireAutoloader } from './wiring.js';
import { lists } from '@verajs/renderer/lists';

/**
 * Takes the renderer **module**, not just its `render`. List rendering is a handler now, and each
 * renderer entry — plain or hydrating — is a substitute bundle with its own inlined copy, so the
 * handler has to go into the one this mode is actually using.
 */
export const start = async (rendererModule) => {
  wireApp(rendererModule.render);
  rendererModule.handle(lists.fn);
  wireAutoloader(import.meta.url);
  await import('./components/sink-shell.js');
  document.documentElement.dataset.sinkReady = 'true';
};
