import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-dialog>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface, so an attribute or part added to the element is shown here
 * in the same change).
 */
export const dialogDemo = {
  ask: 'Judge the dialog open: its spacing, the backdrop, the form\'s buttons, the alert dialog\'s wording, and the end sheet sliding in. Try Escape, a press outside on the dismissible one, and the form\'s Save.',
  states: [
    {
      title: 'Form dialog',
      note: 'A heading names it; the form closes it with a returnValue.',
      markup:
        '<vera-dialog><button slot="trigger">Edit profile</button><dialog><h2>Edit profile</h2><form method="dialog"><label>Name <input name="name" autofocus></label><p><button value="cancel" formnovalidate>Cancel</button> <button value="save">Save</button></p></form></dialog></vera-dialog>',
    },
    {
      title: 'Alert dialog',
      note: 'role="alertdialog": never light-dismissed; autofocus on the least destructive action.',
      markup:
        '<vera-dialog><button slot="trigger">Delete…</button><dialog role="alertdialog"><h2>Delete this file?</h2><p data-vera-part="description">It cannot be restored.</p><form method="dialog"><button value="cancel" autofocus>Cancel</button> <button value="delete">Delete</button></form></dialog></vera-dialog>',
    },
    {
      title: 'Dismissible sheet',
      note: 'placement="end" and dismiss="outside": docked to the end edge; a press outside closes it.',
      markup:
        '<vera-dialog placement="end" dismiss="outside"><button slot="trigger">Filters</button><dialog aria-label="Filters"><p data-vera-part="title">Filters</p><p>Narrow the list.</p></dialog></vera-dialog>',
    },
    {
      title: 'Open at load',
      note: 'The host\'s open: shown as a modal on connect.',
      markup: '<vera-dialog open><dialog><h2>Welcome</h2><form method="dialog"><button autofocus>Start</button></form></dialog></vera-dialog>',
    },
  ],
} as const satisfies ComponentDemo;
