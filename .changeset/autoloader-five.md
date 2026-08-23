---
'@verajs/autoloader': minor
---

One function, three shapes, two helpers — and 184 B lighter than the version that had five.

```js
const autoload = initAutoloader(import.meta.url, 'components');
setAutoloader(autoload);        // watch every component as it renders
autoload();                     // scan whatever is already on the page
autoload(widget.shadowRoot);    // watch a root nothing marked
autoload.url('user-card');      // the URL it would fetch
autoload.retry(element);        // forget that this element's tag failed
```

**`autoload()` replaces the sweep that used to happen by itself.** Creating an autoloader now has no
side effects at all — no scanning, no `DOMContentLoaded` listener. The implicit version was wrong
twice over: it fired once, so markup arriving later was never seen and nothing said so, and two
autoloaders on a page each adopted every marked host and raced to load the same tags from their own
directories, which needed a `sweep: false` option to switch off. As a shape of a function that
already existed it costs almost nothing, can be called again whenever new markup lands, and takes
the option with it.

**`url(tag)` replaces `preload(...tags)`.** Building the URL was all `preload` really did, and having
it in hand does more than the helper could — `modulepreload`, a lower-priority prefetch, priming a
service worker, or just printing it to answer "why is it fetching *that*?".

**`retry(element)` replaces `retry(tag)`**, and `vera:autoload-error` now carries `element` so the
thing you retry is the thing the event hands you. Retrying one element rather than re-scanning every
watched root also drops the iterable set of roots that the old shape required.

**Observers are never disconnected, and do not need to be.** A removed node observed by a live
observer is still collectable — measured in Chromium with `--expose-gc` and pinned by
`tests/browser/memory.test.js`, which guards its own control. jsdom reports the opposite, and reports
it even after `disconnect()`; that is jsdom's bookkeeping, not the observer contract.

905 B to 1 002 B gzipped for all of it — the API surface went from five public things to three
while gaining four capabilities.

**The three attributes are watched, not read once.** Marking a component `autoloader` after it
already has a shadow root now reaches inside it — an observer cannot see through a shadow boundary,
so the attribute is the only thing that can. Repointing `autoload-dir` after a failed attempt tries
the new location, and removing `autoload-ignore` lets an element load. None of these needed the
element to be inserted again before anything noticed, which is not a thing that happens. 56 B of the total above.
