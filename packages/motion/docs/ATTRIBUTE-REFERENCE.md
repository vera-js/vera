# Attribute reference

> **Generated from `src/modules/schema.ts` and the shipped modules — do not edit by hand.**
> Run `npm run reference` to regenerate. `npm run check:reference` fails if it is stale.

Every attribute is namespaced `data-vm`. An element must carry the bare
`data-vm` marker to be picked up at all — CSS has no attribute-prefix selector, so
the marker is what lets the runtime find animated elements without walking the whole document.

**An HTML element.** Every measurement here is `offsetTop`, `offsetHeight` and `offsetParent`,
which no SVG interface has — so a marked `<rect>` is refused rather than animated to
`translateY(NaNpx)`, which is what it used to be. Animate a wrapper around the `<svg>` instead.
The element the instance was given as its `root` **is** included, marker and all: a section can
fade in and stagger its own children.

**Values are bounded at a billion.** Not because engines refuse more — re-measured 2026-09-01,
all three accept `translateY(1e+21px)`, exponential spelling and all, and this reference used to
say otherwise. What actually breaks past the bound is arithmetic and engine saturation: rounding
to three decimals multiplies by 1000, which loses integer precision above ~9e12, and Chromium
silently clamps a transform's translation near 3.36e7px, so an enormous value renders as a
different number than was written. A billion stays under all of that, leaves room for an
overshooting curve, and no layout is a billion pixels.

## Grammar

```
data-vm                              marker (required), or a preset name
data-vm-<property>="v"               animate to v
data-vm-<property>="p v, p v, …"     keyframes: position then value
data-vm-<property>="… ; [a-b]: …"    a width band, merged over the base
data-vm-<property>-<name>            the same, by a registered name
data-vm-<setting>="v"                element-level setting
```

- **A bare value is the end of the timeline.** `data-vm-opacity="0"` fades *to* 0, and the
  missing end is filled from the property's resting value.
- **A position always carries a unit; a value may or may not.** That is what makes a lone number
  unambiguously a value, so the two forms can share one attribute.
- **Position units:** `%`, `vh`, `vw`, `px`, `rem`. **Value units** are per-property — see below.
  The two are independent: `data-vm-rotate="-200px 0deg, 100% 720deg"` is valid.
- **Up to 256 keyframes**, and up to 32 width bands, per attribute. There is no *midpoint* limit — the old two-midpoint cap is gone — but there is a ceiling, and going over it is reported rather than silently truncated.
- **Width bands merge onto the base.** `"0% 0px, 100% 100px; [0-500]: 100% 20px"` keeps the
  start and overrides only the end. A band keyframe at a new position is added.
- **`[a-b]` is closed, `[a+]` has no ceiling.** An open bottom is `[0-b]`, which cannot be
  misread as a negative number.
- **Bands are inclusive at both ends, so they can overlap — and the last one written wins.**
  `[0-700]` and `[700+]` is the obvious way to write a partition and both match at exactly
  700; the `[700+]` applies there because it comes second. Write `[0-699]` if you want the
  edge to belong to the lower band. Overlap is allowed rather than refused, because a
  deliberate `[0-900]` base with a `[0-500]` correction over it is a reasonable thing to write.
- **A name is only an alias for a range**, registered on the instance:
  `createMotion({ breakpoints: { phone: [0, 500] } })` then `data-vm-opacity-phone="0"`.
- **One bad entry drops itself, not the property.** `"0% 0, junk, 100% 1"` keeps two keyframes.

### Timeline positions

`0%` is the moment the element begins entering the scroll window; `100%` is the moment it has
completely left. The scroll window is the element's own size plus the viewport, so an element
animates across rather more scrolling than its own height — and the measure is normalised per
element, which is why one preset looks right on a badge and on a full-bleed hero.

This is what CSS means by a percentage in `animation-range`, whose default range is `cover` —
the same quantity. Assuming CSS semantics here gives the correct behaviour.

Positions outside `0–100%` extrapolate, and negatives are written plainly:

```html
<div data-vm data-vm-opacity="-50% 0, 25% 1">   <!-- starts half a window early -->
<div data-vm data-vm-rotate="0% 0deg, 150% 90deg">  <!-- exits mid-flight, never reaching 90 -->
```

