/**
 * **The `.` entry: registers <vera-input>.** The guard runs before core's `define`: a tag another copy already holds
 * is left to it, with a development warning, so two copies on one page never throw the app down.
 */
import { define } from '@verajs/core';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { options, setup } from './element.js';

if (!customElements.get(options.tag)) define(options, setup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('input', `<${options.tag}>`, 'defined-twice', __DEV__ && SHARED.definedTwice('@vera-components/input', 'element')));

/** The class that serves the tag: the registered one, so `instanceof` tells the truth under a stand-down and under hot. */
export const element = customElements.get(options.tag);

declare global {
  /**
   * Types `document.createElement('vera-input')`, `querySelector` and a TSX element's handlers (`e.currentTarget`).
   * Under a stand-down (another copy already holds the tag) the type is still this copy's; the two can differ by a version.
   */
  // eslint-disable-next-line no-restricted-syntax -- HTMLElementTagNameMap is the DOM library's interface; only an interface merges into it
  interface HTMLElementTagNameMap {
    'vera-input': Parameters<typeof setup>[0];
  }
}
