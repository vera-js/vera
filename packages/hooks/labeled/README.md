# @vera-hooks/labeled

`labeled`: wires a control to its label, hint, count and errors through the platform's own id references, and gives
back exactly what it found. Private until launch.

```js
import { labeled } from '@vera-hooks/labeled';

const wiring = labeled(input, { host: field, label, hint, count, errors: [required, tooLong] });
wiring.show(required); // described, and aria-invalid="true"
wiring.show(null);     // no error shown
wiring.release();      // every attribute back as it was found
```

- **Named the native way.** A labelable control (`input`, `select`, `textarea`, `button`, `meter`, `output`,
  `progress`, or a form-associated custom element) is named by `label[for]`; any other focus target (a `role=combobox`
  part) by `aria-labelledby`. Hint and count are always in `aria-describedby`; an error joins it only while shown.
- **`host` is your component's element.** When two components wire the same control, the one whose host is nearer the
  control owns the wiring, whatever order they ran in; a farther caller gets a handle that does nothing. The same host
  wiring again replaces its own wiring, so after a re-run setup the newest handle is the live one.
- **Ids.** An element that has an id keeps it. One that has none, and is referenced, gets `vu<n>` from one counter
  shared by every copy of the library on the page. The control itself gets an id only when `label[for]` needs one. A
  number already used in the control's root is skipped, **at wiring time only**: an element you insert later with the
  same id still collides, so ids are unique on a best-effort basis.
- **Release.** `release()` puts back every value it replaced and removes only the tokens it added, so a token your page
  adds meanwhile survives. Wiring that was already there when the hook ran (a server render's ids and references, after
  hydration) was not added by this call, so it stays.
- **Wire a form-associated element after its upgrade** (`await customElements.whenDefined(tag)`): before it, the
  element is not labelable yet, so it is named through `aria-labelledby`, and stays so.
- **Never decide "is this labeled" from `control.labels`.** Firefox keeps a `labels` list it has handed out stale when
  a `for` is set afterwards, and a server DOM may not have `labels` at all. The hook compares each label's `for`.
- **Development warns** (each code is in `diagnostics.json`): a part in a different root from the control is not wired
  (an id reference cannot cross a shadow boundary); an id with whitespace cannot be a token; a control left with no
  accessible name, once per control.
