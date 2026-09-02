# `@verajs/motion/path`

Follow an SVG path — `path`, with `path-selector` naming the `<path>` to follow and `path-rotate`
choosing the orientation.

A separate module because most pages animate geometry and never follow a path, and because the
selector resolution, `d` validation and `offset-path` bookkeeping are the only part of the library
that reads one element's attribute to go find *another* element.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { path } from '@verajs/motion/path';

wireMotion(path);
createMotion().init();
```

Attributes are in the [attribute reference](../ATTRIBUTE-REFERENCE.md#svgpath).

## How it works

`path` animates `offset-distance` — an ordinary numeric percentage the runtime interpolates and
`inertia`'s transition damps like anything else. There is no per-frame `getPointAtLength()`; the
compositor does the following. What makes the distance travel *along* something is `offset-path`,
which this module resolves **once**, before the runtime collects the root: it finds the `<path>`
named by `path-selector`, validates its `d`, and writes `offset-path: path("…")` on the element.

```html
<svg viewBox="0 0 400 100" aria-hidden="true">
  <path id="curve" d="M 10 80 C 120 10, 280 10, 390 80" fill="none" />
</svg>

<div
  data-vera-motion
  data-vera-motion-path="0% 0, 100% 100"
  data-vera-motion-path-selector="#curve"
  data-vera-motion-path-rotate="auto"
></div>
```

The selector resolves against the element's **own root** — a path inside the same shadow root is
found, and one outside it is not, because `getRootNode()` is where the search starts.

`path-rotate` takes `auto` (turn to follow the tangent), `reverse`, or the default `0deg`, which
keeps the element upright.

## What it refuses, and where that lands

Everything lands in `instance.rejected`, like every other refusal — the console line is a courtesy
copy.

- **`path` without `path-selector`** does nothing at all — `offset-distance` with no `offset-path`
  travels along nothing — so it is reported instead of being silently inert.
- **A selector that is not one selector** (a list, or something `querySelector` refuses) is refused
  at parse time, by the same validator core uses for `when`.
- **A selector that matches nothing, an element with no `d`, or a `d` the sanitiser will not pass**
  are each named — they are fixed differently, and a reason that misdirects is worse than silence.

The `d` validation restricts the alphabet to what path data can legally contain, because the value
ends up inside a quoted CSS function; `CSS.supports` is then asked whether the engine would take
the declaration, which catches shapes that are alphabetically clean and still not a path.

## Teardown

The module remembers what `offset-path` and `offset-rotate` were before it wrote them, and puts
them back when the element leaves or the instance is destroyed — the same contract every style the
runtime touches has.
