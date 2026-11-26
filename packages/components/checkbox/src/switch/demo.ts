import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-switch>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface).
 */
export const switchDemo = {
  ask: 'Judge the track and thumb off and on, the slide (and that it jumps under reduced motion), the focus ring (Tab to it, then Space), and the mirrored thumb under right-to-left. The label stays the same in both states.',
  states: [
    { title: 'Off', markup: '<vera-switch><label><input type="checkbox" name="wifi"> Wi-Fi</label></vera-switch>' },
    { title: 'On', markup: '<vera-switch><label><input type="checkbox" name="sync" checked> Sync over mobile data</label></vera-switch>' },
    {
      title: 'Disabled',
      markup:
        '<vera-switch><label><input type="checkbox" disabled> Disabled</label></vera-switch> <vera-switch><label><input type="checkbox" checked disabled> Disabled and on</label></vera-switch>',
    },
    {
      title: 'Right to left',
      markup:
        '<div dir="rtl"><vera-switch><label><input type="checkbox"> مزامنة</label></vera-switch> <vera-switch><label><input type="checkbox" checked> مزامنة</label></vera-switch></div>',
    },
    {
      title: 'Look none (the engine\'s own control)',
      markup: '<vera-switch data-vera-look="none"><label><input type="checkbox" checked> The platform\'s control</label></vera-switch>',
    },
  ],
} as const satisfies ComponentDemo;
