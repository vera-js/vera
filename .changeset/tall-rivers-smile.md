---
'@verajs/router': minor
---

`navigate()` now resolves a path exactly as a routed link does.

It re-resolved through `new URL()` only when the path *looked* absolute — `//host` or a scheme —
while `methods.ts` puts every clicked `href` through the same call and takes `.pathname`. So the two
entry points disagreed about every other shape a URL can take. Measured from a page at `/shop/items`,
seven of eight inputs silently matched nothing where the identical value in an `<a route href>`
worked: `edit`, `./edit`, `../a/b`, `/a/./b`, `/a/c/../b`, `#top`, `?q=1`. The README's own motivating
example for the feature — `navigate(params.get('next'))` honouring a `?next=` redirect — is a direct
route to it.

**This changes behaviour**, hence a minor: `navigate('login')` from `/shop/items` now navigates to
`/shop/login` instead of dead-ending with a warning, so a typo becomes a wrong page rather than a
visible failure. That is the same trade `<a route href="login">` has always made.

A base the URL parser rejects — `about:blank`, a `srcdoc` iframe, a blank `window.open` — falls back
to the raw path instead of throwing `Invalid URL` out of an async function.

21 B **smaller** gzipped: the removed condition cost more than the fallback added.
