# Buildless

## The claim

**VeraJS runs with no toolchain at all.** Paste it into CodePen, open an HTML file from disk, drop
it in a `<script type="module">`. A build is something you opt into for minification, Tailwind or
TypeScript — never a prerequisite.

## Why it is credible

This is not a convenience feature bolted on; it is a **hard constraint on the design** that rules
things out:

- **No JSX.** It cannot run in a browser uncompiled. Templates are tagged template literals, which
  are native.
- **No decorators**, and no TypeScript-only runtime syntax (`enum`, parameter properties).
- **Browser-ready ESM output** — no `process.env`, no `require`, no import rewriting.

Verified against the shipped bundles: zero bundler artifacts, zero bare imports.

## What it looks like

```html
<script type="importmap">
  { "imports": {
      "@verajs/core":     "https://cdn.jsdelivr.net/npm/@verajs/core/dist/vera.min.js",
      "@verajs/renderer": "https://cdn.jsdelivr.net/npm/@verajs/renderer/dist/vera-renderer.min.js" } }
</script>

<script type="module">
  import { init, createStore, render, html, wire } from '@verajs/core';
  import { renderer } from '@verajs/renderer';
  wire([renderer]);

  customElements.define('click-counter', class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ count: 0 });
      render(() => html`<button @click=${() => state.count++}>${state.count}</button>`);
    }
  });
</script>

<click-counter></click-counter>
```

That is the entire program. No `npm install`, no bundler, no config file.

## Against the field

| | Usable with no build step |
| --- | --- |
| **VeraJS** | **yes, fully** |
| Van.js | yes |
| Lit | yes (without decorators) |
| Preact + signals | yes (without JSX) |
| Vue | yes (runtime build, no SFCs) |
| Solid | **no** — requires its compiler |
| React | in principle, but nobody does; JSX is the idiom |

So buildless alone is not unique. **What is unusual is buildless + web components + fine-grained
reactivity together** — Lit is buildless and web-component-native but makes you declare reactive
properties; Solid has the reactivity but needs a compiler.

## Tailwind

Buildless Tailwind means the CDN JIT build, which **collides with Shadow DOM**: Tailwind emits
global stylesheet rules and a shadow root blocks them by design.

Both escape hatches already exist — `adoptStyles` from `@verajs/styles` (`adoptedStyleSheets`), or
light-DOM rendering via `init(element)` with no shadow options. Any example using Tailwind must pick one
explicitly and say which. "Works in the light DOM and silently does not in the shadow DOM" is a trap.

## Caveat

Bare specifiers need an importmap to resolve without a bundler, so any documented CDN usage has to
show the importmap. That is a real papercut, not a dealbreaker — importmaps are supported across
all current browsers.
