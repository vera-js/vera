/**
 * Installs the server environment: the globals a component finds when it runs outside a browser.
 *
 * Import this **before anything that imports `@verajs/core`** — core evaluates against these, and
 * `@verajs/ssr/vera` does it for you. What each global is, and why it answers the way it does, lives
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
import { hoistedStyles, setRenderingTag, StyleSheetShim, hoist, beginHoisting } from './stylesheets.js';
import { frames, flushFrames } from './frames.js';
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
      /**
       * **A name the browser will refuse is refused here too**, or the server renders markup the
       * client can never upgrade: `customElements.define('nodash', …)` throws `SyntaxError` in every
       * engine, and this accepted it — so the component rendered server-side, shipped, and the
       * client threw on the very line that was supposed to bring it to life.
       *
       * The rule is the spec's: starts with a lowercase ASCII letter, contains a hyphen, contains no
       * uppercase, and is not one of the eight names SVG and MathML already use.
       */
      if (typeof name !== 'string' || !/^[a-z][^A-Z]*-[^A-Z]*$/.test(name) || RESERVED_NAMES.has(name))
        throw new DOMException(
          `Failed to execute 'define' on 'CustomElementRegistry': "${String(name)}" is not a valid custom element name`,
          'SyntaxError'
        );
      if (registry.has(name)) {
        throw new DOMException(
          `Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`,
          'NotSupportedError'
        );
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
    createElement: (localName) => createElement(localName),
    createElementNS: (namespace, localName) => createElement(localName, namespace),
    createTextNode: (text) => new TextShim(text),
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
    createComment: (text) => new CommentShim(text),
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
    createTreeWalker: () => ({
      currentNode: null,
      root: null,
      nextNode: () => null,
      previousNode: () => null,
      parentNode: () => null,
      firstChild: () => null,
      lastChild: () => null,
      nextSibling: () => null,
      previousSibling: () => null,
    }),
    createNodeIterator: () => ({ nextNode: () => null, previousNode: () => null }),
    elementFromPoint: () => null,
    elementsFromPoint: () => [],
    /**
     * Everything this DOM builds is in the document — the shim sets `isConnected` on every element
     * for the same reason, since a server render is exactly the case where the tree *is* live. A
     * flat `false` contradicted that, and `if (!document.contains(el)) return;` is ordinary
     * defensive code that bailed out of a render that was in fact perfectly connected.
     */
    contains: (node) => node?.isConnected === true,
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
   * `history` is inert: a server has no session history to push onto. A **per-request** URL belongs
   * in `renderToString`'s `location` option, which applies it after every await and restores it
   * afterwards; assigning to this global directly is safe only until two requests overlap.
   */
  globalThis.window = /** @type {any} */ (globalThis);
  /**
   * `self` is the other name for the global, and UMD bundles feature-detect on it. `window` is
   * already defined here, so those bundles have taken the browser branch regardless — leaving `self`
   * undefined only made the two disagree.
   */
  globalThis.self = /** @type {any} */ (globalThis);
  /**
   * Every part, built from a real `URL`, so the default is as complete as the one `renderToString`'s
   * `location` option installs. It used to carry four properties — `pathname`, `search`, `hash`,
   * `href` — so `location.origin`, `.protocol`, `.host` and `.hostname` read `undefined` until a
   * render supplied a URL, and then started working. Two different shapes for the same object
   * depending on when you looked at it.
   */
  globalThis.location ??= /** @type {any} */ (
    (() => {
      const url = new URL('http://localhost/');
      return Object.fromEntries(
        ['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin'].map((part) => [
          part,
          url[part],
        ])
      );
    })()
  );
  globalThis.history = /** @type {any} */ ({
    scrollRestoration: 'auto',
    pushState: () => {},
    replaceState: () => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  });
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
  globalThis.top = /** @type {any} */ (globalThis);
  globalThis.parent = /** @type {any} */ (globalThis);
  globalThis.frames = /** @type {any} */ (globalThis);
  globalThis.frameElement = null;
  globalThis.opener = null;
  globalThis.length = 0;
  globalThis.closed = false;
  /** `name` is `Window`'s, not `globalThis`'s, so TypeScript needs telling which one this is. */
  /** @type {any} */ (globalThis).name ??= '';

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
    'moveBy', 'moveTo', 'resizeBy', 'resizeTo', 'postMessage', 'captureEvents', 'releaseEvents',
  ])
    globalThis[name] = () => {};
  globalThis.confirm = () => false;
  globalThis.prompt = () => null;
  globalThis.find = () => false;
  globalThis.open = () => null;

  /**
   * `reportError` hands an error to the page's error handling. A no-op would **swallow** it, which
   * is the one outcome worse than not having the function — so it goes where every other unhandled
   * failure in this package goes.
   */
  globalThis.reportError ??= (error) => console.error(error);

  /**
   * The `NodeFilter` constants, because `createTreeWalker` is provided and these are what it takes.
   * `@verajs/renderer` passes the numbers directly, so nothing here needs them — but a component
   * writing `NodeFilter.SHOW_ELEMENT` is writing ordinary DOM code, and these are facts rather than
   * answers this DOM has to invent.
   */
  globalThis.NodeFilter = /** @type {any} */ (
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
  );
  Object.freeze(globalThis.NodeFilter);
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
  /** A browser raises `TypeError` for a non-callable, and a silent no-op here is a frame that never runs. */
  globalThis.requestAnimationFrame = (fn) => {
    if (typeof fn !== 'function')
      throw new TypeError(
        `Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'.`
      );
    return frames.push(fn);
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames[id - 1] = null;
  };
  return registry;
};
