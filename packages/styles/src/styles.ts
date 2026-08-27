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

/**
 * Component classes whose light-DOM styles are already hoisted — one sheet per class, ever.
 *
 * Marked **on the class**, not in a module-scope `WeakSet`. A production `.min.js` inlines its
 * dependencies, so two copies of this package on one page hold two sets and neither sees the
 * other's: the same component's rules get hoisted to the document twice, and the browser parses and
 * applies them twice for as long as the page lives. The class is the one object both copies are
 * looking at.
 *
 * `_$veraStyles$` is exempt from property mangling — `/^_[a-z]/` is the pattern and `_$…$` does not
 * match it — so both copies spell it identically, exactly as `_$apply$` and `$r` do.
 */
/** One warning per page for the `@scope` fallback below — the engine's answer cannot change. */
let warnedAboutScope = false;

const HOISTED = '_$veraStyles$';

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
  /** `_root` first: a closed shadow root is not reachable through `element.shadowRoot`. */
  const shadowRoot = (element as StyledElement & { _root?: ShadowRoot })._root ?? element.shadowRoot;
  const stylesArray = Array.isArray(styles) ? styles : [styles];

  if (shadowRoot) {
    /**
     * The array is sorted into the two things a shadow root can hold, and **all** of each is kept.
     *
     * Both halves used to be first-one-wins. A `<style vera-styles>` was created only when none
     * existed, so the second string in an array found the element the first had just created and
     * was dropped; and the element was removed whenever any sheet was adopted, on the reasoning
     * that it must be the server's redundant copy — true only when every style is a sheet, and in
     * a mixed array it deleted CSS that had no other home. `static styles` accepts these forms and
     * `@verajs/ssr` serializes every one of them, so a component written that way rendered
     * correctly on the server and lost rules in the browser.
     */
    const styleSheets: CSSStyleSheet[] = [];
    const texts: string[] = [];
    stylesArray.forEach((style) => {
      if (typeof style !== 'string' && style.styleSheet && document?.adoptedStyleSheets) {
        styleSheets.push(style.styleSheet);
      } else {
        texts.push(escapeStyleText(((style as CSSResultGroup)?.cssText ?? style) as string));
      }
    });

    if (styleSheets.length) shadowRoot.adoptedStyleSheets = [...styleSheets];

    const existing = shadowRoot.querySelector('style[vera-styles]');
    if (texts.length) {
      /**
       * Reused when one is already there — a re-`init`, or the server's own copy — so this is
       * idempotent and repairs rather than duplicates. `textContent`, not `innerHTML`: this is
       * text, and nothing here should ever be parsed.
       */
      const styleElement = existing ?? document?.createElement('style');
      if (!styleElement) return;
      const text = texts.join('\n');
      if (styleElement.textContent !== text) styleElement.textContent = text;
      if (!existing) {
        styleElement.setAttribute('vera-styles', '');
        shadowRoot.appendChild(styleElement);
      }
    } else {
      /**
       * Nothing here is text, so a `<style vera-styles>` can only be the server's copy of a sheet,
       * and it is now redundant.
       *
       * Markup cannot carry a constructed sheet, so `@verajs/ssr` serializes one as an element —
       * which is what styles the page for a reader with no JavaScript. The moment the sheet is
       * adopted the element is a second copy of it: the browser parses and applies the same rules
       * twice, per instance, forever, and the hydrated DOM stops matching a client-only render.
       *
       * Removed here rather than after the first render because this runs on the `'init'` insert —
       * before it — so the hydrating renderer sees exactly the nodes its template describes.
       */
      existing?.remove();
    }
    return;
  }

  /** Light DOM: hoist once per class, scoped to the component's tag. */
  const owner = element.constructor as unknown as Record<string, boolean>;
  if (owner[HOISTED]) return;
  owner[HOISTED] = true;

  const cssText = stylesArray
    .map((style) => (typeof style === 'string' ? style : style.cssText))
    .join('\n');
  /** `@scope` guarded by support — unsupported engines would drop the whole block, not unscope it. */
  const supported = typeof CSSScopeRule === 'function';
  /**
   * **The fallback is unscoped, and that is a different thing than scoped.** Dropping the block
   * would leave the component unstyled, so serving it globally is the right trade — but a rule
   * written for one tag is now applied to the whole page, and the author cannot see it: they are
   * developing on an engine that supports `@scope`, and the person who is not is a user.
   *
   * Once per page rather than per class, since the answer cannot change mid-session.
   *
   * `__DEV__`-only, so a production bundle carries neither the check nor the text.
   */
  if (__DEV__ && !supported && !warnedAboutScope) {
    warnedAboutScope = true;
    console.warn(
      `[vera] styles: this engine has no \`@scope\`, so light-DOM \`static styles\` are hoisted to the ` +
        `document **unscoped** — every rule applies page-wide here and only to <${element.localName}> ` +
        `elsewhere. Attach a shadow root to scope them everywhere, or write selectors that carry the tag.`
    );
  }
  const scoped = supported ? `@scope (${element.localName}) {\n${cssText}\n}` : cssText;

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

/**
 * **The module.** `wire([renderer, styles])` — the same shape `@verajs/renderer`,
 * `@verajs/router` and `@verajs/autoloader` export, so every package in the framework is wired the
 * same way and an app entry never hand-writes a descriptor.
 *
 * It is the descriptor that used to be written out longhand in every README and every example:
 * `{ on: 'init', fn: adoptStyles, priority: 50 }`. That form still works and is still the thing to
 * write when you want a different priority — but a caller who only wants the default was being made
 * to know that `adoptStyles` belongs on `'init'`, and that 50 is the number, in order to use a
 * package whose entire job is one call. Two of those three facts are this package's business, not
 * theirs.
 *
 * Priority 50 is the convention for a default implementation — wire your own at 50 to replace this.
 */
export const styles = {
  name: '@verajs/styles',
  on: 'init' as const,
  fn: adoptStyles as never,
  priority: 50,
};

/**
 * `adoptStyles` is a raw function sitting next to the module, exactly as `render` sits next to
 * `renderer` — and `wire` hands a bare function the registry as a *connector*, so `wire([adoptStyles])`
 * would register nothing and throw nothing. Marking it means `wire` can say which name was meant.
 *
 * `__DEV__`-only: production carries neither the property nor the message that reads it.
 */
if (__DEV__) (adoptStyles as unknown as { $module?: string }).$module = 'styles';
