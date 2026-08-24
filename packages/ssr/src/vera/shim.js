/**
 * The vera-native server environment: the smallest DOM surface core's server path actually
 * touches. No parse5, no jsdom — elements hold strings, not trees. Installed once, BEFORE
 * `@verajs/core` is imported, so core's `customElements.define` wrap lands on our registry and
 * every component module that executes registers itself here — this is what replaces wcc's
 * acorn walk: **Node resolves the module graph, execution registers the classes.**
 */

/** tag name -> class, filled as component modules execute. */
export const registry = new Map();

/**
 * `@scope (tag) { … }` styles hoisted by light-DOM components, **keyed by the component that
 * hoisted them** — the page shell embeds only the ones on the page it is building.
 *
 * A flat array here meant `renderToString` returned every style the *process* had ever hoisted, so
 * request two shipped request one's CSS and request fifty shipped everyone's. `adoptStyles` hoists
 * once per class by design, so it never grew without bound — it simply described the wrong page.
 */
export const hoistedStyles = new Map();

/**
 * Which component is rendering right now, so a hoist can be attributed to it.
 *
 * Sound because a render is synchronous end to end: `renderComponent` sets this, calls
 * `connectedCallback`, and reads the result, with no `await` anywhere in between. The only `await`
 * in the module is the `import()` that happens before any of this.
 */
let renderingTag = '';
export const setRenderingTag = (tag) => {
  const previous = renderingTag;
  renderingTag = tag;
  return previous;
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');

/**
 * Neutralise a `</style>` sequence inside CSS text.
 *
 * `<style>` is a raw-text element: its content is not HTML, so `escapeHtml` cannot be used here —
 * it would turn every `>` in a selector into `&#62;` and break the stylesheet. The only sequence
 * that matters is the end tag, because it is the one thing the HTML tokenizer looks for while
 * inside the element. A value interpolated into `css` and carrying `</style>` therefore closes the
 * element and everything after it parses as markup.
 *
 * `<\/style` is valid CSS — a backslash escape is legal in identifiers and strings, and renders
 * identically — while the tokenizer no longer matches an end tag. Applied here, at the render
 * boundary, rather than in `css` itself: escaping at the source would corrupt the constructed
 * stylesheet path, which is the double-escaping principle #8 warns about. It also catches a
 * sequence assembled across several interpolations, which source-side escaping cannot see.
 *
 * **Deliberately duplicated** in `@verajs/styles` (`escapeStyleText` there is the same three
 * lines). It cannot be shared: the obvious home is `@verajs/shared-utils`, which is private and
 * inlined at build time, and `@verajs/ssr` publishes its `src` with **no dependencies at all** — an
 * import of a package that is never published would break the published tarball. Two copies of a
 * security rule is a real risk, so `tests/ssr-escaping.test.mjs` asserts the two agree on the
 * payloads that matter rather than trusting they will be edited together.
 */
export const escapeStyleText = (value) => String(value).replace(/<\/(style)/gi, '<\\/$1');

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
  /**
   * The `<style>` tags, kept separate from the content.
   *
   * They used to be concatenated here and the whole string handed to the nested-component scan,
   * which then read the stylesheet as markup: CSS containing a registered tag name — a
   * `content: "<some-comp>"` is enough — had that component **rendered inside the stylesheet**.
   * A scan for elements has no business reading a raw-text element.
   */
  styleTags() {
    const sheets = (this._adopted ?? []).map((sheet) => sheet.cssText ?? '');
    return [...sheets, ...this._styles]
      .filter(Boolean)
      .map((css) => `<style vera-styles>${escapeStyleText(css)}</style>`)
      .join('');
  }
  serialize() {
    return this.styleTags() + this.innerHTML;
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

  /**
   * The rest of the surface an ordinary custom element reaches for.
   *
   * The shim was built as "the smallest DOM core's server path touches", which is the wrong bar:
   * the code that runs here is *user* code, and a component that emits an event, reads its
   * `tagName`, or adds a class in `connectedCallback` is doing nothing unusual. Each of these threw
   * a `TypeError` that took the whole render down — measured: `dispatchEvent`, `ownerDocument`,
   * `tagName`, `children`, `classList`, `closest` and `getRootNode`, all of them.
   *
   * They answer the way a detached, childless element would, because that is what this is.
   */
  get tagName() {
    return this.localName.toUpperCase();
  }
  get ownerDocument() {
    return globalThis.document;
  }
  get children() {
    return [];
  }
  get childNodes() {
    return [];
  }
  get firstElementChild() {
    return null;
  }
  dispatchEvent() {
    /** Nothing is listening on a server; `true` is "not cancelled", which is the honest answer. */
    return true;
  }
  closest() {
    return null;
  }
  matches() {
    return false;
  }
  getRootNode() {
    return this.shadowRoot ?? this;
  }
  remove() {}
  /**
   * Backed by the `class` attribute, so a class added during `connectedCallback` reaches the
   * markup — which it now can, because the opening tag is written from these attributes rather
   * than copied from the source text.
   */
  get classList() {
    const tokens = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const write = (list) => (list.length ? this.setAttribute('class', list.join(' ')) : this.removeAttribute('class'));
    return {
      add: (...names) => {
        const list = tokens();
        for (const name of names) if (!list.includes(name)) list.push(name);
        write(list);
      },
      remove: (...names) => write(tokens().filter((token) => !names.includes(token))),
      toggle: (name, force) => {
        const list = tokens();
        const wanted = force ?? !list.includes(name);
        write(wanted ? [...list.filter((token) => token !== name), name] : list.filter((token) => token !== name));
        return wanted;
      },
      contains: (name) => tokens().includes(name),
      get length() {
        return tokens().length;
      },
    };
  }

  /**
   * The element's own opening tag, written from the attributes it holds **now**.
   *
   * Copying the source text instead meant everything a component did to itself during
   * `connectedCallback` was thrown away: `setAttribute('role', 'button')`, a class, an `aria-*` —
   * present on the client after hydration, absent in the server markup, so the two disagreed on
   * every one.
   */
  openTag() {
    let out = `<${this.localName}`;
    for (const [name, value] of this._attributes) out += ` ${name}="${escapeHtml(value)}"`;
    return out + '>';
  }

  get textContent() {
    return this.innerHTML.replace(/<[^>]*>/g, '');
  }
  set textContent(value) {
    this.innerHTML = escapeHtml(value);
  }
}

/** Records a hoisted sheet against whichever component is mid-render. */
const hoist = (cssText) => {
  const sheets = hoistedStyles.get(renderingTag) ?? [];
  if (!sheets.includes(cssText)) sheets.push(cssText);
  hoistedStyles.set(renderingTag, sheets);
};

/** Idempotent. Installs the server environment; the registry is filled as modules execute. */
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
      if (added?.cssText) hoist(added.cssText);
    },
    head: {
      appendChild: (node) => {
        if (node?.innerHTML) hoist(node.innerHTML);
        return node;
      },
    },
  };

  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return registry;
};

export { escapeHtml };
