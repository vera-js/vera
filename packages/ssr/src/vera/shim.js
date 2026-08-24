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

/**
 * Elements whose content is text rather than markup. Setting `textContent` on one of these stores
 * the text as written: inside `<style>` or `<script>` a character reference is **not** decoded, so
 * escaping there does not protect anything and does corrupt the content.
 */
const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'textarea', 'title']);

/** `backgroundColor` -> `background-color`, for the `style` and `dataset` views below. */
const dashed = (name) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * `dataset` and `style` are **views over an attribute**, not stores of their own: an assignment that
 * does not reach the markup is an assignment the server loses. Written as proxies over the element
 * so `this.dataset.userId = '7'` and `this.style.color = 'red'` end up in the tag, which is what
 * they do in a browser.
 */
const datasetView = (element) =>
  new Proxy(
    {},
    {
      get: (_, key) => element.getAttribute(`data-${dashed(String(key))}`) ?? undefined,
      set: (_, key, value) => (element.setAttribute(`data-${dashed(String(key))}`, value), true),
      deleteProperty: (_, key) => (element.removeAttribute(`data-${dashed(String(key))}`), true),
      has: (_, key) => element.hasAttribute(`data-${dashed(String(key))}`),
    }
  );

const styleView = (element) => {
  const read = () =>
    new Map(
      (element.getAttribute('style') ?? '')
        .split(';')
        .map((rule) => rule.split(':'))
        .filter((pair) => pair.length === 2)
        .map(([name, value]) => [name.trim(), value.trim()])
    );
  /**
   * Each declaration ends in a semicolon, including the last, because that is what a browser writes
   * into the attribute when you set a property — `style.color = 'red'` gives `style="color: red;"`.
   * Dropping the final one made every component that styles itself disagree with the client on its
   * own host attribute.
   */
  const write = (rules) => {
    const text = [...rules].map(([name, value]) => `${name}: ${value};`).join(' ');
    if (text) element.setAttribute('style', text);
    else element.removeAttribute('style');
  };
  return new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'cssText') return element.getAttribute('style') ?? '';
        if (key === 'setProperty') return (name, value) => write(read().set(name, value));
        if (key === 'removeProperty') return (name) => { const rules = read(); rules.delete(name); write(rules); };
        return read().get(dashed(String(key))) ?? '';
      },
      set: (_, key, value) => {
        if (key === 'cssText') element.setAttribute('style', String(value));
        else write(read().set(dashed(String(key)), value));
        return true;
      },
    }
  );
};

const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPE = /[&<>"']/g;

/**
 * Escaping is the hottest thing in a large render, and most values have nothing to escape.
 *
 * Asking first is worth it: 200 escapes of ordinary text measured 9.60 µs going straight to
 * `replace` against 3.03 µs testing first — and text that *does* need escaping came out slightly
 * ahead too (21.73 vs 20.03), because a global `replace` sets up more than a single `test` does. On
 * a 100-row table of clean data that is a quarter of the whole render.
 */
const escapeHtml = (value) => {
  const text = typeof value === 'string' ? value : String(value);
  return NEEDS_ESCAPE.test(text) ? text.replace(ESCAPE, (c) => '&#' + c.charCodeAt(0) + ';') : text;
};

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
  constructor() {
    this.cssText = '';
  }
  replaceSync(cssText) {
    this.cssText = cssText;
  }
  /** The async spelling of the same thing; `adoptStyles` uses `replaceSync`, a component may not. */
  async replace(cssText) {
    this.cssText = cssText;
    return this;
  }
  insertRule(rule) {
    this.cssText += rule;
    return 0;
  }
  get cssRules() {
    return [];
  }}

/**
 * Declarative shadow DOM can carry more than the mode, and the extras are **not recoverable on the
 * client**: `attachShadow` reuses a declarative root and ignores the options it is handed, so a
 * component asking for `delegatesFocus: true` over server-rendered markup that omitted it keeps
 * `delegatesFocus === false` for the life of the page. Measured in Chromium. Focus delegation is an
 * accessibility behaviour, so losing it silently under SSR is the kind of difference that never gets
 * reported — it just works worse.
 *
 * `slotAssignment` has no declarative form at all; a component that needs it cannot be faithfully
 * server-rendered, and the README says so rather than pretending.
 */
const SHADOW_ATTRIBUTES = [
  ['delegatesFocus', 'shadowrootdelegatesfocus'],
  ['clonable', 'shadowrootclonable'],
  ['serializable', 'shadowrootserializable'],
];

