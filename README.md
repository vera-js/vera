# VeraJS

A tiny, modular reactive framework built on native web components — intended to replace React and
heavier libraries on most builds.

No virtual DOM. No framework runtime shipped to the client. No runtime dependencies.

| Module | Standalone | gzipped |
| --- | ---: | ---: |
| `@verajs/core` | 4.1 KB | **1.94 KB** |
| `@verajs/renderer` | 7.4 KB | 3.00 KB |
| `@verajs/router` | 5.0 KB | 2.41 KB |
| `@verajs/autoloader` | 737 B | 488 B |
| `@verajs/map-support` | 527 B | 384 B |
| `@verajs/inserts` | 794 B | 530 B |

A typical app — core plus a renderer — is **about 3.6 KB gzipped**. For comparison, `react` +
`react-dom` is roughly 45 KB gzipped.

`@verajs/core` on its own cannot render; it ships no renderer. 3.6 KB is the number that matters.

> **Status: pre-release, under active overhaul.** Nothing is published to npm yet. The structure and
> tooling are being reworked, after which the project gets an honest viability evaluation.

---

## The idea

`@verajs/core` covers most of what people actually need. Everything else is an opt-in module, and the
module system is open — use the prebuilt ones or write your own.

**At minimum you need a renderer.** Everything else is your choice.

```
@verajs/core          reactive state, hooks, lifecycle, rendering
@verajs/renderer      keyed template renderer; beats lit-html across the board  (or bring your own)
@verajs/router        tiny router with nested routes, wildcards, params
@verajs/autoloader    lazy-loads custom elements on discovery
@verajs/map-support   reactive Map and Set
@verajs/ssr           server-side rendering (Node only)
```

The modules are **genuinely independent** — the router and autoloader do not require core, and can be
used on their own or with another framework entirely.

---

## Quick start

### CDN — no build step

```html
<script type="importmap">
  {
    "imports": {
      "@verajs/core": "https://cdn.jsdelivr.net/npm/@verajs/core/dist/vera.min.js",
      "lit-html": "https://cdn.jsdelivr.net/npm/lit-html@3/lit-html.js"
    }
  }
</script>

<script type="module">
  import { init, createStore, render, setHtml } from '@verajs/core';
  import { html } from 'lit-html';

  setHtml(html);

  customElements.define(
    'click-counter',
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        const state = createStore({ count: 0 });

        render(() => html`
          <button @click=${() => state.count++}>Clicked ${state.count} times</button>
        `);
      }
    }
  );
</script>

<click-counter></click-counter>
```

### npm + TypeScript

```bash
npm install @verajs/core lit-html
```

```ts
import { init, createStore, render, useEffect, setHtml } from '@verajs/core';
import { html } from 'lit-html';

setHtml(html);

class ClickCounter extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ count: 0 });

    useEffect(() => {
      console.log('count is now', state.count);
    });

    render(() => html`
      <button @click=${() => state.count++}>Clicked ${state.count} times</button>
    `);
  }
}

customElements.define('click-counter', ClickCounter);
```

Reactivity is transparent — read `state.count` inside `render` or `useEffect` and that effect
re-runs when it changes. There is no dependency array to maintain.

---

## Using more than one module from a CDN

Standalone bundles inline their dependencies, so loading two of them produces two separate internal
registries. Reconcile them with `connectInserts` — this is expected, and it is the price of the
modules being genuinely independent:

```js
import { inserts, setRenderer, setAutoloader } from '@verajs/core';
import { connectInserts } from '@verajs/router';
import { initAutoloader } from '@verajs/autoloader';

connectInserts(inserts); // point the router at core's registry

setAutoloader(initAutoloader(import.meta.url, 'components'));
```

This is unnecessary when using a bundler, where every module resolves to a single shared instance.

---

## Repo layout

```
packages/          the framework modules; each independently versioned
examples/          hand-run playgrounds, one per consumption mode
tests/             self-running tests
bench/             performance harness
docs/              feature docs and architecture
```

## Development

```bash
npm install
npm run build      # wireit -> rollup, all packages
npm run dev        # vite dev server for the examples
npm run dev:cdn    # plain static server for the buildless example
npm run dev:ssr    # SSR example

node bench/reactivity.mjs --compare bench/baseline.json
```

Build outputs, per package:

```
dist/development/<name>.js      unminified, workspace deps external  (npm, bundlers)
dist/development/<name>.d.ts    types
dist/<name>.min.js              minified, fully standalone           (CDN, <script>)
```

`dist/` is gitignored — bundles are never committed.

## Documentation

- [`docs/features/`](docs/features/) — the differentiators, each with evidence and caveats
- [`CLAUDE.md`](CLAUDE.md) — project parameters and conventions
- [`docs/CODE-PRINCIPLES.md`](docs/CODE-PRINCIPLES.md) — the bar every change must clear
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the render pipeline and insert system
- [`docs/RELEASING.md`](docs/RELEASING.md) — how a change becomes a published version
- [`packages/ssr/README.md`](packages/ssr/README.md) — the three SSR strategies

## License

MIT
