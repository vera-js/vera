import {
  CSSResultGroup,
  ComponentElement,
  ComponentHook,
  HookCallback,
  HookCleanup,
  ComponentInstance,
  ResultType,
  TemplateResult,
} from '../types.js';

/** Init sets the current instance element and render uses it in useRender */
export const currentInstance: ComponentInstance = {
  element: null,
};

/** The queue of hooks that are currently being assigned to proxies. We use an array here so that
 * we can add to the hooks stack when we go deeper in useRender templates, and then pop them off when
 * we come back out. For example, if some reactive properties exist in a template and then another
 * web component is rendered as a child, we may go a level deeper for reactive properties in the nested
 * component. But when that component is fully rendered and we pop back out to the original render
 * template, we don't want to lose the hook context for any other reactive properties that may still exist
 * in the template.
 */
export const hooksQueue: ComponentHook[] = [];

/**
 * Swaps a hook's registered cleanup on the element currently on top of the hooks queue, so
 * `init`'s disconnect wrapper can run everything a removed element's effects set up. Cleanups
 * previously lived only inside effect closures — unreachable at disconnect, which meant a removed
 * element's last interval or listener ran forever and pinned the element in memory.
 */
export const swapCleanup = (previous: HookCleanup | void, next: HookCleanup | void) => {
  const element = hooksQueue[hooksQueue.length - 1]?.element?.deref();
  if (!element) return;
  const cleanups = (element._cleanups ??= new Set());
  if (previous) cleanups.delete(previous);
  if (!next) return;
  /**
   * **An element that removed itself while its own effect was running has already torn down.**
   *
   * `disconnectedCallback` runs every cleanup and clears the set. A cleanup is registered when the
   * effect *returns*, so an effect that calls `this.remove()` — a toast dismissing itself, a
   * component that redirects — finishes after that sweep and adds its cleanup to a set nothing will
   * ever drain again. The interval or listener it was meant to release runs forever, silently, which
   * is the exact failure `_cleanups` exists to prevent.
   *
   * Running it now is what the teardown would have done a moment earlier. `_removed` rather than
   * `isConnected`, because a component rendered into a detached container has never been connected
   * and its cleanups are still owed a later removal.
   */
  if (element._removed) {
    /**
     * Not routed through `reportHookError`: that lives in `createHook`, which imports this module,
     * and a cycle for one call site is a worse trade than repeating the prefix. A cleanup that
     * throws must not take the effect down with it either way.
     */
    try {
      next();
    } catch (error) {
      console.error('[vera] a cleanup threw while its element was being removed', error);
    }
    return;
  }
  cleanups.add(next);
};

/**
 * All of the callbacks for all objects, props, elements and priorities.
 *
 * Declared as a `Map` throughout even though a weak collection stores a `WeakMap` here — see the
 * note in `createProxy`'s `addCallback`. A union would be honest and unusable: `Map<string, V>` and
 * `WeakMap<object, V>` share no callable `get`, so every read would need narrowing for a difference
 * that does not exist at these two call sites. One cast, at the single place the container is
 * created, is the smaller lie.
 */
/**
 * One element's subscriptions to one property: the priority-ordered callback sets, and the parallel
 * priorities that decide where a new set is inserted.
 *
 * **They travel together because they are one fact.** The priorities used to live in a separate
 * `WeakMap` keyed by the slots array, which meant a `WeakMap.get` on *every tracked read* to recover
 * something only the insert path ever looks at — `runCallbacks` walks the slots by index and never
 * consults the order at all. Folding them costs one object where there were two arrays and a
 * `WeakMap` entry, and measured ~10% off a server render, whose every subscription is built cold.
 */
export type PropSubscriptions = {
  /** Priority-ordered callback sets. Walked by index on every write. */
  slots: Set<WeakRef<HookCallback>>[];
  /** Parallel priorities, read only when a slot has to be inserted. */
  order: number[];
};

export const proxyCallbacks = new WeakMap<
  object,
  Map<string, Map<WeakRef<ComponentElement>, PropSubscriptions>>
>();

const HTML_RESULT = 1;
const SVG_RESULT = 2;
const MATHML_RESULT = 3;

