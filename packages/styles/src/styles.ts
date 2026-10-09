import type { CSSResultGroup, StyledElement } from './types.js';
import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/**
 * The `css` tagged template: a constructed stylesheet and its source text, for `static styles`.
 *
 * `?? ''` rather than `|| ''`: `0` is a legal CSS value and a falsy one, and `margin: ${0}px` must not
 * become `margin: px`. `replaceSync?.` because an environment with constructed-sheet objects but no
 * `replaceSync` (jsdom, `@verajs/ssr`'s DOM) still needs the text, which is what those paths use.
 *
 * @param strings - The template literal strings array.
 * @param values - The values to interpolate into the CSS.
 * @returns The constructed stylesheet and its CSS text.
 */
export const css = (strings: TemplateStringsArray, ...values: (string | number)[]): CSSResultGroup => {
  /** Development: called, not tagged — a string where the strings array goes fails at `reduce` naming nothing. */
  if (__DEV__ && !Array.isArray(strings))
    throw new TypeError(misuse('css', 'css-called', __DEV__ && PROSE['css-called'](typeof strings === 'string' ? JSON.stringify(strings) : String(strings))));
  const cssText = strings.reduce((text, part, i) => text + part + (values[i] ?? ''), '');
  const styleSheet = new CSSStyleSheet();
  styleSheet.replaceSync?.(cssText);
  return { styleSheet, cssText };
};

/**
 * Neutralizes a `</style>` sequence in CSS text before it reaches a `<style>` element. No engine
 * executes it from here (`<style>` is raw text), but the DOM's SERIALIZATION is poisoned, so anything
 * that re-parses the markup — a server round trip, a copied `innerHTML` — gets a live element.
 * `<\/style` is valid CSS and renders identically. **A deliberate twin of `escapeStyleText` in
 * `@verajs/ssr`** — the packages may not import each other at runtime (CODE-PRINCIPLES #6); a
 * hardening of one needs the other.
 */
/**
 * The CSS with its comments and quoted strings removed — they are text, not selectors, so a sheet that merely MENTIONS
 * `::slotted()` (a documented one does) is not warned about. Not a parser: stripping too much only silences a warning.
 */
const withoutText = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, '');

/** Development: a light-DOM component's styles went global for want of `@scope` — said once per page. */
let warnedAboutScope = false;

/** Development: `element` is a component element (realm-safe — a popped-out window's fails `instanceof`). */
const notAnElement = (element: unknown) => (element as Partial<Node> | null)?.nodeType !== 1;

const escapeStyleText = (value: string) => value.replace(/<\/(style)/gi, '<\\/$1');

/**
 * **`:host` translated for a light host.** Inside `@scope (tag-name)` the scoping root IS the element,
 * so `:host` becomes `:scope` and `:host(.a)` becomes `:scope.a`. `:host` is in nearly every component
 * stylesheet, including every one installed from npm, and does nothing in light DOM untranslated.
 *
 * The lookahead is the whole trick: a `:host` that is a SELECTOR sits in a prelude, whose next
 * structural character is `{`; one inside a VALUE sees `;` or `}` first — so `content: ":host"` and
 * `url(/x/:host.png)` are left alone with no tokenizer. `(^|[^\\])` skips an escaped identifier
 * (Tailwind's `.md\:host`), as a captured group because Safari only shipped lookbehind in 16.4.
 * `:host-context()` is not translated: Firefox and WebKit never shipped it. TEXT rather than the
 * CSSOM, so `@verajs/ssr`'s DOM — which has no stylesheet parser — produces the same output.
 */
