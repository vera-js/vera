/** A store array's `.map` inside a render, handed to the list module when one is wired. */
import { tracking } from '../store/store.js';
import { hasWarned, warnOnce } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { seams } from './seams.js';

/**
 * **Development: a store array's `.map` producing TEMPLATES inside a render, with no list module wired.** Rows are then
 * matched by POSITION, so reordering one shows its DOM state (a focused input, a typed value, a running transition) and
 * its component state against another item. Said once per page, and only when the first result is a template: the same
 * decision automatic lists make, so it fires exactly when wiring `lists` would change the behavior (a `.map(t =>
 * t.name).join(', ')` stays silent). The template test is the renderer's own, `strings !== undefined`; keep it equal to
 * renderer.ts's and keyed.ts's `isTemplateResult` (three addresses).
 *
 * **Never for a KEYED list** (2026-11-15): `keyed()` returns the same template stamped with `$r` (its reconciler,
 * `$`-named so it survives each bundle's mangler), and keyed rows are matched by key already, which is all this warning
 * asks for. The JSX `key={id}` idiom compiles to exactly that, and was told to use the `keyed()` it already used.
 * `keyed` in renderer/keyed.ts is the stamp's other address.
 */
const unwiredList = (method: (...args: unknown[]) => unknown[], proxy: unknown) =>
  function (this: unknown, ...args: unknown[]) {
    const out = method.apply(this, args);
    const first = out[0] as { strings?: unknown; $r?: unknown } | null | undefined;
    if (this === proxy && first !== null && typeof first === 'object' && first.strings !== undefined && first.$r === undefined)
      warnOnce('core', 'a store array\'s .map in a render', 'lists-unwired', __DEV__ && (() => PROSE['lists-unwired']()));
    return out;
  };
/**
 * **Development: automatic lists wired, but not the full renderer** (Brian's ruling, 2026-11-12). `lists` commits its rows through
 * the renderer's 'value' insert, which only the full renderer (`wire([renderer, lists])`) installs; beside a bare render
 * descriptor (`{ on: 'render', fn: renderInto }`) every row's change re-renders its parent instead, and a fan-in of them
 * was held a frame per row. The renderer marks core's registry when it connects (`$rn`). The same rule as `lists-unwired`
 * above: once per page, only when the rows are templates (what a List is), and never inside a server turn, where rows
 * render plainly whatever is wired and shared setup may wire `lists` alone.
 */
const noRenderer = (out: unknown[]) => {
  const first = out[0] as { strings?: unknown } | null | undefined;
  if (first === null || typeof first !== 'object' || first.strings === undefined) return;
  warnOnce('core', 'an automatic .map list', 'lists-no-renderer', __DEV__ && (() => PROSE['lists-no-renderer']()));
};
/**
 * **Automatic `.map`**: inside a RENDER hook (priority 50: a component's render, or a keyed row's), with a list module
 * wired (`$M`, the keyed module's `lists`), a store array's `map(fn)` is handed to that module, which makes it a keyed
 * list whose rows track themselves. Anywhere else (an effect, a computed, plain code, no module, a borrowed `map`, a
 * `thisArg`) it is the native method. Nothing about `.map`'s result changes: it is a real array either way.
 */
export const mapped = (obj: unknown[], method: (...args: unknown[]) => unknown[], proxy: unknown) => {
  const list = seams.$M;
  const hook = tracking.hook;
  if (list === undefined || hook === undefined || hook._priority !== 50) {
    /**
     * Not inside a server turn: a server renders the rows plainly whatever is wired, so it could not act on it.
     * `hasWarned`: once it is out, a render's `.map` is the native method again (no wrapper per call).
     */
    if (__DEV__ && list === undefined && hook !== undefined && hook._priority === 50 && !hasWarned('lists-unwired') && !seams.$ss?.(0))
      return unwiredList(method, proxy);
    return method;
  }
  return function (this: unknown, fn: unknown, ...rest: unknown[]) {
    if (this !== proxy || rest.length) return method.apply(this, [fn, ...rest]);
    const out = list(proxy, obj, fn, hook, hook._owner, method);
    if (__DEV__ && seams.$rn !== true && !hasWarned('lists-no-renderer') && !seams.$ss?.(0)) noRenderer(out);
    return out;
  };
};
