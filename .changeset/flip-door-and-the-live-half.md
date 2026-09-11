---
'@verajs/directives': patch
---

The animated-commit door and the live half. `data-vd-list` and `data-vd-fetch` share one flip
door (`animate: true`): reorders glide, filters crossfade, swaps morph old-to-new through
`startViewTransition`, behind a named-guard table — establishment (activation, URL restore,
`on: 'load'`) never animates, typing never animates, reduced motion and unsupporting engines
keep the instant page. Typed list changes (`move`/`fade`/`swap`/`enter`) carry the policy: waves
are for travel only, and an accumulating fetch's arrivals enter individually. `data-vd-fetch`
gains `place: 'append' | 'prepend'` (existing DOM is parsed around, never rewritten). New
`data-vd-stream` holds a live connection — `http(s)` is an EventSource, `ws(s)` a WebSocket with
capped-backoff reconnect — where every pushed JSON object is a state patch and anything else is
markup, same-origin only; connections are shared per URL, and `send:` transmits new writes of a
state key. The query pack writes arrays as sorted repeated parameters (the same shape a no-JS
form submit emits; readers stay liberal and comma links keep working), `@route.query` walks
repeated keys as arrays, and an accumulating feed with a URL-bound depth key gets a development
warning.
