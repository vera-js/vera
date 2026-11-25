# @vera-components/input

`<vera-input>` wraps your own `<input>` and adds what a text field usually needs around it: your prefix and suffix, a
clear button that keeps the input's undo history, a password reveal, a caps-lock hint and a loading state. Your input stays the form participant, so
autofill, password managers, validity, form reset, `<fieldset disabled>` and the back-forward cache are all the
browser's. Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/input';

wire([renderer]);
document.body.innerHTML =
  '<label>Search <vera-input clearable><input type="search" name="q"></vera-input></label>';
```

`<vera-input>` never labels: put it in a `<label>`, point a `<label for>` at the input, or wrap it in `<vera-field>`.
Development warns when the input has no accessible name.

## Your input, or a default one

The input is yours, read where it is and never moved; `[data-vera-part="prefix"]` and `[data-vera-part="suffix"]` are
your own content around it. With no `<input>` inside, the element renders one, `[data-vera-part="input"]`, from its own
`name`, `type`, `value`, `placeholder` and `autocomplete`, and only those (never markup). A server renders it too.

**Those five are read once, when the default input is rendered.** From then on the input is the source of truth: a later
change to the host's `placeholder` (say) does not reach it, and development says so. Change the input itself, or write
your own.

An input the page replaces (a framework's re-render, of the input or of a wrapper around it) is followed: every part
moves beside the new input, and the old one is let go.

The input served is the first `<input>` in the element that is not inside another custom element: an input inside
another custom element is that element's, not the field's (a component in your prefix keeps its own, and so does a
wrapper element of your own, so write your input outside it). An input that arrives after the element connected (a renderer that appends a parent before its
children, or a page parsed after the definition ran) takes over from the default one, which is dropped.

## Options

| Attribute | What it does |
| --- | --- |
| `clearable` | A clear button after the input, shown while there is something to clear: a value, on an input that is neither disabled (a disabled `<fieldset>` included) nor read-only, and not while a composite around it has its list open (`aria-expanded="true"` on the input). |
| `clear-label` | The clear button's accessible name. Default `"Clear"`. |
| `loading` | `aria-busy="true"` on the input and an `aria-hidden` loading mark after it. Nothing is announced. An `aria-busy` you wrote yourself is left as yours. |
| `reveal` | On a `type="password"` input, a show/hide button after it, in the tab order, with `aria-pressed` for its state. |
| `reveal-label` | The reveal button's accessible name. Default `"Show password"`. |
| `caps-lock-hint` | A hint after the input while Caps Lock is on, shown and announced. |
| `caps-lock-message` | What the hint shows and says. Default `"Caps Lock is on"`. |
| `scale` | `sm`, `md` or `lg`: the box's font size, which the input and its parts follow: `md` the page's, `sm` and `lg` smaller and larger than it; with no `scale` the page's size too. Not `size`, which on `<input>` already means a width in characters (development warns on a host `size`). |

Each option adds its part when it is set and removes it, with its listeners, when it is removed. With no option set,
the element adds nothing and listens to nothing.

## Clearing

The clear button is out of the tab order: from the keyboard, select all and press Delete, or press Escape in a
`type="search"` input (except while a composite's list is open: Escape closes the list then). Clearing goes through the
browser's own editing, so Ctrl+Z or Cmd+Z undoes it as it undoes your own deletion, and the `input` event it fires
(`inputType: "deleteContentBackward"`) is a trusted one that frameworks read as typing. Where the browser refuses that
editing command, the value is set directly and `input` and `change` events are dispatched from the input's own window.
Focus ends in the input.

## Loading

`aria-busy` goes on the input, never on `<vera-input>`: a busy ancestor of a focused field lets a screen reader hold
back the field's own content. A `<vera-spinner>` you put inside speaks for itself, once; the input says nothing of its
own, so the two never both speak.

## Reveal

The input is a password field again before anything could keep its text: when its form submits (before the browser
reads it, so form history and the save-password prompt see a password), when the page is hidden (so the back-forward
cache keeps it hidden), and when `reveal` is removed. On any other input type `reveal` does nothing, and development
says so.

## Caps Lock

The hint reads Caps Lock from the input's own key events, the only reliable source, so it appears at the first key
pressed with Caps Lock on, not at focus. It is announced once per focus, through `@vera-hooks/announce`, and is never
only visual.

## Number inputs

A `type="number"` input keeps the browser's own spinner. Three choices, by what the page wants:

- **The browser's spinner**: nothing to do. It sits inside the box, drawn as the browser draws it.
- **No spinner**, a plain number box (the keyboard's arrows still step it): your own rule,
  `vera-input input[type="number"] { appearance: textfield }` and
  `vera-input input[type="number"]::-webkit-inner-spin-button { appearance: none; margin: 0 }`.
- **Our stepper**: wire `@vera-components/input/stepper` once. Every number input served after that gets
  `[data-vera-part="step-down"]` and `[data-vera-part="step-up"]` beside it, inside `[data-vera-part="stepper"]`,
  which is `aria-hidden`, and the browser's spinner is hidden in that box, so there is one stepper, not two.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/input';
import { stepper } from '@vera-components/input/stepper';

wire([renderer, stepper]);
document.body.innerHTML = '<label>Quantity <vera-input><input type="number" value="3" min="0" max="10"></vera-input></label>';
```

