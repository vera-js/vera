# @verajs/router

SPA routing for web components — <!--size:router.gzip-->3.57 KB<!--/size:router.gzip--> gzipped, no
build step required.

Params and wildcards, redirects, cancellable route events, query strings, hash fragments,
`aria-current` active links, scroll restoration, and several independent routers on one page.

**Standalone: it does not require `@verajs/core`.** The router renders through whatever is
registered on the `'render'` insert, so it works with `@verajs/renderer`, with lit-html, or with a
renderer you wrote.

```sh
npm i @verajs/router @verajs/renderer
```

## A router, whole

<!-- recipe -->
```js
import { initRouter, setRouterRenderer } from '@verajs/router';
import { renderInto } from '@verajs/renderer';
import { html } from '@verajs/core';

setRouterRenderer(renderInto);

customElements.define(
  'app-shell',
  class extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <nav><a route href="/">Home</a> <a route href="/users">Users</a></nav>
        <main view="main"></main>`;

      const router = initRouter(this, { view: 'main' });   // 'main' matches [view="main"]

      router.addRoutes([
        { path: '/', title: 'Home', component: () => html`<p>Home</p>` },
        { path: '/users', title: 'Users', component: () => html`<ul>…</ul>` },
        { path: '/users/:id', component: (params) => html`<p>User ${params.id}</p>` },
        { path: '/*rest', title: 'Not found', component: (params) => html`<p>No ${params.rest}</p>` },
      ]);
    }
  }
);
```

Three pieces make that work: an **outlet**, `<main view="main">`, which is where the matched route
renders; **routed links**, marked with a bare `route` attribute; and the route list.

## Routes

| Key | |
| --- | --- |
| `path` | `'/users/:id'`, or a function returning one |
| `component` | returns the template to render into the outlet. May be `async` |
| `title` | a string, or a function of the params — sets `document.title` |
| `action` | runs before the component; load data here. May be `async` |
| `view` | a different outlet for this route: a name, an element, or a function returning either |
| `redirect` | send this route elsewhere — a path, or a function of the params |
| `children` | routes whose paths are prefixed by this one |
| `meta` | arbitrary data, carried to guards and components on the snapshot |
| `name` | a stable handle, so links are built with `resolve()` instead of by hand |
| `alias` | other paths that reach this same route, its children included |
| `beforeEnter` | a guard for this route alone. Return `false` to cancel |

**A path may be written relative or absolute, at any depth.** `'about'` and `'/about'` at the top
level, `'new'` and `'/new'` under `/users` — all four mean what they look like, and an `alias` is
joined the same way. A name always resolves to the canonical URL, never to an alias.

`component`, `action`, `title` and `view` all receive `(params, to, from)`, where `to` and `from` are
route snapshots carrying `path`, `params`, `query`, `hash`, `trigger` and `meta`.

**`meta` is yours.** The router never reads it — it carries it — which is what lets a guard decide on
the route's own terms rather than by re-parsing the path it was handed:

```js
{ path: '/admin/:id', meta: { requiresAuth: true }, component: adminView }

