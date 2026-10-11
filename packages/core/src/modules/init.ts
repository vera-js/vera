import { diagnostic, misuse, SHARED } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { InitInsert } from '@verajs/inserts';
import { currentInstance } from '../store/store.js';
import { adoptProps } from './adoptProps.js';
import { untracked } from './untrack.js';
import { firstPasses } from './mount.js';
import { useRender } from '../hooks/useRender.js';
import { runCleanup } from '../hooks/coalesce.js';
import { reportHookError, retire } from './createHook.js';
import type { ComponentElement, InitOptions, Setup } from '../types.js';

/**
 * Opens a component's setup: hooks registered from here attach to `element`, until the `render()`
 * that commits it. Attaches a shadow root when `shadowProps` asks for one; without them the
 * component renders into its light DOM.
 *
 * The returned root is **kept** on `_$r$`, because `element.shadowRoot` is null for a closed one.
 *
 * @param element The element to init
 * @param shadowProps Any desired shadowProps. Passing in null will create a light DOM instance
 */
/**
 * **Setup ends at the end of the microtask turn `init()` ran in** — ONE shared microtask per turn, armed only when not
 * already armed. A hook created after the first `await` in setup then always finds no component (and throws, naming
 * the fix), whatever connected in between; before, it attached to whichever component was set up last, or was dropped.
 */
let ending = false;

/**
 * Development: markup addressed to a module nobody wired (`data-vd-*` with no directives engine) is said once (main had
 * this; the lean rebuild dropped the reading half — `@verajs/directives` still claims `data-vd-` from both its doors).
 * `Symbol.for` because the two packages share no runtime; the `Symbol.for` sits INSIDE the function so production —
 * where every caller folds away — drops it whole (a top-level one survives: a call with effects terser cannot prove).
 */
let warnedAboutClaims = false;
/** Development: `static styles` with nothing adopting them — said once per page. */
let warnedAboutStyles = false;
const claimed = (prefix: string): boolean =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.claims')] as Set<string> | undefined)?.has(prefix) === true;
/**
 * Development, a microtask after `init()`: a setup that registered hooks and was never committed — neither `render()`
 * nor `mount()` — runs none of them, silently (main had this; it read the current instance, which the setup-end
 * microtask now clears, so `commit` marks the generation instead). Then the unclaimed-markup check.
 */
const afterSetup = (element: ComponentElement) => {
  const hooks = element._$h$?.reduce((n, set) => n + set.size, 0) ?? 0;
  if (hooks && (element as { _$k$?: number })._$k$ !== element._$g$)
    console.warn(diagnostic('core', `<${element.localName}>`, 'setup-uncommitted', __DEV__ && PROSE['setup-uncommitted'](String(hooks))));
  unclaimedMarkup(element);
};
const unclaimedMarkup = (element: ComponentElement) => {
  if (warnedAboutClaims || claimed('data-vd-')) return;
  const root = element.shadowRoot ?? element._$r$ ?? element;
  for (const node of (root as ParentNode).querySelectorAll('*')) {
    const hit = [...node.attributes].find((a) => a.name.startsWith('data-vd-'));
    if (!hit) continue;
    warnedAboutClaims = true;
    console.warn(diagnostic('core', `<${element.localName}>`, 'unwired-directives', __DEV__ && PROSE['unwired-directives'](hit.name)));
    return;
  }
};
const endSetup = () => {
  ending = false;
  currentInstance.element = null;
};

/** The two shadow roots by name, built once — `init` attaches from these, so no options object is made per connect. */
const OPEN: ShadowRootInit = { mode: 'open' };
const CLOSED: ShadowRootInit = { mode: 'closed' };
/** Development: what was said once per component class — a static setup return, a near-miss `setup` spelling. */
const saidStatic = new WeakSet<object>();
const saidNearMiss = new WeakSet<object>();
/** Development: an invalid app default is said once per page (a component's own invalid option, at each connect). */
let warnedAboutDefault = false;
/** What `shadow` may be: `false`, `'open'`, `'closed'`, or a `ShadowRootInit` naming one of the two modes. */
const validShadow = (value: unknown) =>
  value === false || value === 'open' || value === 'closed' || (value as ShadowRootInit | null)?.mode === 'open' || (value as ShadowRootInit | null)?.mode === 'closed';
