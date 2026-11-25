# @vera-components/dialog

`<vera-dialog>`: a modal dialog over your own `<dialog>`. Private until launch.

**Write a `<dialog>`.** Its direct child `<dialog>` is the dialog: your heading, content, form and buttons, left where
you wrote them in light DOM. The platform does the modal work: the top layer, everything outside made inert, Escape,
the first focus (put `autofocus` where it should land) and focus back to what opened it. A `<form method="dialog">`
inside closes it and sets its `returnValue`. The element adds the wiring the platform leaves to you, and renders
nothing of its own.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/dialog';

wire([renderer, styles]);
document.body.innerHTML = `
  <vera-dialog>
    <button slot="trigger">Edit profile</button>
    <dialog>
      <h2>Edit profile</h2>
      <form method="dialog">
        <label>Name <input name="name" autofocus></label>
        <button value="cancel" formnovalidate>Cancel</button>
        <button value="save">Save</button>
      </form>
    </dialog>
  </vera-dialog>`;
```

**Opening.** A direct child `<button slot="trigger">` opens it: the element gives it the platform's `commandfor` and
`command="show-modal"`, so where the engine has invokers it opens before any script runs; elsewhere a click opens it.
Any `<button commandfor="<the dialog's id>" command="show-modal">` on the page opens it too, but only where the engine
has invokers: without script nothing can wire a button the element was not given. The host's `open` attribute opens it
as a modal (at load too); removing it closes it.

**Bound state stays in step.** `open` goes both ways: an app that binds it (`<vera-dialog open={isOpen}>`) sees a user's
close remove it, whether by Escape, a form, an invoker or a press outside, and the `<dialog>` fires the platform's
`close`, so the bound state can follow. An open that a `beforetoggle` listener cancels removes it too, and is not tried
again. Moving an open `<vera-dialog>` (a portal, a re-keyed list) keeps it open: it is shown as
a modal again where it lands, and the `<dialog>` fires one `close` and `toggle` pair as it does. The `<dialog>`'s own
`open` attribute is HTML's non-modal one; leave it alone.

**Closing.** Every user close but a form's goes through the platform's cancelable `cancel` on the `<dialog>`: Escape, an
invoker with `command="request-close"`, and a press outside. Cancel it to keep the dialog open, for a form with unsaved
changes. Two platform rules apply: a form submission closes without `cancel` (listen to `submit` too), and a second
Escape always closes, whatever `cancel` did.

**A press outside** closes it only with `dismiss="outside"` (read when the element connects), and only when both the press and its release land outside
the dialog: dragging out of a text field, or using the dialog's own scrollbar, does not close it. Where the engine has
the platform's `closedby`, the element sets `closedby="any"`; elsewhere it applies the same rule itself. An
`role="alertdialog"` never closes on a press outside.

**Its name.** With no `aria-label` or `aria-labelledby`, the dialog is named by its first heading (or an element marked
`data-vera-part="title"`), and described by an element marked `data-vera-part="description"`. An unnamed dialog makes
development say so. An alert dialog (`role="alertdialog"` on the `<dialog>`) also needs a description and an
`autofocus` on its least destructive button, and development says when either is missing.

**Focus back.** The platform returns focus to what opened the dialog. When that is gone by the time it closes, focus goes
to the trigger.

**The page does not scroll** while a dialog is open, and the dialog's own scrolling does not chain to the page.

**Placement.** `placement="end"`, `"start"` or `"bottom"` docks the dialog to that edge, full height (or full width for
bottom), sliding in: a sheet. Default: centered. Entry fades or slides in on every engine; the exit animates where the
engine can, and is instant in Firefox. `data-vera-look="none"` on the host drops the look and keeps the scroll lock and
the placement.

**Popups above an open dialog.** A modal dialog makes everything outside it inert, including a toast or a select's list
shown on top of it. Render those inside the open `<dialog>`.

Every name is in `custom-elements.json`.

**Theming.** `<vera-dialog>`'s look reads the same `--vera-*` tokens every Vera component reads (`--vera-accent`,
`--vera-radius`, `--vera-surface`, `--vera-fg` and the rest its `custom-elements.json` lists), so one `:root` block
restyles every component on the page. Dark mode follows the page: with `color-scheme: light dark` on `:root` the
defaults switch with the system, and with no `color-scheme` they are the light ones. The look's floor is the engines
with CSS `light-dark()` (Chromium 123, Firefox 120, Safari 17.5); the behavior works below it.
