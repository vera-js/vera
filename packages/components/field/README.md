# @vera-components/field

`<vera-field>` wires a form control you write to its label, hint, character count and errors. It renders nothing:
every part is your own markup, so a server can render the whole field and the script only connects it. Private until
launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/field';

wire([renderer]);
document.body.innerHTML = `
  <form>
    <vera-field>
      <label>Email</label>
      <input type="email" required>
      <small data-vera-part="hint">Your work address.</small>
      <small data-vera-part="error" data-when="valueMissing">Enter your email.</small>
      <small data-vera-part="error" data-when="typeMismatch">That is not an email address.</small>
    </vera-field>
  </form>`;
```

**Parts**, named by `data-vera-part`:

- `control`: the control to wire, when it is not the first labelable element in the field.
- `hint`: help text that describes the control.
- `count`: shows `length / maxlength` for a control with a `maxlength` (the browser's own count, UTF-16 code units).
- `error`: a message. `data-when` names the ValidityState key it is for (`valueMissing`, `typeMismatch`, …);
  `data-when="server"` marks one your server rendered, which stands until the user's first edit; an error part with
  no `data-when` is the catch-all, and one left empty shows the browser's `validationMessage`. Development warns for
  a `data-when` no key matches.

**When errors show.** Not on first render: after the user has tried (an edit and a blur, or a submit). A user's failed
submit focuses the first invalid control in tree order and shows one report, as native validation does; the field
cancels the native bubble unless it has `native-messages`. A form reset hides the errors and forgets that the user
tried. `checkValidity()` from script moves no focus.

**The count speaks** through a polite live region once per crossing: from 80% of the limit, and at the limit, re-armed
only after the length falls back well below the line. The words are yours: `limit-message`, and `count-message` with
`{left}`, or `count-message-<category>` for the plural form of `{left}` in the field's language (the closest `lang`,
through `Intl.PluralRules`: `count-message-one`, `-few`, `-many`, `-other`, …). The English defaults are
"8 characters left", "1 character left" and "Limit reached".
