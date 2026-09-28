import type { CSSResultGroup, StyledElement } from './types.js';

/**
 * The `css` tagged template: a constructed stylesheet and its source text, for `static styles`.
 *
 * @param strings - The template literal strings array.
 * @param values - The values to interpolate into the CSS.
 * @returns The constructed stylesheet and its CSS text.
 */
export const css = (strings: TemplateStringsArray, ...values: (string | number)[]): CSSResultGroup => {
  const cssText = strings.reduce((text, part, i) => text + part + (values[i] ?? ''), '');
  const styleSheet = new CSSStyleSheet();
  styleSheet.replaceSync(cssText);
  return { styleSheet, cssText };
};

/** Component classes whose light-DOM styles are already hoisted — once per class. */
const hoisted = new WeakSet<object>();

/**
 * Adopts a component's `static styles` — the `'init'` insert this package's `styles` module registers.
 *
 * **Shadow DOM:** the sheets are adopted by the shadow root, which scopes them.
 * **Light DOM:** they are hoisted to the document once per component class, inside
 * `@scope (tag-name) { … }`, so they apply only within that component's subtree — scoping without a
 * shadow root, done by the platform — and survive renders, which own the element's content.
 */
export const adoptStyles = (element: StyledElement) => {
  const styles = (element.constructor as unknown as { styles?: CSSResultGroup | CSSResultGroup[] }).styles;
  if (!styles) return;
  const list = Array.isArray(styles) ? styles : [styles];
  if (element.shadowRoot) {
    element.shadowRoot.adoptedStyleSheets = list.map((style) => style.styleSheet);
    return;
  }
  if (hoisted.has(element.constructor)) return;
  hoisted.add(element.constructor);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`@scope (${element.localName}) {\n${list.map((style) => style.cssText).join('\n')}\n}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
};

/** **The module.** `wire([renderer, styles])`. Priority 50 is the default-implementation convention. */
export const styles = {
  name: '@verajs/styles',
  on: 'init' as const,
  fn: adoptStyles as never,
  priority: 50,
};