const forLightDom = (css: string): string =>
  css
    .replace(/(^|[^\\]):host\(([^)]*)\)(?=[^{};]*\{)/g, (_, before, inner) => `${before}:scope${inner.trim()}`)
    .replace(/(^|[^\\]):host\b(?!-)(?=[^{};]*\{)/g, (_, before) => `${before}:scope`);

/**
 * The documents a component class has hoisted its light-DOM styles into, kept **on the class** and read
 * as an OWN property:
 *
 * - on the class, not in a module-scope set, because a production bundle inlines its dependencies and
 *   two copies of this package on one page would each hoist the same rules — the class is the one
 *   object both copies see (`_$…$` is exempt from property mangling, so both spell it alike);
 * - OWN, because `class Child extends Base` inherits `Base`'s statics, and a subclass reading its
 *   base's marker never hoisted its own `@scope (child-tag)` block — unstyled, depending on which
 *   instance mounted first;
 * - per DOCUMENT, because a component moved into a popped-out window or an iframe lives in a document
 *   whose sheets are its own; hoisting into the opener styled nothing where it was.
 */
const HOISTED = '_$veraStyles$';

/**
 * Adopts a component's `static styles` — the `'init'` insert `styles` registers, so a component never
 * calls it and core never knows about styling.
 */
export const adoptStyles = (element: StyledElement) => {
  if (__DEV__ && notAnElement(element))
    throw new TypeError(misuse('adoptStyles', 'adopt-not-element', __DEV__ && PROSE['adopt-not-element'](String(element))));
  return applyStyles((element.constructor as unknown as { styles: CSSResultGroup | CSSResultGroup[] }).styles, element);
};

/**
 * Applies styles to a component, in the component's OWN document and window — never the global
 * `document`, which is the opener's for a component moved into another window (CODE-PRINCIPLES #2).
 *
 * **Shadow DOM:** constructed sheets are adopted by the shadow root; plain strings — and a sheet from
 * ANOTHER window, which a document cannot adopt (the engine throws) — become one
 * `<style data-vm-sheet="styles">` in the root. Idempotent: a re-`init` or the server's copy is reused,
 * and when every style is an adopted sheet the server's `<style>` copy is removed, since it would apply
 * the same rules twice.
 *
 * **Light DOM:** hoisted to the document once per class, inside `@scope (tag-name) { … }`, so the rules
 * apply only within that component's subtree and survive renders (which own the element's content).
 * Unscoped where `@scope` is unsupported (dropping the block would leave the component unstyled); a
 * `<style>` in `<head>` where constructed sheets are unavailable.
 *
 * A falsy member is skipped, so `[base, isDark && darkSheet]` works.
 *
 * @param styles A `css` result, a string of CSS, or an array of those.
 * @param element The element to apply them to.
 */
export const applyStyles = (styles: CSSResultGroup | CSSResultGroup[] | string, element: StyledElement) => {
  if (!styles) return;
  /** Development: styles first, the element second — `applyStyles(this, sheet)` reads naturally and is backwards. */
  if (__DEV__ && notAnElement(element))
    throw new TypeError(misuse('applyStyles', 'apply-not-element', __DEV__ && PROSE['apply-not-element'](String(element))));
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  /** `_root` first: a closed shadow root is not reachable through `element.shadowRoot`. */
  const shadowRoot = (element as StyledElement & { _root?: ShadowRoot })._root ?? element.shadowRoot;
  const list = (Array.isArray(styles) ? styles : [styles]).filter(Boolean);
  /** Development: an entry that is neither CSS text nor a sheet is named, not met as `value.replace is not a function`. */
  if (__DEV__)
    for (const style of list)
      if (typeof style !== 'string' && !(style as CSSResultGroup).cssText && !(style as CSSResultGroup).styleSheet)
        throw new TypeError(
          misuse('applyStyles', 'apply-not-css', __DEV__ && PROSE['apply-not-css'](typeof style === 'object' ? 'an object with neither cssText nor styleSheet' : `a ${typeof style}`))
        );

  if (shadowRoot) {
    const sheets: CSSStyleSheet[] = [];
    const texts: string[] = [];
    for (const style of list) {
      const sheet = typeof style === 'string' ? undefined : style.styleSheet;
      if (sheet && doc.adoptedStyleSheets && view && sheet instanceof view.CSSStyleSheet) sheets.push(sheet);
      else texts.push(escapeStyleText(typeof style === 'string' ? style : style.cssText));
    }
    if (sheets.length) shadowRoot.adoptedStyleSheets = sheets;
    const existing = shadowRoot.querySelector('style[data-vm-sheet="styles"]');
    if (texts.length) {
      /** `textContent`, never `innerHTML`: this is text, and nothing here should be parsed. */
      const styleElement = existing ?? doc.createElement('style');
      const text = texts.join('\n');
      if (styleElement.textContent !== text) styleElement.textContent = text;
      if (!existing) {
        styleElement.setAttribute('data-vm-sheet', 'styles');
        shadowRoot.appendChild(styleElement);
      }
    } else existing?.remove();
    return;
  }

  const owner = element.constructor as unknown as Record<string, WeakSet<Document>>;
  if (!Object.prototype.hasOwnProperty.call(owner, HOISTED)) owner[HOISTED] = new WeakSet();
  if (owner[HOISTED].has(doc)) return;
  owner[HOISTED].add(doc);

  const raw = list.map((style) => (typeof style === 'string' ? style : style.cssText)).join('\n');
  const cssText = forLightDom(raw);
  const supported = !!view && typeof view.CSSScopeRule === 'function';
  if (__DEV__ && !supported && !warnedAboutScope) {
    warnedAboutScope = true;
    console.warn(diagnostic('styles', `<${element.localName}>`, 'no-scope', __DEV__ && PROSE['no-scope'](element.localName)));
  }
  /** Development: `::slotted()` only ever matches inside a shadow root — in light DOM an ordinary selector reaches it. */
  if (__DEV__ && /::slotted\s*\(/.test(withoutText(raw)))
    console.warn(diagnostic('styles', `<${element.localName}>`, 'slotted-light', __DEV__ && PROSE['slotted-light']()));
  const scoped = supported ? `@scope (${element.localName}) {\n${cssText}\n}` : cssText;
  if (doc.adoptedStyleSheets && view) {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(scoped);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const styleElement = doc.createElement('style');
    styleElement.textContent = escapeStyleText(scoped);
    doc.head.appendChild(styleElement);
  }
};

/** **The module.** `wire([renderer, styles])`. Priority 50 is the default-implementation convention. */
export const styles = {
  name: '@verajs/styles',
  on: 'init' as const,
  fn: adoptStyles as never,
  priority: 50,
};

/** Development: `adoptStyles` is not the module — `wire` names `styles` instead (see the renderer's `renderInto` mark). */
if (__DEV__) (adoptStyles as unknown as { $module?: string }).$module = 'styles';
