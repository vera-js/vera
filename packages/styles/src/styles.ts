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

/** One warning per page for the `@scope` fallback below — the engine's answer cannot change. */
let warnedAboutScope = false;

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
/**
 * **`:host` translated for a light host.** Inside the `@scope (tag-name)` block below, the scoping
 * root IS the element — so `:host` becomes `:scope` and `:host(.a)` becomes `:scope.a` (never
 * `:scope(.a)`, which is not a selector and which the CSSOM silently rejects).
 *
 * This exists because `:host` is how a web component styles its own element — it is in nearly every
 * component stylesheet ever written, including every one installed from npm. Measured before this:
 * `:host`, `:host(.flag)` and `::slotted(b)` all applied under a shadow root and all did nothing in
 * light DOM. Telling authors to write `:host, :scope` fixes their own components and does nothing
 * for anyone else's, which is why this is translation rather than documentation.
 *
 * **The lookahead is the whole trick.** A `:host` that is a SELECTOR sits in a rule prelude, and a
 * prelude ends with `{`; a `:host` inside a VALUE sits in a declaration block, where the next
 * structural character is `;` or `}`. So rewriting only when the next one of `{ ; }` is `{` leaves
 * `content: ":host"`, `url(/x/:host.png)` and `@import url(…:host.css);` alone without needing to
 * tokenise strings, comments or url()s. A quote-and-comment tokeniser was written first and cost
 * 240 B against this one's 83 — and got the url cases WRONG.
 *
 * `(^|[^\\])` because `.md\:host` is an escaped identifier, not a selector: Tailwind emits those
 * for arbitrary variants, and Tailwind is a supported build here. Written as a captured group
 * rather than a lookbehind on purpose — Safari only shipped lookbehind in 16.4, and a regex literal
 * it cannot parse takes this module down at load rather than degrading.
 *
 * `:host-context()` is deliberately not translated: Firefox and WebKit never shipped it.
 *
 * TEXT rather than the CSSOM, also on purpose. `@verajs/ssr` runs this exact code under its shim,
 * which has no stylesheet parser — a CSSOM rewrite would apply on the client and silently no-op on
 * the server, which is a server/client styling divergence.
 *
 * One case it gets wrong and nothing positional could: a data-URI SVG whose own `<style>` contains
 * `:host`. That `:host` has no shadow host to match either way, so the sheet was already inert.
 */
