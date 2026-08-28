---
'@verajs/ssr': patch
---

Events propagate

Bubbling was absent, and the README said why: this DOM held children as a string, so there was no
ancestor chain to walk and an event reached its own target's listeners and stopped. Children are
nodes now, so the chain exists and the reason has expired — a component dispatching a `CustomEvent`
for a parent to hear worked in the browser and did nothing on the server, which is the quietest kind
of divergence: nothing throws, a handler simply never runs.

All three phases work, with `stopPropagation`, `stopImmediatePropagation`, `composedPath()`, correct
`target`/`currentTarget`, and a shadow boundary crossed only by a `composed` event. A listener that
throws is reported and does not take the dispatch down.

The listeners moved off the platform's `EventTarget` to make this possible — it cannot be asked to
run *only* its capturing listeners, so the phases could not be told apart. Everything it provided is
reproduced and re-asserted: `once`, `handleEvent` objects, duplicate registration ignored, and a
return value reflecting `preventDefault`. Each is compared against jsdom dispatching the same event
in `tests/ssr-events.test.mjs`.

The walk covers the node tree; an event does not continue into `document` or `window`, which are not
part of it here.
