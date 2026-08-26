# @verajs/renderer

The DOM renderer for VeraJS — <!--size:renderer.gzip-->3.63 KB<!--/size:renderer.gzip--> gzipped,
no dependencies, no build step required.

Tagged templates parse once and clone; every render after the first walks only the value slots, so
updates touch the DOM and nothing else. Lists are keyed by value, not by directive. Server-rendered
pages hydrate through a separate entry that non-SSR apps never download.

```sh
npm i @verajs/core @verajs/renderer
```

## Quick start

`wire(renderer)` is the only wiring. Core's `html` tag already produces the shape this accepts, so
there is no second call to make.

<!-- recipe -->
```js
import { init, createStore, render, wire, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

customElements.define(
  'click-counter',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ count: 0 });
      render(() => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`);
    }
  }
);

document.body.append(document.createElement('click-counter'));
```

Without it, core has no renderer at all: `render()` warns once in development and puts
nothing on the page. `@event`, `.prop` and `?bool` bindings are the first things to go missing.

## Bindings

| Written | Means |
| --- | --- |
| `<p>${value}</p>` | child content — see [Values](#values) |
| `<p title=${value}>` | attribute. `null`/`undefined` **remove** it |
| `<p class="a ${b} ${c}">` | attribute built from several expressions and the static text between them |
| `<x-item .item=${value}>` | property assignment, uncoerced — objects, arrays, functions |
| `<p ?hidden=${value}>` | boolean attribute, present when truthy |
| `<input !checked=${value}>` | property written from the **live DOM** rather than from what the binding last wrote — see below |
| `<button @click=${fn}>` | event listener |
| `<button onClick=${fn}>` | the same thing, React-style. Strictly `on` + a capital — `onclick` stays a plain attribute |
| `<input ${fn}>` | element ref: a function is called with the element |
| `<input ${obj}>` | element ref: an object gets the element assigned to `.value`, so core's `ref()` works here |
| `<input ${spread(props)}>` | names resolved at runtime — see [`/spread`](#verajsrendererspread) |

A ref runs once per **distinct value**, not once per render.

### `!name` — a live property

Every other binding skips a write when the value matches what it last wrote. That is what keeps a
field someone has typed into, and it is exactly wrong for a control whose DOM state changes as a
**side effect of interacting with a sibling**:

```js
html`<input type="radio" name="pick" !checked=${state.picked === 'one'} />
     <input type="radio" name="pick" !checked=${state.picked === 'two'} />`
```

Clicking the second radio unchecks the first *in the DOM*, with no event on it. With `.checked` the
first binding still says `true`, still matches what it committed, and never writes again — the model
and the page diverge and no amount of re-rendering reconciles them. A `<select>`'s options are the
same shape.

It is deliberately narrow, and it is a **property** binding only:

- **Not for text inputs.** Bind those with `.value` and let a person's typing stand. `!value` exists
  and is authoritative, which is precisely why it is not the default.
- **Not offered for attributes or booleans.** Nothing changes those behind the renderer's back, so
  there is nothing to re-read.
- **It yields during hydration.** A click that happened before the bundle landed had no handler to
  report it, so adoption records the value without writing; live semantics resume on the first
  state-driven render.

`spread({ '!checked': … })` means the same thing, and `@verajs/ssr` serializes it exactly as
`.checked` — a server has nothing to re-read.

Bindings inside comments are not supported — the value is consumed and ignored. A **dynamic tag
name** is a binding a template cannot express either, and has its own entry:
[`/tag`](#verajsrenderertag).

## Values

What a child position does with each kind of value. These match lit-html exactly, `null` and
`undefined` included.

| Value | Renders |
| --- | --- |
| string, number, `true`, `false`, `0` | as text — `${cond && 'x'}` puts the word `false` on the page |
| `null`, `undefined` | nothing |
| a template result | the template, updated in place while its shape holds |
| an array or iterable | each entry in order; key them with `keyed()` |
| a DOM node or fragment | itself, moved into place |
| anything else | `String(value)` |

Strings render as **text**, always. There is no path by which an interpolated value becomes markup
— see [Trusted HTML](#trusted-html-and-why-there-is-no-unsafehtml).

A DOM node renders as itself, which is how a template holds something another library owns:

```js
const chart = document.createElement('canvas');
new Chart(chart, config);