**Prefer `%`.** It is geometry-free, so it never needs recomputing. The length units are for the
cases percentages cannot express — `"-30vh 0"` means "half a viewport before it enters" regardless
of how tall the element is. Curves using them are rebuilt on resize, which costs nothing on a page
that does not use them.

### The one readability trap

```html
data-vm-translate-y="50% 50%"
                       ↑    └── value → 50% of the element's own height (CSS)
                       └─────── position → 50% through the scroll window
```

Never ambiguous to the parser — the position is always first — and both readings are correct for
their slot. CSS has the same overlap between `animation-range: cover 50%` and `translateY(50%)`.

## Modules

Some of the attribute surface ships as separate imports, because most pages never use them and
bytes are a correctness concern here. Each is a descriptor handed to `wireMotion` — a module
never registers itself.

**An attribute whose module is not wired does nothing** and is reported in `instance.rejected`.

| module | adds | documentation |
|---|---|---|
| `@verajs/motion/easings` | no attributes of its own — it makes `ease` values other than `linear` work | [easings](modules/easings.md) |
| `@verajs/motion/paint` | `background`, `color`, `border-color`, `shadow`, `text-shadow` | [paint](modules/paint.md) |
| `@verajs/motion/path` | `path`, `path-selector`, `path-rotate` | [path](modules/path.md) |
| `@verajs/motion/split` | `split` | [split](modules/split.md) |
| `@verajs/motion/sequence` | `frame`, `frame-url`, `frame-count`, `frame-pad`, `frame-ext`, `frame-tween` | [sequence](modules/sequence.md) |

## Properties

Units: `px`, `deg`, `%`, `rem`, `em`, `vh`, `vw`, or none.

### transform

Composed into a single `transform` string, in the order listed here. CSS transform functions do not commute, so this order is fixed by the schema rather than by the order you write the attributes.

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-translate-x` | `translateX()` | `px` `rem` `em` `%` `vh` `vw` | — | 0 | core |
| `data-vm-translate-y` | `translateY()` | `px` `rem` `em` `%` `vh` `vw` | — | 0 | core |
| `data-vm-translate-z` | `translateZ()` | `px` `rem` `em` `%` `vh` `vw` | — | 0 | core |
| `data-vm-rotate` | `rotate()` | `deg` | — | 0 | core |
| `data-vm-rotate-x` | `rotateX()` | `deg` | — | 0 | core |
| `data-vm-rotate-y` | `rotateY()` | `deg` | — | 0 | core |
| `data-vm-scale` | `scale()` | — | ≥ 0 | 1 | core |
| `data-vm-scale-x` | `scaleX()` | — | ≥ 0 | 1 | core |
| `data-vm-scale-y` | `scaleY()` | — | ≥ 0 | 1 | core |
| `data-vm-skew-x` | `skewX()` | `deg` | — | 0 | core |
| `data-vm-skew-y` | `skewY()` | `deg` | — | 0 | core |

### filter

Composed into a single `filter` string.

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-opacity` | `opacity()` | — | 0 … 1 | 1 | core |
| `data-vm-blur` | `blur()` | `px` `rem` `em` | ≥ 0 | 0 | core |
| `data-vm-brightness` | `brightness()` | — | ≥ 0 | 1 | core |
| `data-vm-contrast` | `contrast()` | — | ≥ 0 | 1 | core |
| `data-vm-saturate` | `saturate()` | — | ≥ 0 | 1 | core |
| `data-vm-grayscale` | `grayscale()` | — | 0 … 1 | 0 | core |

### border

