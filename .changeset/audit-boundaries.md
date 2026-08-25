---
'@verajs/autoloader': minor
'@verajs/router': minor
---

Both packages check a URL where it is built, not only where it is used

**`autoloader.url()` refuses a directory that escapes the base.** `autoload-dir` is an ordinary HTML
attribute, so on any page whose markup is partly authored elsewhere it is an input, and
`autoload-dir="//evil.test"` resolves to a different origin. The loader always refused before
fetching; `url()` did not, and `url()` is public and documented for preloading — so it handed the
caller the exact fetch this module declines to make. It now throws, and discovery catches the throw,
reports it once and moves on. A custom `resolve` is covered by the same check.

**`navigate()` checks the origin, as a routed link already does.** `navigate(params.get('next'))` is
the ordinary way an app honours a `?next=` redirect: a protocol-relative path went straight to
`pushState`, which the browser refuses with a `SecurityError` nothing caught, so an open-redirect
payload took the page down instead of being declined. It now returns `false` and warns in
development. A same-origin absolute URL is normalised to the path form the matcher expects — which
is what a link already passes, and which used to fall through to the catch-all.

**The router sees the query on initial load and on traversal.** The path was built from
`pathname + hash`, so `?page=2` and every filter in a bookmarked URL were invisible on a deep link, a
refresh or a back traversal — and present when you clicked through to the same place.
