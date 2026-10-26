import { inserts } from '@verajs/core';
import { diagnostic, hostOf, reportTo } from '@verajs/shared-utils';
import { PROSE } from './until-diagnostics.js';

/**
 * **`until(promise, fallback)` — a promise at a child position** (R5, 2026-10-26; the promise module the 2026-10-22 plan
 * named). `html\`<p>${until(fetchUser(), html\`<em>loading…</em>\`)}</p>\`` shows the fallback, then what the promise
 * resolves to. Built only on the renderer's `_$child$` protocol: core and the renderer carry nothing for it.
 *
 * - **The same promise again** (a re-render) keeps what is shown: no flash, no second subscription.
 * - **A new promise** shows the fallback again, and the old one's LATE answer is dropped — a slow first request can never
 *   overwrite a newer one.
 * - **Removed before it settles** (`_$detach$`): the answer is dropped; nothing commits into a removed position.
 * - **A value that is not a promise** is shown at once.
 * - **A rejection** keeps the fallback and is reported (the `'error'` chain, else `reportError`), with no error view: a
 *   template that shows an error uses `resource()` (Brian, 2026-10-26: "a. is fine").
 * - **On a server** it renders the fallback (the server waits for no promise until the handoff lands); hydration draws
 *   the same fallback again and the value replaces it.
 * - **No bare `${promise}`** (Brian: not now): written inline, a promise is a new one every render, a refetch loop.
 */
type Until = { promise: unknown; fallback: unknown };
type State = { p: unknown; live: boolean };
type Part = { _$commit$(value: unknown): void; $R?: Node | null };

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
  (promise as PromiseLike<unknown>).then(
    (value) => {
      if (state.live) part._$commit$(value);
    },
    (error) => {
      if (!state.live) return;
      reportTo(inserts.get('error') as unknown[] | undefined, error, hostOf(part.$R), __DEV__ ? diagnostic('renderer', 'until()', 'until-rejected', __DEV__ && PROSE['until-rejected']()) : '[vera] until-rejected');
    }
  );
  return state;
}
/** Told when its position goes away: an answer arriving later is dropped. */
applyUntil._$detach$ = (previous: State | undefined) => {
  if (previous !== undefined) previous.live = false;
};

export const until = (promise: unknown, fallback?: unknown): { _$child$: typeof applyUntil; promise: unknown; fallback: unknown } => ({ _$child$: applyUntil, promise, fallback });