**Wire it before your inputs are served**, as every module is wired at startup: an input served before
`wire([stepper])` keeps the browser's spinner. A page that does not wire it carries none of its code or rules.

A press steps by the input's `step` (by 1 under `step="any"`), within its `min` and `max`, and held, repeats after a
pause, as the browser's own spinner does: `input` fires per step that moved the value, and `change` once, when the
press ends. The parts are a pointer's way only, never focused (a press keeps focus in the input): the input is a
spinbutton, and the keyboard steps it with the arrow keys. A disabled or read-only input steps nothing. Each part is
1.5em square, 24px on a 16px page. With `data-vera-look="none"` on the host the parts are unstyled and the browser's
spinner stays.

## Look

- **The box is the element**: a hairline border, rounded corners, the surface and text colors, 2.25em tall (36px on a
  16px page), with your input borderless inside it and the clear, reveal and loading parts beside it, inside the
  border. Focus anywhere in the box (the input, or the clear and reveal buttons, by mouse too) draws one ring around
  it; the border turns to the danger color on an input marked
  `aria-invalid="true"` or one the user has left invalid. A disabled input dims the box.
- The clear and reveal buttons draw their glyphs (× and ● / ○) as generated content with empty alt text: each button
  is named by its label, never by its glyph. The loading mark is a small turning ring in
  `currentColor`; under `prefers-reduced-motion: reduce` it pulses slowly instead, so "busy" stays visible, and in
  forced colors it keeps two system colors.
- On a clearable search input, the browser's own cancel button is hidden, so there is one clear glyph, not two.
- The rules are adopted by the element itself, so the buttons are seen whether or not the app wired `@verajs/styles`.
- The shared tokens: `--vera-border-control` (the box's edge, at least 3:1 against the surface in both schemes, as
  WCAG 1.4.11 asks of the edge that shows where a control is), `--vera-radius`, `--vera-surface`, `--vera-fg`, `--vera-fg-muted` (the
  placeholder), `--vera-focus` (the ring), `--vera-hover` (a step part under the pointer) and `--vera-danger`. Set them on `:root` to restyle every component at once;
  dark mode follows the page's `color-scheme` (`:root { color-scheme: light dark }`). The look needs `light-dark()`
  (Chromium 123, Firefox 120, Safari 17.5); below that, a token you have not set is left unset.
- Every rule is at zero specificity (`:where`) and keyed on the parts, never the tag, so `defineAs('my-input')` looks
  the same and any rule of yours wins, a utility class on a part included. A hidden part stays hidden. One exception:
  the input inside the box keeps its border, background, padding, font and outline reset above a page's ordinary
  `input` rules (a reset's, a framework's `.form-control`), because a rule styling the input inside the box draws a box
  inside the box. To style the input yourself, set `data-vera-look="none"` on the host. Development warns when a rule
  stronger still (an id, `!important`) draws a border on the input inside the box.
- `data-vera-look="none"` on the host or on a part drops our look; the parts stay.

## Before the script runs

Your input is already a working input with your prefix and suffix text around it: it can be focused, typed in and
submitted before `<vera-input>` is defined, and with no script at all. A default input (when you wrote none) exists
before the script only when a server rendered it.

**On a page that wires light-DOM slots** (`@verajs/renderer/slots`, for another component), `<vera-input>` keeps its children where you wrote them: they are its own, not content for a `<slot>`.
