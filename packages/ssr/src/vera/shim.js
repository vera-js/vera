/**
 * The vera-native server environment: the smallest DOM surface core's server path actually
 * touches. No parse5, no jsdom — elements hold strings, not trees. Installed once, BEFORE
 * `@verajs/core` is imported, so core's `customElements.define` wrap lands on our registry and
 * every component module that executes registers itself here — this is what replaces wcc's
 * acorn walk: **Node resolves the module graph, execution registers the classes.**
 */

/** tag name -> class, filled as component modules execute. */
import { randomUUID } from 'node:crypto';

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
export const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'textarea', 'title']);

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

/**
 * A `DOMTokenList` over a space-separated attribute — `class` for `classList`, `part` for `part`.
 *
 * Shared because they are the same thing: `classList` was written first and `part` would have been
 * a second copy of it, which is how `ElementShim` and `ShadowRootShim` came to disagree.
 */
const tokenListView = (element, attribute) => {
  const tokens = () => (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
  const write = (list) =>
    list.length ? element.setAttribute(attribute, list.join(' ')) : element.removeAttribute(attribute);
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
    get value() {
      return element.getAttribute(attribute) ?? '';
    },
    get length() {
      return tokens().length;
    },
    [Symbol.iterator]: () => tokens()[Symbol.iterator](),
  };
};

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
/** Precomputed, because building `'&#' + c.charCodeAt(0) + ';'` per character is the slow half. */
const ESCAPED = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' };

const escapeHtml = (value) => {
  const text = typeof value === 'string' ? value : String(value);
  return NEEDS_ESCAPE.test(text) ? text.replace(ESCAPE, (character) => ESCAPED[character]) : text;
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
  /**
   * There is no rule *list* — this holds the stylesheet as text, which is all the markup needs —
   * so a rule cannot be addressed by index. Deleting one is refused rather than silently ignored.
   */
  deleteRule() {
    throw new Error('ssr: CSSStyleSheet.deleteRule needs a parsed rule list; this sheet is text');
  }
  /** The pre-standard spellings, which are still what some libraries reach for. */
  addRule(selector, style) {
    this.insertRule(`${selector} { ${style ?? ''} }`);
    return -1;
  }
  removeRule() {
    this.deleteRule();
  }
  get cssRules() {
    return [];
  }
  get rules() {
    return this.cssRules;
  }
  get ownerRule() {
    return null;
  }
  get ownerNode() {
    return null;
  }
  get parentStyleSheet() {
    return null;
  }
  get href() {
    return null;
  }
  get title() {
    return null;
  }
  get media() {
    return [];
  }
  get type() {
    return 'text/css';
  }
  disabled = false;
}

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
 *
 * Events come from Node's own `EventTarget`, so `once`, `handleEvent`, `event.target`,
 * `stopImmediatePropagation` and the return value of `dispatchEvent` are all correct without this
 * package implementing any of them. They used to be no-ops that reported every event delivered, so
 * anything a component decided from its own event — a control reading back its change, a callback
 * dispatched at mount, a `preventDefault` deciding whether to proceed — took one branch here and
 * the other in a browser. **Bubbling is still absent**: with children held as a string there is no
 * ancestor chain to walk, so an event reaches its own element's listeners and stops.
 */
class ContainerShim extends EventTarget {
  constructor() {
    super();
    this.innerHTML = '';
    /** A server-rendered node is in the document being built, so it is connected. */
    this.isConnected = true;
  }
  appendChild(node) {
    /**
     * A registered component that has not rendered is marked, so the scan over this markup renders
     * this instance instead of a new one built from the tag it wrote. See `pendingInstances`.
     */
    if (node?.openTag && registry.has(node.localName) && !node._rendered) {
      node.setAttribute(INSTANCE_ATTRIBUTE, String(++instanceCount));
      pendingInstances.set(String(instanceCount), node);
    }
    this.innerHTML += node?.openTag ? node.openTag() + node.innerHTML + `</${node.localName}>` : (node?.innerHTML ?? '');
    return node;
  }

