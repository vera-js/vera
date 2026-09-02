# @verajs/hooks

Headless behavior for VeraJS components — the hard parts of a widget (keyboard models, dismissal,
ARIA wiring, selection) with no markup and no styles. `@verajs/ui` is built on this layer; anyone
building their own component gets the same contracts without re-deriving them.

> **Private while the API settles.** Names exported here are API for life, so the surface stays
> deliberately small: `useDismiss` and `useSelect`. Internal helpers graduate only when a second
> consumer proves their shape.

```js
import { useDismiss, useSelect } from '@verajs/hooks';
```

- **`useDismiss(element, onDismiss)`** — outside-press and Escape dismissal. Installed only while
  activated; recognizes the element's own subtree through `composedPath()` (correct across shadow
  boundaries); releases its document listeners on unmount through core's cleanup contract.
- **`useSelect(element, config)`** — the select behavior: options, filtering, single/multi
  selection, the keyboard walk (disabled rows skipped, wrapping), open/close with dismissal, and
  imperative wiring for user-supplied markup (`attach`). State is a `createStore` store, so a host
  template that reads it re-renders on exactly what it read.

`@verajs/core` stays external in every build — a controller's stores must live in the same core
the app renders with. On a CDN page the importmap resolves it; under a bundler the dependency
dedupes.
