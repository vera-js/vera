import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-tabs>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface, so an attribute or part added to the element is shown here
 * in the same change).
 */
const TABS =
  '<div slot="tabs"><button type="button" value="overview">Overview</button><button type="button" value="specs">Specs</button><button type="button" value="reviews">Reviews</button></div>';
const PANELS =
  '<section data-value="overview"><p>A light, fast component library.</p></section>' +
  '<section data-value="specs"><p>Dimensions, weight and materials, with a two-year warranty.</p><button type="button">Compare</button></section>' +
  '<section data-value="reviews"><p>No reviews yet.</p></section>';

export const tabsDemo = {
  ask: 'Judge the behavior: click a tab, move with the arrow keys and Home/End, watch the indicator slide, and use find-in-page (Ctrl+F) for "warranty". Does the indicator keep up with a tab that changes size?',
  states: [
    {
      title: 'Your own buttons and sections',
      note: 'Before the script runs these are buttons and sections; the inactive panels are hidden',
      markup: `<vera-tabs>${TABS}${PANELS}</vera-tabs>`,
    },
    { title: 'A tab chosen by value', markup: `<vera-tabs value="specs">${TABS}${PANELS}</vera-tabs>` },
    {
      title: 'Manual activation',
      note: 'The arrows move focus only; Enter or Space selects',
      markup: `<vera-tabs activation="manual">${TABS}${PANELS}</vera-tabs>`,
    },
    {
      title: 'Vertical',
      note: 'Up and Down move; the indicator runs down the side',
      markup: `<vera-tabs orientation="vertical">${TABS}${PANELS}</vera-tabs>`,
    },
    {
      title: 'Not findable',
      note: 'Inactive panels are plain hidden. Try find-in-page (Ctrl+F) for "warranty": in the tabs above it opens Specs; here it finds nothing',
      markup: `<vera-tabs findable="false">${TABS}${PANELS}</vera-tabs>`,
    },
    {
      title: 'Paired by order, one tab disabled',
      note: 'No keys: the panels pair with the tabs in order, and a heading between them is skipped',
      markup:
        '<vera-tabs><div slot="tabs"><button type="button">One</button><button type="button" disabled>Two</button><button type="button">Three</button></div>' +
        '<h3>Section</h3><div><p>First</p></div><div><p>Second</p></div><div><p>Third</p></div></vera-tabs>',
    },
  ],
} as const satisfies ComponentDemo;
