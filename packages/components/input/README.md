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
| `scale` | `sm`, `md` or `lg`, for the styles layer. Not `size`, which on `<input>` already means a width in characters (development warns on a host `size`). |

Each option adds its part when it is set and removes it, with its listeners, when it is removed. With no option set,
the element adds nothing and listens to nothing.

## Clearing

The clear button is out of the tab order: from the keyboard, select all and press Delete, or press Escape in a
`type="search"` input (except while a composite's list is open: Escape closes the list then). Clearing goes through the
browser's own editing, so Ctrl+Z or Cmd+Z brings the text back, and the `input` event it fires
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

## Look

- The clear and reveal buttons draw their glyphs (× and ● / ○) as generated content with empty alt text: each button
  is named by its label, never by its glyph. The loading mark is a small turning ring in
  `currentColor`; under `prefers-reduced-motion: reduce` it pulses slowly instead, so "busy" stays visible, and in
  forced colors it keeps two system colors.
- The rules are adopted by the element itself, so the buttons are seen whether or not the app wired `@verajs/styles`.
- Tokens: `--vera-radius` (the buttons' corners) and `--vera-focus` (their focus ring).
- Every rule is at zero specificity (`:where`) and keyed on the parts, never the tag, so `defineAs('my-input')` looks
  the same and any rule of yours wins, a utility class on a part included. A hidden part stays hidden.
- `data-vera-look="none"` on the host or on a part drops our look; the parts stay.

## Before the script runs

Your input is already a working input with your prefix and suffix text around it: it can be focused, typed in and
submitted before `<vera-input>` is defined, and with no script at all. A default input (when you wrote none) exists
before the script only when a server rendered it.
