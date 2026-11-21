/**
 * **The `./element` entry: <vera-spinner> under a tag of your own, with no side effect at import.** `defineAs` is its whole
 * surface (a tag in, the registered class out), so the options and the setup stay private and can change freely. The
 * unregistered class joins it once core's `define` can build a class without registering it.
 */
import { define } from '@verajs/core';
import { options, setup } from './element.js';

/** Registers the element under `tag` and returns the class that serves it. */
export const defineAs = (tag: string) => define({ ...options, tag }, setup);
