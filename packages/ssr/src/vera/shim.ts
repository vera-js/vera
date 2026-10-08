/**
 * Installs the server environment: the globals a component finds when it runs outside a browser.
 *
 * Import this **before anything that imports `@verajs/core`** — core evaluates against these, and
 * `@verajs/ssr` does it for you. What each global is, and why it answers the way it does, lives
 * with the thing it is made of: the nodes in `./nodes.js`, escaping in `./escaping.js`, the frame
 * queue in `./frames.js`, stylesheets in `./stylesheets.js`, the registry in `./registry.js`.
 *
 * The rule every one of them follows: **answer honestly or do not exist** — and its corollary,
 * **where the platform throws, this throws.** A server that is lenient about an error does not make
 * anything work: it moves the failure to the client, strips the context that would have explained
 * it, and in the meantime writes markup no browser would have produced from the same call. That
 * corollary has found more defects here than asking whether a member is present, because a member
 * that is present and too permissive looks exactly like one that is correct. A detached element has no
 * parent, no siblings and no box, and a browser returns exactly what these do. Where a server cannot
 * answer at all — `localStorage` is one browser's state — the global stays undefined, because
 * `typeof localStorage === 'undefined'` is the guard the ecosystem already writes and it only works
 * if this does not lie. `tests/ssr-dom-surface.test.mjs` enforces both halves.
 */
import { escapeHtml, escapeStyleText, escapeRawText, RAW_TEXT_ELEMENTS } from './escaping.js';
import { hoistedStyles, setRenderingTag, StyleSheetShim, hoist, beginHoisting, documentAdoptedSheets, setDocumentAdoptedSheets } from './stylesheets.js';
import { beginBudget, bounded, cancelFrame, endBudget, flushFrames, flushFramesAsync, requestFrame, setCoreFlush } from './frames.js';
import { registry } from './registry.js';
import {
  TextShim,
  CommentShim,
  ContainerShim,
  FragmentShim,
  ShadowRootShim,
  ElementShim,
  createElement,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
  NODE_CONSTANTS,
} from './nodes.js';

/** Any node this DOM builds — what a walk visits and a walker's `root` is. */
type WalkNode = TextShim | CommentShim | ElementShim | FragmentShim | ShadowRootShim;

/**
 * A `NodeFilter` as a walker takes it: a function, or an object with `acceptNode`. Its verdict is the
 * platform's number, and anything that is not `FILTER_ACCEPT` (or `undefined`) rejects.
 */
type WalkFilter = ((node: WalkNode) => unknown) | { acceptNode?: (node: WalkNode) => unknown } | null;

/** The global scope, written to by a name `typeof globalThis` does not declare. */
type GlobalScope = Record<string, unknown>;

/** The flag an install leaves on the global, so a second import installs nothing. */
type ShimmedGlobal = { __veraSsrShimmed?: boolean };

/** The eight hyphenated names SVG and MathML already define, which a custom element may not take. */
const RESERVED_NAMES = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);
/** A name `define` accepts — the spec's rule, shared with `whenDefined` so the two refuse exactly the same names. */
const validName = (name: unknown): name is string =>
  typeof name === 'string' && /^[a-z][^A-Z]*-[^A-Z]*$/.test(name) && !RESERVED_NAMES.has(name);
/**
 * The promises `whenDefined` handed out for names not yet defined, settled by their `define`. Cleared at each render's
 * start: a wait from a finished render has nothing left to resume, and names that come from DATA (tags found in user
 * content) would otherwise grow it for the life of the process.
 */
const pendingDefinitions = new Map<string, { promise: Promise<CustomElementConstructor>; resolve: (Class: CustomElementConstructor) => void }>();
/** What `index.ts` needs of it: the names still awaited — named when a render runs out of time — and the per-render reset. */
export const pendingDefinitionNames = (): string[] => [...pendingDefinitions.keys()];
export const resetPendingDefinitions = (): void => pendingDefinitions.clear();

/**
 * Re-exported so a consumer of the server environment has one import, not seven. The homes above are
 * where the code lives; this is the door.
 */
export {
  escapeHtml,
  escapeStyleText,
  escapeRawText,
  RAW_TEXT_ELEMENTS,
  hoistedStyles,
  beginHoisting,
  setRenderingTag,
  flushFrames,
  flushFramesAsync,
  setCoreFlush,
  beginBudget,
  bounded,
  endBudget,
  registry,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
};

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
 * @param self What the event should report as its target, resolved at dispatch
 *   because `document` does not exist yet when this is called.
 */