  /**
   * What a node with no tree above or below it answers — shared, because an element and a shadow
   * root answer these identically and two copies is how they came to disagree in the first place.
   *
   * Every one is the truthful answer rather than a placeholder: a detached node has no parent, no
   * siblings and no box, and a browser returns exactly these. They are here because their
   * *absence* was a `TypeError` that took the whole render down — `this.parentElement && …` is
   * ordinary defensive code and it crashed.
   */
  get parentNode() {
    return null;
  }
  get parentElement() {
    return null;
  }
  get firstChild() {
    return null;
  }
  get lastChild() {
    return null;
  }
  get lastElementChild() {
    return null;
  }
  get nextSibling() {
    return null;
  }
  get previousSibling() {
    return null;
  }
  get nextElementSibling() {
    return null;
  }
  get previousElementSibling() {
    return null;
  }
  get assignedSlot() {
    return null;
  }
  get offsetParent() {
    return null;
  }
  get childElementCount() {
    return 0;
  }
  hasChildNodes() {
    return false;
  }
  get nodeValue() {
    return null;
  }
  get baseURI() {
    return globalThis.location?.href ?? '';
  }
  get namespaceURI() {
    return 'http://www.w3.org/1999/xhtml';
  }
  get prefix() {
    return null;
  }
  get ownerDocument() {
    return globalThis.document;
  }
  contains(node) {
    return node === this;
  }
  isSameNode(node) {
    return node === this;
  }
  isEqualNode(node) {
    return node === this;
  }
  normalize() {}
  getRootNode() {
    return this;
  }
  /** Needs layout, which a string does not have; a browser with no box returns nothing either. */
  elementFromPoint() {
    return null;
  }
  elementsFromPoint() {
    return [];
  }
  getSelection() {
    return null;
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
  prepend(...nodes) {
    const existing = this.innerHTML;
    this.innerHTML = '';
    this.append(...nodes);
    this.innerHTML += existing;
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
}

/**
 * A fragment is a container and nothing more.
 *
 * Its own class rather than a reused `ElementShim`, so `instanceof DocumentFragment` answers `false`
 * for an element — a check the renderer makes, and one that a shared class would have made true for
 * everything.
 */
class FragmentShim extends ContainerShim {
  get nodeType() {
    return 11;
  }
  get nodeName() {
    return '#document-fragment';
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
  /**
   * The options it was opened with, readable the way a browser exposes them.
   *
   * These are already serialized into the declarative template — they have to be, because
   * `attachShadow` reuses a declarative root and ignores the options it is handed. A component
   * that *reads* them back, to decide whether to manage focus itself, saw `undefined`.
   */
  get delegatesFocus() {
    return !!this._init.delegatesFocus;
  }
  get clonable() {
    return !!this._init.clonable;
  }
  get serializable() {
    return !!this._init.serializable;
  }
  get slotAssignment() {
    return this._init.slotAssignment ?? 'named';
  }
  get nodeType() {
    return 11;
  }
  get nodeName() {
    return '#document-fragment';
  }
  /** Nothing is focused on a server, and nothing is in a top layer. */
  get activeElement() {
    return null;
  }
  get fullscreenElement() {
    return null;
  }
  get pointerLockElement() {
    return null;
  }
  get pictureInPictureElement() {
    return null;
  }
  /** `<style>` elements appended here; the constructed ones are `adoptedStyleSheets`. */
  get styleSheets() {
    return this._styles.map((cssText) => Object.assign(new StyleSheetShim(), { cssText }));
  }
  /** A shadow root's text is its content's text, and setting it replaces the content. */
  get textContent() {
    return this.innerHTML.replace(/<[^>]*>/g, '');
  }
  set textContent(value) {
    this.innerHTML = escapeHtml(value);
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
 * Properties that are a **view of an attribute**, and the attribute each one reflects.
 *
 * `this.id = 'x'`, `this.className = 'a b'`, `this.ariaLabel = 'Close'`, `this.hidden = true` are
 * all ordinary component code, and every one of them was a plain property here: the assignment
 * stuck to the object and never reached the markup, so the server and the client disagreed about
 * the element's own attributes. Generated from a table rather than written out, because there are
 * sixty of them and the ARIA half is pure repetition — the list is the specification, and adding
 * one is adding a name.
 *
 * `booleans` are present/absent (`hidden`), the rest carry their value. `role` and the `aria-*`
 * family are ordinary string reflections; `tabIndex` is a number that still round-trips as text.
 */
const dashedAria = (name) => `aria-${name.slice(4).toLowerCase()}`;

/** Plain strings: the attribute's value, or `''` when it is absent. */
const REFLECTED = {
  id: 'id',
  className: 'class',
  title: 'title',
  lang: 'lang',
  dir: 'dir',
  slot: 'slot',
  nonce: 'nonce',
  accessKey: 'accesskey',
  role: 'role',
  popover: 'popover',
  autocapitalize: 'autocapitalize',
  autocorrect: 'autocorrect',
  enterKeyHint: 'enterkeyhint',
  inputMode: 'inputmode',
  contentEditable: 'contenteditable',
  writingSuggestions: 'writingsuggestions',
  virtualKeyboardPolicy: 'virtualkeyboardpolicy',
};

/** Present or absent. */
const REFLECTED_PRESENCE = { hidden: 'hidden', autofocus: 'autofocus', inert: 'inert' };

/** A boolean in JavaScript, the words `true`/`false` in the markup. */
const REFLECTED_TRUE_FALSE = { draggable: 'draggable', spellcheck: 'spellcheck' };

/** The one that spells its booleans differently. */
const REFLECTED_YES_NO = { translate: 'translate' };

/** A number in JavaScript, its digits in the markup. */
const REFLECTED_NUMBERS = { tabIndex: 'tabindex' };

/**
 * `Node`'s numeric constants, and the measurements a box that was never laid out reports.
 *
 * Zero is what a browser returns for a detached element, so these are accurate rather than
 * convenient. `currentCSSZoom` is 1 for the same reason.
 */
const NODE_CONSTANTS = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12,
  DOCUMENT_POSITION_DISCONNECTED: 1,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
};
const LAYOUT_ZEROS = [
  'clientWidth', 'clientHeight', 'clientLeft', 'clientTop',
  'offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop',
  'scrollWidth', 'scrollHeight', 'scrollLeftMax', 'scrollTopMax',
];

/**
 * Installs the generated accessors onto the shim's prototype.
 *
 * @param {typeof ElementShim} Shim
 */
const defineReflections = (Shim) => {
  for (const name of LAYOUT_ZEROS) Object.defineProperty(Shim.prototype, name, { value: 0, writable: true, configurable: true });
  /** Scroll offsets are writable and read back, which is what a scroll-restoring component does. */
  for (const name of ['scrollLeft', 'scrollTop'])
    Object.defineProperty(Shim.prototype, name, { value: 0, writable: true, configurable: true });
  Object.defineProperty(Shim.prototype, 'currentCSSZoom', { value: 1, configurable: true });
  Object.defineProperty(Shim.prototype, 'isContentEditable', {
    get() {
      return this.getAttribute('contenteditable') === 'true';
    },
    configurable: true,
  });
  for (const [property, attribute] of Object.entries(REFLECTED)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return this.getAttribute(attribute) ?? '';
      },
      set(value) {
        this.setAttribute(attribute, value);
      },
      configurable: true,
    });
  }
  for (const [property, attribute] of Object.entries(REFLECTED_PRESENCE)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return this.hasAttribute(attribute);
      },
      set(value) {
        if (value) this.setAttribute(attribute, '');
        else this.removeAttribute(attribute);
      },
      configurable: true,
    });
  }
  for (const [words, table] of [
    [['true', 'false'], REFLECTED_TRUE_FALSE],
    [['yes', 'no'], REFLECTED_YES_NO],
  ]) {
    for (const [property, attribute] of Object.entries(table)) {
      Object.defineProperty(Shim.prototype, property, {
        get() {
          return this.getAttribute(attribute) !== words[1];
        },
        set(value) {
          this.setAttribute(attribute, value ? words[0] : words[1]);
        },
        configurable: true,
      });
    }
  }
  for (const [property, attribute] of Object.entries(REFLECTED_NUMBERS)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return Number(this.getAttribute(attribute) ?? 0);
      },
      set(value) {
        this.setAttribute(attribute, Number(value));
      },
      configurable: true,
    });
  }
  for (const property of ARIA_PROPERTIES) {
    const attribute = dashedAria(property);
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return this.getAttribute(attribute);
      },
      set(value) {
        if (value == null) this.removeAttribute(attribute);
        else this.setAttribute(attribute, value);
      },
      configurable: true,
    });
  }
};