Written as individual CSS properties.

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-radius` | `border-radius` | `px` `rem` `em` `%` `vh` `vw` | ≥ 0 | 0 | core |
| `data-vm-radius-top-left` | `border-top-left-radius` | `px` `rem` `em` `%` `vh` `vw` | ≥ 0 | 0 | core |
| `data-vm-radius-top-right` | `border-top-right-radius` | `px` `rem` `em` `%` `vh` `vw` | ≥ 0 | 0 | core |
| `data-vm-radius-bottom-left` | `border-bottom-left-radius` | `px` `rem` `em` `%` `vh` `vw` | ≥ 0 | 0 | core |
| `data-vm-radius-bottom-right` | `border-bottom-right-radius` | `px` `rem` `em` `%` `vh` `vw` | ≥ 0 | 0 | core |

### paint

Written as individual CSS properties, and **not interpolated**. Each authored value takes a slot, the ordinary numeric curve steps between slots, and the value is written as a string — CSS transitions do the animating, which is what `inertia` already sets up. Any colour, gradient or shadow the engine accepts is valid, because `CSS.supports()` is the parser; `url()` is refused, since an attribute must not be able to make a request.

**A separate module.** Nothing here works until it is wired — the attribute parses, finds no
property by that name, and is reported in `rejected`.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { paint } from '@verajs/motion/paint';

wireMotion(paint);
```

Full documentation: [@verajs/motion/paint](modules/paint.md).

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-background` | `background` | — | — | — | [`@verajs/motion/paint`](modules/paint.md) |
| `data-vm-color` | `color` | — | — | — | [`@verajs/motion/paint`](modules/paint.md) |
| `data-vm-border-color` | `border-color` | — | — | — | [`@verajs/motion/paint`](modules/paint.md) |
| `data-vm-shadow` | `box-shadow` | — | — | — | [`@verajs/motion/paint`](modules/paint.md) |
| `data-vm-text-shadow` | `text-shadow` | — | — | — | [`@verajs/motion/paint`](modules/paint.md) |

### svgPath

Drives `offset-distance`. Set `data-vm-path-selector` to the `<path>` whose shape to follow.

**A separate module.** Nothing here works until it is wired — the attribute parses, finds no
property by that name, and is reported in `rejected`.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { path } from '@verajs/motion/path';

wireMotion(path);
```

Full documentation: [@verajs/motion/path](modules/path.md).

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-path` | `offset-distance` | `%` | 0 … 100 | 0 | [`@verajs/motion/path`](modules/path.md) |

### image

Drives a `<canvas>` rather than a style. Requires `data-vm-frame-url` and `data-vm-frame-count`. Frames are drawn to fill the canvas's `width`/`height` **attributes**, which default to 300×150 whatever CSS says — set them to the frames' own size. The module is wired, not loaded on demand — being synchronous is what removed a class of bug the dynamic-import version had.

**A separate module.** Nothing here works until it is wired — the attribute parses, finds no
property by that name, and is reported in `rejected`.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { sequence } from '@verajs/motion/sequence';

wireMotion(sequence);
```

Full documentation: [@verajs/motion/sequence](modules/sequence.md).

| attribute | CSS | units | range | resting value | from |
|---|---|---|---|---|---|
| `data-vm-frame` | `—` | — | ≥ 0 | 0 | [`@verajs/motion/sequence`](modules/sequence.md) |

## Settings

Element-level. Property and setting names are deliberately disjoint, so `data-vm-<name>`
always resolves unambiguously.

Every value is validated, and a numeric setting is range-checked exactly as a property value is —
an attribute is untrusted whichever slot it fills. A value outside its range is **dropped**, so the
instance default applies, and the attribute name appears in `rejected`.

