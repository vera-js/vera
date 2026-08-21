/**
 * The vera-native server environment: the smallest DOM surface core's server path actually
 * touches. No parse5, no jsdom — elements hold strings, not trees. Installed once, BEFORE
 * `@verajs/core` is imported, so core's `customElements.define` wrap lands on our registry and
 * every component module that executes registers itself here — this is what replaces wcc's
 * acorn walk: **Node resolves the module graph, execution registers the classes.**
 */

/** tag name -> class, filled as component modules execute. */
export const registry = new Map();

/** `@scope (tag) { … }` styles hoisted by light-DOM components — the page shell embeds these. */
export const hoistedStyles = [];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');

class StyleSheetShim {
  replaceSync(cssText) {
    this.cssText = cssText;
  }
}

class ShadowRootShim {
  constructor(mode) {
    this.mode = mode;
    this.innerHTML = '';
    this._styles = [];
  }
  /** Only `adoptStyles`' string path appends here (a `<style>` element shim). */
  appendChild(node) {
    this._styles.push(node.innerHTML);
    return node;
  }
  querySelector() {
    return null; // fresh instance per render — nothing to dedupe against
  }
  /** Constructed sheets land here; serialized alongside string styles. */
  set adoptedStyleSheets(sheets) {
    this._adopted = sheets;
  }
  get adoptedStyleSheets() {
    return this._adopted ?? [];
  }
  serialize() {
    const sheets = (this._adopted ?? []).map((sheet) => sheet.cssText ?? '');
    const styles = [...sheets, ...this._styles].filter(Boolean);
    const styleTags = styles.map((css) => `<style vera-styles>${css}</style>`).join('');
    return styleTags + this.innerHTML;
  }
}

class ElementShim {
  constructor(localName = '') {
    this.localName = localName;
    this.isConnected = true;
    this._attributes = new Map();
    this.innerHTML = '';
    this.shadowRoot = null;
  }
  attachShadow({ mode = 'open' } = {}) {
    this.shadowRoot = new ShadowRootShim(mode);
    return this.shadowRoot;
  }
  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }
  hasAttribute(name) {
    return this._attributes.has(name);
  }
  removeAttribute(name) {
    this._attributes.delete(name);
  }
  appendChild(node) {
    this.innerHTML += node.innerHTML ?? '';
    return node;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent() {
    return this.innerHTML.replace(/<[^>]*>/g, '');
  }
  set textContent(value) {
    this.innerHTML = escapeHtml(value);
  }
}

/** Idempotent. Returns the registry so callers can diff definitions around an import. */
export const installShims = () => {
  if (globalThis.__veraSsrShimmed) return registry;
  globalThis.__veraSsrShimmed = true;

  globalThis.HTMLElement = ElementShim;
  globalThis.CSSStyleSheet = StyleSheetShim;
  /** Defined so core's `@scope` support check passes — SSR output gets scoped light-DOM CSS. */
  globalThis.CSSScopeRule = function CSSScopeRule() {};

  globalThis.customElements = {
    define: (name, Class) => registry.set(name, Class),
    get: (name) => registry.get(name),
    whenDefined: () => Promise.resolve(),
  };

  globalThis.document = {
    createElement: (localName) => new ElementShim(localName),
    /** Light-DOM styles hoist here — `adoptStyles`' constructed-sheet path. */
    get adoptedStyleSheets() {
      return [];
    },
    set adoptedStyleSheets(sheets) {
      const added = sheets[sheets.length - 1];
      if (added?.cssText) hoistedStyles.push(added.cssText);
    },
    head: {
      appendChild: (node) => {
        if (node?.innerHTML) hoistedStyles.push(node.innerHTML);
        return node;
      },
    },
  };

  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return registry;
};

export { escapeHtml };
