# `@verajs/motion/sequence`

Scroll-scrubbed image sequences — `data-vera-motion-frame` and the `frame-*` settings.

**2.0 KB gzip**, the largest of the modules, and the one whose *assets* dwarf the library entirely.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { sequence } from '@verajs/motion/sequence';

wireMotion(sequence);
createMotion().init();
```

```html
<canvas width="1280" height="720"
        data-vera-motion
        data-vera-motion-frame="0% 1, 100% 120"
        data-vera-motion-frame-url="/seq/"
        data-vera-motion-frame-count="120"
        data-vera-motion-frame-ext="webp"></canvas>
```

**Give the canvas `width` and `height`.** Each frame is drawn to fill the canvas's *bitmap*, and a
`<canvas>` with no attributes is 300×150 whatever CSS says — so a sequence of 1280×720 frames comes
out squashed into that. Match the attributes to the frames' aspect ratio and size the element with
CSS. This example carried no attributes for a while, which is a poor thing for the first thing a
reader copies to teach.

## It paints a canvas, not a style

`frame` is the one property that writes no CSS at all — it draws to a `<canvas>`. Two consequences:

- The element **must be a `<canvas>`**, and its `width`/`height` attributes are the size the frames
  are drawn at — not whatever CSS gives it.
- Anything that verifies animation by reading styles is blind to it. A harness that compared
  thousands of style cells reported this feature working while it drew nothing; it now checks
  pixels and network requests instead.

## Where the frames come from

`frame-url` is a **prefix**, and the frame number is appended to it directly. A trailing slash makes
it a directory — `/seq/` gives `/seq/0003.jpg` — and anything else makes it a filename stem:
`/seq/shot-` gives `/seq/shot-0003.jpg`, which is a common way for an export to be named. Nothing
enforces the slash, so leaving it off `/seq` builds `/seq0003.jpg` and every fetch 404s; that is
reported now rather than leaving a blank canvas. Frames are fetched as `<url><n>.<ext>`,
**numbered from 1** and zero-padded to `frame-pad` digits.

So `/seq/` with the defaults asks for `/seq/0001.jpg`. Defaults are `frame-pad: 4` and
`frame-ext: jpg`; allowed extensions are `jpg`, `jpeg`, `png`, `webp` and `avif`.

**Prefer `webp`.** A sequence is by far the heaviest thing this library will make a page load, and
webp is typically 30–50% smaller than jpg at the same quality.

## Smoothing a short sequence — `frame-tween`

`draw()` picks a whole frame, so a sequence scrubbed slowly steps visibly. `frame-tween` blends the
two frames either side of the position instead:

```html
<canvas width="1280" height="720"
        data-vera-motion
        data-vera-motion-frame="0% 1, 100% 60"
        data-vera-motion-frame-url="/seq/"
        data-vera-motion-frame-count="60"
        data-vera-motion-frame-tween></canvas>
```

A bare attribute means true, as HTML's own booleans do.

**It is off by default, and that is a performance decision.** Snapping redraws only when the rounded
frame changes — on a long scroll, a fraction of the frames. Cross-fading redraws whenever the
position moves at all, and draws *twice* when it does. Worth it below roughly 100 frames, where the
stepping is visible; a 300-frame sequence is dense enough not to need it.

**The blend is positional, not temporal.** The opacity of the upper frame is the fractional part of
the scroll-derived position, so a scroll that stops halfway between two frames *holds* a blend
rather than finishing one. This is why the pre-rewrite library's `tweenDuration` has no equivalent
here: a duration describes a fade running on its own clock, which is exactly what a scrubbed
sequence must not do.

Three things it deliberately does not do:

- **It never blends onto a substituted frame.** When the frame you want has not arrived,
  `nearestLoaded` draws a different one — and blending that frame's neighbour would cross-fade two
  images, neither of which is where the scroll is. The substitute is drawn alone.
- **It never blends past the end.** The position is clamped before the pair is chosen.
- **It restores `globalAlpha`.** The context belongs to the canvas, not to this module, so a page
  drawing its own overlay into the same canvas is unaffected.

Movement below 1/64 of a frame interval skips the redraw entirely — finer than a viewer can
distinguish in a blend of two photographs, and enough that a very slow scroll costs nothing.

## Same-origin by default, and an attribute cannot widen it

Frames are fetched from the page's own origin unless the *instance* says otherwise. This is the one
module that takes options, which is why it is a factory:

```js
wireMotion(sequence);                                              // same-origin only
wireMotion(sequence({ allowedOrigins: ['https://cdn.example'] })); // plus that CDN
```

Calling it is optional — `wireMotion(sequence)` uses the defaults.

**`allowedOrigins` is not an instance option.** It belongs to the module that actually fetches
things, and no attribute on any element can widen it. The attributes are a public API with three
authors — people, a GUI, and AI — so an attribute that could reach a new origin would be a hole
that all three could open.

## What it registers

One property (`frame`) and five settings (`frame-url`, `frame-count`, `frame-pad`, `frame-ext`,
`frame-tween`).

The settings are declared by this module rather than by core, which is what stops the runtime
reporting `data-vera-motion-frame-url` as an unknown attribute on every element that uses it. See
the [attribute reference](../ATTRIBUTE-REFERENCE.md#image) for ranges and defaults.

## The origin allowlist

`sequence({ allowedOrigins })` takes full origins **as a list**. An entry is normalised through
`new URL(entry).origin`, so `https://cdn.example`, `https://cdn.example/` and
`https://cdn.example/some/path` all mean the same thing — the first two matched nothing until
2026-08-28, which refused every frame and reported it against the element rather than against the
allowlist.

