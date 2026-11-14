import { createStore, effect, inserts, untrack } from '@verajs/core';

/**
 * **`resource(source)` — async data as a reactive cell** (Brian 2026-10-22; the design: DOCS `resource`).
 *
 * ```js
 * define('x-user', (host) => {
 *   const user = resource((signal) => fetchUser(host.id, { signal }));
 *   return () => user.loading ? html`<p>loading…</p>` : user.error ? html`<p>couldn't load</p>` : html`<h2>${user.value.name}</h2>`;
 * });
 * ```
 *
 * - **One cell:** `loading`, `value`, `error`, `refreshing`. A store, so a render that reads it repaints when it
 *   settles. First load: `loading` true. A refetch keeps the previous `value` visible with `refreshing` true. An error
 *   after a value keeps the value (stale-while-error) and sets `error`.
 * - **The races are inside it.** The source runs TRACKED for its synchronous part (up to its first `await`); when what it
 *   read changes, the previous request's `AbortSignal` fires and the source runs again, and only the LATEST request
 *   ever writes. An aborted request's rejection is not an error. A source that throws synchronously is an `error`; one
 *   that returns a plain value settles at once.
 * - **Owned by its component:** created in a setup (a hook, so it throws by code outside one — in a render too). Its
 *   first request starts as the component sets up (its first pass), not a frame later. Removal aborts the request in
 *   flight and drops a late result.
 * - **On a server it does not fetch** (`$ss(0)`, the server turn): it renders `loading`, and the client fetches. The
 *   server handoff — waiting, the data in the page, hydration seeded from it — comes later and will use `key`, reserved
 *   for it today.
 * - **Not a thenable**, on purpose: an async setup that returned or awaited it would otherwise be joined as the setup,
 *   and a server would wait for it.
 * - Its hook runs at priority 76, after effects: a cross-window move re-runs effects and skips 76, so it never refetches.
 */
type State<T> =
  | { readonly loading: true; readonly refreshing: false; readonly value: undefined; readonly error: undefined }
  | { readonly loading: false; readonly refreshing: boolean; readonly value: T; readonly error: undefined }
  | { readonly loading: false; readonly refreshing: boolean; readonly value: T | undefined; readonly error: NonNullable<unknown> };
type Writable<T> = { loading: boolean; refreshing: boolean; value: T | undefined; error: unknown };

export type Resource<T> = State<T>;
export type ResourceOptions = {
  /**
   * **Reserved**: accepted and not read yet, so passing it changes nothing today. It will name this resource for the
   * server-to-client data handoff (planned with the rebuilt SSR pipeline), where a conditional resource could shift the
   * order the server and the client meet resources in.
   */
  key?: string;
};

export const resource = <T>(source: (signal: AbortSignal) => T | PromiseLike<T>, options?: ResourceOptions): Resource<T> => {
  const cell = createStore<Writable<T>>({ loading: true, refreshing: false, value: undefined, error: undefined });
  /** Accepted, not read yet: reserved for keying server data in a server-to-client handoff that is not built. */
  void options?.key;
  /** A server turn starts no request nobody waits for (the turn's depth is truthy inside one). */
  if ((inserts as unknown as { $ss?: (delta: number) => unknown }).$ss?.(0)) return cell as Resource<T>;
  effect(() => {
    const controller = new AbortController();
    /** This run's request is current until its cleanup — the next run, or the component's removal. */
    let current = true;
    const settle = (ok: boolean, value: unknown) => {
      if (!current) return;
      cell.loading = false;
      cell.refreshing = false;
      if (ok) {
        cell.value = value as T;
        cell.error = undefined;
      } else cell.error = value;
    };
    /** Untracked: a read of its own cell here would subscribe the source to its own result — a refetch loop. */
    untrack(() => {
      if (!cell.loading) cell.refreshing = true;
    });
    let out: T | PromiseLike<T>;
    try {
      out = source(controller.signal);
    } catch (error) {
      untrack(() => settle(false, error));
      return () => { current = false; };
    }
    if (out !== null && typeof (out as PromiseLike<T> | undefined)?.then === 'function')
      (out as PromiseLike<T>).then((value) => settle(true, value), (error) => settle(false, error));
    else untrack(() => settle(true, out));
    return () => {
      current = false;
      controller.abort();
    };
  }, { priority: 76 });
  return cell as Resource<T>;
};
