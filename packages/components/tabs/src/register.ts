/**
 * **The `.` entry: registers <vera-tabs>.** The guard runs before core's `define`: a tag another copy already holds
 * is left to it, with a development warning, so two copies on one page never throw the app down.
 */
import { define } from '@verajs/core';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { options, setup } from './element.js';

if (!customElements.get(options.tag)) define(options, setup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('tabs', `<${options.tag}>`, 'defined-twice', __DEV__ && SHARED.definedTwice('@vera-components/tabs', 'element')));

/** The class that serves the tag: the registered one, so `instanceof` tells the truth under a stand-down and under hot. */
export const element = customElements.get(options.tag);
