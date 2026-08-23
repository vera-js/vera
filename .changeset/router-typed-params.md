---
'@verajs/router': patch
---

Route params are typed from the path, at zero runtime cost.

```ts
router.addRoutes([
  { path: '/users/:id',        component: (params) => params.id },      // string
  { path: '/files/*rest',      component: (params) => params.rest },    // string[]
  { path: '/u/:id/edit/:tab?', component: (params) => params.tab },     // string | undefined
]);
```

`params.nope` is a compile error, and so is treating a wildcard as a single string — with no
annotation at the call site, no schema and no code generation. `component`, `action`, `beforeEnter`,
`title`, `view` and `redirect` all get it.

`ParseRouteParams` and `TypedRouteAction` shipped as exported types that nothing referenced, and
`TypedRouteAction` named `Route` where it meant `RouteSnapshot`, so anyone who had reached for it
would have got the wrong shape. Both are wired in and corrected. `ParseRouteParams` now also
understands `*wildcards`, optional `:params?`, tokens that are not a whole segment (`/fellow/john:id`
is a real pattern), and several tokens in one segment — and a non-literal path falls back to the
loose record rather than to a type with no properties at all.

A `path` function, and any route under `children`, keeps the loose shape: threading the parent
pattern into children needs a second inferred type parameter, and adding one collapses inference for
the whole array.
