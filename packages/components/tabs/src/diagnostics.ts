/** **@vera-components/tabs's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it. Each is said
 * once per element.
 */
export const PROSE: Record<string, Prose> = {
  'tabs-no-list': () => [
    'has no direct child marked slot="tabs", so there are no tabs to wire and every panel stays as written.',
    'Put the tab buttons in one container, such as <div slot="tabs">, as the first child.',
  ],
  'tabs-count-mismatch': (tabs, panels) => [
    `pairs its tabs with panels by order, and has ${tabs} tabs but ${panels} panels, so some tab controls no panel.`,
    'Give each panel data-value matching its tab\'s value, or write one panel per tab.',
  ],
  'tabs-not-button': () => [
    'has a tab that is not a <button>, so Enter and Space do not choose it and a form may submit it.',
    'Write each tab as <button type="button">.',
  ],
  'tabs-until-found-blocked': () => [
    'hides its inactive panels with hidden="until-found", and a page rule gives them display: none (a reset such as [hidden] { display: none }), so find-in-page cannot reach them.',
    'Scope the rule to [hidden]:not([hidden="until-found"]), or set findable="false" to hide the panels from find-in-page on purpose.',
  ],
};
