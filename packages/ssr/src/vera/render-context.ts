/**
 * **Which render a piece of work belongs to** (2026-11-23). A timed-out asynchronous render is abandoned, not
 * stopped: what it awaited still resolves, later, inside whatever render is current then, and wrote that render's
 * document (its title from the first request's location). Each render runs in its own `AsyncLocalStorage` context, so
 * work started inside it carries it through every await; the context is marked stale the moment its render settles
 * (finished, thrown or timed out), and a write to the shared document from stale work is refused.
 */
import type { AsyncLocalStorage } from 'node:async_hooks';

/** One render's context: stale once that render has settled. */
type Render = { stale: boolean };

/**
 * **The one store, where the runtime has one.** Module-level because every render shares it: `AsyncLocalStorage`
 * keeps a value per async chain, not per instance. Asked of `process.getBuiltinModule` (Node 20.16 and 22.3 on, Deno,
 * Bun), never imported: a browser Web Worker is a supported place to render (`tests/browser/ssr-worker.test.js`) and
 * has no `node:` modules, and a static import stopped this package loading there in all three engines. Where there is
 * none, nothing is stale: the guard is off, as it was before it existed.
 */
const hooks = (
  globalThis as { process?: { getBuiltinModule?: (id: string) => typeof import('node:async_hooks') | undefined } }
).process?.getBuiltinModule?.('node:async_hooks');
const contexts: AsyncLocalStorage<Render> | undefined = hooks && new hooks.AsyncLocalStorage<Render>();

/** Runs one render's work in a context of its own, marked stale when the render settles (a promise: `.finally`). */
export const inRender = <T>(work: () => Promise<T>): Promise<T> => {
  if (contexts === undefined) return work();
  const render: Render = { stale: false };
  return contexts.run(render, work).finally(() => {
    render.stale = true;
  });
};

/** Work from a render that has already settled, still running. Outside every render, or with no store, nothing is. */
export const stale = (): boolean => contexts?.getStore()?.stale === true;
