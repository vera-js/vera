---
'@verajs/autoloader': minor
---

`preload`, `retry`, shadow roots by hand, and a `sweep` switch — plus a memory question answered.

**`preload(...tags)`** adds `<link rel="modulepreload">` for a component you know is coming, so the
later `import()` is a cache hit. Bounded exactly as a load is, and it never defines anything.

**`retry(tag)`** forgets that a tag failed and re-scans every watched root. A failed load is
otherwise permanent for the page — right for a component that does not exist, wrong for one lost to
a dropped connection. Pairs with `vera:autoload-error`, which hands you the tag.

**A `ShadowRoot` passed directly is watched**, with no `autoloader` attribute. An observer cannot
cross a shadow boundary, so a component that never marked itself was unreachable — including a
third-party one holding tags of yours. Handing the root over *is* the opt-in.

**`{ sweep: false }`** skips the document sweep at creation. Without it, a page running two
autoloaders has each adopt every marked host, and they race to load the same tags from their own
directories.

**Observers are never disconnected, and do not need to be.** A removed node observed by a live
observer is still collectable — measured in Chromium with `--expose-gc` and pinned by
`tests/browser/memory.test.js`, which also guards its own control. jsdom reports the opposite, and
reports it even after `disconnect()`; that is jsdom's bookkeeping, not the observer contract.

905 B to 1 130 B gzipped: preload 109 B, retry 83 B (it needs an iterable set of watched roots),
the sweep switch 12 B, shadow roots 8 B.