const forLightDom = (css: string): string =>
  css
    .replace(/(^|[^\\]):host\(([^)]*)\)(?=[^{};]*\{)/g, (_, before, inner) => `${before}:scope${inner.trim()}`)
    .replace(/(^|[^\\]):host\b(?!-)(?=[^{};]*\{)/g, (_, before) => `${before}:scope`);

const HOISTED = '_$veraStyles$';

/**
 * Adopts a component's `static styles`. Registered as an `'init'` insert by this package's entry,
 * so components never call it and core never has to know about styling.
 */
export const adoptStyles = (element: StyledElement) => {
  /**
   * Reads `element.constructor.styles`, so a missing element failed with
   * `Cannot read properties of undefined (reading 'constructor')` — a message about this function's
   * first line rather than about the call.
   */
  if (__DEV__ && (!element || typeof (element as { addEventListener?: unknown }).addEventListener !== 'function'))
    throw new TypeError(
      `adoptStyles: expected a component element and received ${String(element)}. ` +
        `It adopts the element's own class \`static styles\` — \`adoptStyles(this)\`.`
    );
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
  /**
   * Two arguments, styles first and the element second — the order is the trap, since
   * `applyStyles(this, sheet)` reads naturally and is backwards. It failed with
   * `Cannot read properties of undefined (reading '_root')`, which names neither argument.
   */
  if (__DEV__ && (!element || typeof (element as { addEventListener?: unknown }).addEventListener !== 'function'))
    throw new TypeError(
      `applyStyles: expected a component element as the *second* argument and received ${String(element)}. ` +
        `The order is styles first — \`applyStyles(sheet, this)\`.`
    );
  /** `_root` first: a closed shadow root is not reachable through `element.shadowRoot`. */
  const shadowRoot = (element as StyledElement & { _root?: ShadowRoot })._root ?? element.shadowRoot;
  /**
   * **`[base, isDark && darkSheet]` is how conditional styles are written**, and it produced
   * `[sheet, false]` — which broke both paths here, differently and neither of them legibly.
   *
   * The shadow path reached `escapeStyleText(false)` and threw `value.replace is not a function`
   * out of `connectedCallback`, from a file the author has never opened, taking the component with
   * it. The light-DOM path did not throw at all: `false.cssText` is `undefined`, so the literal text
   * `undefined` was joined into the stylesheet and hoisted to the document. `null` from a ternary
   * threw a third message one step earlier.
   *
   * A falsy entry means "no styles here", exactly as the top of this function already reads a falsy
   * `styles` argument. Dropping them once, here, is the same rule applied to the members.
   */
  const stylesArray = (Array.isArray(styles) ? styles : [styles]).filter(Boolean);

  /**
   * And an entry that is neither a string nor a stylesheet is a mistake worth naming, since the
   * alternative is `value.replace is not a function` pointing at a local variable in here.
   * `adoptStyles` and the second argument above are already refused by name; this is the same rule
   * for the members of the first one.
   */
  if (__DEV__)
    for (const style of stylesArray)
      if (typeof style !== 'string' && !(style as CSSResultGroup).cssText && !(style as CSSResultGroup).styleSheet)
        throw new TypeError(
          `applyStyles: expected CSS and received ${typeof style === 'object' ? 'an object with neither cssText nor styleSheet' : `a ${typeof style}`}. ` +
            `Pass a css\`…\` result, a string of CSS, or an array of those — a falsy entry is fine ` +
            `and is skipped, so \`[base, dark && darkSheet]\` works.`
        );

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

  /**
   * Light DOM: hoist once per class, scoped to the component's tag.
   *
   * **Read as an *own* property, because a class inherits its base's.** `class Child extends Base`
   * makes `Base` the prototype of `Child`, so a plain `owner[HOISTED]` on a subclass finds the flag
   * the base set and returns — and the subclass's `static styles` are never hoisted at all. The
   * component renders unstyled, with nothing logged.
   *
   * It was **order-dependent**, which is what made it survivable: mounting the child first hoisted
   * both, because inheritance only looks upward. So a page could style correctly in development and
   * not in production, decided by which instance rendered first.
   *
   * The same read covers a subclass that declares no styles of its own. It inherits the base's CSS,
   * but its tag is different, so the base's `@scope (base-tag)` block never matches it; hoisting its
   * own `@scope (child-tag)` copy is what makes those rules apply.
   */
  const owner = element.constructor as unknown as Record<string, boolean>;
  if (Object.prototype.hasOwnProperty.call(owner, HOISTED)) return;
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
  /**
   * **`::slotted()` is the one shadow-only selector left with nothing to become.** `:host` is
   * translated above; distributed nodes here are ordinary descendants, so there is no equivalent
   * selector for them without MARKING them, which is DOM noise in the user's own tree and exactly
   * what the light-slots design refused. It is also the one that is fair to lose: slotted content
   * is the user's own DOM, and in light mode their page CSS already reaches it — `::slotted()`
   * exists to reach across a boundary that is not there.
   *
   * `__DEV__`-only, once per class, so production carries neither the check nor the text.
   */
  if (__DEV__ && /::slotted\s*\(/.test(cssText))
    console.warn(
      `[vera] styles: <${element.localName}> has no shadow root, and \`::slotted()\` only ever ` +
        `matches inside one — those rules do nothing here. In light DOM you do not need it: ` +
        `slotted content is in the same tree, so an ordinary descendant selector reaches it, and ` +
        `reaches deeper than \`::slotted()\` can. For a component that renders BOTH ways, write ` +
        `both — \`::slotted(img), [part="body"] img\` — the way \`:host, :scope\` used to be ` +
        `needed before \`:host\` was translated for you.`
    );
  const scoped = supported
    ? `@scope (${element.localName}) {\n${forLightDom(cssText)}\n}`
    : forLightDom(cssText);

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
