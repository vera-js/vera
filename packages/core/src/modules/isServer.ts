/**
 * **Whether this code is running on the server** — `true` while `@verajs/ssr` renders, `false` in a browser. Call it
 * to keep per-user state (storage, cookies, the viewport) out of server-rendered markup: `if (!isServer()) …`. Not
 * `typeof localStorage`: a Node server started with `--localstorage-file` HAS a working `localStorage` (Node 26), and
 * that guard then renders one visitor's state into markup served to everyone (2026-11-20). A function, read when it is
 * called: as a constant read at load it answered `false` for the whole process when core was imported before
 * `@verajs/ssr` — failing open, the one direction this guard exists to prevent.
 */
export const isServer = (): boolean => !!(globalThis as { _$ssr$?: boolean })._$ssr$;
