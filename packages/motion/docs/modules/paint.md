# `@verajs/motion/paint`

Colour, gradients and shadows — `background`, `color`, `border-color`, `shadow`, `text-shadow`.

**0.6 KB gzip.** A separate module because most pages animate geometry and never touch colour, and
because the runtime is deliberately kept from ever learning what a colour is.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { paint } from '@verajs/motion/paint';

wireMotion(paint);
createMotion().init();
```

Attributes and their CSS targets are in the [attribute reference](../ATTRIBUTE-REFERENCE.md#paint).

## Nothing here is interpolated

This is the part worth understanding, because it changes how the attributes behave.

Every authored value takes a **slot**. The ordinary numeric curve steps between slots, and `apply`
writes the slot's string:

```html
<div data-vm data-vm-background="0% white, 100% rebeccapurple">
```

That is two slots. The property is declared `discrete`, which tells the runtime these numbers are
not on a number line: it **holds** each keyframe's value across its segment instead of interpolating
towards the next, so the change lands *at* the keyframe rather than halfway to it.

**So `ease` does nothing here, and cannot.** `ease` reshapes progress *within a segment*, the way
`@keyframes` applies a timing function — and a held segment has one value from end to end, so
reshaping the journey across it changes nothing. The segment boundaries are the keyframe positions,
which no easing moves. Write `data-vm-ease="ease-in"` beside a `background` and the colour
still changes exactly at the keyframe. It is not refused, because it is not wrong on the element —
the same `ease` shapes any *numeric* property beside it, and usually that is the point.

That flag is load-bearing, not a description. The slot table is shared by every paint property on
the page and deduped by value, so the slots one element uses are **not adjacent**:

```html
<div data-vm data-vm-background="0% red, 100% blue">   <!-- slots 0, 1 -->
<div data-vm data-vm-background="0% red, 100% green">  <!-- slots 0, 2 -->
```

Interpolated, the second element ran 0 → 2 and the floor of the middle of that range is 1 — so
across the middle of its scroll window it painted **blue**, a colour it never mentions and the first
element's. Held, it shows red until it steps to green. The same crossing reached across properties,
too: `color` and `background` share the table, so a `color` animation could pick up a slot holding a
gradient or a shadow.

Which means the module on its own produces a **hard switch**. The smoothness comes from
[`inertia`](../../README.md#inertia): the runtime already sets up a CSS transition for the catch-up,
and a transition on `background` is what actually animates the colour. With `inertia: 0` there is no
transition, and the colour snaps at each keyframe. That is not a limitation being worked around —
CSS transitions interpolate colour correctly across every colour space, and reimplementing that
would cost far more than 0.6 KB and be worse.

The consequence for authors: **paint properties want `inertia` greater than 0.** Everything else in
the library works either way.

## Both ends must be authored

A paint property has no numeric resting value to fill a missing end from, which is why the reference
shows `—` in that column. `data-vm-color="red"` gives the runtime one slot and nothing to
travel from, so write both keyframes.

A lone keyframe now **holds**, which is the only meaning one value can have. It used to fill the
missing end from the property's `initial` — the number 0, which for a slot table is not a resting
value but *whichever value the page minted first*. So `color="0% crimson"` animated crimson to
another element's colour, and since the five paint properties share one table it need not even have
been a colour: a `color` could travel to a `background` gradient. Nothing was rejected, because
nothing was invalid. The same applies when every keyframe sits in a width band that does not match —
the element rests on its own first value rather than on slot 0.

## The engine is the parser

Validation is `CSS.supports(property, value)` — the browser is asked whether it would accept the
declaration. That is smaller than any hand-written parser and strictly more correct: it understands
every colour space, every gradient form, and every syntax added after this was written.

Two refusals are ours rather than the engine's:

- **`url()` is refused.** Everything else here is inert; a url is a *request*. The runtime's origin
  policy exists precisely so an attribute cannot reach past it, and an image belongs in CSS where
  the page author already controls it.
- **Values longer than 400 characters are refused**, which bounds the slot table's input.

A refused value disables that one animation and lands in `instance.rejected`, like any other.

## The slot table only grows

A slot can never be reclaimed: the number is baked into a curve the runtime has already built, and
reusing one would repaint whatever still holds it in the wrong colour.

So the table grows, and its input is every distinct value ever **parsed** — not every value
currently on the page. Two hundred cards sharing one gradient share one slot; an editing session
that rewrites the attribute on every drag of a colour picker mints a slot per intermediate colour,
forever. That is a GUI editor's exact usage pattern, which is why the bound exists.

**Past 1,024 distinct values the module refuses and says so once**, in `rejected`, where a GUI can
show it.

**Know what that costs in an editing session, because it is not one animation.** For a page that
genuinely ships a thousand distinct colours, the bound costs the thousand-and-first — a fair
trade. For an editor it is different in kind: the session mints the values, so reaching the bound
says nothing about the design being built, and past it **every later colour is refused for the
life of the page**. The picker stops responding, the element keeps whatever it last resolved, and
the only recovery is a reload — measured: `destroy()`, removing the element and building a fresh
instance all leave the table full, because it is module state that outlives every instance. At one
value per `pointermove` a picker mints roughly sixty a second, so the bound is about seventeen
seconds of cumulative dragging, not a thousand deliberate choices.

If you are embedding this in an editor, **debounce the attribute write** — commit a colour when the
drag ends rather than on every move — and the table counts choices instead of frames, which is
what the bound was sized for.