render(html`<figure>${chart}<figcaption>${title}</figcaption></figure>`, host);
```

## Lists — `keyed()`

```js
import { render } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';

render(html`<ul>${rows.map((row) => keyed(row.id, html`<li>${row.label}</li>`))}</ul>`, host);
```

`keyed(key, result)` tags a result with its identity, so a reorder **moves** the existing elements
instead of rebuilding them — focus, scroll position, form state and running animations all survive.
It is its own entry because most apps never reorder a list, and the algorithm that makes reordering
cheap is 365 B gzipped they would otherwise carry. Importing `keyed` is the whole installation:
nothing registers, and there is no `wire()` call — the marker stamps each result with the strategy
that understands it, so a list always names its own reconciler and two strategies cannot disagree
about one. Lit splits `repeat` out for the same reason; the difference is that this one arrives on
the values rather than through a directive protocol.

**Keep it on the same version as `@verajs/renderer`.** It reaches the renderer through a handful of
two-character members that are exempt from property mangling, and nothing checks that both sides
agree about them — a `keyed` bundle paired with a different renderer release fails at runtime rather
than at install. Both ship from this package and bump together, so a single version range covers it;
the trap is pinning one and floating the other. `@verajs/renderer/spread` carries the same rule for
the same reason.

**It is additive, not a substitute.** Unlike `/hydrate` and `/profiler`, this entry imports nothing
at all — it reaches whatever renderer is present through a handful of mangling-exempt members — so
it is safe alongside any of them, `/hydrate` included.

**A list is keyed because `keyed()` marked it, not because its results have a `key` property.**
Setting `.key` by hand no longer makes a list keyed — the marker is what carries the algorithm, so
it is what the renderer looks for, on the client and when adopting server markup alike.

**Key every item in a list, or none of them.** A list is keyed when its first item is, and an
unkeyed item in a keyed list has no identity to match on.

An unkeyed list is not wrong — it updates each position in place, which is exactly right for a list
whose order never changes.

## Preserving DOM — `hold()`

```js
render(html`<div>${hold(editing ? editor(state) : viewer(state))}</div>`, host);
```

`hold(result)` parks the DOM it replaces instead of destroying it, keyed by template identity, and
brings it back when that template returns. lit calls this `cache`. What survives is everything no
attribute records: what the user typed, which element had focus, a scroll offset, a `<details>` left
open, a media element's playback position.

Anything that is not a template passes straight through — there is nothing to park for a string, a list, `null` or `false` — so `hold(editing && editor())` is safe to write.

It only re-adopts a template it has seen at **that same call site** — two `hold()` calls in
different templates are two different templates, and neither adopts the other's DOM.

**It keeps every shape it has parked, for as long as the part lives.** That is the point — a tab
strip of twelve panels holds twelve, and each comes back exactly as it was left — but it is a cache
with no eviction, so `hold` over an unbounded set of templates retains an unbounded amount of DOM.
Verified: fifty distinct shapes cycled through one `hold` and the first still re-adopted its own
nodes. lit's `cache()` behaves the same way, and for the same reason — evicting would silently throw
away the state the directive exists to preserve, which is worse than holding it. Use `hold` for a
set you can name, and let an unbounded one rebuild.

## Write stable shapes

Rendering the same elements every pass and toggling `hidden` is faster than swapping one subtree for
another. Template identity holds, so values update in place rather than the subtree being torn down
and rebuilt. Both forms are correct; this one is cheaper.

```js
// fragile — two sibling parts, each swapping between a template and ''
html`<section>
  ${items.length === 0 ? html`<p>empty</p>` : html`<ul>${rows}</ul>`}
  ${busy ? html`<p>loading</p>` : ''}
</section>`;