const delegateEvents = (target: EventTarget, self: () => unknown) => ({
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: (event: Event) => {
    for (const name of ['target', 'currentTarget'])
      Object.defineProperty(event, name, { value: self(), configurable: true });
    return target.dispatchEvent(event);
  },
});

/** `window` and the global scope are the same object here, so they share one target. */
const windowEvents = new EventTarget();

/** Idempotent. Installs the server environment; the registry is filled as modules execute. */
/**
 * The roots a document-level query has to cover. `documentElement` and `body` are separate elements
 * here rather than one nested pair, so every query walks both — `documentElement` first, which is
 * where a real document would find anything under `<html>` before reaching `<body>`.
 */
/** A filter's verdict as the platform reads it: `whatToShow` first (a node it excludes is SKIPPED), then the filter. */
const ACCEPT = 1;
const REJECT = 2;
const SKIP = 3;
const verdictOf = (node: WalkNode, whatToShow: number, filter: WalkFilter | undefined): number => {
  const bit = node.nodeType === 1 ? 1 : node.nodeType === 3 ? 4 : node.nodeType === 8 ? 128 : 0;
  // eslint-disable-next-line no-bitwise -- whatToShow is the platform's own NodeFilter bitmask
  if (!(whatToShow & bit)) return SKIP;
  const verdict = typeof filter === 'function' ? filter(node) : filter?.acceptNode?.(node);
  return verdict === REJECT || verdict === SKIP ? verdict : ACCEPT;
};
/**
 * The links a walk follows, typed once. Every read goes through `linked`, which turns a MISSING member into `null`:
 * the document object here has no `firstChild` at all, and a walker rooted at it must walk nothing, not throw.
 */
type Linked = WalkNode & {
  readonly parentNode: WalkNode | null;
  readonly firstChild: WalkNode | null;
  readonly lastChild: WalkNode | null;
  readonly nextSibling: WalkNode | null;
  readonly previousSibling: WalkNode | null;
};
const linked = (node: WalkNode | null | undefined): Linked | null => (node ?? null) as Linked | null;

/**
 * `createNodeIterator`: document order, the root included, forwards and backwards. An iterator reads `FILTER_REJECT`
 * as `FILTER_SKIP` — only a walker prunes — so a flat filtered list is exactly its answer.
 */
const makeIterator = (root: WalkNode, whatToShow = 0xffffffff, filter?: WalkFilter) => {
  /** Document order, depth first. `childNodes` rather than `_entries`: it is what makes markup held as a string get parsed. */
  const flatten = (node: WalkNode, out: WalkNode[] = []): WalkNode[] => {
    for (const child of node.childNodes ?? []) {
      out.push(child);
      flatten(child, out);
    }
    return out;
  };
  let current: WalkNode | null = null;
  const step = (direction: number): WalkNode | null => {
    const nodes = [root, ...flatten(root)].filter((node) => verdictOf(node, whatToShow, filter) === ACCEPT);
    const index = current === null ? -1 : nodes.indexOf(current);
    const next = direction > 0 ? nodes[index + 1] : nodes[index - 1];
    if (!next) return null;
    current = next;
    return next;
  };
  return { root, whatToShow, filter: filter ?? null, nextNode: () => step(1), previousNode: () => step(-1) };
};

/**
 * **`createTreeWalker`, by the DOM standard's own algorithms** — "traverse children", "traverse siblings" and the
 * rest, transcribed rather than approximated. The approximation climbed above `root` in `parentNode`, gave up in
 * `nextSibling` at the first filtered sibling instead of searching on (into a SKIPPED sibling's children, past a
 * REJECTED one's), and never pruned a REJECTED subtree in `nextNode`. jsdom implements the same algorithms, and
 * `tests/ssr-tree-walker.test.mjs` compares the two over generated trees and filters.
 */
