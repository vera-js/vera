# @verajs/core

The heart of VeraJS: `init`, `createStore`/`ref`/`shallowRef`, `render`, `html`/`svg`/`mathml`, `useEffect`/
`useLayoutEffect`/`useSyncEffect`, reactive `Map`/`Set` (not `WeakMap`/`WeakSet` — see `llms.txt`), automatic effect cleanup on element
removal, and the insert extension system. `static styles` adoption — including the `@scope`
light-DOM path — moved to `@verajs/styles` in 0.2.0, so apps that do not use it no longer pay for
it. <!--size:core.gzip-->2.52 KB<!--/size:core.gzip--> gzip,
no dependencies, no base class, no build step required.

The complete API reference lives in the repo's `llms.txt` — written to be pasted into an AI
context window, and just as readable by people.
