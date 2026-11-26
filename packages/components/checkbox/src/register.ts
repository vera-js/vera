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
