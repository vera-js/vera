---
'@verajs/renderer': patch
---

`@event` accepts both listener shapes the platform accepts, and names one that cannot listen

`addEventListener` takes **two** shapes — a function, and an object with a `handleEvent` method —
and the second is not exotic: it is how a listener carries state without a closure, and lit-html
supports it. `handleEvent` called `.call()` unconditionally, so the object form bound without
complaint and then threw `this._handler.call is not a function` on **every** dispatch. Verified in
Chromium, Firefox and WebKit that all three honour the object form, since jsdom is the regression net
and never the oracle for something the platform decides.

An event handler is also the most **deferred** call a template makes. Every other binding is checked
when it commits; a listener is checked when a *user clicks*, which in development may be never — the
same shape as the setters that used to accept `undefined` in silence. So a value that cannot listen
is now named in development, at the binding, with the element and the sigil in the message, and is
inert rather than raising from inside the framework on every click.

`false` is deliberately allowed and silent: `@click=${enabled && onClick}` is the ordinary way to
bind conditionally and already behaved correctly. `true` is produced by no idiom, so it is named
along with strings, numbers and objects that cannot listen.

Both published renderer entries were affected — `@verajs/renderer/hydrate` inlines its own copy — and
both are covered. 13 B gzipped on `@verajs/renderer`, 12 B on `/hydrate`.