const makeTreeWalker = (root: WalkNode, whatToShow = 0xffffffff, filter?: WalkFilter) => {
  let current: WalkNode = root;
  const judge = (node: WalkNode): number => verdictOf(node, whatToShow, filter);
  const children = (first: boolean): WalkNode | null => {
    let node = linked(first ? linked(current)!.firstChild : linked(current)!.lastChild);
    while (node !== null) {
      const result = judge(node);
      if (result === ACCEPT) return (current = node);
      if (result === SKIP) {
        const child = linked(first ? node.firstChild : node.lastChild);
        if (child !== null) {
          node = child;
          continue;
        }
      }
      while (node !== null) {
        const sibling: Linked | null = linked(first ? node.nextSibling : node.previousSibling);
        if (sibling !== null) {
          node = sibling;
          break;
        }
        const parent: Linked | null = linked(node.parentNode);
        if (parent === null || parent === root || parent === current) return null;
        node = parent;
      }
    }
    return null;
  };
  const siblings = (next: boolean): WalkNode | null => {
    let node = linked(current)!;
    if (node === root) return null;
    for (;;) {
      let sibling = linked(next ? node.nextSibling : node.previousSibling);
      while (sibling !== null) {
        node = sibling;
        const result = judge(node);
        if (result === ACCEPT) return (current = node);
        sibling = linked(next ? node.firstChild : node.lastChild);
        if (result === REJECT || sibling === null) sibling = linked(next ? node.nextSibling : node.previousSibling);
      }
      const parent = linked(node.parentNode);
      if (parent === null || parent === root) return null;
      node = parent;
      if (judge(node) === ACCEPT) return null;
    }
  };
  return {
    root,
    whatToShow,
    filter: filter ?? null,
    get currentNode() {
      return current;
    },
    set currentNode(node: WalkNode) {
      current = node;
    },
    parentNode: (): WalkNode | null => {
      let node = linked(current);
      while (node !== null && node !== root) {
        node = linked(node.parentNode);
        if (node !== null && judge(node) === ACCEPT) return (current = node);
      }
      return null;
    },
    firstChild: () => children(true),
    lastChild: () => children(false),
    nextSibling: () => siblings(true),
    previousSibling: () => siblings(false),
    previousNode: (): WalkNode | null => {
      let node = linked(current)!;
      while (node !== root) {
        let sibling = linked(node.previousSibling);
        while (sibling !== null) {
          node = sibling;
          let result = judge(node);
          while (result !== REJECT && linked(node.lastChild) !== null) {
            node = linked(node.lastChild)!;
            result = judge(node);
          }
          if (result === ACCEPT) return (current = node);
          sibling = linked(node.previousSibling);
        }
        const parent = linked(node.parentNode);
        if (node === root || parent === null) return null;
        node = parent;
        if (judge(node) === ACCEPT) return (current = node);
      }
      return null;
    },
    nextNode: (): WalkNode | null => {
      let node = linked(current)!;
      let result = ACCEPT;
      for (;;) {
        while (result !== REJECT && linked(node.firstChild) !== null) {
          node = linked(node.firstChild)!;
          result = judge(node);
          if (result === ACCEPT) return (current = node);
        }
        let sibling: Linked | null = null;
        let temporary: Linked | null = node;
        while (temporary !== null) {
          if (temporary === root) return null;
          sibling = linked(temporary.nextSibling);
          if (sibling !== null) {
            node = sibling;
            break;
          }
          temporary = linked(temporary.parentNode);
        }
        if (sibling === null) return null;
        result = judge(node);
        if (result === ACCEPT) return (current = node);
      }
    },
  };
};

const documentRoots = () =>
  [globalThis.document.documentElement, globalThis.document.body] as unknown as ElementShim[];

/**
 * Which parts of a URL `location` carries — the one place that knows.
 *
 * `index.js` kept its own copy for `applyLocation`/`restoreLocation` to walk. They agreed, and
 * nothing made them: a part added to one list would be installed and never restored, or restored
 * from a property the install never wrote. Same single fact, same reasoning as `RAW_TEXT_ELEMENTS`
 * below it — CODE-PRINCIPLES #5.
 */
export const LOCATION_PARTS = [
  'href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin',
] as const;

