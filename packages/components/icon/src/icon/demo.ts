import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-icon>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface).
 */
const SPRITE =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="demo-star" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol></svg>';

export const iconDemo = {
  ask: 'Your own SVG, kept exactly as written, or a sprite reference. Decorative by default; a label makes it meaningful to a screen reader. Size and color follow the text.',
  states: [
    {
      title: 'Decorative, beside its text',
      markup: '<vera-icon><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg></vera-icon> Saved',
    },
    {
      title: 'Labeled: a meaningful image',
      markup:
        '<span style="font-size:28px"><vera-icon label="Settings"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></vera-icon></span>',
    },
    { title: 'From a sprite (src)', note: 'A same-origin reference, rendered as <svg><use>', markup: `${SPRITE}<span style="font-size:24px;color:#00a862"><vera-icon src="#demo-star" label="Favorite"></vera-icon></span>` },
  ],
} as const satisfies ComponentDemo;