**A lone string is refused, not wrapped.** `allowedOrigins: 'https://cdn.example'` threw `flatMap is
not a function` out of the factory until 2026-08-31, at module scope, before any instance existed. It
now records the refusal in every instance's `rejected` and leaves the allowlist **empty**, which is
the boundary a page that declared nothing gets — a security option fails closed. Write a list of one.

A **bare host** is refused and warned about: resolving `cdn.example` means guessing a scheme, and
guessing `https:` for something the owner may have meant as `http:` is not a favour to do silently
on a security boundary. One unusable entry does not discard the usable ones beside it.

## When it refuses

Four things this module will not do to an **element**, each reported **both** to the console and to
`instance.rejected`: a `frame` on an element that is not a `<canvas>`, a missing or
origin-refused `frame-url`, a `frame-count` that is not a positive number, and a canvas with no 2D
context. Two more belong to the **page** rather than to any element — an `allowedOrigins` that is
not a list, and an entry in one that is not a url — and reach the same list with `node: null`,
because wiring happens before any instance exists.

A frame whose fetch fails is the fifth, and is reported once per sequence rather than once per
frame; it is also **asked for once**, not re-requested on every scroll movement, which cost 1,170
requests for 54 distinct urls across 30 draws before 2026-08-31.

None of them is knowable at parse time — `frame` is a real property and `0% 0, 100% 9` is a valid
value, so the attribute parses and the element is perfectly healthy right up until this module is
handed it. That is why the refusal has its own channel: a parse-time diagnostic list could never
have contained it, and a console warning is invisible to the GUI that renders `rejected`.

Recorded once, however many frames the page runs for.

All four are asserted in `test/module-rejections.test.js` and planted as mutations. Two of them
were not, and could be deleted outright with the whole suite green — the 2D-context one being the
most-executed refusal in the suite, since happy-dom gives no canvas a context.

## Editing a setting after the first frame

The decoder is built once, on the first frame drawn, and cached against the element — decoding is
the expensive part and nothing here wants to repeat it per frame. It is rebuilt when any `frame-*`
attribute on that element differs from the one it was built with, and that comparison runs from
`prepare`: on `init()`, and on every `collect()`.

So an edit takes effect the way every other attribute edit does — write the attribute, call
`collect()`. Before this, `release` was the only thing that dropped a decoder, and `release` runs
on removal rather than on a re-parse, so **every `frame-*` setting was frozen at the first frame
drawn**: a new `frame-url` re-parsed cleanly, updated `element.parsed.settings`, and changed
nothing on screen. A refusal was cached the same way and had the same problem in the other
direction — a canvas refused for a url the policy would not permit stayed refused, so correcting
the url did nothing.

The comparison is not in the draw path. It reads five attributes, and the draw path runs per frame
per element.

## Teardown

The module registers `release` and `teardown`, so a removed element forgets its decoded frames and
`destroy()` forgets all of them. Decoded image data is the largest thing this library ever holds,
so this is not a formality. `release` also drops the element's cached refusal, which is retained by
a plain `Map` — it was a `WeakSet` when it only had to warn once, and widening it to carry the
reason gave it a strong reference to every canvas it ever refused.

## Give the canvas a name and a poster

A `<canvas>` is invisible to assistive technology unless you say what it shows, and its pixels
are this module's only output — so both halves are yours to author:

```html
<canvas role="img" aria-label="The product rotating a full turn as you scroll"
        style="background: url(frames/0119.avif) center / cover"
        data-vera-motion data-vera-motion-frame="0% 0, 100% 119"
        data-vera-motion-frame-url="frames/" data-vera-motion-frame-count="120"></canvas>
```

`role="img"` with an `aria-label` gives a screen reader the one sentence the animation is worth.
The CSS background is the poster: a visitor whose instance never animates — `prefers-reduced-motion`
disables the whole instance, and nothing draws into a canvas that never animates — otherwise gets a
blank rectangle where the content should be.

**Pick the frame that is the content at rest, which is usually the *last* one.** Frame 0 is the
start of the animation, and a sequence that builds something in starts from an empty stage — the
one frame that shows nothing. This is the same rule the rest of the library follows for free:
under reduced motion an animated element sits in its natural CSS position, which is the *end* of
its journey, because authors write content in place and animate away from it. The poster is where
you make your canvas do likewise; only you know which frame that is.
