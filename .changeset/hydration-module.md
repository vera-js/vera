---
'@verajs/renderer': minor
---

Hydration is a module wired beside the renderer; the `@verajs/renderer/hydrate` entry is retired

**Breaking for apps that hydrate.** `@verajs/renderer/hydrate` — a second renderer whose first render adopted server
markup — is gone. Hydration is now `hydration`, from `@verajs/renderer/hydration`, wired beside the one renderer:

```js
import { renderer } from '@verajs/renderer';
import { hydration } from '@verajs/renderer/hydration';
wire([renderer, hydration]);
```

On a CDN page, load `vera-renderer-hydration.min.js` beside `vera-renderer.min.js` and wire both; the import-map
swap to `vera-renderer-hydrate.min.js` no longer exists. Adoption is unchanged in what it promises — node identity
kept, attributes read and written only on a difference, form state left as the user left it, a mismatch rebuilding
one container and warning once — and an app that never hydrates loads none of it. `hydration` and
`@verajs/renderer/hydrate-slots` are Node-safe to import, unlike the retired entry.

**A container holding nothing but its SSR stylesheets is rendered, not hydrated.** `styles` writes a
`<style data-vm-sheet>` into a client-made shadow root whenever it cannot adopt a sheet — string `static styles` in
every engine — and the retired entry took that for server output and warned a mismatch on a page no server rendered.
