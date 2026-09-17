# @verajs/styles

## 0.1.1

### Patch Changes

- 57ab91d: Ten public APIs now name the mistake instead of leaking an internal
  
  The second audit sweep took passes 22 and 80's lens again — wrong-typed input to every public
  function — but **mechanically** this time: every export of all thirteen entry points, crossed with
  seven wrong values, filtered for errors that name an internal rather than the call. The hand-picked
  passes had found three defects; enumerating found six more.
  
  **The worst was silent.** `html('<p>hi</p>')` — the call form rather than the tagged form, which is
  how the same job is done in libraries that take a markup string — returned a template-shaped object
  with a *string* where the strings array belongs. It passed every shape check and failed much later
  inside the renderer with `Invalid value used as weak map key`, because the template cache is keyed by
  the strings array and a string is not a legal key. Nothing in that message mentions `html`. `svg` and
  `mathml` did the same; `css` threw `strings.reduce is not a function`.
  
  Also guarded: `untrack(state.a)` instead of `untrack(() => state.a)` — which reads the property
  *before* untrack is entered, so it is tracked after all, the opposite of what was asked — plus
  `renderInto` with no container, `keyed` with no template, `tag('h1')` called instead of tagged,
  `navigate(undefined)` (an async throw, so it surfaced as an unhandled rejection naming nothing), and
  both `@verajs/styles` entries.
  
  The template-literal check is `Array.isArray` and deliberately **not** `raw`: a hand-built
  `html([markup])` works and `ssr-scale.test.mjs` builds a hundred nested components that way. That
  shape does churn template identity, which is the render profiler's business to report rather than
  this guard's to forbid. The defect fixed here is the silent one.
  
  All `__DEV__`-only, so production carries none of it.
- 4ad3d73: `init(element, { mode: 'closed' })` works.
  
  `init` called `attachShadow` and discarded what it returned, and everything downstream read
  `element.shadowRoot` — which is `null` for a closed root, by definition. So a closed component
  rendered its content into the **light DOM**, never adopted its styles, and left an empty unreachable
  shadow root behind. Measured with no SSR involved: `mode: 'closed'` put `<p>content</p>` in the light
  DOM while `mode: 'open'` put it in the shadow root.
  
  The root is kept on the element as `_root` — a cross-boundary contract like `_hooks`, read by the
  `'render'` insert and by `@verajs/styles`, and never mangled. A second `init` on a closed element is
  guarded, which `shadowRoot` alone could not do.
  
  `tests/browser/shadow-modes.test.js` covers every mode as a matrix rather than testing the one bug:
  content lands in the root, styles adopt into it and actually apply, and nothing leaks to the light
  DOM. Light DOM is asserted to create no root at all.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- 0af7dc4: An element ref is told when its element goes away, and styles hoist once across copies
  
  **Refs are released.** A ref was told about attachment and never about detachment, so it kept a
  detached node alive and a component reading `myRef.value` after a subtree was replaced got the old
  element back. A function ref is now called with `null` and an object ref has `.value` set to `null`,
  which is also the hook an exit animation needs.
  
  The cost had to land only on templates that contain one. `_clear`'s bulk removal is what makes
  emptying a 1 000-row table ~5 ms against lit-html's ~22 ms, and walking parts on every removal is
  exactly the per-node work it exists to skip — so the scan records whether a template holds a `&` part
  and the walk is gated on that. Measured: `clear 1k` unchanged, +86 B gzipped.
  
  A **self-applying** value (`_$apply$`, which is how `@verajs/renderer/spread` ships) is deliberately
  not released: it receives the part and owns its own lifecycle, so writing through it here would be a
  second protocol contradicting the first.
  
  **Light-DOM styles hoist once per class however many copies of `@verajs/styles` are loaded.** A
  production `.min.js` inlines its dependencies, so two copies on a page each had their own
  "already hoisted" set and neither saw the other's: the same rules reached the document twice and the
  browser parsed and applied them twice for the life of the page. The mark now lives on the component
  class — the one object both copies can see — under a name exempt from property mangling. +20 B.
