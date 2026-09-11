# @verajs/router

SPA routing for web components — <!--size:router.gzip-->4.00 KB<!--/size:router.gzip--> gzipped, no
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

Under a base these carry it — `/app/users/5` — so the result goes straight into an `href`, and
`navigate()` still accepts it. See *Serving the app from a subdirectory*.

**A missing param fills from the current route.** From `/users/5/profile`, `resolve('user-settings')`
is `/users/5/settings` and `navigate({ name: 'user-settings' })` goes there — the page already knows
the `5`, so no component has to know it or thread it down. Explicit params always win, and an
explicit `undefined` still means "omit this optional segment" rather than "fill it for me". With
nothing routed yet (a server pass, a fresh page) the fill finds nothing and a missing required param
stays visible in the output, exactly as before.

### Moving around

Every relative gesture, from a component that has no idea where it is mounted:

| you want | you write |
| --- | --- |
| a sibling — `/users/5/profile` → `/users/5/settings` | `navigate('settings')` — a relative path resolves like a relative href: the last segment is replaced |
| the same place, a different view | `navigate({ name: 'user-settings' })` — params fill from here |
| a child — `/users/5` → `/users/5/edit` | `navigate({ name: 'user-edit' })`, or `` navigate(`${currentRoute().path}/edit`) `` |
| anything else | `currentRoute()` gives `{ path, query, hash, params }` — the rest is string work |

One resolution rule, deliberately: a relative `navigate()` goes exactly where the same string in an
`<a href>` would, so there is no second grammar to learn and links and calls can never disagree. The
one place that rule surprises — a relative word from a path *ending in a param* replaces the param
(`navigate('edit')` from `/users/5` is the sibling `/users/edit`, not the child) — is diagnosed in
development, naming both correct spellings.

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

A link inside a *child* component's **shadow root** is invisible to the click listener, because
retargeting rewrites the event's target to the host before the listener sees it — so routed links
belong in the router's own template, or in a component that renders **light**.

A **light-DOM** child is a different matter: nothing is retargeted, the link is an ordinary element
in the same tree, and the router handles it exactly as it handles its own. Both halves are pinned in
`tests/router-component-links.test.mjs` — the limitation as much as the capability, since a
limitation people plan around has to be described accurately.

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
| `resolve(name, params)` | build a named route's URL — `href`-ready, `navigate()` takes it too, and missing params fill from the current route |
| `currentRoute()` | where the page is: `{ path, query, hash, params }` — pathname, `URLSearchParams`, fragment, and params merged across every router that matched |
| `setMatchFunction(fn)` | replace pattern matching entirely — the signature is path-to-regexp's `match`, so that library drops straight in |
| `setBasePath(path)` | the path prefix the app is served under; `null` returns to reading `<base href>` |
| `router` | hand this router core's insert registry — pass it to `wire` |

### Serving the app from a subdirectory

Write your routes as if the app were at the origin's root — `/users`, not `/app/users`. The base is
a deployment fact, not part of the route table, so the router adds it when it writes to the address
bar and strips it when it reads one back.

```js
import { setBasePath } from '@verajs/router';
setBasePath('/app');
```

That is all it takes, and it changes nothing else about the page — which is why it comes first. The
alternative is the platform's own `<base href="/app/">`, which the router also reads and which every
deployment tool that serves from a subdirectory can emit. But a `<base>` re-points every relative
URL on the page — assets, form actions, **and relative navigation**: with one installed,
`navigate('settings')` and `href="settings"` alike mean `/app/settings` from anywhere, not the
sibling of where you are (measured; `tests/router-gestures.test.mjs` pins it). That is the correct
platform behaviour and occasionally even what you want; `setBasePath` is mounting with none of it.

Either way, `navigate('/users')` means the route `/users` and puts `/app/users` in the address bar,
and a link written `href="/app/users"` is marked active on that route. `navigate` accepts the mounted
path too, so `navigate('/app/users')` and `navigate('/users')` are the same navigation. A path that
merely shares a prefix with the base — `/application` — is not treated as being under it.

**Write hrefs the way the browser will read them** — relative (`href="users"`, resolved against the
`<base>`) or with the base (`href="/app/users"`). A route-space href like `href="/users"` *appears*
to work, because the router intercepts the click and re-bases it, but it is a broken URL for
everything the router does not intercept: a new tab, a copied link, a crawler, a page with JS off.
The one case anybody tests is the one case that works, so development builds say so, naming the
href you should have written.

`resolve(name, params)` returns the **mounted** path — `/app/users/5`, ready for an `href` — and
`navigate()` accepts it unchanged, because every path it is given is resolved and stripped. So one
return value is correct in both places, and at the origin root it is the same string it always was.

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

## Animated navigations

`router` is a dual: wire it bare, or call it with options first.

```js
wire([renderer, router({ animate: true })]);
```

With `animate: true`, every navigation wraps its routed renders in the platform's
`document.startViewTransition`, so route changes crossfade — and anything you name with
`view-transition-name` in ordinary CSS morphs between pages. The engine keeps four guards: the
initial render never animates (a landing is the page settling, not an answer to anyone),
`prefers-reduced-motion` skips the wrap, an engine without view transitions routes instantly —
the designed page — and a navigation landing mid-transition takes the stage over. A guard or
component that throws still rejects `navigate()` exactly as it does on the instant path. Tune
the look with CSS on `::view-transition-old(root)` / `::view-transition-new(root)`; the no-core
path opts in the same way, `router({ animate: true })` with no wire call.

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
