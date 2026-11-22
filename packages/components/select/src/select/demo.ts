import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-select>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface). Select is the older component, before the design system
 * pass: its look will be redone, so the ask is about behavior.
 */
const FLAVORS =
  '<optgroup label="Classics"><option value="vanilla">Vanilla</option><option value="chocolate" data-description="the safe pick">Chocolate</option></optgroup>' +
  '<vera-option value="pistachio" data-group="Modern"><svg slot="icon" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg> Pistachio<span slot="description">polarizing, correctly</span></vera-option>' +
  '<option value="strawberry" data-group="Modern">Strawberry</option>';

export const selectDemo = {
  ask: "Its look will be redone in the design pass, so judge the behavior: open it, move with the arrow keys, type a letter to jump, search, pick several. Does anything feel slower or stranger than a native select?",
  states: [
    {
      title: 'Single, required, with groups, an icon and a description',
      markup: `<form><vera-select name="flavor" placeholder="Pick a flavor" required required-message="Pick a flavor first" aria-label="Flavor">${FLAVORS}</vera-select></form>`,
    },
    { title: 'An initial value', markup: `<vera-select name="flavor" value="chocolate" aria-label="Flavor">${FLAVORS}</vera-select>` },
    {
      title: 'Several, as chips, clearable',
      markup:
        '<vera-select multi clearable clear-message="Clear all" remove-message="Remove {label}" aria-label="Toppings"><vera-option value="sprinkles" selected><svg slot="icon" viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="7" width="10" height="2" fill="currentColor"/></svg> Sprinkles</vera-option><option value="fudge" selected>Fudge</option><option value="nuts">Nuts</option></vera-select>',
    },
    {
      title: 'Searchable, and creatable',
      markup: `<vera-select searchable creatable search-placeholder="Type a flavor" create-message="Add “{label}”" results-message="{count} flavors" empty-message="No flavor by that name" aria-label="Flavor">${FLAVORS}</vera-select>`,
    },
    {
      title: 'Remote, loading, with an overflow line',
      note: 'The page owns filtering; edits emit the filter event',
      markup:
        '<vera-select remote loading debounce="300" loading-message="Finding flavors…" overflow-message="1,250 more flavors" aria-label="Flavor"><option value="vanilla">Vanilla</option></vera-select>',
    },
    { title: 'Disabled', markup: `<vera-select disabled aria-label="Flavor">${FLAVORS}</vera-select>` },
    { title: 'In light DOM', note: 'light: rendered into the page, styled by its scoped sheet', markup: `<vera-select light aria-label="Flavor">${FLAVORS}</vera-select>` },
  ],
} as const satisfies ComponentDemo;