/** Development: how a `shadow` value is shown in shadow-option, and whether it is the platform's to refuse (it names a mode). */
const shown = (value: unknown) => {
  const mode = (value as ShadowRootInit | null)?.mode;
  return mode ? `{ mode: '${mode}' }` : typeof value === 'string' ? `'${value}'` : String(value);
};
const platformRefuses = (value: unknown) => ((value as ShadowRootInit | null)?.mode ? 'platform' : '');
/** Shape B's call: the class's own `setup()` method, with the element as both `this` and `host`. */
const callMethod = (element: ComponentElement) => (element as unknown as { setup: Setup }).setup(element);

/**
 * **Starts a component**: `init(host, setup?)` or `init({ host, …options }, setup?)` — the element, or an object carrying
 * it and its options, and the SETUP always second. The setup runs ONCE, untracked, inside this call — the window is the
 * call, so it ends exactly when the setup returns or throws, and nesting is the JavaScript stack — and returns its RENDER
 * function. With no setup, `init` calls the class's `setup()` method (Shape B). A setup returning nothing is a
 * side-effect setup; a promise, an async one (its synchronous part is the window).
 *
 * Until R2 migrates every call site, `init(element)` with neither a setup nor a `setup()` method, and the old
 * `init(element, shadowProps)`, keep the earlier window — closed by `render()`/`mount()` or the microtask below.
 */
export const init = (target: ComponentElement | InitOptions, setup?: Setup | ShadowRootInit) =>
  (target as Partial<Node> | null)?.nodeType === 1
    ? initWith(target as ComponentElement, undefined, setup)
    : initWith((target as InitOptions | null)?.host as ComponentElement, target as InitOptions, setup);

/**
 * The one entry `init` and (R3) `define` share: the host and its options SEPARATELY, so `define`'s generated class can
 * hand over one options object per tag and allocate nothing per connect.
 */
export const initWith = (element: ComponentElement, options: InitOptions | undefined, given: Setup | ShadowRootInit | undefined) => {
  if (__DEV__ && (element as Partial<Node> | null)?.nodeType !== 1)
    throw new TypeError(misuse('init', 'init-not-element', __DEV__ && PROSE['init-not-element'](String(element))));
  mine.add(element);
  /**
   * The component's own `shadow` (an explicit `false` included), else the app default `renderer({ shadow })` set on the
   * registry (`$S`), else light DOM.
   */
  const own = options?.shadow;
  const shadow = own !== undefined ? own : (inserts as unknown as { $S?: InitOptions['shadow'] }).$S;
  if (__DEV__ && own === undefined && shadow !== undefined && !warnedAboutDefault && !validShadow(shadow)) {
    warnedAboutDefault = true;
    console.warn(diagnostic('core', 'renderer({ shadow })', 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(shadow), platformRefuses(shadow))));
  }
  if (__DEV__ && options) {
    for (const key in options)
      if (key !== 'host' && key !== 'shadow')
        console.warn(diagnostic('core', 'init()', 'unknown-option', __DEV__ && SHARED.unknownOption(key, 'host, shadow')));
    if (own !== undefined && !validShadow(own))
      console.warn(diagnostic('core', `<${element.localName}>`, 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(own), platformRefuses(own))));
  }
  /**
   * An object naming a mode goes to the platform AS IS — an unknown mode is refused by `attachShadow` itself, in both
   * builds (development says why first). Anything else that is not a root renders into the light DOM.
   */
  const root = shadow === 'open' ? OPEN : shadow === 'closed' ? CLOSED : (shadow as ShadowRootInit | undefined)?.mode ? (shadow as ShadowRootInit) : undefined;
  const setup = typeof given === 'function' ? given : typeof (element as { setup?: unknown }).setup === 'function' ? callMethod : undefined;
  /** The earlier `init(element, shadowProps)` is explicit, so it wins over the app default. */
  if (setup === undefined) return legacy(element, (typeof given === 'object' && given) || root);
  start(element, root);
  /** The window: this component is the owner while its setup runs — untracked, restored in `finally`, on a throw too. */
  const previous = currentInstance.element;
  currentInstance.element = element;
  let out: unknown;
  /**
   * A setup that throws is rethrown (it is the author's own call) and commits nothing, so the hooks it registered never
   * run — no discard needed: nothing reaches them, and the next connect's `start` resets them (a discard here was
   * mutation-proven unobservable, 2026-10-10).
   */
  try {
    out = untracked(setup as (e: ComponentElement) => unknown, element);
  } finally {
    currentInstance.element = previous;
  }
  settle(element, out, element._$g$!);
};