// preferred — one shape, visibility toggled
html`<section>
  <p ?hidden=${items.length > 0}>empty</p>
  <ul ?hidden=${items.length === 0}>${rows}</ul>
  <p ?hidden=${!busy}>loading</p>
</section>`;
```

[`/profiler`](#verajsrendererprofiler) exists to make the difference visible: it counts templates
committed in place against templates that replaced a different template.

## Entries

| Import | What it adds | Ships in production |
| --- | --- | --- |
| `@verajs/renderer` | the renderer | yes |
| `@verajs/renderer/hydrate` | a superset whose first render adopts server-rendered DOM | yes |
| `@verajs/renderer/keyed` | `keyed(key, result)` — keyed list reconciliation | yes |
| `@verajs/renderer/spread` | `spread(props)` — binding names resolved at runtime | yes |
| `@verajs/renderer/profiler` | a superset that measures template churn | no — development only |

`/hydrate` and `/profiler` each re-export the whole public API, so they are drop-in replacements for
the base import. **Never mix two of them in one app** — that loads two renderers with two template
caches.

## `@verajs/renderer/hydrate`

<!-- recipe -->
```js
import { render } from '@verajs/renderer/hydrate';   // instead of '@verajs/renderer'
```

The first render into a container that already has children **adopts** them as server output of the
same template: node identity is preserved, listeners attach, and updates mutate the adopted nodes.
Hydration here is **markerless** — server HTML carries no framework comments, and the client repairs
its own anchors into the adopted DOM.

Any disagreement with the server markup clears the container (keeping `<style vera-styles>` tags)
and renders fresh, so correctness never depends on the server output being right. A DOM node at a
child position is the one thing the server cannot have rendered; it is inserted without giving up
adoption of everything around it.

**A fallback warns in development, naming the first place the two renders disagreed** — *"expected
`<p>` and found `<div>`"*, *"`<ul>` contains `<li>`, which the template does not describe"*. The page
is correct either way, which is the point of the fallback and also why it needs saying: the server's
markup was just thrown away, and with nothing observable to notice, the only symptom is a first
paint that is slower than the one you paid a server render for. An attribute that disagrees is
simply re-set during adoption and is not a fallback at all.

On a CDN page, point the import map's `@verajs/renderer` at `vera-renderer-hydrate.min.js` and
nothing else changes. Apps that never hydrate download none of this.

## `@verajs/renderer/spread`

Spread a props object onto an element, with names resolved at runtime.

<!-- recipe -->
```js
import { init, createStore, render, wire, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { spread } from '@verajs/renderer/spread';

wire([renderer]);

customElements.define(
  'x-field',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ disabled: false });
      const props = {
        id: 'email',                                  // attribute
        placeholder: 'you@example.com',               //   "
        '.value': '',                                 // property
        '?disabled': state.disabled,                  // boolean attribute
        onInput: (e) => console.log(e.target.value),  // event — @input works too
      };
      render(() => html`<input ${spread(props)} />`);
    }
  }
);

document.body.append(document.createElement('x-field'));
```

Keys carry the same sigils as written bindings, so a spread key and a written binding mean the same
thing — `.value`, `?disabled`, `@click`, `onClick`, and `&ref` for an element ref.

**A key that cannot be written into markup is skipped**, with a warning in development. That is any
name holding whitespace, a quote, `<`, `>`, `/`, `=`, a backtick or a control character. Engines are
more permissive than markup — measured across Chromium, Firefox and WebKit, `setAttribute` accepts
`"`, `'` and `<` — but a name that binds in the browser and cannot survive server rendering is worse
than one that works nowhere, so both sides apply the same rule. Skipped rather than thrown: the keys
are runtime data, and one bad name in a props bag should not cost the render.

Several spreads on one element are supported — each element position owns its own keys, so
`<div ${spread(a)} ${spread(b)}>` works and neither releases the other's bindings.

Keys are strings carrying sigils, so TypeScript cannot check them against the element's attributes.
That is a genuine step down from written bindings, and the trade for names that are not known until
runtime.

### Removing a key

A key that disappears between renders **restores what the element held before the binding existed**.

```js
render(html`<input type="text" ${spread({ type: 'number' })} />`, host);  // type="number"
render(html`<input type="text" ${spread({})} />`, host);                  // type="text" again
```

Not removed — *restored*. The usual framing, "what value means absent", has no answer for a
property: `delete` cannot remove a prototype accessor, and assigning `undefined` puts the literal
string `"undefined"` into a form field. Asked as "undo what this binding did" it is well defined for
every kind, because it reads the element's own pristine state — `""` for `input.value`, `undefined`
for a custom element's property.

**On a hydrated page it restores the server's value**, because that is genuinely what was there
before the binding: the server rendered this same spread, and a spread key *replaces* a static
attribute in server markup exactly as it overwrites one on the client. The original is gone by
construction, so bind `null` when you mean removal:

