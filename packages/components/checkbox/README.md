# @vera-components/checkbox

`<vera-checkbox>` and `<vera-switch>`: a checkbox and a switch around your own `<input type="checkbox">`. The input
stays the form participant, so submit, reset, `<fieldset disabled>`, autofill and back/forward restore are the
platform's, and it works before the script runs. Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/checkbox';

wire([renderer]);
document.body.innerHTML = `
  <vera-checkbox><label><input type="checkbox" name="terms"> I accept the terms</label></vera-checkbox>
  <vera-checkbox indeterminate><label><input type="checkbox" name="all"> Select all</label></vera-checkbox>
  <vera-switch><label><input type="checkbox" name="wifi" checked> Wi-Fi</label></vera-switch>`;
```

## Your input, required

There is no default render: a control made by the script would be no control before the script runs. Write the input
inside the element and label it yourself, with a wrapping `<label>`, a `<label for>`, or `<vera-field>`. In
development, a host with no checkbox input warns `checkbox-no-control`, and an input whose labels give no text warns
`checkbox-no-name` (an empty `<label>` around the input is the usual cause).

The element writes only marks onto the input (`data-vera-checkbox` or `data-vera-switch`, and the switch's semantics)
and takes them off when the input leaves it, so an input a framework swaps is served and the old one is left as you
wrote it.

## Mixed

`indeterminate` on `<vera-checkbox>` sets the input's `indeterminate` property, which has no attribute of its own. A
click on a mixed box is the platform's: it clears mixed and flips `checked`, and the attribute goes with it. A click
that a listener cancels keeps both, as the platform restores them. What mixed means next (a parent of several boxes)
is yours.

## The switch

`<vera-switch>` uses the platform's `switch` attribute where the engine has it (Safari 17.4 and later today) and
`role="switch"` where it does not, never both; a `role` you wrote is kept. It submits exactly as a checkbox does. Some
screen readers announce a switch as a checkbox, so its label names the setting and never changes with its state.

## The look

Drawn on the input itself (`appearance: none`), from the platform's own states (`:checked`, `:indeterminate`,
`:disabled`, `:focus-visible`), so it follows the input whatever changed it. Every selector is zero specificity, so
any rule of yours wins. The input's own box is a target of at least 24 × 24 CSS px at any font size (WCAG 2.2, 2.5.8):
a transparent ring around the visible box makes up the difference. The switch's thumb moves to the inline end when on,
mirrors under `dir="rtl"`, and jumps instead of sliding under reduced motion. In forced colors every color is a system
color. `data-vera-look="none"` on the element (or the input) leaves the engine's own control; the element's is read
when the input is served, so to change it later, set it on the input.

Tokens: `--vera-accent`, `--vera-accent-fg`, `--vera-border-control`, `--vera-focus`, `--vera-hover`,
`--vera-surface`.

## Your own tags

`@vera-components/checkbox/element` registers nothing at import: `defineAs(tag)` and `defineSwitchAs(tag)` register
the checkbox and the switch under tags of your own and return their classes.