/**
 * What every connect does before its setup: a fresh generation, the root (attached from `root` when it has none), the
 * delivered props adopted, and the `'init'` inserts — shared by the setup path and the earlier window.
 */
const start = (element: ComponentElement, root: ShadowRootInit | undefined) => {
  /**
   * A new generation: the previous connection's hooks go inert — see `createHook` — and leave the store. (Skipping this on
   * a first setup and writing `_$u$` up front, to spare two missing-field reads, cost Firefox's collector 35% on
   * create + remove over a long run — raced 2026-10-10. Leave it as it is.)
   */
  retire(element);
  element._$g$ = (element._$g$ ?? 0) + 1;
  element._$h$ = [];
  element._$p$ = [];
  /** A fresh connection: cleanups registered from here are owed a later removal again. */
  element._$c$ = new Set();
  element._$x$ = false;
  /** The document it was set up in: a move into another one is a teardown and a fresh setup (see the wrapper below). */
  (element as Moving)._$d$ = element.ownerDocument;
  if (root && !element.shadowRoot && !element._$r$) element._$r$ = element.attachShadow(root);
  adoptProps(element);
  /**
   * The `'init'` insert: every element as it comes to life, after its root exists and before its first
   * render — how `@verajs/styles` adopts `static styles`, and the place for instrumentation or
   * per-element registration. Core knows nothing about what is registered; with nothing, it is one
   * `Map.get` per element.
   */
  inserts.get('init')?.forEach((callback) => (callback as InitInsert)(element));
  /**
   * Development: a component declaring `static styles` with nothing adopting them renders unstyled, silently — style
   * adoption left core, so the styles README promises this is said, once (main had it; the lean rebuild dropped it).
   * Asked of `@verajs/styles` itself (its development `$module` mark), not "any init module": a page wiring directives
   * but not styles was silenced by main's coarser check.
   */
  if (
    __DEV__ &&
    !warnedAboutStyles &&
    (element.constructor as { styles?: unknown }).styles !== undefined &&
    !inserts.get('init')?.some((fn) => (fn as { $module?: string }).$module === 'styles')
  ) {
    warnedAboutStyles = true;
    console.warn(diagnostic('core', `<${element.localName}>`, 'unwired-styles', __DEV__ && PROSE['unwired-styles']()));
  }
};

/**
 * What a setup returned: its render (installed, then every first pass runs), nothing (a side-effect setup — its effects
 * still run), a promise (settled later, if the element is still this generation and connected), or anything else —
 * rendered once, statically, in both builds, with development saying why it will never update.
 */
