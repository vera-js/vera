# @verajs/motion

Scroll animation as HTML attributes. No build step, no dependencies, **13.2 KB** gzipped.

```html
<div data-vm="fade-up">I rise into view as you scroll.</div>
```

That is the whole API surface for most uses. Everything below is for when you want more control.

---

## Why this exists

Most scroll-animation libraries ask you to write JavaScript that describes your HTML. This inverts
that: the HTML describes itself, and the runtime reads it. That has three consequences worth knowing
before you decide whether it suits you.

- **It works with server-rendered pages.** The page knows what animates before any JavaScript runs,
  so there is no flash of un-animated content and no second source of truth to keep in sync — and
  the library itself is **safe to import and call where there is no DOM at all**. Every artifact
  imports, `createMotion()` and `createScrollTo()` construct, and their whole surface — `init()`,
  `collect()`, `refresh()`, `toPosition()`, teardown — is inert rather than fatal: nothing throws
  into a server render, and `rejected` says the APIs were unavailable. The schema exports
  (`properties()`, `settings()`, `parseMeasure`) answer normally there, so build-time tooling can
  read the vocabulary without a browser.
- **A visual editor can drive it.** Setting an attribute is something a GUI can do; generating and
  re-parsing a JavaScript config is not.
- **The attributes are the API.** They are written by people, by tooling, and by AI agents, and all
  three are first-class audiences. See [Working with AI agents](#working-with-ai-agents).

It is not a general-purpose animation library. There is no timeline-scrubbing API and no
tween-anything surface — it does scroll-driven and interaction-driven animation, configured by
attributes, and nothing else.

---

## Install

### In a VeraJS app

One name in the wiring, like every other Vera module — and then `data-vm` attributes work
inside your components' templates, closed shadow roots included, registered and released with each
component's own lifecycle:

```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { autoloader } from '@verajs/autoloader';
import { motion } from '@verajs/motion/vera';

wire([renderer, autoloader, motion]);   // or motion({ inertia: 0.3 }) to configure
```

Details and the reasoning: [`@verajs/motion/vera`](docs/modules/vera.md). Everything below is the
standalone story — no framework required.

### Buildless — no bundler, no toolchain

```html
<script type="importmap">
  { "imports": {
    "@verajs/motion": "https://cdn.jsdelivr.net/npm/@verajs/motion/dist/vera-motion.min.js",
    "@verajs/motion/split": "https://cdn.jsdelivr.net/npm/@verajs/motion/dist/vera-motion-split.min.js"
  } }
</script>

<script type="module">
  import { createMotion, wireMotion } from '@verajs/motion';
  import { split } from '@verajs/motion/split';
  wireMotion(split);
  createMotion().init();
</script>
```

**The first entry is required even if you load a module by path.** Every module artifact begins
`import { reject } from '@verajs/motion'` — that is how it reports *why* it refused an element, and a
module carrying its own copy of that registry would write into a map the runtime never reads. Without
the mapping the browser cannot resolve the specifier and the module does not load at all.

### npm

```sh
npm install @verajs/motion
```

```js
import { createMotion } from '@verajs/motion';
createMotion().init();
```

### WordPress

```php
wp_enqueue_script_module(
  '@verajs/motion',
  plugins_url( 'dist/vera-motion.min.js', __FILE__ ),
  array(),
  '0.1.0'
);
```

Requires WordPress 6.5+ for `wp_enqueue_script_module()`. The package ships ESM only.

---

## Entry points

Two, built independently. Importing one never pulls in the other.

| import | what it is | size |
|---|---|---|
| `@verajs/motion` | the scroll-animation runtime | 13.2 KB gzip |
| `@verajs/motion/scroll-to` | smooth scrolling to in-page anchors | 4.3 KB gzip |

They share no state and neither requires the other. Smooth anchor scrolling is imperative navigation
triggered by a click; the animation runtime is continuous rendering driven by scroll position. Most
pages want one without the other, so you are never charged for both.

Everything else is a **module**: a separate import the page hands to `wireMotion`. Nothing is fetched
on demand, so a page that does not import one pays nothing for it — not a loader, not a schema
entry, not a byte:

`@verajs/motion/sequence`, `@verajs/motion/split`, `@verajs/motion/easings`,
`@verajs/motion/paint` and `@verajs/motion/path`. Sizes and what each one gives you are under [Property modules](#property-modules) — deliberately
in one place, because a number written twice goes stale in one of them.

There is one more that adds no attributes: **`@verajs/motion/vera`**, 0.3 KB. A
[Vera](https://github.com/vera-js) app writes `wire([renderer, autoloader, motion])` and every
component hands its own shadow root over as it mounts and gives it back as it unmounts. A **closed** shadow root cannot be discovered from outside — `element.shadowRoot`
is null, which is what closed means — so the root has to come from whoever created it, and Vera keeps
it on `element._root` for exactly that reason. [→ `docs/modules/vera.md`](docs/modules/vera.md)

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { split } from '@verajs/motion/split';

wireMotion(split);
createMotion().init();
```

**A module imports the runtime**, and says so: `dist/vera-motion-split.min.js` begins
`import { reject } from '@verajs/motion'`. It is how a module reports *why* it
refused an element — `instance.rejected` is one registry, and a module that
bundled its own copy wrote into a map nobody read. With a bundler or the import
map above there is nothing to do. On WordPress, name it as a dependency, or
`wp_enqueue_script_module` emits no import-map entry and the browser cannot
resolve the specifier:

```php
wp_enqueue_script_module(
  '@verajs/motion/split',
  plugins_url( 'dist/vera-motion-split.min.js', __FILE__ ),
  array( '@verajs/motion' ),
  '0.1.0'
);
```

Every module is a **named** export. A default import of one is `undefined`, and
`wireMotion` used to throw on that at module scope — before `init()`, taking the
page's own script down for a mistake whose worst honest consequence is one module
not being wired. It now refuses it and reports it in every instance's `rejected`,
so the attributes that module owns are not simply listed as unknown with no
reason why.

---

## The attributes

Every animated element needs the bare **`data-vm`** marker alongside its properties. It is
what `querySelectorAll` matches on, and it doubles as the preset slot
(`data-vm="fade-up"`). Forgetting it used to be completely silent — the element was never
found, so it was never refused either. An element carrying a **property** and no marker is now
reported in `rejected`, naming the attribute. Settings are not enough to trigger it, because three of
them belong on unmarked elements by design: `stagger` sits on a parent whose children animate,
`split` stays on a container after its attributes have moved to the pieces, and `scroll-target` is
written by `scroll-to` onto sections it did not otherwise touch.

**[→ Full attribute reference](docs/ATTRIBUTE-REFERENCE.md)** — generated from the schema, so it
cannot drift. Regenerate with `npm run reference`.

The shape of it:

```html
<!-- a preset: the shortest path -->
<div data-vm="fade-up"></div>

<!-- a bare value is the END of the timeline; units live in the value -->
<div data-vm data-vm-opacity="0"></div>

<!-- a keyframe is a position and a value; one attribute holds as many as you like -->
<div data-vm
     data-vm-translate-y="0% 60px, 100% 0px"
     data-vm-opacity="0% 0, 40% 1"></div>

<!-- positions outside 0-100% extrapolate, and negatives are written plainly -->
<div data-vm
     data-vm-translate-x="-20% -90px, 35% 45px, 70% -20px, 100% 0px"></div>

<!-- a position may use any of % vh vw px rem, independent of the value's unit -->
<div data-vm data-vm-rotate="-30vh 0deg, 100% 720deg"></div>

<!-- a width band, merged over the base: less travel on a narrow screen -->
<div data-vm data-vm-translate-y="0% 0px, 100% 100px; [0-500]: 100% 20px"></div>

<!-- hold it against the viewport while it animates, then release -->
<div data-vm data-vm-pin="15vh" data-vm-scale="0% 0.8, 100% 1.1"></div>

<!-- driven by a selector instead of by scroll -->
<div data-vm data-vm-when=".is-open" data-vm-opacity="0% 0, 100% 1"></div>
```

### Five rules that cover most of it

1. **A bare value is the end of the timeline.** `data-vm-opacity="0"` fades *to* 0, and the
   missing end is filled from the property's resting value.
2. **A keyframe is `<position> <value>`, comma-separated.** A position always carries a unit and a
   value may not — which is what makes a lone number unambiguously a value.
3. **Units go in the value.** `"100px"`, `"1.5rem"`, `"50%"` — never a separate `-unit` attribute.
   Position units and value units are independent.
4. **`0%` is where the element starts entering the viewport, `100%` where it has fully left.**
   The scroll window is the element's height *plus* the viewport, so it animates over more scrolling
   than its own height. This is exactly what CSS's `animation-range` means by a percentage.
   Positions outside `0–100%` extrapolate — `-50%` starts half a window early, `150%` means the
   element exits before the animation finishes.

   **The page can do the same thing to you.** An element near the end of the document can never
   *fully leave*, because nothing follows it to scroll past — so its timeline stops short of `100%`
   however it is written. A last section on an ordinary page reached 0.222 and stopped: three
   quarters of the animation never happening. The runtime says so in
   [`rejected`](#bad-values-are-dropped-not-guessed) rather than leaving you to wonder, compared
   against that element's own furthest keyframe, so an animation that finishes at `50%` is never
   mentioned. The fix is space below it, or keyframes that finish sooner.
5. **A separator left at the end costs nothing.** `"0% 0px, 100% 40px,"` and
   `"…40px;"` are what CSS habit produces, and the value is not CSS — both are read as written. An
   attribute with *nothing* in it is still reported, because that is a mistake with intent behind it.
6. **The bare `data-vm` marker is required.** CSS has no attribute-prefix selector, so it is what
   lets the runtime find animated elements without walking the entire document.

### The one thing to read twice

```html
data-vm-translate-y="50% 50%"
                       ↑    └── value → 50% of the element's own height (CSS)
                       └─────── position → 50% through the scroll window
```

Never ambiguous to the parser — the position is always first — and both readings are correct for
their slot. CSS has the same overlap between `animation-range: cover 50%` and `translateY(50%)`.

**Prefer `%` for positions.** It is geometry-free and never needs recomputing. `vh` / `vw` / `px` /
`rem` are for what percentages cannot express — `"-30vh 0"` is "half a viewport before it enters"
whatever the element's height. Curves that use them rebuild on resize; a page without them never
pays that cost.

---

## JavaScript API

### `createMotion(options?)`

```js
import { createMotion } from '@verajs/motion';

const animation = createMotion({ inertia: 0.1 });
animation.init();
```

#### Options

| option | default | what it does |
|---|---|---|
| `inertia` | `0.1` | How much the element resists the position scroll says it should be at, in seconds. `0` tracks scroll exactly. See [Inertia](#inertia). **Range-checked against the same bounds as the attribute** — 0 to 3,600 — and read from the schema rather than written out twice, so the option and `data-vm-inertia` cannot disagree. A negative used to be accepted in silence and produce no transition at all, which is `inertia: 0` reached by a sign error. |
| `inertiaEase` | `cubic-bezier(0.33, 1, 0.68, 1)` | Timing function of the catch-up. See [Two easings](#two-easings). |
| `ease` | `linear` | Timing function of the **curve** — value against scroll position. Anything other than `linear` **requires [`@verajs/motion/easings`](#property-modules)**; without it the runtime warns once and every curve stays straight. **Does nothing on a `when` element**, and says so: `when` holds the element at one end of the timeline or the other, so there is never a point between keyframes for a curve to shape — use `inertia-ease` for the change between the two states. See [Two easings](#two-easings). |

**`transformOrigin` is ignored unless the engine accepts it**, checked with `CSS.supports`. The
behaviour was already safe — an unusable value is refused by the CSSOM and the element animates
around its default origin — so what the check adds is a warning naming the option, rather than an
option that quietly does nothing.

**`onProgress` is ignored unless it is a function, and dropped if it throws** — with a warning
either way. It is the one option whose value is *called* rather than read, so a wrong type there
used to throw out of `init()` and take the whole instance with it. A callable that throws did the
same thing: every element on the page went unanimated over a bug in a callback about one element's
progress, and your own script stopped at the `init()` call. It is dropped on the first throw rather
than caught per frame, because a callback that throws once throws sixty times a second.

**One instance per element.** Two live instances animating the same element both write its style
every frame, and `destroy()` on either strips what the other owns. Each is told so, in `rejected`, the
moment the second one adopts an element the first already holds — two plugins on one page each
calling `createMotion()` is how it happens. Instances with **disjoint roots** are the supported case
and say nothing; that is what `observe(shadowRoot)` is for.

**An option given as `undefined` means *not given*.** A spread would let it win, and for a boolean
whose default is `true` that inverts it — `respectReducedMotion: undefined` ran the animation for
someone who had asked for reduced motion, and said nothing. `{ respectReducedMotion: config.respect }`
with the key missing from `config` is how generated code is written. Nothing is reported: `undefined`
is how JavaScript spells "unset".

**A module that replaces something already registered is reported.** The registry is keyed by
attribute and the last writer wins, so `wireMotion({ attribute: 'opacity', … })` takes the built-in
`opacity` from every element on the page. Doing that deliberately is allowed — this is the section
inviting it — but doing it by accident used to be silent. Wiring the *same* module twice is not a
clash and says nothing.

**A boolean option that is not a boolean is reported and falls back**, on both entry points, derived
from each one's defaults rather than a list. `disableOnTouch: 'no'` is truthy, so it used to turn
animation off on every touch device — the exact inverse of what was written. This library has refused
the same mistake in an *attribute* since `run-once="yes"` came out off; being wrong about a boolean is
quiet in a way being wrong about a number is not.

**An option name this library does not have is reported too**, on both entry points, naming the key:
`createMotion({ intertia: 0.4 })` used to run on the default and say nothing, while an *attribute*
nobody registered has always been reported as unknown. TypeScript catches the typo, which settles who
the check is for rather than excusing it — the GUI builds these objects, hand-written pages are
JavaScript, and neither can read a console.

**These three are validated, and fall back to their defaults.** `ease` and `inertiaEase` must be
easings the library accepts; `inertia` must be a number — `parseInt` of a config string is where
`NaN` comes from. Each falls back with a warning naming the option, because an unusable
value here does not merely take effect wrongly: `inertiaEase: 'wobble'` builds a `transition` the
CSSOM refuses outright, which leaves **no transition at all** and turns inertia off completely.
| `scrollDirection` | `'vertical'` | `'vertical'` or `'horizontal'`. Anything else falls back to vertical and is reported — it used to be read *as* vertical in silence, so a typo animated the wrong axis. |
| `scrollElement` | `window` | `window`, an element, or a selector for a scrolling container. **Resolved once**, at `init()` — replace that container and the instance goes on listening to the node that has left, so scrolling the new one drives nothing and elements are painted from the old one's last position. The next `collect()` reports it; make a new instance for the new container. Anything else falls back to the window and is reported in `rejected`: a number used to be handed back as the scroll element and threw `Invalid value used as weak map key` out of `init()`. |
| `breakpoints` | `{ mobile: [0,640], tablet: [641,1024] }` | Named width ranges usable as attribute suffixes. A range's max may be `null` for no ceiling; pass `{}` to register no names at all. An entry that is not a usable `[min, max]` — not a pair, not numbers, or reversed — is **dropped and reported**, leaving the rest of the map working; an attribute suffixed with the dropped name is then an unknown attribute. See [Width bands](#width-bands). |
| `respectReducedMotion` | `true` | Honour `prefers-reduced-motion`. See [Accessibility](#accessibility). |
| `willChange` | `false` | Set `will-change` on animated elements, naming the properties each one actually animates. Costs memory per element — use sparingly. |
| `transformOrigin` | `''` | Default `transform-origin` for animated elements. |
| `translateZFix` | `false` | Prefix transforms with `translateZ(0px)` to force compositor promotion. |
| `allowedOrigins` | `[]` | Extra origins permitted for url-valued attributes. **Instance-level on purpose** — an attribute cannot widen its own boundary. |
| `root` | `document` | Where to look for animated elements — **one node or an array of them**: `createMotion({ root: [nav, hero] })` watches exactly those subtrees and nothing else, the granularity control when a page only animates a nav bar and one section and a document-wide `MutationObserver` would be waste (an unusable array entry is reported **by position** in `rejected` and skipped). Includes **the root itself** if it carries the marker — so a section can fade in and stagger its own children. It could not, until 2026-08-31: `querySelectorAll` never matches the node it is called on, so the root was the one element in its own subtree that did nothing, silently. That was never a decision, just the selector's semantics. Pass a `ShadowRoot` for a web component. A **node**, not a selector — unlike `scrollElement`, which resolves one because a page's scroller is often known only by selector while a root is a node you already have. Anything else falls back to the document and is reported in `rejected`; it used to throw out of `init()`. |
| `observeMutations` | `true` | Watch for elements added or changed after `init()`. With it off, `collect()` is how a page keeps up: it re-reads every root, so an edited attribute is picked up the next time you call it. Off is for a page whose markup does not change after render, or one that would rather say when it has. |
| `disableOnTouch` | `false` | Leave everything un-animated where the primary input is a finger. See [Touch](#touch). |
| `onProgress` | — | Called with `(node, progress)` every frame an element updates. See [`onProgress`](#onprogress). |

#### Instance

| member | what it does |
|---|---|
| `init()` | Parse, measure, wire listeners, paint the initial state. Safe to call twice — the second is a no-op. |
| `destroy()` | Full teardown. Every listener, observer, frame handle and injected style is released. |
| `enable()` | Resume. **Explicitly overrides reduced motion** — see [Accessibility](#accessibility). |
| `disable()` | Stop, and return every element to its natural un-animated state — *not* frozen mid-transform. Called **before** `init()` it is remembered rather than ignored, so `createMotion(); if (!on) m.disable(); m.init();` starts quiet; the last answer given before starting is the one that counts. |
| `setEnabled(bool)` | Either of the above. |
| `enabled` | Whether it is currently running. |
| `reducedMotion` | Whether it is stopped *because* the visitor asked for reduced motion. |
| `touchDisabled` | Whether it is stopped *because* the primary input is a finger and `disableOnTouch` is on. The companion to `reducedMotion`, and both are live: a trackpad arriving on an iPad changes the answer. |
| `rejected` | Every refusal, with the element it was about: `{ node, rejected }`, an array of reasons per element — each one a sentence, `data-vm-when: is not a selector this library will use`, not a bare attribute name. Every core *setting* was a bare name until 2026-08-31, while properties had carried a sentence all along. **Shaped differently from `scroll-to`'s**, which is `{ node, reason }`, one reason per entry — a consumer rendering both has to branch. `node` is null when the problem is the instance's own configuration. This is what to read when something is not animating, and it was the one member missing from this table while the rest of this file told you eight times to look at it. |
| `collect()` | Re-scan the roots: pick up elements added since `init()`, **and drop any that have left**, clearing any refusal recorded about markup it is about to read again. Needed only for markup a module must prepare — split text — because rewriting the DOM from inside the mutation observer would re-enter it. Attribute changes and removals are picked up automatically while `observeMutations` is on; with it off, this is what prunes. An element that has left the document is handed back — its styles cleared, and any module holding it told — rather than being updated every frame for the life of the page. **It re-reads elements it has already adopted**, not only new ones — the same path the mutation observer takes, so an edited attribute is picked up whether the observer is on or off. It compares before it re-reads — an element whose own attributes and stagger context are unchanged keeps the parse it has — so an unchanged page costs a scan and not a re-parse: **9.7 ms at 5,000 elements against 78 ms** to read them all again. Call it after rendering, not per frame. |
| `refresh()` | Re-measure geometry. Call after a layout change the runtime cannot observe. |
| `observe(root)` | Register an additional root — typically a component's `ShadowRoot`. **Adoption is synchronous** — `instance.elements` is right the moment it returns — and the **painting** lands on the next microtask. That split is not a convenience: a framework built on closed shadow roots hands every root over separately, and writing style at the end of each call made the next one's geometry read force a layout, **779 ms to register 400 roots** against 8.4 ms. A microtask runs before paint, so nothing is ever visible un-animated; what waits is `will-change`, `transform-origin`, `offset-path`, the `position: sticky` a `pin` writes, and the first value. `init()` and `collect()` are one batch each, so they flush before returning and stay fully synchronous. **Nesting is not recursive** — a shadow root inside an observed shadow root needs its own call, and a **closed** one can only ever be handed over by whoever created it, since `element.shadowRoot` is null from outside. Anything that is not a node is refused and reported rather than registered. |
| `unobserve(root)` | Drop a root, reset its elements, and undo any structural work modules did inside it (a `split` paragraph goes back to one node). Each root carries its own `MutationObserver`, so this stops watching one without touching the others — it used to disconnect and re-observe every remaining root, which is O(roots) on a call a component makes on unmount. Call it when a component goes. A root that has left the document *is* dropped without it — `collect()` prunes any root whose `isConnected` is false, and runs modules' `teardown` over every disconnected node, which is what stops a detached subtree being held and re-scanned for the life of the page. What `unobserve` adds is doing it **at the moment the component unmounts** rather than at the next `collect()`, and doing it at all under `observeMutations: false`, where nothing schedules one. |
| `elements` | The live element list. For debugging; not a stable API. |

### `createScrollTo(options?)`

```js
import { createScrollTo } from '@verajs/motion/scroll-to';

createScrollTo({ selector: 'nav a[href*="#"]' }).init();
```

Smooth-scrolls in-page anchors and marks the link whose section is on screen.

**Percent-encoded fragments resolve**, so `href="#caf%C3%A9"` finds `id="café"` — which is how a CMS
writes any heading that is not plain ASCII. A fragment is matched as written first and decoded only
if that finds nothing, which is what the browser does: `#both%41` prefers `id="both%41"` over
`id="bothA"`.

A **modified click is left to the browser** — Cmd, Ctrl, Shift or Alt, a middle button, or a link
carrying `target` — so opening an in-page anchor in a new tab still works. So is any click a handler
of yours has already called `preventDefault()` on.

**`href="#top"` glides too.** HTML's fragment fallback makes `top` mean the top of the document
when nothing carries the id, so the classic back-to-top link is a real target at position 0 — it
tweens like every other link instead of jumping natively, and is not reported as broken. An
element genuinely carrying `id="top"` wins over the fallback, exactly as it does in the browser.

#### Options

| option | default | what it does |
|---|---|---|
| `selector` | `'a[href*="#"]'` | Which links become smooth-scroll triggers. |
| `duration` | `1000` | Tween length in ms. Zero or negative arrives at once. A value that is not a number — `parseInt` of a bad config string, most often — also arrives at once and is reported in `rejected`, rather than starting a tween whose end condition can never be true. |
| `easing` | `'ease-in-out'` | A **continuous** CSS timing function — the keywords and `cubic-bezier()`, the same language the animation runtime's `ease` speaks. `steps()` is refused here on purpose: a stepped scroll tween teleports in chunks, and leaving it out keeps its implementation out of this bundle. A value that is not one falls back to the default and is reported in `rejected` at `init()` — silently using the wrong curve looks exactly like a deliberate choice. |
| `offset` | `0` | Pixels to stop short — for a sticky header. Must be a number: a `NaN` makes every destination `NaN`, so the tween runs its whole duration and arrives nowhere. One that is not falls back to `0` and is reported in `rejected`. |
| `activeClass` | `'active'` | Class applied to the link whose section is current. **One class name, no whitespace** — `classList.toggle` throws on an empty string and on one containing a space, in every engine, and `update()` runs from the scroll listener, so `'nav-link active'` did not fail at `init()` where someone is looking but on every frame a link was current. Anything else falls back to `active` and is reported. |
| `activeThreshold` | `0.5` | Fraction of the viewport at which a section counts as current. **Where sections nest, the innermost one containing the threshold wins** — a subsection is where a reader would say they are, and the answer must not depend on the order the links happen to be written in. Must be a number **between 0 and 1** — a `NaN` makes every comparison false and a `5` puts the line five screens down, so in both cases no link is ever the active one — and one that is not falls back to `0.5` and is reported. **At the end of the scroll range the last section is marked regardless**, because the threshold stops short of the document's end by the remainder — without which a final section shorter than that gap could never be current, and a short contact block or footer is the ordinary last section. |
| `updateHash` | `false` | Update the address bar on arrival. **`replaceState`, so clicking anchors never grows the back stack** — a nav with eight links would otherwise put eight entries in the history and make Back a tour of the page instead of a way off it. The cost is that Back does not return to the previous section either, which is what a native anchor click would do; the click is intercepted, so no native history entry happens. |
| `cancelOnUserInput` | `true` | Abort an in-flight tween when the visitor scrolls. Only scroll keys count — typing does not. **An aborted tween updates neither the hash nor focus**: focus stays on the link that was clicked rather than being thrown at a section the visitor scrolled away from, and the address bar does not claim an anchor the page never reached. |
| `manageFocus` | `true` | Move focus to the target on arrival. **Turning this off is a deliberate accessibility regression** — see below. |
| `scrollDirection` / `scrollElement` / `respectReducedMotion` / `root` | | As for `createMotion` — `scrollElement` takes a node **or a CSS selector** in both. A selector that matches nothing, or is not valid CSS, falls back to the window and is reported in `rejected`; an instance quietly scrolling the whole page instead of its container is otherwise hard to place. `root` scopes which **links** are collected, not where their targets may be: the root is searched for the target first and then the tree the root is in, so `root: nav` finds the sections outside the nav while a `ShadowRoot` still resolves its own private ids. |

#### The target marker

Every element a managed link points at carries `data-vm-scroll-target` while the instance
holds it. Nothing in the library reads it — it exists so a page can style or find its own sections
without repeating the nav's selector:

```css
/* A mid-page landing clears a sticky header, however the visitor got there. */
[data-vm-scroll-target] { scroll-margin-top: 5rem; }
```

That complements `offset` rather than duplicating it. `offset` applies to scrolling *this library*
performs; `scroll-margin-top` also covers a browser-native jump — a modified click, a page opened
straight at a hash, or a `findText` — which the library never sees.

It goes on at `collect()` and comes off at `collect()` and `destroy()`, so an element that stops
being a target stops being marked. **Two instances pointing at one element share the mark**, and it
is removed when the last of them lets go rather than the first.

**`root` scopes links and targets together.** Both are looked up inside it, so a nav in the light DOM
cannot point at a target inside a shadow root — `getElementById` does not pierce one, and the link is
reported in `rejected` rather than silently doing nothing. Give the component its own instance with
`root: shadowRoot`, holding both its nav and its sections.

#### Instance

| member | what it does |
|---|---|
| `init()` / `destroy()` | As above. |
| `toElement(node, opts?)` | Scroll to an element. `opts`: `duration`, `easing`, `offset`, `onComplete`. |
| `toPosition(px, opts?)` | Scroll to an absolute position, clamped to what the container can reach — asking for more animates to the end over the whole duration rather than arriving early and waiting. A destination that is **not a finite number** is refused and reported in `rejected` rather than tweened towards: `Math.min(NaN, max)` is `NaN`, so the clamp cannot help, and the tween would run its whole duration writing positions that move nothing before calling `onComplete` as though it had arrived. `onComplete` is still called, as it is for a journey of zero length. |
| `cancel()` | Stop an in-flight tween where it stands. |
| `collect()` | Re-scan for links and targets, **and re-measure them**. Call after the page adds or removes some — including when the page had none at `init()`, which is the usual case for a nav rendered by a framework. Anything it no longer tracks loses the active class and the target marker attribute. |
| `refresh()` / `update()` | Re-measure targets / recompute the active link. |
| `enable()` / `disable()` / `setEnabled()` / `enabled` | As above. |
| `rejected` | Every refusal, with the link it was about. **Shaped differently from the animation runtime's**: `{ node, reason }` here, one reason per entry, against `{ node, rejected }` there, an array of reasons per element. `node` is null when the problem is the instance's own configuration — a bad `easing`, an `offset` that is not a number, a `scrollElement` selector that resolves to nothing. A consumer rendering both has to branch. |

### Events

The one channel pointing outward: the runtime telling your JavaScript what it is doing. CSS cannot
run your code, so this is the only way to start a video when its section arrives, or fire analytics,
or drive a canvas from scroll position.

```js
import { EVENTS } from '@verajs/motion';

document.addEventListener(EVENTS.active, (e) => e.detail.element.querySelector('video')?.play());
document.addEventListener(EVENTS.idle,   (e) => e.detail.element.querySelector('video')?.pause());
document.addEventListener(EVENTS.complete, (e) => confetti(e.detail.element));
```

| event | fires when |
|---|---|
| `vm:active` | the element is in the update loop — its animation can move from here on |
| `vm:idle` | it has left the loop, after a final pass that settled it on its clamped value |
| `vm:complete` | a `data-vm-run-once` element played through and latched. Once, ever — the latch and the position it played to are carried across a re-parse, so editing an unrelated attribute does not replay it |

Every element reports its state once the observer has settled, then again on each change — so an
element already on screen at load gets an `vm:active` rather than silence.

**The pair balances across the instance, not only across the tracker.** `disable()`, `destroy()`
and a `prefers-reduced-motion` change arriving all stop the instance animating, and each now fires
`vm:idle` for every element that had been announced active — otherwise a listener that
started something on `active` is left holding an element it believes is still animating. Re-enabling
starts a fresh tracker, so every element announces its state again, exactly as it did at `init()`.

All three bubble and are `composed`, so one listener on `document` covers the page including shadow
roots. **Read `event.detail.element`, not `event.target`**: a composed event crossing a shadow
boundary is retargeted to the host, so `target` is the custom element rather than the animated one.
`detail` also carries `progress`, the timeline position it fired at.

> **These are not visibility events.** The tracker's margin reaches half a viewport beyond the
> viewport — further if your keyframes sit outside `0–100%` — so `vm:active` fires well before an
> element can be seen. They mean "is this animating", not "did the reader see this". For the latter,
> use your own `IntersectionObserver` with the threshold you actually mean.

### `onProgress`

Per-frame position, for driving anything that is not a CSS property — a canvas, a WebGL scene, a
video's `currentTime`, an audio parameter.

```js
createMotion({
  onProgress(node, progress) {          // 0 entering, 1 fully left — and outside that
    if (node.id === 'chart') drawChart(ctx, Math.min(1, Math.max(0, progress)));
  },
});
```

A callback rather than an event, and the reason is measured. At 200 elements a bubbling
`CustomEvent` per frame costs about **0.18 ms** against **0.002 ms** for a call — about **6.6× the
library's entire per-frame cost**, versus a tenth of it. Dispatch is not free unlistened either:
with no listeners at all it still costs about 0.084 ms, three times the whole frame, because the
event object is built and the propagation path walked regardless. So the rare notifications are
events, where delegation is worth having, and the 60-times-a-second one is a call.

Both halves of that ratio come from one run of `spikes/event-cost.mjs`, which measures the
library's own frame on its own page for exactly this purpose. It used to be quoted as "roughly 5×"
from two runs of two different harnesses — a number nothing reproduced, which read 4.8× when it was
written and 3.6× when it was checked.

**Values outside `0–1` are normal, and not only for unusual keyframes.** `0` is where the element
starts entering the scroll window and `1` where it has fully left, so anything *before* or *after*
that is negative or greater than one — an element far down the page reports about `-2.9` before you
reach it and about `4.6` once you are well past. Keyframes written outside `0–100%` widen it
further, but they are not what causes it: an ordinary `"0% 0, 100% 1"` does this.

Clamp if your consumer needs a fraction — `Math.min(1, Math.max(0, progress))` — and do not assume a
first call at `0`. The same number is readable without a callback at
`instance.elements[i].timelinePosition` if you are already running your own loop.

### Schema exports

`@verajs/motion` also exports the schema, so tooling can generate controls from the same
definition the parser uses.

**Build controls from `properties()` and `settings()`, not from `PROPERTIES` and `SETTINGS`.** The
arrays are the built-in tables and stop there; the functions return what the runtime actually knows,
including everything handed to `wireMotion` — `background`, `color`, `frame`, `split` and the rest.
Iterating the arrays leaves those out silently, because they still parse and animate perfectly well
when written by hand. The arrays remain exported because "which of these are built in?" is a fair
question, and because the types derive from them.

`parseMeasure` validates a single value against a property, and it is the same function the runtime
parses markup with — so a control cannot accept a value the page will then reject. It reaches a
module's own validator too: `parseMeasure('url(x.png)', getProperty('background'))` is null.

Also exported: `PROPERTIES`, `SETTINGS`, `PRESETS`, `CATEGORIES`, `UNITS`, `MIN_PERCENT`,
`MAX_PERCENT`, `getProperty`, `isProperty`, `isSetting`, `isPreset`, `wireMotion`. There is no
`BREAKPOINTS` — width bands replaced the fixed pair, and a name is an alias a site registers.

---

## Things to keep in mind

### Inertia

`inertia` is the number most worth understanding. It is not a style choice — it is resilience.

**This idea has exactly one name here.** Other tools call it momentum, damping, smoothing, `scrub`
(GSAP) or `lerp` (Lenis). There is no `momentum`, `damping` or `scrub` attribute in this library and
there will not be — the setting is `inertia`, its shape is `inertia-ease`, and its per-category
overrides are `transform-inertia` and `filter-inertia`. Inertia is the physically apt term: a
property you *set* that governs resistance to a change in motion, where momentum is an instantaneous
quantity you could not hold constant.

The catch-up is a CSS transition, so it runs on the **compositor**. When the main thread misses a
frame — a garbage collection, a long task, a loaded machine — an element with `inertia: 0` freezes
for that frame, because nothing wrote a new value. An element with inertia keeps moving toward its
last target regardless, because the compositor is still interpolating.

The default of `0.1` covers about **54 ms** of blocked main thread, which is roughly the
[Long Tasks](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) threshold —
one blocking task smoothed over, for about 20 px of lag on a 1200 px travel. `0` is perfectly usable
and tracks scroll exactly; anything below `0.03` is shorter than two frames and insures nothing.

### Two easings

The single most misreadable thing in this API, so it is worth thirty seconds.

```html
<div data-vm
     data-vm-translate-y="0% 0px, 100% 500px"
     data-vm-ease="ease-in"             <!-- shape of the movement -->
     data-vm-inertia="0.1"              <!-- how much it trails -->
     data-vm-inertia-ease="ease-out">   <!-- shape of the trailing -->
```

| | `ease` | `inertia-ease` |
|---|---|---|
| shapes | the **curve** — value against scroll position | the **catch-up** — how it reaches that value |
| evaluated by | this library, per animation per frame | CSS, on the compositor |
| default | `linear` | `cubic-bezier(0.33, 1, 0.68, 1)` |
| at `inertia: 0` | full effect | **none** — there is no transition to shape |

Both take the same vocabulary: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `step-start`,
`step-end`, `cubic-bezier()`, `steps()`. A control point above `1` — `cubic-bezier(0.34, 1.56, 0.64,
1)` — overshoots and settles back in either slot.

**Why the curve is not CSS's job.** A `transition` runs on a timer and cannot ask where the scrollbar
is, so something has to turn scroll position into a value, every frame. That is this library, and
`ease` shapes that conversion. The one CSS mechanism that does know about scroll is
`animation-timeline`, and an animation *overrides* a transition — so using it would mean giving up
inertia entirely. Measured in Chromium and WebKit; Firefox has no `animation-timeline` at all.

`ease` applies **per segment**, exactly as `animation-timing-function` does inside `@keyframes`:
`"0% 0px, 50% 250px, 100% 500px"` with `ease-in-out` eases into and out of the midpoint, rather than
easing once across the whole range.

**`inertia-ease` is really a stiffness control.** The runtime rewrites the transition's target every
frame, so only the first ~17% of that curve is ever traversed and what matters is its slope near the
start. Measured at `inertia: 0.1`:

| `inertia-ease` | trails the scroll by |
|---|---|
| `cubic-bezier(0.33, 1, 0.68, 1)` (default) | 8px |
| `ease-out` | 17px |
| `linear` | 30px |
| `ease-in-out` | 94px |
| `ease-in` | 113px |

### Stagger

Siblings at the same Y share a scroll window, so they animate in **perfect unison** — right for a
hero, wrong for a list. `data-vm-stagger` goes on the parent and shifts each animated descendant's
keyframes by `index × value`:

```html
<div class="grid" data-vm-stagger="8">
  <div data-vm="fade-up"></div>   <!-- unshifted -->
  <div data-vm="fade-up"></div>   <!-- +8%  -->
  <div data-vm="fade-up"></div>   <!-- +16% -->
</div>
```

Stagger offsets a **scroll** timeline, so it applies to scroll-driven descendants only. A child with
`data-vm-when` takes no offset — that attribute replaces the scroll driver, so there is no
timeline to shift and the row would land in unison. It is reported in `instance.rejected` rather than
left to be discovered.

`%` by default, because that is what keyframe positions mostly use. Any position unit works —
`data-vm-stagger="40px"` composes correctly with `data-vm-translate-y="0% …"` even though the two
units measure different things, because the offset is normalised against geometry exactly as a
position is. A negative value runs the row in reverse.

The index is document order among the animated descendants that parent staggers, so it works through
wrapper elements, not just direct children. A parent that is itself animated is not part of its own
sequence, and a nested `stagger` starts a sequence of its own — its members belong to the inner row
and do not advance the outer one.

### Text splitting

`data-vm-split` breaks an element's text into characters, words or layout-measured lines, and each
piece animates on its own. Pair it with `data-vm-stagger` on the same element for the classic
cascade — the stagger is doing that work, not the splitter.

```html
<h1 data-vm data-vm-split="chars" data-vm-stagger="3"
    data-vm-opacity="0% 0, 60% 1"
    data-vm-translate-y="0% 30px, 60% 0px">Hello there</h1>
```

The pieces inherit the element's animation attributes and its per-element settings (`inertia`,
`ease`, `inertia-ease`…). The element keeps `stagger` and `split`, because those describe the container.

**`when` moves to the pieces too, and a selector is evaluated against whatever holds it.** That
changes its subject: `data-vm-when=".is-open"` on the paragraph becomes the same attribute
on every span, each asking *"do I have `.is-open`?"* — which is never true, so the words never
animate and nothing is refused, because nothing is wrong. Name the container instead:

```html
<div class="panel">
  <p data-vm-split="words"
     data-vm-when=".panel.is-open *"
     data-vm-opacity="0% 0, 100% 1">one two three</p>
</div>
```

The `*` is the whole difference. This is the same "a selector may name an ancestor, which is usually
what you want" that [`when`](#data-vm-when-replaces-the-scroll-driver) already relies on —
after a split it stops being optional.

**A separate import.** `@verajs/motion/split` is a module: a page that does not import it pays nothing
for it, and a page that does imports it up front rather than fetching it when an element turns up.
That is deliberate — being wired makes it synchronous, which removes the class of bug the
load-on-demand version had by construction: a chunk landing after `disable()`, a chunk landing after
`destroy()`, an element split twice because two paths raced.

Two limits worth knowing before you reach for it:

- **Plain text only.** `Some <strong>bold</strong> text` is refused with a warning and left alone,
  rather than silently dropping the emphasis. Preserving inline structure through a split is most of
  what makes a general-purpose splitter large. **Text opposing the paragraph's direction is refused
  too** — split pieces keep source order, so the bidi reordering that makes an embedded Hebrew or
  Arabic run read correctly is lost; text matching its paragraph's direction splits fine.
- **Accessibility rests on a visually-hidden text copy + `aria-hidden` pieces.** The original
  sentence stays in the element as real hidden text, so a screen reader gets it whole — not as
  `aria-label`, which ARIA prohibits on these roles and which only worked where an engine was
  lenient. The trade: while split, the sentence exists twice in the DOM — find-in-page can
  match the invisible copy, though `user-select: none` keeps it out of a copied selection. **An `aria-label` you wrote yourself is left alone**, before and
  after `destroy()`, and no copy is added under it. `lines` mode also re-splits on resize and
  on `document.fonts.ready`, because line breaks are a layout fact rather than a text one.

### Video scrubbing — a recipe, not a feature

Scrubbing a `<video>` by scroll position is not built in, deliberately. With `onProgress` it is a few
lines, and the part that decides whether it looks good is the **encoding**, not the code:

```js
let pending = false, queued = null;
const seek = (v, t) => {
  if (pending) { queued = t; return; }        // coalescing is the part that matters
  pending = true;
  v.currentTime = t;
  v.requestVideoFrameCallback(() => {
    pending = false;
    if (queued !== null) { const next = queued; queued = null; seek(v, next); }
  });
};

createMotion({
  onProgress(node, progress) {
    if (node.tagName === 'VIDEO') seek(node, Math.min(1, Math.max(0, progress)) * node.duration);
  },
});
```

Measured in Chromium against an ordinary web encode, scrubbing 120 frames across a 4s clip —
`spikes/video-scrub.mjs`, three runs, median with the range beside it, because a decode under a
clock does not repeat exactly:

| | distinct frames shown | mean lag |
|---|---|---|
| setting `currentTime` every frame | 42 of 120 (40–43) | ~31 frames |
| coalesced, as above | **71 of 120** (70–72) | **~18 frames** |

Coalescing roughly halves the lag — and **even the good version trails by ~0.6s of video**, because
`video.currentTime` seeks to the nearest *keyframe* and decodes forward. To scrub well the file has
to be re-encoded almost all-intra:

```sh
ffmpeg -i in.mp4 -c:v libx264 -g 5 -keyint_min 5 -sc_threshold 0 -crf 23 \
       -pix_fmt yuv420p -movflags +faststart -an out.mp4
```

That costs **3–6× the file size**, at which point compare it honestly against
[`data-vm-frame`](#property-modules), which already ships as a module, is frame-exact, and needs no re-encoding.
`requestVideoFrameCallback` is Chrome and Safari only; Firefox degrades to coarser scrubbing.

Full analysis in [`docs/VIDEO-SCRUBBING.md`](docs/VIDEO-SCRUBBING.md).

### Width bands

There is no fixed `tablet`/`mobile` any more. **The primitive is a width range**, and a name is an
alias for one.

```html
<div data-vm data-vm-translate-y="0% 0px, 100% 100px; [0-500]: 100% 20px"></div>
```

At 500px and under, that element travels 20px instead of 100 — **and keeps its `0%` start**, because
bands *merge* onto the base rather than replacing it. A band keyframe at a position the base already
has replaces that value; one at a new position is added.

| form | means |
|---|---|
| `[200-500]` | closed range, inclusive both ends — so bands can overlap, and the **last one written wins** |
| `[900+]` | no ceiling |
| `[0-500]` | no floor — there is no `[-500]`, which would read as minus five hundred |

Register names for the ranges you use often, and they work as attribute suffixes:

```js
createMotion({ breakpoints: { phone: [0, 500], wide: [1200, null] } });
```
```html
<div data-vm data-vm-translate-y="100px"
     data-vm-translate-y-phone="20px"
     data-vm-translate-y-wide="200px"></div>
```

`null` is no ceiling. The defaults are `{ mobile: [0, 640], tablet: [641, 1024] }`, so those two
suffixes work with no JavaScript — override the whole map to use your own names and widths.

A property whose keyframes *all* live in bands simply rests at its natural value where none of them
apply. Bands are resolved when the element is measured, not per frame, so the scroll loop never asks
how wide the window is.

### Touch

```js
createMotion({ disableOnTouch: true });
```

Off by default, because most scroll animation is fine on a phone. It is for the effects that are
not — pinning fights momentum scrolling, wide horizontal travel has nowhere to go, and heavy
parallax costs most on the devices least able to pay for it.

Detected with `(pointer: coarse)`, which asks about the **primary input device** rather than whether
the browser understands touch events — a touchscreen laptop with a trackpad answers yes to the
second and no to the first. Watched rather than sampled, so an iPad gaining a trackpad starts
animating. Read it back at `instance.touchDisabled`.

It behaves exactly like reduced motion: elements are still parsed, so `enable()` overrides it
without re-parsing, and content is left in its natural readable state rather than frozen.

### Geometry is cached

Element positions are measured once and re-measured on resize and on relevant DOM changes — never
per frame, because that would force layout on every scroll.

Four things trigger a re-measure, and it is worth knowing which, because the gap is where
`refresh()` earns its place:

- the `load` event, once, if the page was still loading
- a `resize` on the window
- a `ResizeObserver` on `document.documentElement` — this is what catches a font swapping in, a
  lazy image arriving, a component rendering late, a `<details>` opening, anything that changes the
  document's own height
- a `ResizeObserver` on the **scroll container**, when you set `scrollElement` to one. A pane can
  change size while the document does not: a splitter drag, a flex reflow, a panel collapsing

**What none of them see is a layout change confined inside a fixed-height, clipped box.** If an
animated element sits in an `overflow: hidden` container of fixed height and something above it in
that container grows, the document's height does not change and neither does the container's — so
nothing fires. Measured: the element stayed at timeline 0.833 when the correct value was 0.556.

Every ancestor of every element is not observed on purpose; that is a `ResizeObserver` per element
per level, on a page that may have thousands. **Call `refresh()` after a layout change you made
inside a clipped box**, which you know about and the runtime cannot.

**Give your images `width` and `height`.** Not because the runtime cannot cope — it re-measures —
but because a page still reflowing is a page whose geometry was briefly wrong.

### `translate-z` needs `perspective`

`translateZ()` has no visual effect at all without perspective — measured, a 100×100 box stays
100×100. `data-vm-perspective` supplies it as the `perspective()` transform function on the
element itself, so no ancestor has to cooperate:

```html
<div data-vm data-vm-perspective="400px" data-vm-translate-z="0% 0px, 100% 200px"></div>
```

`rotate-x` and `rotate-y` work without it, but read as flat squashing rather than rotation.

### Transform order is fixed

Transform functions do not commute: `translate` then `rotate` is not `rotate` then `translate`. The
order is **translate → rotate → scale → skew**, set by the schema, regardless of the order you write
the attributes. Otherwise the same animation would render differently depending on markup order.

### `data-vm-when` replaces the scroll driver

`data-vm-when` takes a selector. While the element matches it the animation sits at its end;
while it does not, at its start. Everything else is unchanged — keyframes, breakpoints, and the
inertia that makes it ease rather than snap.

It **replaces** the driver rather than adding to it: an element is scroll-driven or state-driven,
never both. `data-vm-run-once` means the same thing on either — play through once and latch.

The selector is an ordinary one and may name an ancestor, which is usually what you want: a class
toggled on a wrapper drives everything inside it.

```html
<section class="panel">
  <div data-vm data-vm-when=".panel.is-open &gt; *"
       data-vm-opacity="0% 0, 100% 1"></div>
</section>
```

```html
<div data-vm data-vm-when=".is-open"
     data-vm-translate-y="0% -14px, 100% 0px" data-vm-opacity="0% 0, 100% 1"></div>
```

```js
panel.classList.toggle('is-open');   // that is the whole integration
```

**It is re-evaluated when an attribute changes, and only then.** A `MutationObserver` watching
attributes is what drives it, so a selector whose truth depends on anything else is not going to be
noticed: `:hover`, `:focus`, `:active`, `:target`, `:checked` on an element the visitor clicked —
none of those change an attribute — and neither does a structural selector like `:first-child` when
a sibling is added. The selector is not refused, because it is valid and because an author may be
toggling a class that happens to contain one; it simply will not be re-read until something on the
element or an ancestor does change an attribute.

For hover and focus, **use CSS**. That is the case the next paragraph is about, and it is the one
where CSS wins outright.

**Plain CSS does the simple version of this in three lines, and you should use it when it fits.**
This earns its place when the element is *also* scroll-animated — inline transforms beat class
rules, so CSS cannot participate — when several properties and keyframes need coordinating, or when
opening a stylesheet is the thing you are trying to avoid. In a Tailwind codebase that last one is
not a small consideration.

### Pinning is `position: sticky`

`data-vm-pin` sets `position: sticky` with your offset, on the edge the instance scrolls
along — `top` by default, `inset-inline-start` when `scrollDirection` is `'horizontal'`, so a
right-to-left scroller pins against its own leading edge. The element never leaves
layout, so nothing jumps when it attaches and nothing collapses when it releases. **How long it
holds is its containing block's extent along that axis** — exactly as CSS sticky behaves. Give the
parent room.

Sticky is conditional, and two of those conditions are invisible from the markup. An ancestor with
any `overflow` other than `visible` between the element and its scroll container becomes the
scrollport, and a containing block no taller than the element leaves nowhere to travel. Measured in
all three engines: in both cases the element does not hold *at all* — it scrolls away as though
`pin` had never been written. Both are reported in `rejected`, live, so the reason appears while it
is true and goes away when a resize or an accordion fixes it. The body clipping its own overflow —
`overflow-x: hidden`, which a great many themes set — is **not** one of these; the body is the
scrollport rather than an obstacle before it, and the check stops there.

### Shadow DOM needs registering

`querySelectorAll` does not pierce shadow boundaries. Pass `root`, or call `observe(shadowRoot)`:

```js
class MyCard extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<div data-vm="fade-up">…</div>`;
    animation.observe(root);
  }
  disconnectedCallback() { animation.unobserve(this.shadowRoot); }
}
```

Geometry across shadow boundaries was verified in Chromium, WebKit and Firefox — `offsetParent`
traverses the flattened tree, so it works identically inside a shadow root, including a closed one.

### `offset-path` does not scale

SVG path following reads the path's coordinates as **CSS pixels** and does not scale them. A
responsive `<svg>` will draw one curve while the element travels along a differently-sized one.
Render the guide at exactly its `viewBox` size, or scale the path data to suit.

### An element inside a transformed ancestor

Geometry comes from `offsetTop`, which is layout position and immune to any
transform. That is deliberate — the element's own animated transform must never
feed back into its own timeline — but it means a transform on an **ancestor** is
invisible to the same reading, and that one moves the element for real.

The runtime measures the difference between where an element is drawn and where
it is laid out, once, before it writes anything. So a wrapper carrying
`transform: translateY(300px)` — page builders emit these for centring and
nudging — animates from where the reader sees it. It did not, and such an
element ran a third of its timeline early.

Two things it deliberately does **not** do:

- **An ancestor transform that changes** is not tracked, and cannot be by
  anything that caches geometry. Animating a parent with this library and a
  child inside it is that case: the child's timeline is measured against where
  the parent started.
- **A right-to-left scroller scrolled horizontally** — container or document —
  is left uncorrected. The axis is already mirrored there and the reading is
  not; applying it anyway undid the mirroring outright. An uncorrected
  displacement starts a timeline early, a wrongly corrected one runs it
  backwards.

### Right-to-left pages and containers

A horizontal timeline reads the way its scroller does — a container, or the
document itself. In an RTL scroller `scrollLeft` is 0 at the **right** edge —
where the content begins — and goes negative as the reader moves through it
(`window.scrollX` behaves identically in an RTL document, measured in all three
engines), while `offsetLeft` stays physical and measured from the left. The
runtime reconciles the two, so `0%` is where the reader starts and `100%` is
where they end up, whichever direction that is.

It did not, and every horizontal timeline in an RTL container ran backwards:
elements sat fully animated before anyone scrolled and un-animated as they went.
A **vertical** timeline was never affected — nothing about it depends on the
inline direction — so an RTL page scrolling normally always behaved.

### The runtime owns the inline styles it animates

An animated element's inline `transform`, `filter` and border radii belong to the instance. It
composes each one and **skips the write when the string is unchanged** — 94% of frames, measured —
which is what keeps the per-element cost at a fraction of a microsecond.

The consequence is worth stating plainly: if something else clears those inline styles, the runtime
does not notice, because noticing would mean reading the DOM every frame and giving up the skip. It
self-heals the moment the value changes — one scroll — but until then the element stays as the other
writer left it.

**Teardown gives them back.** If the page already had one of those properties inline — a builder
emitting `transform: translateX(-50%)` to centre something, which is most of them — the instance
takes it over while it animates and puts it back on `destroy()` or `disable()`. It used to remove
it, so the centring was gone for good the first time an instance tore down. Only inline values are
recorded: a value from a stylesheet needs no restoring, because removing the inline one uncovers it
again.

So: **one instance per element**, and set those properties from CSS rather than inline JavaScript.
Two instances over the same element will fight, and destroying one will leave the other convinced it
has already written what is no longer there. Only the first instance to adopt an element records
what was there — otherwise the second would read the first one's current frame as the page's value
and hand *that* back on teardown, freezing the element at whatever it happened to be showing.
Everything else — classes, other properties, other elements — is yours.

**Two things in your CSS outrank an inline style, and the runtime cannot see either.** Measured in
Chromium, WebKit and Firefox:

| in your stylesheet | what happens | how it looks |
| --- | --- | --- |
| `transform: none !important` | the write is overridden; computed stays `none` | the element never moves, and nothing is reported |
| `animation: … ` touching the same property | the CSS animation wins outright | the element runs the CSS animation only |
| `transition: none !important` | inertia is discarded | values snap rather than easing |

An `!important` declaration in a stylesheet beats any inline value that is not itself `!important`,
and a running CSS animation beats both. The runtime writes inline and never reads back — that is the
skip that keeps a frame cheap — so it cannot tell the difference between a write that took and one
the cascade discarded, and `rejected` stays empty because nothing was refused. If an element
carrying motion attributes is not animating and the attributes are spelled right, **search your CSS
for `!important` and for an `animation` on that element first**. This is the one failure this
library cannot narrate for you.

### Property modules

Some things are a separate import, because most pages never use them and bytes are a correctness
concern here. Each one is a *descriptor* you hand to `wireMotion` — a module never registers itself.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { easings } from '@verajs/motion/easings';
import { paint } from '@verajs/motion/paint';

wireMotion([easings, paint]);
createMotion().init();
```

| module | gives you | size | docs |
|---|---|---|---|
| `@verajs/motion/easings` | `ease` values other than `linear` — the keywords, `cubic-bezier()`, `steps()` | 0.7 KB gzip | [easings](docs/modules/easings.md) |
| `@verajs/motion/paint` | `background`, `color`, `border-color`, `shadow`, `text-shadow` | 0.6 KB gzip | [paint](docs/modules/paint.md) |
| `@verajs/motion/path` | `path`, `path-selector`, `path-rotate` — follow an SVG path | 0.9 KB gzip | [path](docs/modules/path.md) |
| `@verajs/motion/split` | `data-vm-split` — animate by line, word or character | 2.0 KB gzip | [split](docs/modules/split.md) |
| `@verajs/motion/sequence` | `data-vm-frame` and the `frame-*` settings — scroll-scrubbed image sequences | 2.0 KB gzip | [sequence](docs/modules/sequence.md) |

A module that takes options is a factory, and calling it is optional:
`wireMotion(sequence)` uses the defaults, `wireMotion(sequence({ allowedOrigins: ['https://cdn.example'] }))`
permits a CDN. **`allowedOrigins` is no longer an instance option** — it belongs to the module that
fetches things, and an attribute still cannot widen it.

**`wireMotion`, not `wire`.** `@verajs/core` exports `wire` for framework modules and this is a
different registry — motion is dependency-free and cannot share core's. The distinct name says so at
the call site, and **take it from `@verajs/motion`, never from a submodule**: a module registering
through its own inlined copy would write to a table the runtime never reads, and it would not throw.

You can wire your own, too. A property is a plain object, and the apply path is generic over
`cssFunction` and `cssProperty`:

```js
wireMotion({
  attribute: 'tracking', category: 'text', cssProperty: 'letter-spacing',
  defaultUnit: 'px', units: ['px', 'rem', 'em'], initial: 0,
  /** Optional, and worth setting: what a GUI tells an author to import. */
  from: '@your-scope/tracking',
});
```

**`from` is how an editor finds you.** It is the import specifier of the module contributing the
attribute, and it is *absent* for the built-ins — so `getProperty('opacity').from` is `undefined`
while `getProperty('background').from` is `'@verajs/motion/paint'`. A panel iterating the
vocabulary can describe an attribute completely and still leave an author stuck when its module
is not wired; this is the sentence that unsticks them. Optional, because a module that omits it
still works — it simply reads as one of core's.

A property that is not numeric supplies its own `parse` and `apply` — that is all `paint` is. If its
values are *slots in a table* rather than quantities, add `discrete: true`: the runtime then holds
each keyframe's value across its segment instead of interpolating towards the next, because nothing
between two slots means anything. Without it a value halfway between slot 0 and slot 2 rounds to
slot 1, which belongs to some other element.

**A setting declares a `type`; a property declares a `category`.** That is the whole distinction, and
a descriptor carrying both is refused at wiring with a reason rather than resolved by whichever
field is read first — it used to install as a setting, so the property never existed and every
element using it had its attribute refused with the attribute's own name as the whole of the reason.
A property with no `cssProperty`, no `cssFunction` and no `apply` is refused for the same kind of
reason: it would parse values and put them nowhere. Both reasons land in `instance.rejected`.
TypeScript refuses either literal outright; these guards are for JavaScript, which is what a
hand-written page and the GUI both are.

**In TypeScript, the types come from the package.** A module is an exported const, so it needs a
name for its own shape — the same names the first-party modules are written in:

```ts
import { wireMotion } from '@verajs/motion';
import type { Insert, Wirable } from '@verajs/motion';

const teardown: Insert = { on: 'teardown', fn: (owns) => { /* … */ } };
export const tint: readonly Wirable[] = [property, teardown];
```

`Wirable`, `WirableTree`, `WirableFactory`, `Insert`, `InsertMap` and `Easing` are all exported, and
none of them costs a byte. They were not, for a while, and the effect was narrow but exact:
`wireMotion({ … })` inferred a literal fine, while `export const tint: readonly Wirable[]` — which is
what a module *is* — could not be written at all.

### `scroll-behavior: smooth` on the page

The tween writes a scroll position every frame, and with `scroll-behavior: smooth`
in force the browser animates each of those writes — two things animating one
property, and `duration`, `easing` and `offset` all overridden by a rule the
theme set. A very large number of themes set exactly that rule.

So the tween takes `scroll-behavior` for its duration and gives it back: an
inline `auto` while it runs, and whatever was inline before once it finishes or
is interrupted. Nothing needs to be configured, and a page that set its own
inline value keeps it.

Left alone this was not merely slower. The tween ends on elapsed time, so
`onComplete` reported arrival with the page still 1,700px away — and
`manageFocus` moves focus on that signal, sending a keyboard user somewhere the
page had not gone.

A jump with no tween — `duration: 0`, or reduced motion — does not touch it. One
write is the page's business.

### `when` takes a selector list; `path-selector` does not

`when` is evaluated with `element.matches()`, so `when=".menu-open, .search-open"`
means what it looks like: while *either* matches. `path-selector` (from
[`@verajs/motion/path`](docs/modules/path.md)) is handed to `querySelector`,
which returns the first match of any of them — not what anyone writing `a, b`
intends — so a list is refused there.

Both refuse `:has()`, for cost rather than safety: it can be expensive on a large
document and this runs on every mutation. A selector is parsed, never evaluated,
so nothing in one can become code.

### One unit per animation, and it says when you gave it two

The values in one animation are interpolated against each other, so a curve
running from `rem` to `vh` means nothing. A bare number inherits, and **the first
keyframe carrying an explicit unit sets it for the whole animation** — bands
included.

Give it two and it still resolves that way, and now tells you which it used:
`"0% 0px, 100% 40rem"` produced `translateY(40px)` in silence, a sixteenth of
what was asked for.

### An animation can exist only inside a band

Both spellings allow it, and mean the same thing:

```html
<div data-vm data-vm-opacity="[0-700]: 0% 0, 100% 1">
<div data-vm data-vm-opacity-mobile="0% 0, 100% 1">
```

"Fade in on small screens, do nothing on large ones" — no base needed. Outside
the band the element simply does not animate, and nothing is reported, because
nothing is wrong. The named form used to be refused for having no keyframes
while the inline form beside it was accepted.

A base written *blank* is still refused: `opacity=""` is a mistake with intent
behind it, which is a different thing from a base that is not there.

A `-name` attribute may carry bands of its own, and they are **intersected with
the range the name stands for** — narrowest wins. An intersection that comes
out empty is reported: `opacity-mobile="[800-1200]: 0% 0, 100% 1"` against a
`mobile` of 0–640 can never apply at any width, and used to be kept as a band
of `{800, 640}` that matched no viewport while `rejected` stayed empty.

### Boolean settings take three spellings and refuse the rest

A bare attribute is true, the way HTML booleans are: `data-vm-run-once`.
`"true"` and `"false"` are spelled out as well, because the GUI needs a way to
say *off* that survives a round trip.

**Anything else is refused**, not read as off. `run-once="yes"` and
`run-once="1"` both meant *on* to whoever wrote them and both used to come out
off, with nothing said — and being wrong about a boolean is quiet in a way being
wrong about a number is not. Nothing looks broken; the animation simply repeats
when it was asked not to.

### Bad values are dropped, not guessed

A value that fails validation disables *that* animation and leaves the rest of the element working.
Content never ends up hidden, transparent or translated off-screen because a parse failed. Check
`instance.rejected` while developing if something is not animating — it lists every refused
attribute with the element it was on, including elements that produced no animation at all.

**Including refusals about elements the runtime never adopted.** A `split` container carries
`data-vm-split` and usually no bare marker — the animation attributes move to the pieces —
so it is in neither of the lists this is built from, and every refusal about it went unread:
nested markup, an unknown mode, the piece cap, a `pin` that would land on every word. They are all
here now, scoped to the instance's own roots.

**Including refusals a module makes later.** Some things cannot be known at parse time:
`data-vm-frame` on an element that is not a `<canvas>` parses perfectly — `frame` is a real
property and the value is valid — and is refused only when `@verajs/motion/sequence` is handed it.
The same goes for a `frame-url` the origin policy rejects, and for text
[`split`](docs/modules/split.md) will not touch. Those used to reach the console and nothing else,
which is invisible to a GUI; they are in `rejected` now, recorded once however long the page runs.

**And settings that parse but land on nothing.** A [`path-selector`](docs/modules/path.md) that
matches nothing — a typo, or a `<path>` in another root — leaves `path` driving `offset-distance`
along no path at all. It
validates, saves and does nothing; it says so in `rejected` now, which is the only place a GUI can
read.

**And a wired module that misbehaves.** A module that throws in one of its insert points does not
stop the rest of the chain, and an `onProgress` that throws is dropped rather than called sixty
times a second — both were console-only, and both are reported with **`node: null`** now, once per
instance.

**And mistakes in the options, which have no element.** An `ease` the runtime cannot parse, an
`inertia` that is `NaN`, an `onProgress` that is not a function, a `scrollElement` selector that
matches nothing — each falls back to its default and is reported with **`node: null`**, the shape
`createScrollTo` has always used. At most one such entry, and it sorts first, so a reader scanning
the list meets the setup problem before its symptoms.

```js
createMotion({ ease: 'not-an-easing', onProgress: 'nope' }).rejected;
// [{ node: null, rejected: [
//     'ease "not-an-easing" is not usable; using linear.',
//     'onProgress is not a function; ignoring it.',
//   ] }]
```

> **Consumers iterating `rejected` must expect `node` to be null.** It was `Element` and is now
> `Element | null`, so `entry.node.id` no longer type-checks — deliberately, because it would
> otherwise throw the first time an option was wrong.

**One case that is not refused and still surprises people: `position: fixed`.** A scroll timeline
asks "when does this element enter the scroll window", and a fixed element never enters it — it does
not scroll. Geometry is measured by walking `offsetParent`, which is null for a fixed element, so it
reads as sitting at the very top of the document, and starts near the end of its own timeline:
`viewport / (element + viewport)`, which for a 100px element in a 700px viewport is **0.875 at
scroll 0**. Its animation reaches its last keyframe within the first viewport and stays there — it
is over before anyone scrolls. Measured in all three engines by `spikes/fixed-element.mjs`; the
figure depends on the geometry, which is why the formula is quoted with it.

Nothing is broken and nothing is reported, because there is no right answer to give. If you want a
fixed element to animate on scroll, drive it from [`onProgress`](#onprogress) on an element that
does scroll, or give it `data-vm-when` and animate it on state instead.

**`position: sticky` is different, and is handled.** A sticky ancestor *does* have a right answer —
the slot the element occupies in the flow — and `offsetTop` does not give it: it follows the stick,
so an element inside a pinned wrapper reads as sitting wherever the wrapper currently is. That is a
scroll-dependent number, so the measurement depended on when it was taken. An element 850px down
measured 2,200 if the page was scrolled there at the time, which is what a reload part-way down a
sticky section does, and what any re-measure while it is stuck — a resize, a font swap, a lazy image
— did to a running page: the animation jumped backwards and stayed wrong. Sticky ancestors are now
stood down for both readings — the offset walk and the rect — and put back, so the answer is the
same whenever it is asked, and an element inside a sticky wrapper that also carries a transform
still gets the transform corrected.

---

## Accessibility

- **`prefers-reduced-motion` is honoured by default.** Elements are left in their natural, readable
  state — never half-applied, never hidden.
- **`enable()` explicitly overrides it, and keeps overriding it.** That is deliberate: someone who
  personally prefers reduced motion still has to be able to *preview* animations they are
  configuring for visitors. It is an authoring escape hatch. A page that never calls `enable()` stays
  still. Once either `enable()` or `disable()` has been called, the instance stops taking its cue
  from the media queries — it held only until the preference next changed, so a preview vanished the
  second time the visitor's setting moved, and a GUI that had paused with `disable()` found the page
  animating again.
- **The preference is watched, not sampled.** It is a live toggle on macOS and Windows, so turning it
  off mid-session starts the animations — including the ones a module has to *build*. A page loaded
  under reduced motion never splits its text, because `aria-hidden` pieces for an animation that will
  not run are pure cost; turning the preference off splits it then. It did not, and the page stayed
  inert for good while reporting itself enabled. `disableOnTouch` shares the same resolver and the
  same behaviour.
- **Smooth scrolling moves focus.** Preventing an anchor's default also prevents the focus move that
  comes with it, which would strand keyboard and screen-reader users at the top of the document
  while the page visibly scrolls elsewhere. `manageFocus` is on by default and turning it off is a
  genuine regression against a plain `<a href="#x">`.
- **Never animate content out of existence.** If an animation's job is to fade something in, its
  reduced-motion state must be *visible*.

---

## Working with AI agents

The attribute vocabulary was designed with this in mind, and a few things follow from that.

**Point the agent at [`docs/ATTRIBUTE-REFERENCE.md`](docs/ATTRIBUTE-REFERENCE.md).** It is generated
from the schema, so it is complete and current by construction. One file is usually enough context.

**The grammar is guessable, deliberately.** Names were kept long and explicit rather than
abbreviated — `data-vm-translate-y`, not `data-vm-ty` — precisely so a model reaches for the
right one without having read the docs. If an agent guesses an attribute, it is usually right.

**Two attributes are named `*-ease` and they are not interchangeable.** `ease` shapes the curve
(value against scroll position); `inertia-ease` shapes the catch-up. A model reaching for "make this
ease in" wants `ease`. Tell it so explicitly — and that the thing other libraries call momentum,
damping, smoothing, `scrub` or `lerp` is `inertia` here.

**Positions borrow CSS semantics rather than inventing any.** `0%`–`100%` over the scroll window is
what `animation-range: cover` means, so a model assuming CSS behaviour gets the correct result.
A custom unit was designed for this slot and dropped for exactly that reason. Tell the agent to
**prefer `%`** unless a keyframe genuinely needs a viewport-relative or absolute distance.

**Failures are quiet by design, so tell the agent how to check.** An invalid value is dropped rather
than throwing. That is right for production and unhelpful when generating markup, so:

```js
const motion = createMotion();
motion.init();
motion.rejected;   // [] when all is well; otherwise [{ node, rejected: ['grayscale: 100% 100%'] }]
```

Anything in that array is an attribute the runtime refused, paired with the element carrying it —
or, when `node` is `null`, an *option* it refused, which belongs to no element.

This used to read `createMotion().init().elements.flatMap(...)`, which threw — `init()` returns
`void` — and, once corrected, still could not see an element whose *every* animation failed, because
such an element is dropped before it reaches `elements`. That is the one an agent most needs to see.

**Generate from the schema, not from memory.** If you are building tooling that emits these
attributes, import `properties()` / `settings()` / `PRESETS` and derive from them — the functions,
so that whatever the page wired is included. Hand-maintaining a second list is how it goes out of
date.

**A prompt that works well:**

> Animate this markup with @verajs/motion. Use `data-vm-*` attributes only — no JavaScript.
> Prefer presets (`data-vm="fade-up"`) where they fit, and `%` for keyframe positions. `ease`
> shapes the curve; `inertia` and `inertia-ease` shape the follow — do not use one for the other.
> Reference: [paste `docs/ATTRIBUTE-REFERENCE.md`]

---

## Browser support

Modern evergreen browsers. Everything is feature-detected, and an unsupported browser gets **no
animation and readable content** rather than a half-applied state.

`IntersectionObserver`, `ResizeObserver` and `MutationObserver` are used where present and degrade
without them. SVG path following needs `offset-path` (Chrome 55+, Firefox 72+, Safari 16+).

---

## Development

```sh
npm install
npm run dev              # demo page
npm test                 # 422 tests
npm run typecheck
npm run build            # both entries, with size budgets
npm run reference        # regenerate the attribute reference
```

`npm run build` **fails** if any entry exceeds its budget. Budgets ratchet down; raising one is a
deliberate decision that gets recorded, not a quiet edit — the animation budget has been raised
twice, both times written down in `scripts/size.js` with what bought the room.

Two pages worth knowing about:

- `index.html` — the demo, which doubles as documentation. Built with VeraJS components, so it also
  exercises animation inside real shadow roots and across framework re-renders.
- `lab.html` — an inertia lab. Drives the scroll programmatically at a constant rate so inertia can
  be judged without the trackpad's own fling confusing the picture.

Further reading: the [video-scrubbing design notes](docs/VIDEO-SCRUBBING.md), for a feature that is
designed but not built. The published package carries only what a consumer needs: the attribute
reference, the keyframe-syntax notes, and one file per module.

---

## License

MIT © Brian Grider