| attribute | type | range | from | notes |
|---|---|---|---|---|
| `data-vm-inertia` | `number` | 0 … 3600 | core | How much the element resists the position scroll says it should be at, in seconds. `0` tracks scroll exactly. Default `0.1` — see **Two easings** below. |
| `data-vm-pin` | `length` | — | core | Hold the element against the leading edge of the viewport at this offset while its animation runs — `top` for a vertical instance, `inset-inline-start` for a horizontal one, so a right-to-left scroller pins against its own leading edge. `position: sticky` underneath, so how long it holds is its containing block's extent along that axis. A clipping ancestor, or a containing block with no room to travel, turns sticky off entirely; both are reported in `rejected`. |
| `data-vm-perspective` | `length` | — | core | Depth for the 3D properties, as a distance from the viewer. **`translate-z` does nothing without it** — measured, `translateZ(200px)` leaves a 100x100 box at 100x100 with no perspective and doubles it with one. `rotate-x` and `rotate-y` work either way but read as flat squashing without it. Applied as the `perspective()` transform function on the element itself, so it needs no cooperation from surrounding markup. A `translate-z` with **neither** this nor a CSS `perspective` on an ancestor is reported in `rejected` — the sentence above was measured fact here for as long as the attribute existed while the runtime wrote `translateZ()` in silence, which is the worst of both. The value itself must be a **non-negative length** — a negative one or a percentage is refused, because CSS rejects `perspective()` for either and this function composes at the *front* of the transform, so an invalid one drops the element's translate, rotate and scale with it. |
| `data-vm-transform-inertia` | `number` | 0 … 3600 | core | Overrides `inertia` for transforms only, so one element can move fast and fade slowly. |
| `data-vm-filter-inertia` | `number` | 0 … 3600 | core | Overrides `inertia` for filters only. |
| `data-vm-inertia-ease` | `easing` | — | core | Timing function of the **catch-up**, handed to CSS. Because the target is rewritten every frame, this is effectively a stiffness control — see **Two easings**. |
| `data-vm-ease` | `easing` | — | core | Timing function of the **curve** — how value relates to scroll position. Default `linear`. Applies per segment, as `@keyframes` does. **Anything other than `linear` requires [`@verajs/motion/easings`](modules/easings.md)**; without it the runtime warns once and every curve stays straight. Not to be confused with `inertia-ease`, which is handed to CSS and needs no module. |
| `data-vm-run-once` | `boolean` | — | core | Play through once and latch. Means the same on either driver — later scrolling, or the selector no longer matching, will not walk it back. |
| `data-vm-when` | `selector` | — | core | Drive this element from a selector match instead of from scroll. At the animation's end while the element matches, at its start while it does not. **Replaces** the scroll driver — an element is one or the other, never both. A selector **list** is accepted and means what it looks like: while either matches. `:has()` is refused. Re-evaluated when an attribute changes and only then, so `:hover`, `:focus`, `:active`, `:target`, `:checked` and friends cannot be seen at all — a selector using one is **refused**, and the element animates on scroll instead. Use CSS for those. Because it replaces the driver, what depended on the driver goes with it: `ease` and `stagger` are refused on a `when` element, and the *page is too short to finish this* diagnostic never fires for one — it reaches its end when the selector matches, whatever the page height. |
| `data-vm-stagger` | `offset` | — | core | Goes on a **parent**. Offsets each animated descendant's keyframes by `index x value`, so a row arrives one after another instead of in unison. `%` by default; any position unit works and is normalised the same way a keyframe position is. Negative runs the row in reverse. **Scroll-driven descendants only** — it offsets a scroll timeline, and `data-vm-when` replaces the scroll driver, so a state-driven child takes no offset and is reported in `rejected`. A host with **no animated descendants at all** is reported as well, marked or not — it is on an unmarked parent by design, which is what made that the quiet case. |
| `data-vm-will-change` | `boolean` | — | core | Hint the compositor, naming the properties this element actually animates. Use sparingly — it costs memory per element. |
| `data-vm-transform-origin` | `origin` | — | core | CSS `transform-origin`, and the real grammar rather than "one to three keywords or lengths": `[left\|center\|right\|<len>] [top\|center\|bottom\|<len>]`, or two keywords in **either** order with one per axis, plus an optional third value that must be a length. So `top bottom`, `top top` and `center center center` are refused, and — read off three engines rather than the specification — `10px top` is legal where `top 10px` is not. |
| `data-vm-path-selector` | `selector` | — | [`@verajs/motion/path`](modules/path.md) | Selects the `<path>` a `path` animation follows. Resolved within the element's own root, so it works inside a shadow root. If it matches nothing, matches an element with no `d`, or matches a `d` the sanitiser will not pass through, `path` does nothing and `rejected` says which. |
| `data-vm-path-rotate` | `string` | `auto` `reverse` `0deg` | [`@verajs/motion/path`](modules/path.md) | Orientation along the path. `auto` follows the tangent; default keeps it upright. |
| `data-vm-split` | `string` | `chars` `words` `lines` | [`@verajs/motion/split`](modules/split.md) | Splits the element's text into `chars`, `words` or `lines` so each piece animates on its own. The pieces inherit the animation attributes; the element keeps `stagger`, which is what cascades them. Plain text only: nested markup is refused with a warning, and so are comments — a comment node is how several frameworks anchor themselves in a page. Refused too when the element has **no animation attributes to give the pieces**: splitting then hides the text behind `aria-hidden` and buys nothing. |
| `data-vm-frame-url` | `string` | — | [`@verajs/motion/sequence`](modules/sequence.md) | Base URL of an image sequence, ending in a slash. Frames are fetched as `<url><n>.jpg`, **numbered from 1** and zero-padded to `frame-pad` digits — so `/seq/` with the default padding asks for `/seq/0001.jpg`. The extension comes from `frame-ext`, default `jpg`. **Same-origin unless the instance allowlists otherwise** — an attribute cannot widen this. |
| `data-vm-frame-count` | `number` | 1 … 10000 | [`@verajs/motion/sequence`](modules/sequence.md) | How many frames the sequence has. |
| `data-vm-frame-pad` | `number` | 1 … 12 | [`@verajs/motion/sequence`](modules/sequence.md) | Zero-padding width of the frame number in the filename. Default 4 → `0001.jpg`. |
| `data-vm-frame-ext` | `string` | `jpg` `jpeg` `png` `webp` `avif` | [`@verajs/motion/sequence`](modules/sequence.md) | Frame file extension, without the dot. One of `jpg`, `jpeg`, `png`, `webp`, `avif`. Default `jpg`. A sequence is the heaviest thing this library loads, and `webp` is typically 30-50% smaller than `jpg` at the same quality. |
| `data-vm-frame-tween` | `boolean` | — | [`@verajs/motion/sequence`](modules/sequence.md) | Cross-fade adjacent frames instead of snapping to the nearest. A bare attribute means true. **Off by default, for performance**: snapping redraws only when the rounded frame changes, cross-fading redraws whenever the position moves and draws twice when it does. Worth it below roughly 100 frames, where stepping is visible; a dense sequence does not need it. The blend is positional — a scroll that stops mid-way holds a blend rather than finishing one. |

