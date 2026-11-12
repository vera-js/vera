import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './until-diagnostics.js';

/**
 * **`until(promise, fallback)` — a promise at a child position** (2026-10-26; the promise module the 2026-10-22 plan
 * named). `html\`<p>${until(fetchUser(), html\`<em>loading…</em>\`)}</p>\`` shows the fallback, then what the promise
 * resolves to. Built only on the renderer's `_$child$` protocol: core and the renderer carry nothing for it.
 *
 * - **The same promise again** (a re-render) keeps what is shown: no flash, no second subscription.
 * - **A new promise** shows the fallback again, and the old one's LATE answer is dropped — a slow first request can never
 *   overwrite a newer one.
 * - **Removed before it settles** (`_$detach$`): the answer is dropped; nothing commits into a removed position.
 * - **A value that is not a promise** is shown at once.
 * - **A rejection** keeps the fallback, and the PLATFORM reports it: `until` handles only the value, so the rejection is
 *   unhandled, and the browser prints it with its stack and fires `unhandledrejection`, which monitoring hears (Brian,
 *   2026-10-26: routing it through the `'error'` chain cost 157 B gz of 391; it is the app's own promise). Development
 *   adds a hint. To SHOW an error, pass the caught promise — `until(load().catch(() => html\`…\`), fallback)` resolves to
 *   the error view — or use `resource()`.
 * - **On a server** it renders the fallback (the server waits for no promise until the handoff lands); hydration draws
 *   the same fallback again and the value replaces it.
 * - **No bare `${promise}`** (Brian: not now): written inline, a promise is a new one every render, a refetch loop.
 */
/**
 * **On a server, a rejection is CONSUMED** (2026-10-26): the server serves the fallback and never shows the result (the
 * client makes its own request), and an unhandled rejection ends a Node process by default, so one failed fetch during a
 * server render would take the server down. `@verajs/ssr` sets this public flag at import, before anything renders.
 */
const onServer = (globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed === true;
type Until = { promise: unknown; fallback: unknown };
type State = { p: unknown; live: boolean };
type Part = { _$commit$(value: unknown): void };

/** Hoisted: the applier's identity is its own continuity key (a new function per call would restart every render). */
function applyUntil(this: Until, part: Part, previous: State | undefined): State {
  const promise = this.promise;
  if (previous !== undefined && previous.p === promise) return previous;
  if (previous !== undefined) previous.live = false;
  const state: State = { p: promise, live: true };
  if (typeof (promise as { then?: unknown } | null)?.then !== 'function') {
    part._$commit$(promise);
    return state;
  }
  part._$commit$(this.fallback);
  /** A rejection is RE-THROWN on a client — so the derived promise is unhandled and the platform reports it — and dropped on a server. */
  (promise as PromiseLike<unknown>).then(
    (value) => {
      if (state.live) part._$commit$(value);
    },
    (error) => {
      if (!onServer) throw error;
    }
  );
  /** Development: a hint beside the platform's own report (a SEPARATE handler: the chain above stays unhandled, so reported). */
  if (__DEV__)
    (promise as PromiseLike<unknown>).then(undefined, () => {
      if (state.live) console.warn(diagnostic('renderer', 'until()', 'until-rejected', __DEV__ && PROSE['until-rejected']()));
    });
  return state;
}
/** Told when its position goes away: an answer arriving later is dropped. */
applyUntil._$detach$ = (previous: State | undefined) => {
  if (previous !== undefined) previous.live = false;
};

export const until = (promise: unknown, fallback?: unknown): { _$child$: typeof applyUntil; promise: unknown; fallback: unknown } => ({ _$child$: applyUntil, promise, fallback });
