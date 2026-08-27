---
'@verajs/styles': patch
'@verajs/core': patch
---

`@verajs/styles` exports a `styles` module, so it wires like every other package:

```js
wire([renderer, styles]);
```

Previously this package alone made an app entry hand-write `{ on: 'init', fn: adoptStyles, priority:
50 }` — knowing which insert point style adoption belongs to, and that 50 is the number, in order to
use a package whose whole job is one registration. `renderer`, `router`, `autoloader` and
`collections` all export a module; `styles` was the exception.

`adoptStyles` is unchanged and still exported: the longhand is what to write for a non-default
priority. It is now marked so that `wire([adoptStyles])` — a bare function, which `wire` would
otherwise treat as a connector and silently register nothing — throws and names `styles` instead, the
same way `render` names `renderer`.

Costs 40 B gzipped in `@verajs/styles`. Core's "nothing is adopting them" warning now prints the
short form.
