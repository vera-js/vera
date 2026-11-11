/** A store array's `.map` inside a render, handed to the list module when one is wired. */
import { tracking } from '../store/store.js';
import { inserts } from '@verajs/inserts';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import type { HookRecord } from '../types.js';

/**
 * **Development: a store array's `.map` producing TEMPLATES inside a render, with no list module wired.** Rows are then
 * matched by POSITION, so reordering one shows its DOM state (a focused input, a typed value, a running transition) and
 * its component state against another item. Said once per page, and only when the first result is a template: the same
 * decision automatic lists make, so it fires exactly when wiring `lists` would change the behavior (a `.map(t =>
 * t.name).join(', ')` stays silent). The template test is the renderer's own, `strings !== undefined`; keep it equal to
 * renderer.ts's and keyed.ts's `isTemplateResult` (three addresses).
 */
let saidLists = false;
type AutoMap = (proxy: unknown, raw: unknown[], fn: unknown, parent: HookRecord, owner: unknown, method: (...args: unknown[]) => unknown[]) => unknown[];
const unwiredList = (method: (...args: unknown[]) => unknown[], proxy: unknown) =>
  function (this: unknown, ...args: unknown[]) {
    const out = method.apply(this, args);
    const first = out[0] as { strings?: unknown } | null | undefined;
    if (!saidLists && this === proxy && first !== null && typeof first === 'object' && first.strings !== undefined) {
      saidLists = true;
      console.warn(diagnostic('core', 'a store array\'s .map in a render', 'lists-unwired', __DEV__ && PROSE['lists-unwired']()));
    }
    return out;
  };
/**
 * **Automatic `.map`**: inside a RENDER hook (priority 50: a component's render, or a keyed row's), with a list module
 * wired (`$M`, the keyed module's `lists`), a store array's `map(fn)` is handed to that module, which makes it a keyed
 * list whose rows track themselves. Anywhere else (an effect, a computed, plain code, no module, a borrowed `map`, a
 * `thisArg`) it is the native method. Nothing about `.map`'s result changes: it is a real array either way.
 */
export const mapped = (obj: unknown[], method: (...args: unknown[]) => unknown[], proxy: unknown) => {
  const list = (inserts as unknown as { $M?: AutoMap }).$M;
  const hook = tracking.hook;
  if (list === undefined || hook === undefined || hook._y !== 50) {
    /** Not inside a server turn: a server renders the rows plainly whatever is wired, so it could not act on it. */
    if (__DEV__ && list === undefined && hook !== undefined && hook._y === 50 && !saidLists && !(inserts as unknown as { $ss?: (d: number) => unknown }).$ss?.(0))
      return unwiredList(method, proxy);
    return method;
  }
  return function (this: unknown, fn: unknown, ...rest: unknown[]) {
    if (this !== proxy || rest.length) return method.apply(this, [fn, ...rest]);
    return list(proxy, obj, fn, hook, hook._o, method);
  };
};
