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
  if (next) cleanups.add(next);
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
export const proxyCallbacks = new WeakMap<
  object,
  Map<string, Map<WeakRef<ComponentElement>, Set<WeakRef<HookCallback>>[]>>
>();

const HTML_RESULT = 1;
const SVG_RESULT = 2;
const MATHML_RESULT = 3;

const tag =
  <T extends ResultType>(type: T) =>
  (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<T> => {
      // Warn against templates octal escape sequences
      // We do this here rather than in render so that the warning is closer to the
      // template definition.
      // if (DEV_MODE && strings.some((s) => s === undefined)) {
      //   console.warn(
      //     'Some template strings are undefined.\n' +
      //       'This is probably caused by illegal octal escape sequences.'
      //   );
      // }
      // if (DEV_MODE) {
      //   // Import static-html.js results in a circular dependency which g3 doesn't
      //   // handle. Instead we know that static values must have the field
      //   // `_$litStatic$`.
      //   if (
      //     values.some((val) => (val as {_$litStatic$: unknown})?.['_$litStatic$'])
      //   ) {
      //     issueWarning(
      //       '',
      //       `Static values 'literal' or 'unsafeStatic' cannot be used as values to non-static templates.\n` +
      //         `Please use the static 'html' tag function. See https://lit.dev/docs/templates/expressions/#static-expressions`
      //     );
      //   }
      // }
      return {
        // This property needs to remain unminified.
        ['_$litType$']: type,
        strings,
        values,
      };
    };

export let html = tag(HTML_RESULT);
export const svg = tag(SVG_RESULT);
export const mathml = tag(MATHML_RESULT);

/**
 * A template literal function that creates a CSSStyleSheet from the given CSS string.
 * @param strings - The template literal strings array.
 * @param values - The values to interpolate into the CSS.
 * @returns The created CSSStyleSheet and its CSS text.
 */
export let css = (strings: TemplateStringsArray, ...values: (string | number)[]): CSSResultGroup => {
  const cssText = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
  const styleSheet = new CSSStyleSheet();
  styleSheet.replaceSync?.(cssText);

  return { styleSheet, cssText };
};

export const setCss = (
  cssFunction: (strings: TemplateStringsArray, ...values: (string | number)[]) => CSSResultGroup
) => {
  css = cssFunction;
};

/**
 * An html template literal function used for syntax highlighting. Can be optionally replaced
 * with other options like lit
 */
// export let html = (strings: TemplateStringsArray, ...values: unknown[]): unknown =>
//   strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');

export const setHtml = (htmlFunction: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => {
  /**
   * The parameter stays deliberately permissive while `html` is precisely typed, so the cast is the
   * seam between them. Swapping the template function is the entire point of this API, and core
   * cannot know what a replacement returns: lit-html hands back its own `TemplateResult`, but a
   * template function that returns a plain HTML **string** is equally valid with the default
   * renderer. Narrowing the parameter would reject that.
   */
  html = htmlFunction as typeof html;
};
