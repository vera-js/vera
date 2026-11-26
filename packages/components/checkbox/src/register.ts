/**
 * **The `.` entry: registers <vera-checkbox> and <vera-switch>.** The guard runs before core's `define`: a tag another
 * copy already holds is left to it, with a development warning, so two copies on one page never throw the app down.
 */
import { define } from '@verajs/core';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { checkboxOptions, checkboxSetup, switchOptions, switchSetup } from './element.js';

if (!customElements.get(checkboxOptions.tag)) define(checkboxOptions, checkboxSetup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('checkbox', `<${checkboxOptions.tag}>`, 'defined-twice', __DEV__ && SHARED.definedTwice('@vera-components/checkbox', 'element')));

if (!customElements.get(switchOptions.tag)) define(switchOptions, switchSetup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('checkbox', `<${switchOptions.tag}>`, 'defined-twice', __DEV__ && SHARED.definedTwice('@vera-components/checkbox', 'element')));

/** The classes that serve the tags: the registered ones, so `instanceof` tells the truth under a stand-down and under hot. */
export const element = customElements.get(checkboxOptions.tag);
export const switchElement = customElements.get(switchOptions.tag);

declare global {
  /**
   * Types `document.createElement('vera-checkbox')`, `querySelector` and a TSX element's handlers (`e.currentTarget`).
   * Under a stand-down (another copy already holds the tag) the type is still this copy's; the two can differ by a version.
   */
  // eslint-disable-next-line no-restricted-syntax -- HTMLElementTagNameMap is the DOM library's interface; only an interface merges into it
  interface HTMLElementTagNameMap {
    'vera-checkbox': Parameters<typeof checkboxSetup>[0];
    'vera-switch': Parameters<typeof switchSetup>[0];
  }
}
