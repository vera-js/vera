/**
 * `@verajs/directives/motion-ssr` — the server half alone: mark a document, emit its sheet.
 * Split from `/motion-core` so a client embedder's bundle never carries the emitter; the full
 * `/motion` entry still exports it for the everything-wired page.
 */
export { renderMotion } from './ssr.js';
