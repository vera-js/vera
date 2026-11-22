# @vera-components/spinner

`<vera-spinner>` shows that something is busy: a turning arc, decorative to assistive technology, whose `label` a
screen reader hears once, through the document's one polite live region (`@vera-hooks/announce`), when the wait lasts
past a short settle window. A fast load says nothing. Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/spinner';

wire([renderer]);
document.body.innerHTML = '<vera-spinner label="Loading results" done-label="Results loaded"></vera-spinner>';
```

Use `<progress>` instead when you know how far along the work is: it says how much is done, and it needs no script.

## What a screen reader hears

- **`label`, once, about 150 ms after the spinner connects**, if it is still connected then. A spinner removed inside
  that window says nothing, so a quick load never interrupts anyone.
- **One load per label.** Spinners with the same label are one load: twenty rows that start loading together say
  "Loading" once, and so does a framework that replaces its spinner with a new element on every render. The load ends
  a settle window after the last spinner with that label leaves; one still on the page anywhere keeps the label's load
  running, so a second "Loading" elsewhere stays silent ("still loading" is true). Give two loads different labels to
  hear both. Under a renderer scheduler that runs effects late (`frameBudget`, a long task), a replacement
  arriving more than a settle window after the spinner it replaces is a new load: the done label, then the label again.
- **`done-label`, once, when the load ends**, and only if its label was said. When spinners of one label give
  different done labels, the first one given is said.
- **Nothing inside an `aria-busy="true"` owner** (any ancestor, across shadow roots), read when the window closes: the
  owner speaks for what is busy inside it. An owner that says nothing itself (a grid or feed marked busy) leaves the
  load unspoken, so give such an owner its own announcement, or leave `aria-busy` off and let the spinner speak.
- The host never takes `role="status"`: a live region inserted with its text already inside is spoken inconsistently.
- **Development warns** (`spinner-silent`) when a spinner has no label and no busy owner, once the settle window has
  passed.

On the server, and before script runs, nothing is announced: the busy state is visual only until the element connects.

## Look

- The arc is `1em` square and takes `currentColor`, so it fits beside text and inside a button. Its rule is adopted
  by the element itself, so it draws whether or not the app wired `@verajs/styles`.
- Tokens: `--vera-spinner-size`, `--vera-spinner-width` (the stroke), `--vera-spinner-color` (the turning segment),
  `--vera-spinner-track` (the rest of the ring).
- `show-label` also shows the label, as plain text after the arc.
- Under `prefers-reduced-motion: reduce` the arc pulses slowly instead of turning, so "busy" stays visible. In forced
  colors it keeps two system colors, so it is still seen to move.
- `data-vera-look="none"` on the host or on a part drops our look; the parts stay.
- Every rule is at zero specificity (`:where`), and keyed on the parts, never the tag, so `defineAs('my-spinner')`
  draws the same and any rule of yours wins.

## Parts

`arc` (`aria-hidden`) and `label` (only with `show-label` and a label), each as `data-vera-part`. Each also carries
`data-vera-spinner`, and our rules ask for it, so another component's part with the same name never gets the
spinner's look; style a part by its `data-vera-part` as usual.

## Before script runs

A server-rendered spinner turns before any script: the server returns the arc's rule in its `styles`. On a page with
no server markup, link `@vera-components/spinner/preupgrade.css` and an empty `<vera-spinner>` turns until the
element is defined (in `@layer vera`, so your CSS wins). It is keyed on the default tag; under `defineAs('my-spinner')`,
write the same rule for your tag. Nothing is announced until script runs.