/**
 * What an element and a shadow root both are: something that holds children as markup and can be
 * appended to, queried and listened to.
 *
 * Shared because they kept drifting. `ShadowRootShim` was built for the renderer and `ElementShim`
 * for core, so each was short of a different set of members — the router threw on
 * `shadowRoot.addEventListener`, component code threw on `element.dataset`, and every gap was found
 * by probing rather than by the two being one thing. Anything a container does belongs here.
 *
 * Queries answer emptily because this holds a **string**, not a tree; nothing in this package parses
 * HTML. `insertBefore` and `cloneNode` are deliberately absent for the same reason — they need a
 * tree, and faking them would misplace content silently.
 */
class ContainerShim {
  constructor() {
    this.innerHTML = '';
  }
  appendChild(node) {
    this.innerHTML += node?.openTag ? node.openTag() + node.innerHTML + `</${node.localName}>` : (node?.innerHTML ?? '');
    return node;
  }
  /** `append` takes several nodes, and strings as text — the modern spelling of `appendChild`. */
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') this.innerHTML += escapeHtml(node);
      else this.appendChild(node);
    }
  }
  replaceChildren(...nodes) {
    this.innerHTML = '';
    this.append(...nodes);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getElementById() {
    return null;
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
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

class ShadowRootShim extends ContainerShim {
  constructor(init) {
    super();
    this.mode = init.mode ?? 'open';
    this._init = init;
    /** Set by `attachShadow`; a shadow root's `host` is part of the contract the router reads. */
    this._host = null;
    this.innerHTML = '';
    this._styles = [];
  }
  /** `shadowrootmode` plus whatever else the root was opened with, as the parser expects them. */
  templateAttributes() {
    let out = ` shadowrootmode="${this.mode}"`;
    for (const [option, attribute] of SHADOW_ATTRIBUTES) if (this._init[option]) out += ` ${attribute}=""`;
    return out;
  }
  /**
   * A `<style>` joins the stylesheet collection; anything else is content.
   *
   * Every append used to be treated as a stylesheet, on the assumption that only `adoptStyles`
   * would ever reach here. A component appending an element to its own shadow root — ordinary DOM
   * code — therefore had that element silently turned into CSS and its markup lost.
   *
   * @override
   */
  appendChild(node) {
    if (node?.localName === 'style') {
      this._styles.push(node.innerHTML);
      return node;
    }
    return super.appendChild(node);
  }
  /** A shadow root's `host` is part of the contract `@verajs/router` reads. */
  get host() {
    return this._host;
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
}

/**
 * A component's own `attributeChangedCallback`, when it declared one.
 *
 * Read through a cast rather than declared as a field: a field in this base class would be an own
 * property set to `undefined`, which shadows the subclass's method and silently switches observed
 * attributes back off — the very thing this exists to deliver.
 *
 * @param {ElementShim} element
 * @return {((name: string, previous: string | null, value: string | null) => void) | undefined}
 */
const observerOf = (element) =>
  /** @type {{ attributeChangedCallback?: (name: string, previous: string | null, value: string | null) => void }} */ (
    element
  ).attributeChangedCallback;

class ElementShim extends ContainerShim {
  constructor(localName = '') {
    super();
    this.localName = localName;
    this.isConnected = true;
    this._attributes = new Map();
    this.innerHTML = '';
    this.shadowRoot = null;
  }
  attachShadow(init = {}) {
    this.shadowRoot = new ShadowRootShim(init);
    this.shadowRoot._host = this;
    return this.shadowRoot;
  }
  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }
  setAttribute(name, value) {
    const previous = this.getAttribute(name);
    this._attributes.set(name, String(value));
    this._attributeChanged(name, previous);
  }
  hasAttribute(name) {
    return this._attributes.has(name);
  }
  /**
   * `force` decides, and when the attribute is already in the wanted state **nothing happens** —
   * no write, no callback. This used to reset the value to `''` on `toggleAttribute(name, true)`
   * for an attribute that was already there, which silently erased it.
   */
  toggleAttribute(name, force) {
    const present = this._attributes.has(name);
    const wanted = force ?? !present;
    if (wanted === present) return wanted;
    if (wanted) this._attributes.set(name, '');
    else this._attributes.delete(name);
    this._attributeChanged(name, wanted ? null : this.getAttribute(name));
    return wanted;
  }

  /**
   * Upgrade, the way the parser does it: `attributeChangedCallback` fires once per **present**
   * observed attribute, before `connectedCallback`, with a `null` old value.
   *
   * It never fired at all on the server. `attributeChangedCallback` is the only reactive-attribute
   * mechanism a plain custom element has, so a component that derives its state there rendered
   * its *initial* state into the page and then corrected itself on the client — a hydration
   * mismatch on every such component, and a flash of the wrong content for anyone without JS.
   */
  upgrade() {
    this._observed = /** @type {{ observedAttributes?: string[] }} */ (this.constructor).observedAttributes;
    this._upgraded = true;
    const changed = observerOf(this);
    if (!this._observed || !changed) return;
    for (const name of this._observed) {
      const value = this.getAttribute(name);
      if (value !== null) changed.call(this, name, null, value);
    }
  }

  /**
   * And it keeps firing afterwards, because a browser does: a component that changes its own
   * attribute during a render sees the callback on the client and must see it here.
   *
   * Guarded on `_upgraded` first, which is the common case for the renderer's attribute writes —
   * an element mid-upgrade has no observers yet, and one that observes nothing never reaches the
   * `includes`.
   */
  _attributeChanged(name, previous) {
    if (!this._upgraded || !this._observed?.includes(name)) return;
    /**
     * Fired even when the value did not change, because a browser does: `setAttribute` runs the
     * attribute-change steps unconditionally. Only a *no-op* — removing what was not there,
     * toggling to the state it is already in — is silent, and those never reach here.
     */
    observerOf(this)?.call(this, name, previous, this.getAttribute(name));
  }
  /** Enough of a `NamedNodeMap` to iterate, which is what component code does with it. */
  get attributes() {
    return [...this._attributes].map(([name, value]) => ({ name, value }));
  }
  getAttributeNames() {
    return [...this._attributes.keys()];
  }

  /**
   * `this.dataset.x = 'y'` and `this.style.color = 'red'` both change the markup, so both write
   * through to the attribute they are a view of. A plain object would accept the assignment and
   * lose it.
   */
  get dataset() {
    return datasetView(this);
  }
  get style() {
    return styleView(this);
  }
  removeAttribute(name) {
    if (!this._attributes.has(name)) return;
    const previous = this.getAttribute(name);
    this._attributes.delete(name);
    this._attributeChanged(name, previous);
  }

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

  /**
   * Tags stripped and the escaping undone, so what goes in comes back out.
   *
   * Reading back what `textContent` had just written returned `&#60;b&#62;` for `<b>` — the setter
   * escapes and the getter did not decode, so the round trip a component may reasonably rely on was
   * broken. Only the numeric references the setter emits need undoing; anything else in there came
   * from author markup and is text as written.
   */
  get textContent() {
    return this.innerHTML.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }
  /**
   * Escaped for an ordinary element, stored as-is for a raw-text one.
   *
   * `@verajs/styles` sets a `<style>` element's `textContent` to the stylesheet, and escaping it
   * turned every `>` into `&#62;` and every `"` into `&#34;`. A browser does not decode those inside
   * `<style>`, so a component with `static styles = '.a > .b { … }'` shipped a broken stylesheet —
   * every child selector, every attribute selector, every `content: "…"`. The client never had it:
   * there, `textContent` sets real text and the serializer of a raw-text element emits it verbatim.
   */
  set textContent(value) {
    this.innerHTML = RAW_TEXT_ELEMENTS.has(this.localName) ? String(value) : escapeHtml(value);
  }
}

/** Callbacks awaiting a frame that will not arrive on its own. See `flushFrames`. */
const frames = [];

/**
 * How many rounds of frames a single server render will run.
 *
 * Deferring until after `connectedCallback` is what a browser does, and it is what makes a
 * component's own ordering hold: work scheduled before `render()` still sees the template. Draining
 * *repeatedly* is what makes the markup match where the client settles — an effect that derives
 * state schedules a re-render, which is another frame, and stopping after one would ship the
 * half-settled DOM this whole area exists to avoid.
 *
 * The bound is for the component that schedules a frame from inside a frame forever: an animation
 * loop, which is browser-only code that happens to be reachable here. It runs a few times and stops
 * rather than hanging the request.
 */
const FRAME_ROUNDS = 20;

/**
 * Runs everything waiting on a frame, and everything those schedule in turn.
 *
 * Called once per component, after `connectedCallback` — not inside `requestAnimationFrame` itself.
 * Running each callback immediately looked equivalent and was not: two state changes in a row
 * re-rendered twice where a browser coalesces them into one, and anything scheduled before
 * `render()` ran against a component that had not drawn yet.
 */
export const flushFrames = () => {
  for (let round = 0; round < FRAME_ROUNDS && frames.length; round++) {
    const batch = frames.splice(0, frames.length);
    for (const frame of batch) frame?.(performance.now());
  }
  /** A loop that never settles leaves work queued; it must not reach the next component. */
  frames.length = 0;
};

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

  /**
   * Every assignment here is a deliberate lie: a shim is not an `HTMLElement`, and saying so is the
   * point — elements hold strings, not trees. The casts mark each one as intended rather than
   * missed, which is what type-checking this package is for. Anything a component genuinely reaches
   * for is on `ElementShim`; anything else was never going to work server-side anyway.
   */
  globalThis.HTMLElement = /** @type {any} */ (ElementShim);
  globalThis.CSSStyleSheet = /** @type {any} */ (StyleSheetShim);
  /** Defined so core's `@scope` support check passes — SSR output gets scoped light-DOM CSS. */
  globalThis.CSSScopeRule = /** @type {any} */ (function CSSScopeRule() {});

  globalThis.customElements = /** @type {any} */ ({
    /**
     * Refused on a second definition, exactly as the platform does. The registry used to overwrite
     * silently, so a module defining a tag twice rendered fine on the server and threw
     * `NotSupportedError` in the browser — the server being lenient about an error is the server
     * hiding it.
     */
    define: (name, Class) => {
      if (registry.has(name)) {
        throw new Error(`customElements.define: '${name}' has already been defined`);
      }
      registry.set(name, Class);
    },
    get: (name) => registry.get(name),
    whenDefined: () => Promise.resolve(),
  });

  /**
   * The document, with the surface a component reaches for.
   *
   * `body`, `documentElement` and `title` are real enough to be written to — a component setting
   * `document.title` or appending to `document.body` is ordinary code, and losing the assignment
   * silently is the failure mode this package keeps producing. Queries answer emptily for the same
   * reason the containers do: this holds strings, not a tree.
   */
  globalThis.document = /** @type {any} */ ({
    title: '',
    body: new ElementShim('body'),
    documentElement: new ElementShim('html'),
    createElement: (localName) => new ElementShim(localName),
    createElementNS: (_namespace, localName) => new ElementShim(localName),
    createTextNode: (text) => ({ innerHTML: escapeHtml(text), textContent: String(text) }),
    createDocumentFragment: () => new ElementShim(''),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
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
  });

  /**
   * Enough `window` for `@verajs/router` to initialise.
   *
   * Without it, a component calling `initRouter` threw `window is not defined` and could not be
   * server-rendered at all — which rules out the app shell of every routed app, the exact thing
   * server rendering is for. The router is careful to be *importable* in Node and says so; nothing
   * made it *runnable*.
   *
   * Listeners are accepted and never fire, because nothing navigates on a server. `location`
   * describes the page being rendered, so a route resolves against a real path; set
   * `globalThis.location.pathname` before `renderToString` to render a route other than `/`.
   * `history` is inert: a server has no session history to push onto.
   */
  globalThis.window = /** @type {any} */ (globalThis);
  globalThis.location ??= /** @type {any} */ ({ pathname: '/', search: '', hash: '', href: 'http://localhost/' });
  globalThis.history = /** @type {any} */ ({
    scrollRestoration: 'auto',
    pushState: () => {},
    replaceState: () => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  });
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.scrollTo = () => {};
  globalThis.CustomEvent ??= /** @type {any} */ (class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this.defaultPrevented = false;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  });

  /**
   * Frames are queued and drained once the component's `connectedCallback` has returned — see
   * `flushFrames`.
   *
   * This deferred to `setTimeout`, which ran every scheduled callback long after the response was
   * built. Core's render scheduler is `requestAnimationFrame`, so any state a component settled
   * after its first `render()` — the ordinary `render(); this.state.x = fromAttribute` shape —
   * was dropped, and every `useEffect` was too. Both landed on the client instead, so the server
   * shipped one page and the browser immediately replaced it with a different one.
   *
   * Shimmed rather than left undefined so that unguarded callers — `@verajs/router`'s initial
   * navigation, any third-party component measuring itself — run instead of throwing.
   */
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.cancelAnimationFrame = (id) => {
    frames[id - 1] = null;
  };
  return registry;
};

export { escapeHtml };
