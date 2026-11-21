/**
 * **Whether this code is running on the server** — `true` while `@verajs/ssr` renders, `false` in a browser. Read it
 * to keep per-user state (storage, cookies, the viewport) out of server-rendered markup: `if (!isServer) …`. Not
 * `typeof localStorage`: a Node server started with `--localstorage-file` HAS a working `localStorage` (Node 26), and
 * that guard then renders one visitor's state into markup served to everyone (2026-11-20). A constant: `@verajs/ssr`
 * sets its flag before anything imports core, which its README requires.
 */
export const isServer: boolean = !!(globalThis as { _$ssr$?: boolean })._$ssr$;