export const installShims = () => {
  if ((globalThis as ShimmedGlobal).__veraSsrShimmed) return registry;
  (globalThis as ShimmedGlobal).__veraSsrShimmed = true;

  /**
   * Every assignment here is a deliberate lie: a shim is not an `HTMLElement`, and saying so is the
   * point — elements hold strings, not trees. The casts mark each one as intended rather than
   * missed, which is what type-checking this package is for. Anything a component genuinely reaches
   * for is on `ElementShim`; anything else was never going to work server-side anyway.
   */
  globalThis.HTMLElement = ElementShim as unknown as typeof HTMLElement;
  globalThis.CSSStyleSheet = StyleSheetShim as unknown as typeof CSSStyleSheet;
  /**
   * The DOM interfaces, so `instanceof` answers correctly.
   *
   * `value instanceof Node` is how ordinary code tells a node from a string — the renderer's own
   * text-vs-node decision is that test — and `Node` being undefined made it a `ReferenceError`
   * rather than `false`. These are the real shim classes, so an element made here *is* a `Node`,
   * an `Element` and an `HTMLElement`, exactly as it would be in a browser.
   */
  globalThis.Node = ContainerShim as unknown as typeof Node;
  globalThis.Element = ElementShim as unknown as typeof Element;
  globalThis.ShadowRoot = ShadowRootShim as unknown as typeof ShadowRoot;
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
  globalThis.Document = (class Document {}) as unknown as typeof Document;
  Object.defineProperty(globalThis.Document.prototype, 'adoptedStyleSheets', { value: [], writable: true });
  globalThis.DocumentFragment = FragmentShim as unknown as typeof DocumentFragment;
  /** `new Image()` is a spelling of `createElement('img')`, and `Audio` of `createElement('audio')`. */
  globalThis.Image = (class Image extends ElementShim {
    constructor() {
      super('img');
    }
  }) as unknown as typeof Image;
  globalThis.Audio = (class Audio extends ElementShim {
    constructor() {
      super('audio');
    }
  }) as unknown as typeof Audio;

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
    (globalThis as unknown as GlobalScope)[name] = class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };

  /**
   * A media query with no viewport to match matches nothing, which is what every server renderer
   * answers and what hydration then corrects. Absent, it was a `TypeError` in `connectedCallback`.
   */
  globalThis.matchMedia = (
    (media: string) => ({
      media,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
    })
  ) as unknown as typeof matchMedia;

  /** No layout means no computed value; a browser gives a detached element nothing useful either. */
  globalThis.getComputedStyle = (
    () => ({
      getPropertyValue: () => '',
      getPropertyPriority: () => '',
      length: 0,
      item: () => '',
    })
  ) as unknown as typeof getComputedStyle;
  globalThis.getSelection = () => null;

  /**
   * Idle time joins the frame queue rather than inventing a second one — the render is over when
   * `flushFrames` runs out, and work deferred to "when the browser is free" has to land before
   * then or it lands nowhere.
   */
  globalThis.requestIdleCallback = (
    (fn: IdleRequestCallback) => requestFrame(() => fn({ didTimeout: false, timeRemaining: () => 0 }), true)
  ) as typeof requestIdleCallback;
  globalThis.cancelIdleCallback = ((id: number) => cancelFrame(id, true)) as typeof cancelIdleCallback;
  /** Defined so core's `@scope` support check passes — SSR output gets scoped light-DOM CSS. */
  globalThis.CSSScopeRule = (function CSSScopeRule() {}) as unknown as typeof CSSScopeRule;

  globalThis.customElements = ({
    /**
     * Refused on a second definition, exactly as the platform does. The registry used to overwrite
     * silently, so a module defining a tag twice rendered fine on the server and threw
     * `NotSupportedError` in the browser — the server being lenient about an error is the server
     * hiding it.
     */
    define: (name: unknown, Class: CustomElementConstructor) => {
      /**
       * **A name the browser will refuse is refused here too**, or the server renders markup the
       * client can never upgrade: `customElements.define('nodash', …)` throws `SyntaxError` in every
       * engine, and this accepted it — so the component rendered server-side, shipped, and the
       * client threw on the very line that was supposed to bring it to life.
       *
       * The rule is the spec's: starts with a lowercase ASCII letter, contains a hyphen, contains no
       * uppercase, and is not one of the eight names SVG and MathML already use.
       */
      if (!validName(name))
        throw new DOMException(
          `Failed to execute 'define' on 'CustomElementRegistry': "${String(name)}" is not a valid custom element name`,
          'SyntaxError'
        );
      /**
       * Refused as the platform refuses: a value that is not a constructor (`TypeError`), and a class already defined
       * under another name (`NotSupportedError` — one class, one definition). Both were accepted here.
       */
      if (typeof Class !== 'function' || !Class.prototype)
        throw new TypeError(`Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not a constructor.`);
      for (const defined of registry.values())
        if (defined === Class)
          throw new DOMException(
            `Failed to execute 'define' on 'CustomElementRegistry': this constructor has already been used with this registry`,
            'NotSupportedError'
          );
      if (registry.has(name)) {
        throw new DOMException(
          `Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`,
          'NotSupportedError'
        );
      }
      registry.set(name, Class);
      const waiting = pendingDefinitions.get(name);
      if (waiting !== undefined) {
        pendingDefinitions.delete(name);
        waiting.resolve(Class);
      }
    },
    get: (name: string) => registry.get(name),
    /**
     * **The platform's promise**: resolved WITH the constructor, at once for a defined name, at its `define` for a
     * later one — one promise per name until then — and rejected with `SyntaxError` for a name `define` would refuse.
     * It resolved immediately with `undefined` for any name, so code awaiting a definition ran before it existed and
     * got no class, and a client-only component's wait, which never settles in a browser, settled on the server.
     */
    whenDefined: (name: unknown) => {
      if (!validName(name))
        return Promise.reject(
          new DOMException(
            `Failed to execute 'whenDefined' on 'CustomElementRegistry': "${String(name)}" is not a valid custom element name`,
            'SyntaxError'
          )
        );
      const defined = registry.get(name);
      if (defined !== undefined) return Promise.resolve(defined);
      let waiting = pendingDefinitions.get(name);
      if (waiting === undefined) {
        let resolve!: (Class: CustomElementConstructor) => void;
        const promise = new Promise<CustomElementConstructor>((done) => (resolve = done));
        pendingDefinitions.set(name, (waiting = { promise, resolve }));
      }
      return waiting.promise;
    },
  }) as unknown as CustomElementRegistry;

  /**
   * The document, with the surface a component reaches for.
   *
   * `body`, `documentElement` and `title` are real enough to be written to — a component setting
   * `document.title` or appending to `document.body` is ordinary code, and losing the assignment
   * silently is the failure mode this package keeps producing. Queries answer emptily for the same
   * reason the containers do: this holds strings, not a tree.
   */
  globalThis.document = ({
    title: '',
    body: new ElementShim('body'),
    documentElement: new ElementShim('html'),
    /**
     * **`body` is what a browser reports when nothing has focus**, and it never answers `null` for a
     * document that exists. `null` here meant `document.activeElement.tagName` — ordinary code —
     * threw on the server and worked in the browser.
     */
    get activeElement() {
      return globalThis.document.body;
    },
    /**
     * This document *has* a `documentElement`, so saying it has no children contradicted itself —
     * the same shape as `document.contains` answering `false` while every element reported
     * `isConnected`. One element, first and last, exactly as a real document reports.
     */
    get firstElementChild() {
      return globalThis.document.documentElement;
    },
    get lastElementChild() {
      return globalThis.document.documentElement;
    },
    get childElementCount() {
      return 1;
    },
    createElement: (localName: string) => createElement(localName),
    createElementNS: (namespace: string, localName: string) => createElement(localName, namespace),
    createTextNode: (text: string) => new TextShim(text),
    createDocumentFragment: () => new FragmentShim(),
    /**
     * **The document's queries search the document.** Each answered nothing whatever it was asked,
     * because there was no tree to search; `document.getElementById('x')` was `null` for an element
     * that had been appended to `body` moments earlier.
     *
     * `documentElement` and `body` are separate roots here rather than one nested pair, so each
     * query covers both — the order is `documentElement` first, which is where a real document would
     * have found anything under `<html>` before reaching `<body>`.
     */
    querySelector: (selector: string) => {
      for (const root of documentRoots()) {
        const found = root.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll: (selector: string) => documentRoots().flatMap((root) => root.querySelectorAll(selector)),
    getElementById: (id: string) => {
      for (const root of documentRoots()) {
        const found = root.getElementById(id);
        if (found) return found;
      }
      return null;
    },
    ...NODE_CONSTANTS,
    getElementsByTagName: (name: string) => documentRoots().flatMap((root) => root.getElementsByTagName(name)),
    getElementsByTagNameNS: (namespace: string | null, name: string) =>
      documentRoots().flatMap((root) => root.getElementsByTagNameNS(namespace, name)),
    getElementsByClassName: (names: string) => documentRoots().flatMap((root) => root.getElementsByClassName(names)),
    /**
     * The elements whose `name` attribute IS `name`, compared directly. It was a selector built from the name with only
     * `"` escaped, so a `\\` was read as a CSS escape (`a\\b` matched nothing, or the wrong elements).
     */
    getElementsByName: (name: string) => {
      const wanted = `${name}`;
      return documentRoots()
        .flatMap((root) => [root, ...root.querySelectorAll('[name]')])
        .filter((element) => element.getAttribute('name') === wanted);
    },
    /**
     * **`complete`, because nothing more is coming.** `loading` is the truthful description of a
     * document still being assembled, and it is the wrong answer to give a component: the guard
     * everyone writes is `if (readyState === 'loading') addEventListener('DOMContentLoaded', boot)`,
     * and this DOM never fires that event — so `loading` meant the callback was registered and never
     * ran, and the component silently rendered nothing. `@verajs/jsx/standalone` is written exactly
     * that way. `complete` sends the same code down the branch that runs `boot()` now, which is what
     * the browser ends up doing too.
     */
    readyState: 'complete',
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
    currentScript: null,
    /**
     * **`documentElement`, because this document declares standards mode.** `null` is the answer a
     * *quirks-mode* document gives, so returning it beside `compatMode: 'CSS1Compat'` two lines up
     * was a document contradicting itself — and a component reading
     * `document.scrollingElement.scrollTop`, which every engine allows, crashed on the server with
     * a `TypeError` and worked in the browser. Measured on Chromium, Firefox and WebKit: all three
     * answer `documentElement`.
     */
    get scrollingElement() {
      return globalThis.document.documentElement;
    },
    fullscreenElement: null,
    pointerLockElement: null,
    pictureInPictureElement: null,
    /**
     * The output is an HTML document, so it has a doctype. A browser reports these three fields and
     * an empty public and system id, which is exactly what `<!doctype html>` means.
     */
    doctype: { name: 'html', publicId: '', systemId: '' },
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
    createComment: (text: string) => new CommentShim(text),
    getSelection: () => null,
    /**
     * An empty walk over an empty tree, which is the truthful answer for a DOM that holds strings.
     *
     * `@verajs/renderer` builds two shared `TreeWalker`s **at import time**, so importing it threw
     * here — and a component doing nothing unusual imports it: `keyed` and `hold` are exported from
     * that entry, and a keyed list is the renderer's headline feature. Any component using either
     * could not be server-rendered at all. Nothing walks this DOM (`@verajs/ssr` has its own
     * renderer and never uses these), so an inert walker is the whole requirement.
     */
    /**
     * **The walkers walk.** Both existed and answered `null` to everything, whatever the tree held —
     * a stub that reported "no more nodes" from the first call, so a component walking its own
     * subtree found it empty and did nothing, on the server only. There is a tree to walk now.
     */
    createTreeWalker: (root: WalkNode, whatToShow?: number, filter?: WalkFilter) => makeTreeWalker(root, whatToShow, filter),
    createNodeIterator: (root: WalkNode, whatToShow?: number, filter?: WalkFilter) => makeIterator(root, whatToShow, filter),
    elementFromPoint: () => null,
    elementsFromPoint: () => [],
    /**
     * Everything this DOM builds is in the document — the shim sets `isConnected` on every element
     * for the same reason, since a server render is exactly the case where the tree *is* live. A
     * flat `false` contradicted that, and `if (!document.contains(el)) return;` is ordinary
     * defensive code that bailed out of a render that was in fact perfectly connected.
     */
    contains: (node: { readonly isConnected?: boolean } | null | undefined) => node?.isConnected === true,
    /**
     * `importNode` CLONES — the spec's "import" is a copy into this document, never the node
     * itself. The identity it used to return was a lie with teeth: a caller mutates the "copy"
     * and corrupts the original (for the renderer's Instance, the template's canonical content —
     * every later render of that template starts from the corrupted tree). Element, text and
     * comment shims clone for real; a kind without `cloneNode` (a fragment) refuses loudly, which
     * is this DOM's posture — decline what cannot be reproduced, never hand back an alias.
     * `adoptNode` stays the identity: adopting MOVES a node and nothing here owns another
     * document, so the node itself is the correct answer there.
     */
    importNode: (node: TextShim | CommentShim | ElementShim, deep?: boolean) => node.cloneNode(deep === true),
    adoptNode: <T>(node: T) => node,
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
    /** Light-DOM styles hoist here — `adoptStyles`' constructed-sheet path. See `documentAdoptedSheets`. */
    get adoptedStyleSheets() {
      return documentAdoptedSheets;
    },
    set adoptedStyleSheets(sheets: unknown) {
      setDocumentAdoptedSheets(sheets);
    },
    head: {
      /**
       * A `<style>` appended to the head is the page's CSS, hoisted into the render's styles. Nothing else is: this
       * hoisted ANY node's `innerHTML`, so an appended `<script>` shipped its source inside the stylesheet.
       */
      appendChild: <T extends { readonly localName?: string; readonly innerHTML?: string } | null | undefined>(node: T) => {
        if (node?.localName === 'style' && node.innerHTML) hoist(node.innerHTML);
        return node;
      },
    },
  }) as unknown as Document;
  /** Given `Document.prototype` here, where the document it describes finally exists. */
  Object.setPrototypeOf(globalThis.document, globalThis.Document.prototype);

  /**
   * Enough `window` for `@verajs/router` to initialize.
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
   * `history` is inert: a server has no session history to push onto. A **per-request** URL belongs
   * in `renderToString`'s `location` option, which applies it after every await and restores it
   * afterwards; assigning to this global directly is safe only until two requests overlap.
   */
  globalThis.window = globalThis as typeof window;
  /**
   * `self` is the other name for the global, and UMD bundles feature-detect on it. `window` is
   * already defined here, so those bundles have taken the browser branch regardless — leaving `self`
   * undefined only made the two disagree.
   *
   * **`??=`, because a Web Worker already has one and it is read-only.** Assigning threw
   * `Cannot set property self of #<WorkerGlobalScope> which has only a getter`, which is where this
   * shim stopped when it was first run off the main thread. Nothing is lost by skipping it there:
   * in a worker `self` already *is* the global, which is exactly what this line wanted. Node
   * defines no `self` on the main thread or inside `worker_threads`, so the server still assigns.
   */
  globalThis.self ??= globalThis as typeof self;
  /**
   * Every part, built from a real `URL`, so the default is as complete as the one `renderToString`'s
   * `location` option installs. It used to carry four properties — `pathname`, `search`, `hash`,
   * `href` — so `location.origin`, `.protocol`, `.host` and `.hostname` read `undefined` until a
   * render supplied a URL, and then started working. Two different shapes for the same object
   * depending on when you looked at it.
   */
  /**
   * **Installed as an own, writable property rather than assigned, because `applyLocation` mutates
   * it and not every environment's `location` can be mutated.** `renderToString`'s `location` option
   * writes each part in place, which a plain object takes and a Web Worker's real `WorkerLocation`
   * refuses — every property is a getter, so a per-request URL threw
   * `Cannot set property href of [object WorkerLocation]`. `??=` could not see that: a worker *has*
   * a location, so it short-circuited and left the read-only one in place. Rendering one route per
   * URL is the whole point of the option, so this is the difference between the option working and
   * not.
   *
   * Seeded from whatever the environment describes, so a worker keeps its real URL as the default
   * instead of being told it is localhost. Node has no `location` at all, on the main thread or in
   * `worker_threads`, so the server gets the identical localhost object it got before — a writable,
   * configurable own property is what a plain assignment already produced.
   */
  Object.defineProperty(globalThis, 'location', {
    value: (
      (() => {
        const url = new URL(globalThis.location?.href ?? 'http://localhost/');
        return Object.fromEntries(LOCATION_PARTS.map((part) => [part, url[part]]));
      })()
    ) as unknown as Location,
    writable: true,
    configurable: true,
  });
  globalThis.history = ({
    scrollRestoration: 'auto',
    pushState: () => {},
    replaceState: () => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  }) as unknown as History;
  Object.assign(globalThis, delegateEvents(windowEvents, () => globalThis.window));
  /**
   * **A server render is a top-level, unframed, open window — and saying nothing says otherwise.**
   *
   * This is the one place where *absence* gives the wrong answer rather than no answer.
   * `window.top === window` is how a page asks "am I in an iframe"; with `top` undefined that
   * comparison is **false**, so a component concludes it *is* framed and takes the branch meant for
   * a page it does not control. Every value here is what a browser reports for a page that is not
   * framed, which is exactly the situation a server render is in.
   */
  globalThis.top = globalThis as unknown as Window;
  globalThis.parent = globalThis as unknown as Window;
  globalThis.frames = globalThis as unknown as Window;
  globalThis.frameElement = null;
  globalThis.opener = null;
  globalThis.length = 0;
  globalThis.closed = false;
  /** `name` is `Window`'s, not `globalThis`'s, so TypeScript needs telling which one this is. */
  (globalThis as unknown as Window).name ??= '';

  /**
   * Derived from `location` rather than stored, so the two cannot disagree — `renderToString`'s
   * `location` option rewrites the URL per request, and a copied-at-install `origin` would answer
   * for whichever request installed the shim.
   */
  Object.defineProperty(globalThis, 'origin', {
    get: () => globalThis.location?.origin ?? '',
    configurable: true,
  });

  /**
   * **Inert, because a server has no user and no window to move** — the same reason the observers
   * are inert and `scrollTo` already was. A browser does not throw for any of these, so neither can
   * this: a component that calls one during setup would work in the browser and crash here, which
   * is the divergence this package exists to remove.
   *
   * The ones with a return value get the answer a browser gives when the thing did not happen —
   * `confirm` when the user declines, `prompt` when they cancel, `open` when the browser refuses,
   * `find` when there is no match. None of those is invented; each is a real outcome of the call.
   */
  for (const name of [
    'alert', 'print', 'blur', 'focus', 'close', 'stop', 'scroll', 'scrollBy', 'scrollTo',
    'moveBy', 'moveTo', 'resizeBy', 'resizeTo', 'captureEvents', 'releaseEvents',
  ])
    (globalThis as unknown as GlobalScope)[name] = () => {};
  /**
   * **`postMessage` is `??=` and the rest are not, because in a Web Worker it is the only channel
   * back to the page.** Replacing it with a no-op does not throw and does not stop the render — it
   * silently severs the host's reporting, so a worker that rendered perfectly looks exactly like one
   * that crashed. That cost two debugging rounds the first time this shim ran off the main thread.
   *
   * **`close` deliberately stays unconditional**, which is the same reasoning arriving at the
   * opposite answer: in a worker `close()` *terminates* it, so a component calling `window.close()`
   * during setup would kill the render. A no-op is both what a browser does for a page it did not
   * open and what protects the render; a host still terminates its worker from the outside.
   *
   * Node defines neither name — on the main thread or inside `worker_threads` — so the server
   * assigns both exactly as before.
   */
  globalThis.postMessage ??= (() => {}) as typeof postMessage;
  globalThis.confirm = () => false;
  globalThis.prompt = () => null;
  (globalThis as unknown as GlobalScope).find = () => false;
  globalThis.open = () => null;

  /**
   * `reportError` hands an error to the page's error handling. A no-op would **swallow** it, which
   * is the one outcome worse than not having the function — so it goes where every other unhandled
   * failure in this package goes.
   */
  globalThis.reportError ??= (error: unknown) => console.error(error);

  /**
   * The `NodeFilter` constants, because `createTreeWalker` is provided and these are what it takes.
   * `@verajs/renderer` passes the numbers directly, so nothing here needs them — but a component
   * writing `NodeFilter.SHOW_ELEMENT` is writing ordinary DOM code, and these are facts rather than
   * answers this DOM has to invent.
   */
  globalThis.NodeFilter = (
    Object.assign(function NodeFilter() {
      throw new TypeError('Illegal constructor');
    }, {
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
      FILTER_SKIP: 3,
      SHOW_ALL: 0xffffffff,
      SHOW_ELEMENT: 1,
      SHOW_ATTRIBUTE: 2,
      SHOW_TEXT: 4,
      SHOW_CDATA_SECTION: 8,
      SHOW_ENTITY_REFERENCE: 16,
      SHOW_ENTITY: 32,
      SHOW_PROCESSING_INSTRUCTION: 64,
      SHOW_COMMENT: 128,
      SHOW_DOCUMENT: 256,
      SHOW_DOCUMENT_TYPE: 512,
      SHOW_DOCUMENT_FRAGMENT: 1024,
      SHOW_NOTATION: 2048,
    })
  ) as unknown as typeof NodeFilter;
  Object.freeze(globalThis.NodeFilter);
  /**
   * Node supplies `Event` and `CustomEvent`; this fills in only where it does not, and matches the
   * shape `EventTarget` dispatches.
   */
  globalThis.CustomEvent ??= (
    class CustomEvent extends Event {
      declare detail: unknown;
      constructor(type: string, init: CustomEventInit<unknown> = {}) {
        super(type, init);
        this.detail = init.detail ?? null;
      }
    }
  ) as unknown as typeof CustomEvent;
  /**
   * **The phase constants belong on the prototype, not only on the interface.** Node puts
   * `CAPTURING_PHASE` and friends on `Event` alone; all three engines put them on `Event.prototype`
   * too, so `event.AT_TARGET` reads `2` in a browser and `undefined` here. That matters because
   * `event.eventPhase === event.AT_TARGET` is how the comparison is normally written, and against
   * `undefined` it is `false` for every phase — the test silently never matches instead of failing.
   */
  for (const [name, value] of [['NONE', 0], ['CAPTURING_PHASE', 1], ['AT_TARGET', 2], ['BUBBLING_PHASE', 3]])
    if (!(name in Event.prototype))
      Object.defineProperty(Event.prototype, name, { value, enumerable: false, configurable: true });


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
  /** A browser raises `TypeError` for a non-callable, and a silent no-op here is a frame that never runs. */
  globalThis.requestAnimationFrame = (fn) => {
    if (typeof fn !== 'function')
      throw new TypeError(
        `Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'.`
      );
    return requestFrame(fn, false);
  };
  globalThis.cancelAnimationFrame = (id) => cancelFrame(id, false);
  return registry;
};
