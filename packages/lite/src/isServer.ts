/**
 * **Whether this code is running on the server** — `true` while `@verajs/ssr` renders, `false` in a browser: the same
 * function as `@verajs/core`'s, so a component that guards per-user state with `if (!isServer()) …` runs unchanged on
 * either tier. Its own copy, because lite imports nothing; both read the flag `@verajs/ssr` sets on the global, when called.
 */
export const isServer = (): boolean => !!(globalThis as { _$ssr$?: boolean })._$ssr$;