router.on('before-route', async (to) => {
  if (to.meta?.requiresAuth && !(await isSignedIn())) {
    navigate('/login', 'replace');
    return false;
  }
});
```

**Patterns.** `:name` matches one segment, `:name?` makes that segment optional, and `*name`
matches the rest of the path and gives you an array of segments. A token does not have to be the
whole segment — `/fellow/john:id` matches `/fellow/johnXYZ`. Everything else is literal —
`/file.html` matches only that path, not `/fileXhtml`. Params arrive **percent-decoded**, so
`/u/John%20Doe` gives you `John Doe`; an optional param that did not match is simply absent.

```js
{ path: '/users/:id?' }   // matches /users and /users/5
```

**The most specific route wins**, not the first one registered. A static segment outranks a
`:param`, a required param outranks an optional one, and a `*wildcard` ranks below everything — so
`/users/new` beats `/users/:id`, and a catch-all `/*rest` sits last wherever it was declared.
Longer patterns outrank shorter ones. React Router ranks the same way, and for the same reason:
where a route went in the list should not decide whether it is reachable.

**A path that matches nothing does nothing, and development says so.** `navigate` returns `false`,
and a `route` link has already had its click cancelled by the time anyone finds out — so the page
sits there looking like the listener is broken, when the path is what is wrong. The warning names
the path. A guard returning `false` reaches the same place and stays quiet: that is a deliberate
cancellation, not a missing route.

### Nested routes

`children` renders the whole chain, outermost first, each level into an outlet the level above it
rendered:

```js
{
  path: '/settings',
  component: () => html`<h1>Settings</h1><nav>…</nav><section view="main"></section>`,
  children: [
    { path: '/profile', component: () => html`<p>Profile</p>` },
    { path: '/billing', component: () => html`<p>Billing</p>` },
  ],
}
```

`/settings/profile` renders the settings layout into the router's outlet and the profile view into
the `<section view="main">` that layout just rendered. `/settings` renders the layout with its outlet
left empty.

A view name is resolved **inside the level above**, so a nested outlet can reuse the router's own
name — as above — and nothing outer claims it first. A child may name its own outlet with `view`
instead. If the parent's template renders no matching outlet the route does not apply, and says so
in development.

**Give `initRouter` a view *name* if you use `children`.** It also accepts an element, which is fine
for a flat app and is the router's root outlet either way — but an element is one node, so a nested
level cannot inherit it. Those levels fall back to searching inside the level above for a bare
`<div view>`, and a child that finds nothing says so in development.

Leaving a level means leaving it: navigating from `/settings/profile` back to `/settings` empties the
outlet the profile was in. The parent's template is *reused* rather than rebuilt — that is template
identity doing its job — so the outlet element survives, and the router clears what it put inside.
An element the router never rendered into is left alone, even if it carries a `view` attribute.

`beforeEnter` and `action` run down the same chain, so a parent can refuse before a child does any
work.

**Only `false` cancels.** Returning a *path* is the Vue Router habit and does not redirect here — a
string is truthy, so the guarded route renders anyway, which in an auth guard defeats the guard
entirely. Development warns when a guard returns a string.

There are two ways to send someone elsewhere, and **they settle differently**:

| | after `await navigate('/guarded')` |
| --- | --- |
| `redirect: '/b'` on the route | already at `/b` |
| guard calls `navigate('/b')` and returns `false` | still where you were — `/b` a task later |

`redirect` is handled inside that navigation, so the promise `navigate()` returns covers it. A guard
calling `navigate()` starts a **separate** navigation the promise knows nothing about; awaiting it
tells you only that the guarded route was cancelled. Prefer `redirect` when the caller awaits.

## Navigating

```js
import { navigate, resolve } from '@verajs/router';

navigate('/users/5');                          // pushes a history entry
navigate('/login', 'replace');                 // swaps the current entry — for guards and redirects
navigate({ name: 'user', params: { id: 5 } }); // by name

navigate('https://this-site/users/5');         // same origin, normalised to the path
navigate('//elsewhere.test/x');                // refused — returns false, warns in development

navigate('edit');                              // relative to the current page, like an href
navigate('../a/b');                            // dot-segments resolve, like an href
navigate('?q=1');                              // same route, new query
```

**`navigate()` resolves a path exactly as a routed link does.** Both put it through
`new URL(path, location.href)`, so relative paths, `.` and `..` segments, and a bare `?query` all mean
what they mean in an `href`. They did not always agree: `navigate()` used to resolve only paths that
*looked* absolute, so seven of eight of the shapes above silently matched nothing while the same
value in an `<a route href>` worked.

The trade is worth naming. `navigate('login')` from `/shop/items` now goes to `/shop/login` rather
than dead-ending with a warning, so a typo becomes a wrong page instead of a visible failure — the
same trade `<a route href="login">` has always made, and relative resolution against the current
document is the oldest rule on the web.

**A path that names an origin is checked against this one**, exactly as a routed link is: the router
moves within one site, and anything else belongs to the browser. That matters because
`navigate(params.get('next'))` is the ordinary way to honour a `?next=` redirect — an unchecked
protocol-relative path reached `pushState`, which the browser refuses with a `SecurityError` nothing
catches, so the payload took the page down instead of being declined. Use `location.assign()` to
leave the site deliberately.

```js
back();                                        // history, by the usual names
forward();
go(-2);
```

**Named routes.** Give a route a `name` and build its URL with `resolve(name, params)` instead of
by hand, so renaming `/users/:id` to `/people/:id` leaves every caller alone:

```js
{ path: '/users/:id', name: 'user', component: userView }

resolve('user', { id: 5 });                 //  /users/5
resolve('user', { id: 'John Doe' });        //  /users/John%20Doe   — encoded to round-trip
resolve('file', { rest: ['a', 'b'] });      //  /files/a/b          — a wildcard takes segments
resolve('user-edit', { id: 5 });            //  /users/5/edit       — an omitted `:tab?` takes its segment
```

Names are page-wide, because a name is a handle on a URL and every router shares one URL. A child
route registers its complete path, so `resolve('child')` gives `/parent/child`. Two routes claiming
one name warn in development.

Every router on the page follows every navigation, because they all share one URL. History gets one
entry per user navigation, and none for back/forward or the initial load.

A newer navigation **supersedes** an older one. If a route's `component` fetches and the user clicks
something else while it is in flight, the abandoned pass stops at its next checkpoint and commits
nothing — no render, no history entry, no title.

`router.currentRoute` is where that router is now, with the params and query already parsed —
`undefined` until it has routed once. `location.pathname` gives you the string back; this gives you
the match.

### Params are typed from the path

In TypeScript, a route's params are read off its own `path` — no annotation, no code generation, no
schema:

```ts
router.addRoutes([
  { path: '/users/:id',        component: (params) => html`<p>${params.id}</p>` },      // string
  { path: '/files/*rest',      component: (params) => html`<p>${params.rest[0]}</p>` }, // string[]
  { path: '/u/:id/edit/:tab?', component: (params) => html`<p>${params.tab ?? ''}</p>` },// string | undefined
]);
```

`params.nope` is a compile error, and so is treating a wildcard as a single string. A `path`
function has no literal to read, so those routes keep the loose `RouteParams` shape rather than
losing param access entirely.

`children` keep the loose shape too. Threading the parent's pattern into them needs a second
inferred type parameter, and adding one collapses inference for the whole array — every route,
nested or not, loses its params. Typed where people write most, loose one level down, beats typed
nowhere; a child callback can annotate its own params.

## Guards and events

```js
router.on('before-route', async (to, from) => {
  if (to.path.startsWith('/admin') && !(await isAdmin())) {
    navigate('/login', 'replace');
    return false;      // cancels
  }
});
```

| Event | |
| --- | --- |
| `before-leave` | before leaving the current route. Return `false` to cancel |
| `before-route` | after `before-leave`, before anything renders. Return `false` to cancel |
| `after-route` | cleanup, once the route has been applied. Cannot cancel |

**Every handler runs**, even after one cancels, and the results aggregate. A handler that **throws**
counts as a cancellation — fail-closed, so a bug in a guard cannot let a navigation through it.

The same three are dispatched as DOM events named `vera:before-leave`, `vera:before-route` and
`vera:after-route`. They bubble, cross shadow boundaries, and carry `{ currentRoute, previousRoute }`
on `detail`. `preventDefault()` on either `before-` event cancels the navigation, exactly as
returning `false` does:

```js
element.addEventListener('vera:before-leave', (e) => {
  if (formIsDirty) e.preventDefault();
});
```

## Links

```html
<a route href="/users/5">User 5</a>
```

The `route` attribute is what opts a link in; anything without it is a normal link. Clicks with a
modifier key or a non-primary button, links with `target` or `download`, and links pointing at
another origin are all left to the browser — hijacking those is the classic SPA-router etiquette bug.

**Relative hrefs work**, resolved exactly as the browser resolves them: from `/docs/intro`,
`href="edit"` goes to `/docs/edit` and `href="../"` to `/`. This is deliberately *not* React
Router's `<Link to="edit">`, which would give `/docs/intro/edit` — a `route` attribute must not
change where a link points, or the same markup would go to two different places depending on
whether the script ran.

Routed links must live in the router's own template. A link inside a *child* component's shadow root
is invisible to the click listener, because retargeting hides it.

**Active links** are marked as the route changes: an exact match gets `.active` and
`aria-current="page"`; an ancestor of the current path — `/users` while at `/users/5` — gets
`.active-within`. The ancestor match is on segment boundaries, so `/user` never lights up for
`/users`, and `aria-current` stays exact-only per the ARIA spec.

## Query strings and hashes

A query rides in the URL but never reaches pattern matching, so `/users?page=2` matches the `/users`
route. The parsed `URLSearchParams` is `to.query` on every snapshot.

`navigate('/docs#install')` costs a single history entry, scrolls to the anchor and sets `:target`,
and a deep-linked fragment scrolls once the routed content exists rather than before it. With
`pushHash: false`, fragments never reach the URL at all — they go to `hashChangeFunction` alone.

The fragment is on every snapshot as `to.hash`, `#` included. A **hash-only** change does not
re-route — the matched route has not changed and the browser has already moved the fragment — but
each router's `currentRoute` takes the new fragment and `after-route` fires with the `'hashchange'`
trigger, so a component can respond to it:

```js
router.on('after-route', (to) => {
  if (to.trigger === 'hashchange') highlight(to.hash);
});
```

## Scrolling

Fresh navigation lands at the top, like a page load. Back and forward restore the position the user
left that entry at: the router stamps the scroll offset into history state on the way out and
restores it after the content renders, which is why it sets `history.scrollRestoration = 'manual'` —
the browser's own restoration fires before a routed view exists.

`scrollBehavior` replaces both — for a list that should keep its offset, a view that scrolls its own
container rather than the window, or smooth scrolling:

```js
initRouter(this, {
  view: 'main',
  scrollBehavior: (to, saved) => {
    if (saved) window.scrollTo(...saved);                 // back/forward
    else if (!to.path.startsWith('/inbox')) window.scrollTo({ top: 0, behavior: 'smooth' });
  },
});
```

`saved` is the position stamped on the entry a back/forward traversal landed on, and is absent for
every other trigger.

## Options

```js
initRouter(element, { view: 'main', focusView: true, handleInitial: true, pushHash: true });
```

| | |
| --- | --- |
| `view` | the outlet: a `[view="…"]` name, an element, or a shadow root. **Required** |
| `focusView` | move focus into the new view after routing. Default `true` |
| `handleInitial` | route the landing URL on the first frame. Default `true` |
| `pushHash` | let fragments reach the URL. Default `true` |
| `hashChangeFunction` | called with each fragment |
| `scrollBehavior` | replace where the page scrolls to after routing |

`initRouter` returns `{ addRoutes, removeRoute, currentRoute, deleteRouter, on, off }`.

`removeRoute(name)` takes a named route and its aliases back out — for a route that arrived with a
permission or a feature flag. Routes are flat, so a parent's children are removed by their own
names. `deleteRouter()` removes everything: the routes, the handlers and the link listener.

## Extending it

| | |
| --- | --- |
| `setRouterRenderer(fn)` | what draws a route's template into its outlet |
| `resolve(name, params)` | build a named route's path |
| `setMatchFunction(fn)` | replace pattern matching entirely — the signature is path-to-regexp's `match`, so that library drops straight in |
| `router` | hand this router core's insert registry — pass it to `wire` |

**Specificity is scored from the pattern text**, using the token syntax above, so replacing the
matcher with `setMatchFunction` leaves ranking reading a grammar that matcher may not share. It
still orders sensibly — static text outranks tokens either way — but if your patterns mean something
different, register them in the order you want them tried.

On a CDN page, `vera.min.js` and `vera-router.min.js` each inline their own bundle. This package
keeps **no registry of its own**, so there is no second one to reconcile — hand it core's:

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { router } from '@verajs/router';

wire([renderer, router]);
```

Identical under a bundler and on a CDN page, which is the point: `connectInserts`, the replay
function this replaced, was load-bearing in one mode and ceremonial in the other. Without core at
all, skip the registry entirely — `initRouter(el, …)` plus `setRouterRenderer(renderer)` is the
whole wiring.

## When a route fails

A guard or a component that throws leaves the view exactly as it was. What happens next depends on
who asked for the navigation:

- **`navigate()` rejects**, so a caller that awaits it can handle the failure itself.
- **A link click has nobody to reject to**, so the router reports it: a console line naming the path,
  and a `vera:route-error` event that bubbles and crosses shadow boundaries.

```js
addEventListener('vera:route-error', ({ detail: { path, error } }) => {
  toast(`Could not open ${path}`);
  report(error);
});
```

The event exists for the same reason `@verajs/autoloader` has `vera:autoload-error`: a route that
fails to render is something an app may want to render *around*, and an unhandled promise rejection
cannot be caught where that decision is made.

## Node and SSR

Importing the router is side-effect-free: window listeners attach on the first `initRouter`, not at
import time, so `import '@verajs/router'` is safe in Node. Routing itself is browser-only.

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.

## License

MIT