**A `cubic-bezier()` needs its `x` co-ordinates in 0-1**, in either slot. `y` may go anywhere —
a control point above 1 or below 0 is how a springy curve overshoots and settles back — but an
`x` outside the range is not a function of progress at all, and every engine refuses it. Accepted
here it would reach `inertia-ease` verbatim, build a `transition` the CSSOM drops whole, and leave
**no transition at all**, which is inertia silently off. Refused instead.

## Two easings, and what each one is for

`ease` and `inertia-ease` take the same vocabulary and do entirely different jobs. They are the
one thing in this API most likely to be misread, so:

| | `ease` | `inertia-ease` |
|---|---|---|
| shapes | the **curve** — value against scroll position | the **catch-up** — how the element reaches that value |
| evaluated by | this library, once per animation per frame | CSS, on the compositor |
| default | `linear` | `cubic-bezier(0.33, 1, 0.68, 1)` |
| effect at `inertia: 0` | full | **none** — there is no transition to shape |
| effect on a `when` element | **none** — it sits at one endpoint, never between keyframes | full |

**Both of those "none" cells are refused, not merely true.** Each was documented here and
accepted in silence by the runtime, which is the worst of both: the reference said the attribute
does nothing and the library let you write it anyway. `ease` on a `data-vm-when` element
and `inertia-ease` at an effective `inertia` of 0 both land in `instance.rejected`, naming the one
that does work instead. `inertia-ease` counts the instance default when the element sets no
`inertia` of its own, and stays quiet when a `transform-inertia` or `filter-inertia` above zero
brings the catch-up back.

```html
<div data-vm
     data-vm-translate-y="0% 0px, 100% 500px"
     data-vm-ease="ease-in"             <!-- creeps, then rushes -->
     data-vm-inertia="0.1"              <!-- how much it trails -->
     data-vm-inertia-ease="ease-out">   <!-- shape of the trailing -->
```

