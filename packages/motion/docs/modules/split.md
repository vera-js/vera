# `@verajs/motion/split`

Animate a line, word or character at a time — `data-vera-motion-split`.

**2.0 KB gzip.** The only module that rewrites the DOM rather than adding a property.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { split } from '@verajs/motion/split';

wireMotion(split);
createMotion().init();
```

```html
<h1 data-vera-motion data-vera-motion-split="chars" data-vera-motion-stagger="3"
    data-vera-motion-translate-y="0% 20px, 100% 0px">Hello</h1>
```

Modes are `chars`, `words` and `lines`. Lines are **measured from layout**, not guessed from
wrapping in the source, so they survive a resize.

## Splitting alone animates nothing

`split` cuts the text into pieces and hands each piece the element's animation attributes. It does
not cascade them — every piece would then animate in unison, which looks identical to not splitting
at all.

**[`stagger`](../ATTRIBUTE-REFERENCE.md#settings) is what produces the cascade**, and it stays on
the element along with `split`, because both describe the container. The pieces inherit the rest —
`translate-y`, `ease`, `inertia` and so on.

A nested stagger group resolves against its own host and is not counted again by the outer one, so
a split paragraph does not move whatever follows it by a step per word.

## Plain text only

Nested markup is **refused with a warning** rather than flattened. Preserving inline structure
through a split — keeping an `<em>` intact while cutting the words around it — is most of the work
a splitter does, and doing it wrong silently destroys the emphasis rather than the animation.

## Changing the mode

Switching `data-vera-motion-split` from `words` to `chars` takes effect on the next
`instance.collect()`, not on the attribute change itself.

That is not an oversight in this module. `prepare` deliberately never runs from inside the mutation
observer, because a module that rewrites the DOM re-enters the observer by construction — the same
reason content added after `init()` needs `collect()`. **A GUI that changes the split mode must
call `collect()`**, exactly as it must after inserting animated markup.

Until 2026-08-28 it did not take effect even then: `prepare` skipped any node it had already split,
whatever the attribute now said, so a paragraph split as words stayed words for the life of the
page. The module remembers which mode it used, and a different one means restore and re-split.

## When it refuses

**Five** things it says no to, each reported to `instance.rejected` as well as the console.

Three are refusals to split at all: text with nested markup, text containing a **comment node**, and
text that would make more than the piece limit (500).

Two are about the split it does perform. An unknown mode — anything that is not `chars`, `words` or
`lines` — is refused rather than guessed at. And a `data-vera-motion-pin` on the container is
*reported but not obeyed*: `pin` moves to each piece with every other animation attribute, and a
piece cannot hold the container, so the message names the spelling that works — put the pin on a
wrapper around this element.

This section said "three ... and **both**" until 2026-08-31, which is the count it had when it was
written and the word it had before that.

A refused split is the quietest failure this module has. The element still animates, as one block:
a plausible-looking result rather than a missing one, so nobody goes looking for a warning they had
no reason to expect.

## It is synchronous, and that is the point

`split` runs at the `prepare` insert point, before the runtime collects anything, so the pieces it
creates are found by the ordinary scan and nothing downstream knows they were not written by hand.

Being **wired rather than fetched on demand** makes that synchronous, which removed a whole class
of bug the dynamic-import version had: a chunk landing after `disable()`, a chunk landing after
`destroy()`, an element split twice because two paths raced. There is no in-flight window any more.

## Content added after `init()`

`prepare` never runs from inside the mutation observer — a module that rewrites the DOM would
re-enter the observer by construction. So new markup that needs splitting is picked up by the
public **`collect()`**, not automatically.

Attribute changes and removals on existing elements *are* automatic. `collect()` is only needed for
markup a module must prepare.

## `pin` moves too, and cannot mean anything on a word

`pin` says "hold this element against the leading edge while its animation runs", and the element
its author meant is the paragraph. Moved to the pieces it makes every word `position: sticky` inside
the paragraph's own box — each one pinning separately, for the height of a line.

It is reported rather than refused: refusing would abandon the split over a setting, and keeping it
on the container would be worse than useless, because a container carries no marker of its own and
nothing would ever apply it. Put it on a wrapper around the paragraph instead.

## `when` moves with everything else, and that changes its subject

Only `split` and `stagger` stay on the container; every other attribute moves to the pieces, `when`
included. A selector is evaluated against whatever holds it, so
`data-vera-motion-when=".is-open"` on the paragraph becomes the same attribute on every span, each
asking *"do I have `.is-open`?"* — never true. The words never animate, and nothing is refused,
because nothing is wrong: the attribute is valid and it is doing what it says.

Name the container: `data-vera-motion-when=".panel.is-open *"`. The `*` is the whole difference,
and both `.is-open *` and `.is-open p > *` work. Verified in the suite.

## Text the bidi algorithm reorders

A run of text opposing the paragraph's direction — Hebrew or Arabic inside an LTR paragraph, or
Latin inside an RTL one — is **refused**, not split. Pieces are atomic inline boxes and lay out
in source order, so the reordering that makes such a run read correctly is lost the moment it is
split: measured in all three engines, the words come back visually reversed. Text matching its
paragraph's direction splits fine — source order *is* reading order there — so an RTL page
splits its own script without ceremony. The fix the refusal names: give the opposite-direction
run its own element and split that, where it is the base.

## The readable text

Every piece is `aria-hidden`, and the original sentence stays in the element as a
**visually-hidden text copy**, so a screen reader gets the sentence whole. Not `aria-label`:
ARIA 1.2 prohibits naming on the roles a split container usually has (`generic`, `paragraph`),
so a label there works only where an engine is lenient — and a screen reader that follows the
spec would get nothing at all. Real text needs no naming rule.

The honest cost: while the split is live the sentence exists twice in the DOM, so find-in-page
can also match the invisible copy — though `user-select: none` keeps it out of a copied
selection, so pasting a passage does not double it. `destroy()` gives back the single original.

**Unless you wrote an `aria-label` yourself.** That is the name you chose; the module adds no
copy under it and never touches it, before or after `destroy()`.

## Reduced motion, and turning it back off

Nothing is split while nothing will animate — `aria-hidden` pieces for an animation that will not run
are pure cost, so a page loaded under `prefers-reduced-motion` keeps its paragraphs whole.

The preference is a live toggle on macOS and Windows. Turning it **off** while the page is open
splits the text then, because there is nothing to re-style: the pieces this module would have built
are also the elements the runtime would have animated, and neither exists yet. `enable()` always did
this; the media-query listener did not, so a visitor who turned reduced motion off got an instance
reporting `reducedMotion === false` and a paragraph that would never animate for the life of the
page. Plain elements were never affected — those are collected either way, and only what a module
builds went missing.

Turning it back **on** stops the animation and strips the styles but leaves the pieces in place, like
`disable()`. `destroy()` is what puts the text back; see below for why.

## Putting it back

Every split is tracked by the element it was made from, so it can be undone. `release` restores one
element; `teardown` restores all of them, and the module registers both.

Two things this got wrong once, worth knowing if you build on it:

- **`drop()` is bookkeeping, not a farewell.** It runs on re-parse as well as removal, so telling
  `split` an element was leaving on every re-parse un-split the paragraph, `prepare` split it
  again, and the two chased each other until the heap ran out.
- **`observe()` and `unobserve()` must run the full cycle.** A split paragraph in a newly observed
  root was never split, and an unobserved root kept its pieces *and* got re-adopted.
