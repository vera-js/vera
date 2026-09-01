---
'@verajs/ssr': patch
---

`eventPhase` now says which phase is running, the phase constants are on the event itself, and
`dispatchEvent` takes an `Event` rather than anything shaped like one.

`eventPhase` read `NONE` for the whole dispatch where every engine reports 1, 2 and 3, and Node puts
`AT_TARGET` and its neighbours on `Event` alone while all three engines also put them on
`Event.prototype`. Together those made `event.eventPhase === event.AT_TARGET` — the ordinary way to
ask "was this mine, or a descendant's?" — compare a number against `undefined`, so the branch was
never taken at all rather than taken wrongly, and the server quietly disagreed with the client about
an event both of them dispatched.

The dispatch guard checked `typeof event.type === 'string'`, which `{ type: 'click' }` satisfies, so
the server accepted a call every engine refuses with a `TypeError` and the mistake reached the client
before failing.

Found by dispatching the same 23 events against this DOM and jsdom and comparing; the three
behaviours were then confirmed on Chromium, Firefox and WebKit before being called defects.
