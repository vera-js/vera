/**
 * The client entry, for both modes.
 *
 * The renderer is chosen by the importmap or the query string rather than here: a hydrating app
 * swaps one import and nothing else, which is the claim, and an entry that branched on a flag would
 * quietly prove something weaker.
 */
import { wire, wireAutoloader } from './wiring.js';

export const start = async (renderer) => {
  wire(renderer);
  wireAutoloader(import.meta.url);
  await import('./components/sink-shell.js');
  document.documentElement.dataset.sinkReady = 'true';
};
