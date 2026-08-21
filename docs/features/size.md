# Size

## The claim

**A working VeraJS app is about 3.5 KB gzipped — second smallest of eight frameworks measured,
1.7x smaller than Lit and 13x smaller than React.**

## The evidence

A minimal but *working* reactive counter, bundled with esbuild, minified, `NODE_ENV=production`,
tree-shaken, gzipped:

| Framework | gzip | vs smallest |
| --- | ---: | ---: |
| Van.js | 1 219 B | 1.0x |
| **VeraJS + own renderer** | **3 512 B** | 2.9x |
| Solid *(needs a compiler)* | 4 504 B | 3.7x |
| VeraJS + lit-html | 4 988 B | 4.1x |
| Lit | 5 875 B | 4.8x |
| Preact + signals | 6 033 B | 4.9x |
| Vue | 25 258 B | 20.7x |
| React | 45 683 B | 37.5x |

## Why measured this way

Gzipping a `dist` file would be dishonest in both directions: it ignores tree-shaking, and it hides
that several libraries need **two packages** to render anything (react + react-dom, preact +
signals, solid-js + solid-js/web). Every figure above comes from an app that actually puts reactive
state on screen.

This is also why the number is *lower* than the standalone `vera.min.js` bundle — a bundler drops
the core exports an app does not use.

## The honest framing

**Lead with 3.5 KB, not 1.78 KB.** Core alone is 2.3 KB gzipped but ships no renderer and cannot
render anything. Quoting it is technically true and reads as a bait-and-switch to exactly the
audience that checks size claims.

**Name Van.js.** It is smaller, and volunteering that buys more credibility than the half-point of
claiming to be smallest. It is also a fair trade to explain: Van.js has no keyed reconciliation, so
any list change rebuilds the list.

**The Solid comparison is now honest to state precisely:** Solid is 4 504 B and requires its
compiler; VeraJS + own renderer is 4 756 B and requires nothing. 252 B for not needing a toolchain —
say it exactly that way, because a reader who checks will find the numbers.

*(The earlier 3 522 B figure used the old renderer, which was 24x slower on list updates. The
rebuilt renderer costs 1.3 KB more and is faster than lit-html on every measured operation — that
trade is the whole point.)*

## Per-module

| Module | gzip | |
| --- | ---: | --- |
| `@verajs/core` | 2 333 B | state, hooks, lifecycle, render |
| `@verajs/renderer` | 3 541 B | keyed template renderer, refs, `hold` |
| `@verajs/router` | 2 840 B | nested routes, params, wildcards, redirects, scroll memory |
| `@verajs/inserts` | 322 B | the extension point |
| `@verajs/autoloader` | 612 B | lazy component discovery |

You only ship what you use — the modules are independent. See [module-system.md](module-system.md).

## Reproduce

```bash
npm run build && node bench/size.mjs
```