/**
 * The ARIA reflection family, named once. Each is `aria-` plus the rest, lowercased —
 * `ariaValueMax` is `aria-valuemax` — with no exceptions in the set a component uses.
 */
const ARIA_PROPERTIES = [
  'ariaAtomic', 'ariaAutoComplete', 'ariaBrailleLabel', 'ariaBrailleRoleDescription', 'ariaBusy',
  'ariaChecked', 'ariaColCount', 'ariaColIndex',
  'ariaColIndexText', 'ariaColSpan', 'ariaCurrent', 'ariaDescription', 'ariaDisabled',
  'ariaExpanded', 'ariaHasPopup', 'ariaHidden', 'ariaInvalid', 'ariaKeyShortcuts', 'ariaLabel',
  'ariaLevel', 'ariaLive', 'ariaModal', 'ariaMultiLine', 'ariaMultiSelectable', 'ariaOrientation',
  'ariaPlaceholder', 'ariaPosInSet', 'ariaPressed', 'ariaReadOnly', 'ariaRelevant', 'ariaRequired',
  'ariaRoleDescription', 'ariaRowCount', 'ariaRowIndex', 'ariaRowIndexText', 'ariaRowSpan',
  'ariaSelected', 'ariaSetSize', 'ariaSort', 'ariaValueMax', 'ariaValueMin', 'ariaValueNow',
  'ariaValueText',
];

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
  get nodeType() {
    return 1;
  }
  get nodeName() {
    return this.tagName;
  }
  closest() {
    return null;
  }
  matches() {
    return false;
  }
  remove() {}
  /**
   * Backed by the `class` attribute, so a class added during `connectedCallback` reaches the
   * markup — which it now can, because the opening tag is written from these attributes rather
   * than copied from the source text.
   */
  get classList() {
    return tokenListView(this, 'class');
  }

  /**
   * What a **detached, childless** element answers.
   *
   * Every one of these is the truthful answer for this element, not a placeholder: an element with
   * no parent has no siblings and no parent, an element outside a document has no box, and a
   * childless one contains nothing. A browser returns exactly these values for a detached element.
   * They are here because their *absence* was a `TypeError` that took the whole render down —
   * `this.parentElement && …` is ordinary defensive code and it crashed.
   */

  /** No layout on a server, and none for a detached element in a browser either. */
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  }
  getClientRects() {
    return [];
  }
  checkVisibility() {
    return false;
  }
  getElementsByTagName() {
    return [];
  }
  getElementsByTagNameNS() {
    return [];
  }
  getElementsByClassName() {
    return [];
  }
  /**
   * Namespaces collapse to the plain attribute methods. This DOM serializes HTML, where an
   * `xml:lang` or `xlink:href` is one attribute with a colon in its name — which is how the
   * serializer already treats it, and how the markup reads it back.
   */
  getAttributeNS(_namespace, name) {
    return this.getAttribute(name);
  }
  setAttributeNS(_namespace, name, value) {
    this.setAttribute(name, value);
  }
  hasAttributeNS(_namespace, name) {
    return this.hasAttribute(name);
  }
  removeAttributeNS(_namespace, name) {
    this.removeAttribute(name);
  }
  hasAttributes() {
    return this._attributes.size > 0;
  }
  getAttributeNode(name) {
    return this.hasAttribute(name) ? { name, value: this.getAttribute(name) } : null;
  }
  getAttributeNodeNS(_namespace, name) {
    return this.getAttributeNode(name);
  }
  setAttributeNode(node) {
    this.setAttribute(node.name, node.value);
    return null;
  }
  setAttributeNodeNS(node) {
    return this.setAttributeNode(node);
  }
  removeAttributeNode(node) {
    this.removeAttribute(node.name);
    return node;
  }
  /** Aliases the engines still carry. */
  webkitMatchesSelector() {
    return false;
  }
  mozMatchesSelector() {
    return false;
  }
  /**
   * Interaction, which a server has none of — but the calls are ordinary and must not throw.
   *
   * `click()` is the exception: it *dispatches an event*, and now that listeners are real, a
   * component that clicks itself to seed its own state gets the same result on both sides.
   */
  focus() {}
  blur() {}
  click() {
    this.dispatchEvent(new globalThis.Event('click', { bubbles: true, cancelable: true, composed: true }));
  }
  scrollIntoView() {}
  scroll() {}
  scrollTo() {}
  scrollBy() {}

  /**
   * `insertAdjacent*` at the two positions that do not need a parent.
   *
   * `beforebegin` and `afterend` place content *beside* this element, which requires the parent
   * this element does not have. They are refused rather than silently dropped — putting content
   * nowhere is the failure this whole file keeps being audited for.
   *
   * **A markup sink, deliberately** (CODE-PRINCIPLES #8). It writes what it is given, exactly as
   * the DOM's own `insertAdjacentHTML` does, because a component calling it has already decided
   * that: the same call on the client is the same sink, and a server that escaped where the browser
   * does not would render one page and hydrate into another. `insertAdjacentText` escapes, which is
   * the difference between the two methods and the one to reach for with anything from a request.
   */
  insertAdjacentHTML(position, markup) {
    const where = String(position).toLowerCase();
    if (where === 'afterbegin') this.innerHTML = markup + this.innerHTML;
    else if (where === 'beforeend') this.innerHTML += markup;
    else
      throw new Error(
        `ssr: insertAdjacentHTML('${position}') needs a parent element, and a server-rendered ` +
          `component has none. Use 'afterbegin' or 'beforeend'.`
      );
  }
  insertAdjacentText(position, text) {
    this.insertAdjacentHTML(position, escapeHtml(text));
  }
  insertAdjacentElement(position, element) {
    this.insertAdjacentHTML(position, element.openTag() + element.innerHTML + `</${element.localName}>`);
    return element;
  }
  /** The element's own markup, which the serializer builds anyway. */
  get outerHTML() {
    return `${this.openTag()}${this.innerHTML}</${this.localName}>`;
  }
  get innerText() {
    return this.textContent;
  }
  set innerText(value) {
    this.textContent = value;
  }
  /** `part` is a token list over the `part` attribute, exactly as `classList` is over `class`. */
  get part() {
    return tokenListView(this, 'part');
  }

  /**
   * Form-associated custom elements.
   *
   * `attachInternals()` not existing meant `static formAssociated = true` — the standard way to
   * write a custom form control — threw during `connectedCallback` and took the page with it. None
   * of what internals carry reaches markup (form value, validity and implicit ARIA are all
   * internal state), so this is inert by design rather than by omission: the component runs, and
   * the client's real internals take over on hydration.
   */
  attachInternals() {
    if (internals.has(this)) return internals.get(this);
    internals.set(this, {
      shadowRoot: this.shadowRoot,
      form: null,
      labels: [],
      willValidate: true,
      validity: { valid: true },
      validationMessage: '',
      states: new Set(),
      setFormValue: () => {},
      setValidity: () => {},
      checkValidity: () => true,
      reportValidity: () => true,
    });
    return internals.get(this);
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

/**
 * The three event methods, bound to a real `EventTarget`, ready to spread onto a plain-object shim.
 *
 * `document` and `window` are object literals rather than classes, so they cannot simply extend
 * `EventTarget` the way the containers do. They still have to *work*: both were no-ops that
 * reported every event delivered.
 *
 * The dispatched event's `target` is corrected to the shim, because the listener reads it and
 * `document` is the answer it expects — not the private object the listeners happen to live on.
 * An own property shadows `Event`'s prototype getter, which is read-only.
 *
 * @param {EventTarget} target
 * @param {() => unknown} self What the event should report as its target, resolved at dispatch
 *   because `document` does not exist yet when this is called.
 */
const delegateEvents = (target, self) => ({
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: (event) => {
    for (const name of ['target', 'currentTarget'])
      Object.defineProperty(event, name, { value: self(), configurable: true });
    return target.dispatchEvent(event);
  },
});

/** `window` and the global scope are the same object here, so they share one target. */
const windowEvents = new EventTarget();

/**
 * `document.createElement('my-comp')` builds **the component**, not a blank element.
 *
 * A browser upgrades a known tag as it creates it, so the class's constructor runs and its field
 * initialisers are in place before anyone touches the element. This returned a bare `ElementShim`,
 * so a component created imperatively had none of its own state, and `instanceof` said no.
 */
const createElement = (localName) => {
  const Component = registry.get(localName);
  if (!Component) return new ElementShim(localName);
  const element = new Component();
  element.localName = localName;
  return element;
};

/**
 * Instances handed to `appendChild` before they have rendered, so the scan renders **them** rather
 * than a fresh copy built from their markup.
 *
 * The nested-component scan reads emitted markup and instantiates what it finds, which is right for
 * a tag written in a template and wrong for an element the component built itself: everything
 * assigned to it — `kid.rows = data`, the ordinary way to hand structured data to a child — was
 * lost, because an attribute cannot carry it and a fresh instance never saw it. The marker attribute
 * is the handle, and `renderComponent` removes it as it renders.
 */
export const pendingInstances = new Map();

/**
 * The marker's **name** carries a per-process random token, because the markup it is written into is
 * not all ours.
 *
 * `children` and the string form of `attributes` are raw markup by design, so a caller passing
 * request data through either hands an attacker a way to write attributes into this document. With a
 * fixed name, injected markup could claim a component's prepared instance — and win, because it is
 * already in the markup when the real one is appended, and the scan reads in order. Demonstrated: an
 * injected `<x-y vera-ssr-instance="1">` rendered with the parent's data while the parent's own
 * child fell back to defaults. A name nothing outside this module can guess closes it, and
 * `renderComponent` also refuses a marker whose instance is not the tag being rendered.
 *
 * Import-time rather than per-render: an attacker cannot read either, and the output never contains
 * the marker, so nothing observable depends on it.
 */
export const INSTANCE_ATTRIBUTE = `vera-ssr-${randomUUID()}`;
let instanceCount = 0;

/** One `ElementInternals` per element, as `attachInternals` guarantees. */
const internals = new WeakMap();

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
export const flushFrames = (report) => {
  for (let round = 0; round < FRAME_ROUNDS && frames.length; round++) {
    const batch = frames.splice(0, frames.length);
    for (const frame of batch) {
      /**
       * One failing callback does not take the others down, because a browser runs each frame
       * callback independently and reports a throw rather than abandoning the frame. It is not
       * *swallowed* either — `report` collects it, and the render fails at the end naming the
       * component, the same way a hook error does.
       */
      try {
        frame?.(performance.now());
      } catch (error) {
        report?.(error);
      }
    }
  }
  /** A loop that never settles leaves work queued; it must not reach the next component. */
  frames.length = 0;
};

defineReflections(ElementShim);
/** `Node`'s constants are on every node, so they go on the shared base. */
Object.assign(ContainerShim.prototype, NODE_CONSTANTS);

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
  /**
   * The DOM interfaces, so `instanceof` answers correctly.
   *
   * `value instanceof Node` is how ordinary code tells a node from a string — the renderer's own
   * text-vs-node decision is that test — and `Node` being undefined made it a `ReferenceError`
   * rather than `false`. These are the real shim classes, so an element made here *is* a `Node`,
   * an `Element` and an `HTMLElement`, exactly as it would be in a browser.
   */
  globalThis.Node = /** @type {any} */ (ContainerShim);
  globalThis.Element = /** @type {any} */ (ElementShim);
  globalThis.ShadowRoot = /** @type {any} */ (ShadowRootShim);
  /**
   * `Document` exists so that **feature detection** can read it.
   *
   * The standard constructed-stylesheet probe is
   * `ShadowRoot && 'adoptedStyleSheets' in Document.prototype && 'replace' in CSSStyleSheet.prototype`
   * — lit's, and everyone else's. Defining `ShadowRoot` without `Document` moved that probe from
   * "no shadow DOM at all" to "shadow DOM, now read `Document.prototype`", which threw. Every
   * clause is true of this environment, so all three are answerable and the probe takes the branch
   * this shim actually supports.
   *
   * The document is a literal rather than a class — it has one instance and no subclasses — so it
   * is given this prototype rather than built from it.
   */
  globalThis.Document = /** @type {any} */ (class Document {});
  Object.defineProperty(globalThis.Document.prototype, 'adoptedStyleSheets', { value: [], writable: true });
  globalThis.DocumentFragment = /** @type {any} */ (FragmentShim);
  /** `new Image()` is a spelling of `createElement('img')`, and `Audio` of `createElement('audio')`. */
  globalThis.Image = /** @type {any} */ (class Image extends ElementShim {
    constructor() {
      super('img');
    }
  });
  globalThis.Audio = /** @type {any} */ (class Audio extends ElementShim {
    constructor() {
      super('audio');
    }
  });

  /**
   * The observers, inert.
   *
   * Every one of them observes something a server does not have — a viewport, a box, a live tree —
   * so none can ever fire here. What matters is that constructing one does not throw: a component
   * that lazy-loads on intersection, or watches its own size, is written for a browser and must
   * still *render* on a server. `@verajs/autoloader` builds a `MutationObserver`, which made an app
   * entry that wires it unrenderable.
   */
  for (const name of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'PerformanceObserver'])
    globalThis[name] = /** @type {any} */ (class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    });

  /**
   * A media query with no viewport to match matches nothing, which is what every server renderer
   * answers and what hydration then corrects. Absent, it was a `TypeError` in `connectedCallback`.
   */
  globalThis.matchMedia = /** @type {any} */ (
    (media) => ({
      media,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
    })
  );

  /** No layout means no computed value; a browser gives a detached element nothing useful either. */
  globalThis.getComputedStyle = /** @type {any} */ (
    () => ({
      getPropertyValue: () => '',
      getPropertyPriority: () => '',
      length: 0,
      item: () => '',
    })
  );
  globalThis.getSelection = () => null;

  /**
   * Idle time joins the frame queue rather than inventing a second one — the render is over when
   * `flushFrames` runs out, and work deferred to "when the browser is free" has to land before
   * then or it lands nowhere.
   */
  globalThis.requestIdleCallback = /** @type {any} */ (
    (fn) => frames.push(() => fn({ didTimeout: false, timeRemaining: () => 0 }))
  );
  globalThis.cancelIdleCallback = /** @type {any} */ ((id) => {
    frames[id - 1] = null;
  });
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
    createElement: (localName) => createElement(localName),
    createElementNS: (_namespace, localName) => createElement(localName),
    createTextNode: (text) => ({ innerHTML: escapeHtml(text), textContent: String(text) }),
    createDocumentFragment: () => new FragmentShim(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    ...NODE_CONSTANTS,
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [],
    getElementsByClassName: () => [],
    getElementsByName: () => [],
    /**
     * What a document being *built* reports. `readyState` is `'loading'` because that is exactly
     * what is happening: nothing has finished parsing, and a component that waits for
     * `DOMContentLoaded` on the client is right to see this rather than a lie about being ready.
     */
    readyState: 'loading',
    visibilityState: 'visible',
    hidden: false,
    characterSet: 'UTF-8',
    inputEncoding: 'UTF-8',
    charset: 'UTF-8',
    contentType: 'text/html',
    compatMode: 'CSS1Compat',
    dir: '',
    designMode: 'off',
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    currentScript: null,
    scrollingElement: null,
    fullscreenElement: null,
    pointerLockElement: null,
    pictureInPictureElement: null,
    doctype: null,
    firstElementChild: null,
    lastElementChild: null,
    childElementCount: 0,
    children: [],
    childNodes: [],
    styleSheets: [],
    forms: [],
    images: [],
    links: [],
    scripts: [],
    embeds: [],
    plugins: [],
    anchors: [],
    hasFocus: () => false,
    createComment: (text) => ({ innerHTML: `<!--${text}-->`, textContent: String(text) }),
    getSelection: () => null,
    elementFromPoint: () => null,
    elementsFromPoint: () => [],
    contains: () => false,
    /** Nothing here owns another document, so importing and adopting are the identity. */
    importNode: (node) => node,
    adoptNode: (node) => node,
    get defaultView() {
      return globalThis.window;
    },
    get URL() {
      return globalThis.location?.href ?? '';
    },
    get documentURI() {
      return globalThis.location?.href ?? '';
    },
    get baseURI() {
      return globalThis.location?.href ?? '';
    },
    get referrer() {
      return '';
    },
    /**
     * Real listeners here too, delegated to an `EventTarget` of the document's own. A component
     * that listens on `document` and dispatches there — a store broadcasting, a dialog closing on
     * `keydown` it fires itself — behaved one way in a browser and not at all here.
     */
    ...delegateEvents(new EventTarget(), () => globalThis.document),
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
  /** Given `Document.prototype` here, where the document it describes finally exists. */
  Object.setPrototypeOf(globalThis.document, globalThis.Document.prototype);

  /**
   * Enough `window` for `@verajs/router` to initialise.
   *
   * Without it, a component calling `initRouter` threw `window is not defined` and could not be
   * server-rendered at all — which rules out the app shell of every routed app, the exact thing
   * server rendering is for. The router is careful to be *importable* in Node and says so; nothing
   * made it *runnable*.
   *
   * Listeners are real — a component that dispatches a window event and listens for it, which is
   * how loosely coupled components talk to each other, used to be talking into a no-op. Nothing on
   * a server *navigates*, so `popstate` and friends still never arrive on their own. `location`
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
  Object.assign(globalThis, delegateEvents(windowEvents, () => globalThis.window));
  globalThis.scrollTo = () => {};
  /**
   * Node supplies `Event` and `CustomEvent`; this fills in only where it does not, and matches the
   * shape `EventTarget` dispatches.
   */
  globalThis.CustomEvent ??= /** @type {any} */ (
    class CustomEvent extends Event {
      constructor(type, init = {}) {
        super(type, init);
        this.detail = init.detail ?? null;
      }
    }
  );


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