**Why the curve cannot be CSS.** A `transition` runs on a timer and has no way to ask where the
scrollbar is, so the value has to be computed from scroll position by this library either way.
The one CSS mechanism that does know is `animation-timeline`, and an animation overrides a
transition — so using it would mean giving up inertia entirely. Measured in Chromium and WebKit;
Firefox has no `animation-timeline` at all.

**What `inertia-ease` really controls.** The runtime rewrites the transition's target every frame,
so only the first ~17% of the curve is ever traversed. What matters is its slope near the start,
which makes it a stiffness control rather than a shape one. Measured at `inertia: 0.1`:

| `inertia-ease` | trails the scroll by |
|---|---|
| `cubic-bezier(0.33, 1, 0.68, 1)` (default) | 8px |
| `ease-out` | 17px |
| `linear` | 30px |
| `ease-in-out` | 94px |
| `ease-in` | 113px |

A control point above `1` — `cubic-bezier(0.34, 1.56, 0.64, 1)` — overshoots and settles back, in
either slot. On `ease` that means overshooting against **scroll position**; on `inertia-ease` it is
a spring in the catch-up.

### One name for this idea

The thing `inertia` controls is called momentum, damping, smoothing, `scrub` and `lerp` by
different tools. **Here it is inertia, and only inertia** — there is no `momentum`, `damping` or
`scrub` attribute, and there will not be. Inertia is the physically apt term: a property you set
that governs resistance to a change in motion, where momentum is an instantaneous quantity that
could not be a constant. Its shape is `inertia-ease`, and its per-category overrides are
`transform-inertia` and `filter-inertia`.

## Presets

A name on the marker attribute. Presets expand into ordinary keyframes, so they are never a
special case — they produce exactly what writing the attributes by hand would. An explicit
attribute for the same property replaces the preset's contribution for that property.

A **band** does not. `data-vm="fade"` with
`data-vm-opacity-mobile="0% 0.5, 100% 1"` fades everywhere and fades differently below
that width — the suffixed attribute says where the animation differs, not that the preset was a
mistake. A band written inline, `data-vm-opacity="[0-700]: 0% 0.5, 100% 1"`, is an
explicit attribute for the property and does replace the preset outright.

| preset | expands to |
|---|---|
| `data-vm="fade"` | `data-vm-opacity="0% 0, 100% 1"` |
| `data-vm="fade-up"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-translate-y="0% 40px, 100% 0px"` |
| `data-vm="fade-down"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-translate-y="0% -40px, 100% 0px"` |
| `data-vm="fade-left"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-translate-x="0% 40px, 100% 0px"` |
| `data-vm="fade-right"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-translate-x="0% -40px, 100% 0px"` |
| `data-vm="zoom-in"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-scale="0% 0.8, 100% 1"` |
| `data-vm="zoom-out"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-scale="0% 1.2, 100% 1"` |
| `data-vm="slide-up"` | `data-vm-translate-y="0% 100px, 100% 0px"` |
| `data-vm="slide-down"` | `data-vm-translate-y="0% -100px, 100% 0px"` |
| `data-vm="blur-in"` | `data-vm-opacity="0% 0, 100% 1"` · `data-vm-blur="0% 12px, 100% 0px"` |

## Validation

Attribute values are untrusted input — in a CMS, anyone who can edit a block can set them.
Every value is checked before it reaches the DOM, and **a value that fails is dropped rather than
guessed at**. The rest of the element keeps working.

| what | rule |
|---|---|
| numbers | `-?digits[.digits]` with an optional unit from the allowlist, range-checked against the property |
| units | fixed allowlist per property; anything else is rejected |
| urls | same-origin unless the **instance** allowlists an origin. `javascript:`, `data:`, `blob:`, `vbscript:`, `file:` and protocol-relative are refused |
| selectors | conservative shape only, verified against the browser parser |
| SVG path data | restricted to the alphabet path data can legally contain, and must begin with a moveto |

Nothing resembling `calc()`, `url()`, `var()`, `attr()` or a CSS function survives validation.

**Failures are safe.** A dropped animation leaves content in its natural, readable state — never
hidden, transparent, or translated off-screen.

---

_29 properties · 20 settings · 10 presets, across core and 5 modules_
