/**
 * **The `./element` entry: <vera-checkbox> and <vera-switch> under tags of your own, with no side effect at import.**
 * `defineAs` and `defineSwitchAs` are its whole surface (a tag in, the registered class out), so the options and the
 * setups stay private and can change freely.
 */
import { define } from '@verajs/core';
import { checkboxOptions, checkboxSetup, switchOptions, switchSetup } from './element.js';

/** Registers the checkbox under `tag` and returns the class that serves it. */
export const defineAs = (tag: string) => define({ ...checkboxOptions, tag }, checkboxSetup);
/** Registers the switch under `tag` and returns the class that serves it. */
export const defineSwitchAs = (tag: string) => define({ ...switchOptions, tag }, switchSetup);