const settle = (element: ComponentElement, out: unknown, generation: number) => {
  if (typeof (out as PromiseLike<unknown> | null)?.then === 'function') {
    /**
     * Kept for the `customElements.define` wrapper below, which hands it to whoever awaits the connect — a server. It is
     * the HANDLED chain, so it never rejects: a setup that rejects commits nothing (like one that throws) and is reported
     * once through the `'error'` chain — which is how a server hears of it — never as an unhandled rejection.
     */
    (element as Moving)._$s$ = (out as PromiseLike<unknown>).then(
      (value) => {
        if (element._$g$ === generation && element.isConnected) settle(element, value, generation);
      },
      (error) =>
        reportHookError(error, element, __DEV__ ? diagnostic('core', `<${element.localName}>`, 'setup-rejected', __DEV__ && PROSE['setup-rejected']()) : '[vera] setup-rejected')
    );
    return;
  }
  /**
   * ONE save and restore around both steps, on a throw too: the render is installed as THIS component's (`useRender`'s
   * owner is the component being set up), then the first passes run with NO owner — a hook created inside a render
   * belongs to no one — and the outer owner is back.
   */
  const previous = currentInstance.element;
  try {
    currentInstance.element = element;
    if (out != null) {
      useRender(out, element);
      if (__DEV__ && typeof out !== 'function' && !saidStatic.has(element.constructor)) {
        saidStatic.add(element.constructor);
        const kind = Array.isArray(out) ? 'an array' : typeof out === 'object' ? 'a template or object' : `a ${typeof out}`;
        console.error(diagnostic('core', `<${element.localName}>`, 'setup-returned-value', __DEV__ && PROSE['setup-returned-value'](kind)));
      }
    }
    currentInstance.element = null;
    firstPasses(element);
    /** Development: the first pass has committed, so there is a subtree to check for markup no module claimed. */
    if (__DEV__) unclaimedMarkup(element);
  } finally {
    currentInstance.element = previous;
  }
};

/** The earlier window (until R2): open until `render()`/`mount()` commits, or the shared microtask closes it. */
const legacy = (element: ComponentElement, shadowProps: ShadowRootInit | undefined) => {
  const current = currentInstance.element;
  currentInstance.element = element;
  /**
   * **Development: a second `init()` in one setup discards the hooks registered since the first**, silently — correct
   * on a reconnect (a fresh generation is what stops effects doubling), a mistake within one setup (main had this).
   */
  if (__DEV__ && current === element && element._$h$?.length) {
    const count = element._$h$.reduce((n, set) => n + set.size, 0);
    console.warn(diagnostic('core', `<${element.localName}>`, 'init-twice', __DEV__ && PROSE['init-twice'](String(count))));
  }
  if (__DEV__) nearMiss(element);
  /** After the synchronous setup, so the first render has committed and there is a subtree to look at. */
  if (__DEV__) queueMicrotask(() => afterSetup(element));
  if (!ending) {
    ending = true;
    queueMicrotask(endSetup);
  }
  start(element, shadowProps);
};

/**
 * Development: `init(this)` found no setup, and the class has a member that is `setup` in another spelling (`setUp`,
 * `Setup`, `set_up`) — once per class. The walk stops at the element's own window's `HTMLElement.prototype`, so DOM
 * members are never read.
 * A setup-less init is otherwise legitimate (a root for static markup, styles adopted by their module).
 */
