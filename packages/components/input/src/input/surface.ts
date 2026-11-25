import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-input>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const inputSurface = {
  tag: 'vera-input',
  description:
    "Wraps the user's own <input> (the form participant: autofill, validity, reset and disabled stay the platform's), with optional prefix and suffix parts of the user's. With no <input> inside it renders one, server-side too, from its name, type, value, placeholder and autocomplete, read once. Options add a clear button that keeps the input's undo history, a password reveal, a caps-lock hint (shown and announced), and a loading mark with aria-busy on the input. It never labels: put it in a <label> or a <vera-field>.",
  attributes: [
    {
      name: 'clearable',
      description:
        'Shows a clear button while the input has a value it may clear (not disabled or read-only, and not while a composite\'s list is open: aria-expanded="true"). The button is out of the tab order; Escape clears a type="search" input, and select-all then Delete clears any. Observed.',
    },
    { name: 'clear-label', description: 'The clear button\'s accessible name. Default "Clear". Observed.' },
    { name: 'loading', description: 'Sets aria-busy="true" on the input and shows the aria-hidden loading mark. Observed.' },
    {
      name: 'reveal',
      description:
        'On a type="password" input: a show/hide button after it (aria-pressed), in the tab order. The input is a password again on submit, on pagehide and when reveal is removed, so form history, the save-password prompt and the back-forward cache never keep it as text. Observed.',
    },
    { name: 'reveal-label', description: 'The reveal button\'s accessible name. Default "Show password". Observed.' },
    {
      name: 'caps-lock-hint',
      description: 'Shows the caps-lock part while Caps Lock is on in the input, and announces it once per focus. Observed.',
    },
    { name: 'caps-lock-message', description: 'What the hint shows and says. Default "Caps Lock is on". Observed.' },
    { name: 'scale', description: 'sm, md or lg: the box\'s font size, which the input and its parts follow, md the page\'s and sm and lg around it; none is the page\'s too (never size, which <input size> already means).' },
    { name: 'name', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'type', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'value', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'placeholder', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'autocomplete', description: 'Copied to the default input once, at render; not observed.' },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [
    { name: 'input', description: 'The default input, rendered only when the user wrote none.' },
    { name: 'prefix', description: "The user's own content before the input." },
    { name: 'suffix', description: "The user's own content after the input." },
    { name: 'clear', description: 'The clear button, with clearable; hidden while there is nothing to clear.' },
    { name: 'loading', description: 'The loading mark, with loading; aria-hidden (aria-busy on the input carries it).' },
    { name: 'reveal', description: 'The show/hide button, with reveal on a password input.' },
    { name: 'caps-lock', description: 'The caps-lock hint, with caps-lock-hint; hidden while Caps Lock is off.' },
    { name: 'stepper', description: "On a number input, the aria-hidden holder of step-down and step-up; the engine's own spin buttons are hidden under the look." },
    { name: 'step-down', description: "Steps a number input down by its step, repeating while held; a pointer's way only (the keyboard's is ArrowDown)." },
    { name: 'step-up', description: "Steps a number input up by its step, repeating while held; a pointer's way only (the keyboard's is ArrowUp)." },
  ],
  states: [],
  customStates: [],
  tokens: ['--vera-border-control', '--vera-danger', '--vera-fg', '--vera-fg-muted', '--vera-focus', '--vera-hover', '--vera-radius', '--vera-surface'],
} as const satisfies ComponentSurface;