/**
 * **These are tagged templates, and calling one as a function is silent.** `html('<p>hi</p>')` puts a
 * *string* where the renderer expects the strings array, so the value looks like a template, passes
 * every shape check, and fails much later inside the renderer with `Invalid value used as weak map
 * key` — the template cache is keyed by the strings array, and a string is not a legal WeakMap key.
 * Nothing in that message mentions `html`, the call site, or what was wrong with it.
 *
 * It is a plausible mistake rather than an exotic one: it is how the same job is done in libraries
 * that take a markup string, and it is what building markup by concatenation leads to.
 *
 * **The check is `Array.isArray`, and deliberately not `raw`.** Only a real template literal carries
 * `raw`, so testing for it would also refuse a hand-built `html([markup])` — which
 * `tests/ssr-scale.test.mjs` uses to generate a hundred nested components, and which works. That
 * shape does have a cost, since a fresh array per render is a fresh template identity and so a rebuild
 * rather than an update; that is the render profiler's business to report, not this guard's to
 * forbid. The defect being fixed here is the *silent* one, and a string is unambiguously it.
 */
const refuseCall = (name: string, strings: unknown) => {
  if (Array.isArray(strings)) return;
  throw new TypeError(
    `${name}: expected a template literal and received ${typeof strings === 'string' ? JSON.stringify(strings) : String(strings)}. ` +
      `It is a tagged template — write ${name}\`<p>hi</p>\`, not ${name}('<p>hi</p>').`
  );
};

const tag =
  <T extends ResultType>(type: T, name: string) =>
  (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<T> => {
      if (__DEV__) refuseCall(name, strings);
      return {
        ['_$litType$']: type,
        strings,
        values,
      };
    };

export let html = tag(HTML_RESULT, 'html');
export const svg = tag(SVG_RESULT, 'svg');
export const mathml = tag(MATHML_RESULT, 'mathml');

/**
 * A template literal function that creates a CSSStyleSheet from the given CSS string.
 * @param strings - The template literal strings array.
 * @param values - The values to interpolate into the CSS.
 * @returns The created CSSStyleSheet and its CSS text.
 */
export let css = (strings: TemplateStringsArray, ...values: (string | number)[]): CSSResultGroup => {
  /**
   * `?? ''` rather than `|| ''`: **`0` is a legal CSS value and a falsy one.** `margin: ${0}px`
   * produced `margin: px` and `z-index: ${0}` produced `z-index: ` — declarations the parser drops,
   * so the rule silently lost a property rather than failing. Every zero from a computed layout hit
   * this, and an empty string is the only value that should vanish.
   */
  if (__DEV__) refuseCall('css', strings);
  const cssText = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
  const styleSheet = new CSSStyleSheet();
  styleSheet.replaceSync?.(cssText);

  return { styleSheet, cssText };
};

export const setCss = (
  cssFunction: (strings: TemplateStringsArray, ...values: (string | number)[]) => CSSResultGroup
) => {
  /** Throws at the first `css` tag otherwise — *"css is not a function"*, naming an internal rather
   *  than the call that broke it. `__DEV__`-only, like every other guard here. */
  if (__DEV__ && typeof cssFunction !== 'function')
    throw new Error(
      `setCss: expected a function and received ${String(cssFunction)}. It replaces the \`css\` ` +
        `tagged template, so it must be callable as one.`
    );
  css = cssFunction;
};

/**
 * An html template literal function used for syntax highlighting. Can be optionally replaced
 * with other options like lit
 */

export const setHtml = (htmlFunction: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => {
  /** Throws at the first template otherwise — *"html is not a function"*, naming an internal rather
   *  than the call that broke it. `__DEV__`-only, like every other guard here. */
  if (__DEV__ && typeof htmlFunction !== 'function')
    throw new Error(
      `setHtml: expected a function and received ${String(htmlFunction)}. It replaces the \`html\` ` +
        `tagged template, so it must be callable as one.`
    );
  /**
   * The parameter stays deliberately permissive while `html` is precisely typed, so the cast is the
   * seam between them. Swapping the template function is the entire point of this API, and core
   * cannot know what a replacement returns: lit-html hands back its own `TemplateResult`, but a
   * template function that returns a plain HTML **string** is equally valid with the default
   * renderer. Narrowing the parameter would reject that.
   */
  html = htmlFunction as typeof html;
};
