import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-dialog>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const dialogSurface = {
  tag: 'vera-dialog',
  description:
    "A modal dialog over the author's own <dialog>: wired in place, opened by the platform's invokers or a trigger, named by its heading, light-dismissible on request, with a host open attribute that binds both ways and a CSS-only sheet placement.",
  attributes: [
    {
      name: 'open',
      description:
        'Observed. Present: the dialog is open as a modal; written by the app it opens or closes it, and a user close (Escape, a form, an invoker, an outside press) removes it, so bound state stays in step. Not the <dialog>\'s own open, which is HTML\'s non-modal attribute.',
    },
    { name: 'dismiss', description: 'Read at connect. "outside": a press and release both outside the dialog close it (closedby where the engine has it). Never for role="alertdialog".' },
    { name: 'placement', description: 'Read by the sheet. "end", "start" or "bottom": docked to that edge, sliding in (a sheet). Default centered.' },
  ],
  properties: [{ name: 'open', type: 'string | null', description: 'The open attribute.' }],
  events: [],
  methods: [],
  slots: [
    { name: 'trigger', description: 'A direct child <button> that opens the dialog (the platform\'s commandfor and command="show-modal").' },
  ],
  parts: [
    { name: 'dialog', description: 'The author\'s direct child <dialog>.' },
    { name: 'title', description: 'Optional, the dialog\'s name when it has no heading: an element marked data-vera-part="title".' },
    { name: 'description', description: 'Optional, the dialog\'s description (aria-describedby): an element marked data-vera-part="description".' },
  ],
  states: [],
  customStates: [],
  tokens: ['--vera-border', '--vera-radius', '--vera-bg', '--vera-fg'],
} as const satisfies ComponentSurface;