const nearMiss = (element: ComponentElement) => {
  const Class = element.constructor;
  if (saidNearMiss.has(Class)) return;
  /** The element's OWN window's platform prototype — never the bare global (Brian's rule; a pop-out has its own). */
  const platform = (element.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.HTMLElement?.prototype;
  for (let proto = Object.getPrototypeOf(element); proto && proto !== platform && proto !== Object.prototype; proto = Object.getPrototypeOf(proto))
    for (const key of Object.getOwnPropertyNames(proto))
      if (key !== 'setup' && key.replace(/_/g, '').toLowerCase() === 'setup') {
        saidNearMiss.add(Class);
        console.warn(diagnostic('core', `<${element.localName}>`, 'setup-near-miss', __DEV__ && PROSE['setup-near-miss'](key)));
        return;
      }
};

/**
 * Removal runs every cleanup an element's effects returned. This must live on the **prototype at
 * definition time**: the custom-elements reaction system snapshots lifecycle callbacks when `define()`
 * runs, so an instance property assigned later is never invoked. Wrapping `customElements.define` is
 * therefore the one seam a framework with no base class has. The author's own `disconnectedCallback`
 * runs first, while subscriptions are still live; an element that never called `init()` pays one
 * undefined-property read. Guarded for environments with no custom elements (a server importing core).
 *
 * **A move is not a removal.** Moving a connected component in ONE operation — `append`/`insertBefore`
 * from one place in the page to another: light-DOM slots placing a slotted component, a keyed reorder,
 * a drag-and-drop library — used to run its whole teardown and then its whole setup again: a component
 * that fetched in its setup fetched twice. Now neither its `disconnectedCallback` nor its
 * `connectedCallback` runs and it keeps its state, as `moveBefore()` defines a move. A real removal
 * (to nowhere, or into a fragment) is torn down synchronously, exactly as before, and so is a move into
 * ANOTHER document (a pop-out window) once it connects there: its listeners and frame clock belong to
 * the old window.
 *
 * `_$x$` is set after the teardown, so a cleanup registered from then on — an effect that removed
 * its own element and has not returned yet — runs at once instead of into a set nothing drains again.
 */
type Moving = ComponentElement & { _$m$?: boolean; _$d$?: Document; _$s$?: PromiseLike<unknown> };
/**
 * **The components THIS copy of core initialized** — what its `customElements.define` wrapper may tear down. A page can
 * hold two copies (a production bundle that inlines core, as `@verajs/directives` does for its standalone fallback): each
 * copy installs a wrapper, and each mangles its internal fields differently, so a copy reading another's element read
 * fields that were never set — removing a component that rendered directives threw `reading 'forEach'` in production
 * (measured 2026-10-09). `_$adopt$` stays the cross-copy brand of "a component" for everything else; teardown is mine.
 */
const mine = new WeakSet<Element>();
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as Moving & { connectedCallback?: () => unknown };
    const own = proto.disconnectedCallback;
    const connected = proto.connectedCallback;
    const teardown = (element: Moving) => {
      own?.call(element);
      element._$c$!.forEach((cleanup) => runCleanup(cleanup, element));
      element._$c$!.clear();
      element._$x$ = true;
      retire(element);
    };
    /**
     * **Only a COMPONENT is touched** — an element `init` ran on, known by `_$adopt$` (installed by `init`, sigiled, never
     * mangled — a brand no other library has). The wrapper sees every class defined after core loads, a third party's
     * included: the fields it keeps are mangled to single letters in production, where a minified library keeps fields
     * of its own, and its unmangled ones (`_$c$`) are ordinary names another base class may own — so neither can be
     * the test. Anything else gets exactly its own callbacks; nothing is read from it, written to it, or called.
     *
     * **Still connected at its disconnect, a component is being MOVED** — `append`/`insertBefore` of a connected node,
     * in one operation: the platform runs the callbacks after the operation, so the node already sits in its new place
     * (measured in Chrome, Firefox and Safari). Nothing is torn down, and the reconnect that follows sets nothing up. A
     * real removal also clears any stale mark, so a move that never reconnected cannot skip a later setup.
     */
    proto.disconnectedCallback = function (this: Moving) {
      if (!mine.has(this)) return own?.call(this);
      this._$m$ = this.isConnected;
      if (!this._$m$) teardown(this);
    };
    /**
     * A move into ANOTHER document (a pop-out window) is not kept: its listeners and frame clock belong to the old one.
     * The document is the one `init` ran in — inserting into another document adopts the node first.
     *
     * On a FIRST connect `_$adopt$` is still undefined here — the author's `connectedCallback`, below, is what runs `init`
     * — and that is correct: a first connect has nothing to keep. Do not move `init` earlier to "fix" it.
     */
    proto.connectedCallback = function (this: Moving) {
      if (mine.has(this) && this._$m$) {
        this._$m$ = false;
        if (this.ownerDocument === this._$d$) return;
        teardown(this);
      }
      /**
       * Its result is returned, and a server render awaits it — so a PENDING SETUP joins it: an async setup is part of
       * the connect, whatever the author's callback returned (nothing, a value, or its own promise, which may settle
       * first — or before `init` even ran, so the setup is read once that promise has settled). A browser ignores the
       * result. A class defined before core loaded is not wrapped; on a server the app imports core first.
       */
      const result = connected?.call(this);
      return this._$s$ || (result as PromiseLike<unknown> | undefined)?.then ? Promise.resolve(result).then(() => this._$s$) : result;
    };
    return nativeDefine(name, Class, options);
  };
}
