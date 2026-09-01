---
'@verajs/renderer': patch
---

A spread event key now honours the object listener shape, as `@event` already does

`addEventListener` takes two shapes — a function, and an object with a `handleEvent` method — and
the event-lifecycle pass taught the written `@event` binding the second one. The fix never travelled
to `@verajs/renderer/spread`, which kept calling `.call()` unconditionally: the identical value
fired through `@click=${listener}` and, through `spread({ onClick: listener })`, bound without
complaint, never fired, and raised `this._handler.call is not a function` on **every** dispatch.
Measured, not reasoned — the suite's function-handler control fired while the object shape threw.

The dispatch now branches on shape exactly as `AttrPart.handleEvent` does, and development names a
truthy value that cannot listen at the binding — where the mistake still is — rather than letting it
surface on a user's click. `false` stays silent, since `{ onClick: enabled && onClick }` is the
ordinary conditional form and already behaves correctly.

14 B gzipped on the spread entry; the warning is `__DEV__`-only, so production carries the branch
and none of the text.
