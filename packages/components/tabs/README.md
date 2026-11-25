# @vera-components/tabs

`<vera-tabs>`: tabs over your own buttons and panels. Private until launch.

**Write buttons and sections.** A direct child marked `slot="tabs"` holds the tab `<button>`s; the host's other
children are the panels. Before the script runs it is buttons and sections (serve the inactive panels with `hidden`).
After it, the element sets the roles, the ids and the `aria-*` wiring, makes the tabs one tab stop moved by the arrow
keys (Home and End too), and shows one panel. It renders nothing of its own and never moves your nodes.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/tabs';

wire([renderer, styles]);
document.body.innerHTML = `
  <vera-tabs>
    <div slot="tabs">
      <button type="button" value="overview">Overview</button>
      <button type="button" value="specs">Specs</button>
    </div>
    <section data-value="overview">The overview.</section>
    <section data-value="specs" hidden>The specs.</section>
  </vera-tabs>`;
```

**Pairing.** A panel is found by key: its `data-value` matching a tab's `value`, or the id a tab's `aria-controls`
names. With no keys, panels pair with tabs in order, skipping headings. A tab without `value` is keyed by its position.

**Selecting.** A press, or an arrow key (with `activation="manual"`, arrows only move focus and Enter or Space
selects), fires `beforetabchange`, cancelable, then `tabchange`, both bubbling, with
`detail: { value, previous, reason }`. They are not `change`, which a form control inside a panel already fires through
the host. Writing `value` (the attribute or the property) selects that tab and fires nothing. If the selected tab is
disabled later, the next enabled tab takes over and `tabchange` says `reason: 'disabled'`. A natively `disabled` tab
is skipped by the arrows; an `aria-disabled="true"` tab stays reachable and cannot be chosen.

**Find in page.** Inactive panels are `hidden="until-found"` where the engine has it, so the browser's find reaches
their text, reveals the panel, and the element selects its tab (`reason: 'find'`, not cancelable: the browser has
already shown it). `findable="false"` hides them fully. A page rule giving hidden elements `display: none` blocks
this, and development says so.

**A panel takes focus** when it holds nothing focusable (`tabindex="0"`, read when it is shown), so a keyboard user
reaches its text.

**The indicator** under the selected tab is the tablist's own `::after`, anchored to that tab with CSS anchor
positioning: it follows a tab's resize with no measurement, and slides between tabs on Chromium and WebKit (Firefox
moves it straight to the new tab). Without anchor positioning the selected tab draws its own underline and nothing
slides. An `::after` of your own on the tablist container wins (the
look is zero specificity), and then the indicator is not drawn. `orientation="vertical"` makes the tablist a column and
runs the rule and the indicator down its inline-start side, the labels aligned to it. `data-vera-look="none"` on the host drops the look.

Every name is in `custom-elements.json`.

**Theming.** `<vera-tabs>`'s look reads the same `--vera-*` tokens every Vera component reads (`--vera-accent`,
`--vera-radius`, `--vera-surface`, `--vera-fg` and the rest its `custom-elements.json` lists), so one `:root` block
restyles every component on the page. Dark mode follows the page: with `color-scheme: light dark` on `:root` the
defaults switch with the system, and with no `color-scheme` they are the light ones. The look's floor is the engines
with CSS `light-dark()` (Chromium 123, Firefox 120, Safari 17.5); the behavior works below it.
