import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-spinner>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface, so an attribute or part added to the element is shown here
 * in the same change).
 */
export const spinnerDemo = {
  ask: 'Does the ring read as "busy" at a glance, at every size? Is the shown label placed right? A screen reader hears the label once, about 150 ms after the spinner appears, and nothing for a quick load.',
  states: [
    { title: 'Default', note: '1em, in the text\'s color', markup: '<vera-spinner label="Loading"></vera-spinner>' },
    { title: 'With its label shown', markup: '<vera-spinner label="Loading results" show-label></vera-spinner>' },
    {
      title: 'Sized by token',
      markup:
        '<vera-spinner label="Loading" style="--vera-spinner-size:1.5em"></vera-spinner> <vera-spinner label="Loading" style="--vera-spinner-size:2.5em;--vera-spinner-width:.2em"></vera-spinner>',
    },
    {
      title: 'Colored by token or by color',
      markup:
        '<vera-spinner label="Saving" style="--vera-spinner-color:#00a862;--vera-spinner-track:#cfeee0"></vera-spinner> <vera-spinner label="Saving" style="color:#c4321c"></vera-spinner>',
    },
    {
      title: 'Inside a busy owner',
      note: 'The owner speaks; the spinner stays silent',
      markup: '<button type="button" aria-busy="true"><vera-spinner></vera-spinner> Saving</button>',
    },
    {
      title: 'With a done label',
      note: 'Said once when the load ends, only if its label was said',
      markup: '<vera-spinner label="Uploading" done-label="Uploaded"></vera-spinner>',
    },
    { title: 'Our look dropped', note: 'data-vera-look="none": nothing of ours is drawn', markup: '<vera-spinner label="Loading" data-vera-look="none"></vera-spinner>' },
  ],
} as const satisfies ComponentDemo;
