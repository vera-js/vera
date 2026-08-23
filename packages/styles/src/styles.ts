import type { CSSResultGroup, StyledElement } from './types.js';

/**
 * Neutralise a `</style>` sequence inside CSS text before it reaches a `<style>` element.
 *
 * No engine executes it from `innerHTML` here — `<style>` is a raw-text element, so the fragment
 * parser creates no nodes; verified in Chromium, Firefox and WebKit. What it does produce is a DOM
 * whose *serialization* is poisoned, so anything that later re-parses that markup — a server round
 * trip, a copied `innerHTML` — gets a live handler. `@verajs/ssr` had exactly that hole.
 *
 * `<\/style` is valid CSS and renders identically, so escaping costs nothing. Done here at the
 * sink rather than in core's `css`, which must stay unescaped for the constructed-stylesheet path.
 */
const escapeStyleText = (value: string) => value.replace(/<\/(style)/gi, '<\\/$1');

/** Component classes whose light-DOM styles are already hoisted — one sheet per class, ever. */
const hoisted = new WeakSet<object>();

/**
 * Adopts a component's `static styles`. Registered as an `'init'` insert by this package's entry,
 * so components never call it and core never has to know about styling.
 */
export const adoptStyles = (element: StyledElement) => {
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
export const applyStyles = (styles: CSSResultGroup | CSSResultGroup[] | string, element: StyledElement) => {
  if (!styles) return;
  const shadowRoot = element.shadowRoot;
  const stylesArray = Array.isArray(styles) ? styles : [styles];

  if (shadowRoot) {
    const styleSheets: CSSStyleSheet[] = [];
    stylesArray.forEach((style) => {
      if (typeof style !== 'string' && style.styleSheet && document?.adoptedStyleSheets) {
        styleSheets.push(style.styleSheet);
      } else if (!shadowRoot.querySelector('style[vera-styles]')) {
        const styleElement = document?.createElement('style');
        if (!styleElement) return;
        styleElement.setAttribute('vera-styles', '');
        /** `textContent`, not `innerHTML`: this is text, and nothing here should ever be parsed. */
        styleElement.textContent = escapeStyleText(((style as CSSResultGroup)?.cssText ?? style) as string);
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
    styleElement.textContent = escapeStyleText(scoped);
    document.head.appendChild(styleElement);
  }
};
