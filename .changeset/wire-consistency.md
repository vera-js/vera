---
'@verajs/inserts': minor
'@verajs/core': minor
'@verajs/autoloader': minor
'@verajs/eslint-config': patch
---

`setAutoloader` and `connectInserts` are gone; one way to install a module

Every module now hands `wire` a descriptor, and the registry package no longer knows about any
particular consumer.

**`setAutoloader(fn)` → `wire(instance)`, and `initAutoloader` is now `autoloader`.** The instance is
also its own descriptor, so configuring and installing are one call, and the name matches every
other module you hand `wire`:

```js
- import { setAutoloader } from '@verajs/core';
- import { initAutoloader } from '@verajs/autoloader';
- setAutoloader(initAutoloader(import.meta.url, 'components'));
+ import { wire } from '@verajs/core';
+ import { autoloader } from '@verajs/autoloader';
+ wire([domRender, router, autoloader(import.meta.url, 'components')]);
```

`wire` now tests for a descriptor — anything naming an insert point — *before* the connector case, so
a module can be both a function and a descriptor. Without that order such a module is called as a
connector and silently never registers.

**`connectRouter` is now `router`.** `wire` is the verb, so what you hand it is named for the thing,
not the act — and whether a given module is a descriptor or a connector is an implementation detail
an app should not have to read off a name:

```js
- wire([connectRouter]);
+ wire([domRender, router, collections, autoloader(import.meta.url, 'components')]);
```

`domRender` deliberately keeps its name: `@verajs/renderer` also exports `render` for direct use, and
`render`/`renderer` one character apart in a single import line is worse than the inconsistency.

**`connectInserts` is removed.** It replayed one registry's chains into another; nothing needs that
now that every module takes the registry it writes to (`router` for the router, `wire` from
core for everything else). Two copies of `@verajs/inserts` in one page is a mistake with no repair
function, rather than a supported arrangement.

**`@verajs/eslint-config` restricts `wire`, not `insert`.** The rule named an import that stopped
existing at the 0.2.0 rename, so the production-silent registry mistake it exists to catch had been
unguarded since.
