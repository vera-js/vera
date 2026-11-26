import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-checkbox>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface, so an attribute or part added to the element is shown here
 * in the same change).
 */
export const checkboxDemo = {
  ask: 'Judge the box and its check and dash at the page size and larger, the focus ring (Tab to it), and a click on the mixed box: it becomes checked and the mixed mark goes. The whole label is the target.',
  states: [
    { title: 'Unchecked', markup: '<vera-checkbox><label><input type="checkbox" name="news"> Email me the newsletter</label></vera-checkbox>' },
    { title: 'Checked', markup: '<vera-checkbox><label><input type="checkbox" name="terms" checked> I accept the terms</label></vera-checkbox>' },
    {
      title: 'Mixed',
      markup: '<vera-checkbox indeterminate><label><input type="checkbox" name="all"> Select all (some selected)</label></vera-checkbox>',
    },
    {
      title: 'Disabled',
      markup:
        '<vera-checkbox><label><input type="checkbox" disabled> Disabled</label></vera-checkbox> <vera-checkbox><label><input type="checkbox" checked disabled> Disabled and checked</label></vera-checkbox>',
    },
    { title: 'Larger text', markup: '<div style="font-size: 1.5em"><vera-checkbox><label><input type="checkbox" checked> At 1.5em</label></vera-checkbox></div>' },
    {
      title: 'Look none (the engine\'s own checkbox)',
      markup: '<vera-checkbox data-vera-look="none"><label><input type="checkbox" checked> The platform\'s box</label></vera-checkbox>',
    },
  ],
} as const satisfies ComponentDemo;
