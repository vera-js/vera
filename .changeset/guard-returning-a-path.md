---
'@verajs/router': patch
---

Say something when a route guard returns a path instead of `false`

**Only `false` cancels a navigation**, which is what the README documents and what the code does:
`if ((await link.beforeEnter?.(…)) === false) return false;`. Every other return value is truthy, so
the route proceeds.

That makes `beforeEnter: () => '/login'` — the Vue Router habit, where returning a path redirects
there — render the guarded route anyway. Silently. In an auth guard that is the entire purpose of the
guard defeated, and nothing said a word.

Development now warns, naming the fix: this router redirects with the `redirect` route option, or by
calling `navigate()` and returning `false`. It is **warned rather than obeyed** — making a returned
string redirect would be a second way to do what `redirect` already does, and the two would disagree
the moment a route set both.