```js
render(html`<input ${spread({ id: null })} />`, host);   // removes, on either path
```

One residue worth knowing: `.value`, `.checked` and `.selected` are mirrored to attributes
server-side so hydration can read them back, and releasing the property does not clear that
attribute. The property is correct either way; the attribute lingers as the field's *default* value.

A released event binding stops dispatching; the listener itself stays registered, which is how
written `@event` bindings behave too.

### What it costs, and why it is a separate entry

`@verajs/renderer` grows **8 B** gzipped for the protocol this uses, whether or not you import it.
The entry itself is **<!--size:spread.gzip-->842 B<!--/size:spread.gzip-->** gzipped, and only apps
that import it pay for that.

Runtime is at parity with writing the bindings out: both do one comparison per binding per render,
and the spread does one part-dispatch where five written bindings do five.

Template renderers bake attribute names into the template at parse time. That is what makes them
small and fast, and it is why neither this renderer nor lit-html has spread built in —
[lit's spread PR](https://github.com/lit/lit/pull/1960) has been an open draft since 2021.

The renderer itself holds only a protocol: a value at element position carrying `_$apply$` applies
itself. Everything else lives in this entry, which imports nothing — not even from the renderer — so
it loads alongside any renderer that honours the protocol, including your own.

## `@verajs/renderer/profiler`

```js
import { render, profile, formatReport } from '@verajs/renderer/profiler';

/** `profile` awaits an async driver — driving an app means awaiting frames, and the render
    scheduler is `requestAnimationFrame`, so nothing commits inside one synchronous turn. */
const { report } = await profile(async () => { /* click around, await frames */ });
console.log(formatReport(report));
// 39 updated in place, 2 created, 19 rebuilt (32% of commits)
// Template identity churn — these were torn down, not updated:
//   10x  at body > main#app > ul.todo-list
//       <li class="done"><s>${…}</s></li>
//    -> <li><label><input type="checkbox">${…}</label></li>
```

`showProfiler()` puts the same numbers in a live panel in the corner of the page and returns a
function that removes it. The panel is plain DOM in a shadow root — it never renders itself through
the renderer, so it does not appear in its own measurements.

Full API: `startProfiling()`, `stopProfiling()`, `getReport()`, `isProfiling()`, `profile(fn)`,
`formatReport(report)`, `showProfiler(options?)`.

This costs production nothing, and there is nothing to strip: the instrumentation sits behind a
`__DEV__` constant the build folds to `false`, so `vera-renderer.min.js` is byte-identical whether
or not this entry exists.

## Trusted HTML, and why there is no `unsafeHTML`

Every interpolated value is escaped at the render boundary. There is no `unsafeHTML` and there will
not be one: shipping a sanctioned opt-out puts an XSS sink in the public API, where it reads as
blessed in tutorials and in review.

Trusted markup goes through a property binding, so you write the sink yourself:

```js
render(html`<div .innerHTML=${trustedMarkup}></div>`, host);
```

Greppable, obviously yours, reviewable as the security decision it is. Sanitize first
(`DOMPurify.sanitize`) unless the markup is genuinely your own, and put it on an element whose
children nothing else binds — the renderer owns the content of elements it renders into.

## `@verajs/renderer/tag`

An element whose **tag name** is decided at runtime — a heading whose level comes from data, a
component that renders `<a>` or `<button>`.

```js
import { html, tag } from '@verajs/renderer/tag';

const HEADING = { 1: tag`h1`, 2: tag`h2`, 3: tag`h3` };

const H = HEADING[state.level];
render(html`<${H} class="title">${state.text}</${H}>`, host);
```

A template renderer bakes tag names into its statics — that is what template identity *is*, and
what every fast path here depends on. So a runtime tag cannot be a binding: it is spliced into the
statics before the renderer sees the template. Downstream nothing changes. The renderer,
`@verajs/ssr` and hydration all receive an ordinary template and are unaware this entry exists.

Note the `html` import: in a template containing a tag, use the one from here rather than core's.

### In JSX

**A tag is also a component.** A capitalized JSX tag compiles to `H({…})`, and a tag *is* that
function, so the same value works in both notations with no compiler change and no new syntax —
`<{expr}>` is not valid JSX or TSX, and inventing it would break `tsc`, Prettier and every editor.

```jsx
const H = HEADING[state.level];
return <H className="title" hidden={state.muted}>{state.text}</H>;
```

React's names are mapped here exactly as the compiler maps them on a written element, so `<H
className="t" hidden={false}>` and `<h1 className="t" hidden={false}>` mean the same thing. That is
a correctness matter, not an ergonomic one: passed through raw, `hidden={false}` becomes the
attribute `hidden="false"` and any value at all applies it.

### What to know

- **A string can never become a tag.** Only another tag may be interpolated, so the set of tags an
  app can produce is fixed by its source. That is what keeps a tag out of reach of a request — the
  same reasoning as there being no `unsafeHTML` — and it is what bounds the cache below.
- **Each tag is its own template.** Switching tags rebuilds the subtree, which is correct: the
  element genuinely changed. Within a tag it updates in place like anything else.
- **The cache is per call site.** Spliced statics hang off the call site's own `strings` array, so
  two template literals in the source are two entries however identical they look. Right for real
  code, where a template lives at one place in a render function — and the thing that catches people
  writing tests for it.
- HTML only. There is no `svg`/`mathml` equivalent yet.

<!--size:tag.gzip-->1.41 KB<!--/size:tag.gzip--> gzipped, which includes `/spread` — the factory
needs it to apply props whose names it cannot know. Additive, like `/spread` and unlike the other
entries: it inlines no renderer internals, so it is safe alongside any of them.

## Extending it — `_$apply$` and `_$child$`

The renderer holds no directive system. It holds a **protocol**, at the two positions worth
extending, and everything built on it is an ordinary package the renderer knows nothing about —
`@verajs/renderer/spread` is the proof, at 8 B of protocol in this bundle and its own weight only
for apps that import it.

| position | brand | called as |
| --- | --- | --- |
| element — `<div ${value}>` | `_$apply$` | `value._$apply$(element, part)` |
| child — `<div>${value}</div>` | `_$child$` | `value._$child$(part, previous)` |

A child-position value carrying `_$child$` applies itself. It is handed the part and whatever it
returned last time **at that part**, and calls `part._$commit$(value)` to render content. That is
the whole surface: `until()` is nine lines against it.

```js
/** Hoisted — the applier's identity is the directive's identity. */
function applyUntil(part, previous) {
  if (previous && previous.promise === this.promise) return previous;
  if (previous) previous.live = false;
  const state = { promise: this.promise, live: true };
  part._$commit$(this.placeholder);
  this.promise.then((value) => { if (state.live) part._$commit$(value); });
  return state;
}
const until = (promise, placeholder) => ({ _$child$: applyUntil, promise, placeholder });

render(html`<p>${until(fetchUser(), html`<em>loading…</em>`)}</p>`, host);
```

Three rules, each of which is a real trap:

- **Hoist the applier.** Written as an object-literal method it is a new function per call, so the
  part can never recognise it and `previous` is always `undefined`. Its identity is what keeps two
  directives at one part from reading each other's state.
- **Continuity lives in the return value**, not in a directive instance. That is what makes this a
  protocol rather than a framework — no base class, no `directive()` factory, no lifecycle.
- **Teardown is opt-in, on the applier.** `applyThing._$detach$ = (previous) => …` is called with
  whatever the directive last returned, when the subtree holding it is removed — replaced, dropped
  from a keyed list, or shrunk out of an unkeyed one. Declaring it is what arms the walk; a directive
  that does not declare it costs nothing, and neither does an app with no such directive anywhere.

  It **notifies, it does not defer**. The nodes are already going. To hold content on screen while it
  animates out, do not remove it: a directive owns what it commits, so it can simply not commit the
  removal until it is ready — see *Deferring a removal* below.
- **The older note said there was no teardown at all.** `_clear`
  bulk-removes DOM and, when the part owns its parent, does `parent.textContent = ''` — the thing
  that makes clearing a 1 000-row table ~5 ms against lit-html's ~22 ms. Calling teardown on a
  nested directive would mean walking the part tree on every removal, which is exactly the per-node
  work that fast path exists to skip. If you need to unsubscribe, do it from the component.

### Deferring a removal

A directive owns the content it commits, so an exit animation needs nothing from the renderer — it
just does not commit the removal until the animation has finished:

```js
function applyTransition(part, previous) {
  const next = this.value;
  const state = previous ?? { shown: undefined, timer: null };
  if (next != null) { part._$commit$(next); state.shown = next; return state; }
  if (state.shown != null && state.timer === null)
    state.timer = setTimeout(() => { state.timer = null; part._$commit$(null); }, 300);
  return state;
}
const transition = (value) => ({ _$child$: applyTransition, value });
```

This works for a child position and for a whole list committed as one value. It does **not** work for
one row inside a keyed list: that row's removal is decided by the reconciler, and nothing inside it
is asked.

Both names survive minification by construction: the renderer mangles `/^_[a-z]/`, and `_$…$` does
not match it. `tests/minification-contracts.test.mjs` holds that.

The check costs the hot path nothing: it sits after the template branch, and a template — the
common object at a child position — returns before ever reading it, so only arrays, nodes and
directives pay a property read. Measured with no runtime difference distinguishable from noise.

The whole protocol is **116 B gzipped** — the check, the two fields holding a directive's state and
whose it is, the save/restore in `_$commit$` that stops a directive's own rendering from destroying
its continuity, and the `_$detach$` call. It was 94 B before teardown existed.

## Animating things in and out

There is no transition component, and none is needed — but the shapes are worth knowing, because
one of the obvious ones does not work in every engine.

**Fading on `?hidden`.** The framework's own advice is to prefer a stable shape with `?hidden=${…}`
over swapping subtrees, and that is also what makes an exit transition possible: the element is
still there to animate.

```css
.fade          { opacity: 1; transition: opacity 200ms; }
.fade[hidden]  { display: block; opacity: 0; pointer-events: none; }
```

The `display: block` is load-bearing — it overrides the user agent's `[hidden] { display: none }`,
which would otherwise remove the element from rendering instantly with nothing to fade.

**Do not reach for `transition-behavior: allow-discrete` on `display` for this.** Measured
2026-08-24 across all three engines, transitioning `display` with `allow-discrete`: Chromium and
WebKit fade correctly, **Firefox jumps straight to `display: none`** and no transition runs. All
three report `CSS.supports('transition-behavior', 'allow-discrete')` as `true`, so the feature test
does not tell you. The opacity-only shape above behaves identically in all three.

**Animating a removal**, where the element really does leave the render, is the browser's job:

```js
const flushSync = (fn) => {
  const previous = setRenderScheduler((run) => run());
  try { fn(); } finally { setRenderScheduler(previous); }
};

document.startViewTransition(() => flushSync(() => { state.rows = next; }));
```

The View Transitions API snapshots the DOM around the callback and cross-fades, so a row that
disappears fades out and the rows below animate up. `startViewTransition` is present in Chromium,
Firefox and WebKit. Two things it needs: the state change must happen **inside** the callback —
which is what `flushSync` is for, since a render deferred to the next frame lands after the snapshot
— and each row needs its own `view-transition-name`, or the whole page cross-fades as one image.

**Or keep it in state.** Mark the row `leaving`, animate, then drop it. Vue's `<Transition>` is
sugar over exactly this, and it is the only one of the three that gives you a completion callback.

## Absent on purpose

Directives other renderers ship, and what replaces them here.

| Elsewhere | Here |
| --- | --- |
| `repeat()` | `keyed()` |
| `cache()` | `hold()` |
| `ref()` | an element-position expression, `<input ${myRef}>` |
| `ifDefined()` | built in — `null`/`undefined` remove an attribute |
| `classMap()` / `styleMap()` | build the string: `class="base ${extra}"` |
| `guard()` | reactivity already skips unchanged work |
| `until()`, `asyncReplace()` | render a loading state and re-render from an effect |
| `unsafeHTML()` | `.innerHTML=${trusted}`, above |
| `literal()` / `static-html` | [`/tag`](#verajsrenderertag) — and a tag doubles as a JSX component |
| `live()` | [`!name`](#name--a-live-property) — a sigil, for the case that needs it |
| `until()`, `asyncReplace()` — as directives | writable against [`_$child$`](#extending-it--apply-and-child) |
| `live()` | not available. A property bound to a value it already holds is not re-applied, so a field the user has typed into keeps their text |

## Types

`TemplateResult` is exported for annotating what a template function returns. The rest of the
surface is inferred.

## License

MIT