- c248b36: Escape `</style>` in CSS text before it reaches a `<style>` element. **Security fix.**
  
  `css` is a plain concatenation and escapes nothing, deliberately — the constructed-stylesheet path
  must receive exactly the CSS the author wrote. `@verajs/ssr` then wrapped that text in
  `<style>…</style>`, and `<style>` is a raw-text element: the HTML tokenizer scans it for one thing,
  its end tag. A value interpolated into `css` and carrying `</style>` closed the element, and
  everything after it parsed as markup. Verified against a real parser: it built an `<img>` with a
  live `onerror`. Reachable wherever an application themes from a value it does not fully control.
  
  The client was never directly exploitable — fragment parsing into a `<style>` creates no nodes,
  confirmed in Chromium, Firefox and WebKit — but it produced a DOM whose *serialization* was
  poisoned, which is one round trip away from the same result.
  
  Fixed at the sinks rather than in `css`: `@verajs/ssr` when it writes a `<style>` and when it hands
  back hoisted light-DOM styles for the caller to place, and `@verajs/styles` before assigning to a
  `<style>` element, which now uses `textContent` rather than `innerHTML` since the content is text
  and nothing there should ever be parsed. Escaping in `css` itself would corrupt the constructed
  stylesheet, which is exactly the double-escaping principle #8 warns against, and could not see a
  sequence assembled across several interpolations.
  
  `escapeHtml` is the wrong tool here and would break every stylesheet, because `>` is a child
  combinator. Only the end-tag sequence is rewritten, to `<\/style` — valid CSS that renders
  identically, asserted against `getComputedStyle` in all three engines. Selectors, media queries,
  `url()` and ordinary declarations are untouched.
  
  Costs `@verajs/styles` 29 B gzipped.
- e3a0a4d: `static styles = [base, isDark && darkSheet]` no longer crashes the component.
  
  That idiom produces `[sheet, false]`, and it broke both of `applyStyles`' paths, differently, and
  neither of them legibly. In the shadow DOM `escapeStyleText(false)` threw `value.replace is not a
  function` out of `connectedCallback`, from a file the author has never opened, taking the component
  with it. In the light DOM nothing threw at all: `false.cssText` is `undefined`, so the literal text
  `undefined` was joined into the stylesheet and hoisted to the document. A ternary yielding `null`
  threw a third message one step earlier.
  
  A falsy entry now means "no styles here", which is what the top of `applyStyles` already reads a
  falsy `styles` argument to mean — the same rule applied to the members of an array. CSS that is
  genuinely not CSS is refused by name in development, as `adoptStyles` and the element argument
  already were.
  
  Separately, `wire` no longer warns that "the second replaced the first" when the second **is** the
  first. An app whose entry points share a wiring module wires `styles` from each of them; the callback
  was identical, nothing was replaced, and the advice it gave — use different priorities — would have
  made it run twice. It fired in this repo's own kitchen-sink example, which is the reference
  application, and a warning the reference app trips on is one people learn to scroll past. Two
  *different* modules claiming one priority still warn, which is the failure it exists for.
- d73b937: `@verajs/styles` exports a `styles` module, so it wires like every other package:
  
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
- eb4fa7a: Hoist a subclass's light-DOM `static styles` instead of skipping them.
  
  Hoisting is deduplicated with a flag on the component class — `if (owner[HOISTED]) return`. But
  `class Child extends Base` makes `Base` the prototype of `Child`, so that read finds the flag the base
  already set and returns. The subclass's `static styles` were never hoisted at all: the component
  rendered unstyled, with nothing logged.
  
  It was order-dependent, which is what made it survivable. Inheritance only looks upward, so mounting
  the child first hoisted both — the child set its own flag and the base still had none of its own. Only
  base-before-child failed, so a page could style correctly in development and not in production,
  decided by which instance rendered first.
  
  The flag is now read as an own property. That also fixes a subclass which declares no styles of its
  own: it inherits the base's CSS, but its tag is different, so the base's `@scope (base-tag)` block
  never matched it. It now hoists its own scoped copy.
  
  Deduplication is unchanged otherwise — still once per class, however many instances.

## 0.1.0

### Minor Changes

- Initial release. `static styles` adoption for VeraJS components — constructed stylesheets into
  shadow roots, `@scope`-wrapped hoisting for light DOM — extracted from `@verajs/core`.
  
  ```js
  import { insert } from '@verajs/core';
  import { adoptStyles } from '@verajs/styles';
  insert('init', adoptStyles, 50);
  ```
  
  `minor` rather than `patch` because this package is at `0.0.0`: a patch would produce `0.0.1`,
  where minor produces `0.1.0` and sits with the rest of the family. The 0.x rule that minor signals
  a breaking change is about protecting existing consumers, and a package with no prior version has
  none.
