import { CSSResultGroup, ComponentElement } from '../types.js';

/** Component classes whose light-DOM styles are already hoisted — one sheet per class, ever. */
const hoisted = new WeakSet<object>();

/**
 * Adopts a component's `static styles`. Called by `init`, so components never do this manually.
 *
 * @param element The element to adoptStyles on
 */
export const adoptStyles = (element: ComponentElement) => {
  applyStyles((element.constructor as unknown as { styles: CSSResultGroup | CSSResultGroup[] }).styles, element);
};

/**
 * Applies styles to a component.
 *
 * **Shadow DOM:** constructed sheets go to `shadowRoot.adoptedStyleSheets`; plain strings become a
 * `<style>` in the shadow root. Both are naturally scoped and re-`init` safe (`adoptedStyleSheets`
 * is assignment, and the string path is guarded below).
 *
 * **Light DOM:** styles are **hoisted to the document once per component class**, wrapped in
 * `@scope (tag-name) { … }` so they apply only inside that component's subtree — scoping without
 * a shadow root, done by the platform. Hoisting also survives renders: the renderer owns the
 * element's content, so a `<style>` injected *inside* the element would be wiped by the first
 * render pass. Where `@scope` is unsupported the rules apply unscoped (the previous behavior);
 * where constructed sheets are unavailable a `<style>` goes to `<head>` instead.
 *
 * @param styles Can be an object with styleSheet and cssText properties, an array of those, or a string.
 * @param element The element to apply styles to.
 */
export const applyStyles = (styles: CSSResultGroup | CSSResultGroup[] | string, element: ComponentElement) => {
  if (!styles) return;
  const shadowRoot = element.shadowRoot;
  const stylesArray = Array.isArray(styles) ? styles : [styles];

  // TODO Adapt for SSR

  if (shadowRoot) {
    const styleSheets: CSSStyleSheet[] = [];
    stylesArray.forEach((style) => {
      if (typeof style !== 'string' && style.styleSheet && document?.adoptedStyleSheets) {
        styleSheets.push(style.styleSheet);
      } else if (!shadowRoot.querySelector('style[vera-styles]')) {
        const styleElement = document?.createElement('style');
        if (!styleElement) return;
        styleElement.setAttribute('vera-styles', '');
        styleElement.innerHTML = (style as CSSResultGroup)?.cssText ?? style;
        shadowRoot.appendChild(styleElement);
      }
    });
    if (styleSheets.length) shadowRoot.adoptedStyleSheets = [...styleSheets];
    return;
  }

  /** Light DOM: hoist once per class, scoped to the component's tag. */
  if (hoisted.has(element.constructor)) return;
  hoisted.add(element.constructor);

  const cssText = stylesArray
    .map((style) => (typeof style === 'string' ? style : style.cssText))
    .join('\n');
  /** `@scope` guarded by support — unsupported engines would drop the whole block, not unscope it. */
  const scoped = typeof CSSScopeRule === 'function' ? `@scope (${element.localName}) {\n${cssText}\n}` : cssText;

  if (document?.adoptedStyleSheets) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(scoped);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } else {
    const styleElement = document?.createElement('style');
    if (!styleElement) return;
    styleElement.innerHTML = scoped;
    document.head.appendChild(styleElement);
  }
};
