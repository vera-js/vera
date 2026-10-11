import { diagnostic, misuse, SHARED } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { InitInsert } from '@verajs/inserts';
import { currentInstance, hooksQueue, mine } from '../store/store.js';
import { adoptProps } from './adoptProps.js';
import { firstPasses } from './mount.js';
import { useRender } from '../hooks/useRender.js';
import { runCleanup } from '../hooks/coalesce.js';
import { reportHookError, retire } from './createHook.js';
import type { ComponentElement, InitOptions, Setup } from '../types.js';

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
const unclaimedMarkup = (element: ComponentElement) => {
  if (warnedAboutClaims || claimed('data-vd-')) return;
  const root = (element.shadowRoot ?? element._$r$ ?? element) as ParentNode;
  /**
   * A plain walk, not `querySelectorAll`: a selector engine may keep the last root it searched (jsdom's does), and
   * this runs on EVERY component's first pass in development — it kept the last-set-up component alive after removal
   * (tests/core-subscription-sweep's re-render and 5000-hook rows, development only, 2026-10-10).
   */
  const stack: Element[] = [];
  let el = root.firstElementChild;
  while (el !== null) {
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++)
      if (attrs[i]!.name.startsWith('data-vd-')) {
        warnedAboutClaims = true;
        console.warn(diagnostic('core', `<${element.localName}>`, 'unwired-directives', __DEV__ && PROSE['unwired-directives'](attrs[i]!.name)));
        return;
      }
    /** Depth first: down to the first child, else across, else back up to the nearest ancestor with a next sibling. */
    if (el.firstElementChild !== null) {
      stack.push(el);
      el = el.firstElementChild;
      continue;
    }
    let next = el.nextElementSibling;
    while (next === null && stack.length) next = stack.pop()!.nextElementSibling;
    el = next;
  }
};

/** The two shadow roots by name, built once — `init` attaches from these, so no options object is made per connect. */
(inserts as unknown as { $S?: unknown }).$S = undefined;
const OPEN: ShadowRootInit = { mode: 'open' };
const CLOSED: ShadowRootInit = { mode: 'closed' };
/** Development: what was said once per component class — a static setup return, a near-miss `setup` spelling. */
const saidStatic = new WeakSet<object>();
const saidNearMiss = new WeakSet<object>();
const saidOptions = new WeakSet<object>();
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
 * function. With no setup, `init` calls the class's `setup()` method (Shape B); with neither, the element is a
 * component with nothing to set up — its root, its delivered props, the `'init'` inserts, committed at once. A setup
 * returning nothing is a side-effect setup; a promise, an async one (its synchronous part is the window).
 *
 * The legacy window — `init(this)`, hooks, then `render()` or `mount()` to close it — was removed in R2 (2026-10-10).
 */
export const init = (target: ComponentElement | InitOptions, setup?: Setup) =>
  /**
   * An options object is a plain object; an element never is. `constructor` is an ordinary read (a hit on the class's
   * prototype) — where `nodeType` would be a DOM getter, a call into the engine on every connect.
   */
  (target as { constructor?: unknown } | null)?.constructor === Object
    ? initWith((target as InitOptions).host as ComponentElement, target as InitOptions, setup)
    : initWith(target as ComponentElement, undefined, setup);

/**
 * The one entry `init` and (R3) `define` share: the host and its options SEPARATELY, so `define`'s generated class can
 * hand over one options object per tag and allocate nothing per connect.
 *
 * **ONE straight line per connect, and every piece in its cheapest measured form** (R2.5, 2026-10-11 — rebuilt from
 * pre-R1's `init` + `render()` one piece at a time, each measured on Chrome's interpreted first render, which R1 had
 * made ≈10% slower). What a fresh, synchronous, light-DOM component does: a generation, its hook lists, its document,
 * its props and the `'init'` inserts; its setup, untracked; its render installed and every first pass run. Everything
 * else is paid only by the components that need it: a re-init's cleanup (a previous generation exists), a root (a
 * `shadow` asks for one), an async branch (a promise came back), the cleanup Set (an effect returned a cleanup — see
 * `coalesce`).
 */
export const initWith = (element: ComponentElement, options: InitOptions | undefined, given: Setup | undefined) => {
  if (__DEV__ && (element as Partial<Node> | null)?.nodeType !== 1)
    throw new TypeError(misuse('init', 'init-not-element', __DEV__ && PROSE['init-not-element'](String(element))));
  /**
   * The old `init(this, { mode })`, where options used to go — they travel WITH the host now. Both builds ignore the
   * object (a setup-less init, no root); development says so, once per class — logged, not thrown, so the builds never
   * behave differently.
   */
  if (__DEV__ && given != null && typeof given !== 'function' && !saidOptions.has(element.constructor)) {
    saidOptions.add(element.constructor);
    console.error(diagnostic('core', `<${element.localName}>`, 'init-options', __DEV__ && PROSE['init-options']()));
  }
  mine.add(element);
  const setup = typeof given === 'function' ? given : typeof (element as { setup?: unknown }).setup === 'function' ? callMethod : undefined;
  /**
   * Development: `init` on a host from inside ITS OWN setup starts a new generation and discards the hooks that setup
   * registered so far — the one form's only window-open second init (a sequential `init(this, s1); init(this, s2)` never
   * warned; a reconnect is a legitimate restart).
   */
  if (__DEV__ && currentInstance.element === element && element._$h$?.length) {
    const count = element._$h$.reduce((n, set) => n + set.size, 0);
    console.warn(diagnostic('core', `<${element.localName}>`, 'init-twice', __DEV__ && PROSE['init-twice'](String(count))));
  }
  /** Development: a `setup()` method spelled another way would have been this init's setup. */
  if (__DEV__ && setup === undefined) nearMiss(element);
  /**
   * **A new generation.** The previous one — a re-init — retires (its cleanups run, its hooks leave every store) and the
   * element is live again. A fresh element has nothing to undo, and its first read of `_$g$` already says so: no walk,
   * no field written (writing `_$u$` up front instead once cost Firefox's collector 35% on create + remove).
   */
  const generation = element._$g$;
  if (generation !== undefined) {
    retireGeneration(element);
    element._$x$ = false;
  }
  element._$g$ = (generation ?? 0) + 1;
  element._$h$ = [];
  element._$p$ = [];
  /** The document it was set up in: a move into another one is a teardown and a fresh setup (see the wrapper below). */
  (element as Moving)._$d$ = element.ownerDocument;
  /**
   * The root: the component's own `shadow` (an explicit `false` included), else the app default `renderer({ shadow })`
   * on the registry (`$S`), else light DOM. Written without optional chaining — an ordinary component carries no options
   * object, and its path is one comparison and one read. An object naming a mode goes to the platform AS IS (an unknown
   * mode is refused by `attachShadow` itself, in both builds); anything else that is not a root is light DOM.
   */
  const shadow =
    options !== undefined && options.shadow !== undefined ? options.shadow : (inserts as unknown as { $S?: InitOptions['shadow'] }).$S;
  if (__DEV__) checkShadow(element, options, shadow);
  if (shadow) {
    const root = shadow === 'open' ? OPEN : shadow === 'closed' ? CLOSED : (shadow as ShadowRootInit).mode ? (shadow as ShadowRootInit) : undefined;
    if (root && !element.shadowRoot && !element._$r$) element._$r$ = element.attachShadow(root);
  }
  adoptProps(element);
  /**
   * The `'init'` insert: every element as it comes to life, after its root exists and before its first render — how
   * `@verajs/styles` adopts `static styles`, and the place for instrumentation or per-element registration.
   */
  const initInserts = inserts.get('init');
  /** A plain loop: no closure per connect (a `forEach` arrow captured `element` on every connect of every styled app). */
  if (initInserts !== undefined) for (let i = 0; i < initInserts.length; i++) (initInserts[i] as InitInsert)(element);
  if (__DEV__) unwiredStyles(element);
  /**
   * **The setup: this component is the owner while it runs, and nothing it reads is tracked** (the `undefined` on the
   * tracking stack). A setup that throws is rethrown (the author's own call) with the outer owner restored, and commits
   * nothing — the hooks it registered never run; the next connect resets them.
   */
  const previous = currentInstance.element;
  currentInstance.element = element;
  let out: unknown;
  if (setup !== undefined) {
    hooksQueue.push(undefined);
    try {
      out = (setup as (e: ComponentElement) => unknown)(element);
    } catch (error) {
      currentInstance.element = previous;
      throw error;
    } finally {
      hooksQueue.pop();
    }
  }
  /** A render function — the common return — is never a promise: one `typeof`, not a `.then` miss on every component. */
  if (typeof out !== 'function' && typeof (out as PromiseLike<unknown> | null)?.then === 'function') {
    currentInstance.element = previous;
    pending(element, out as PromiseLike<unknown>, element._$g$);
    return;
  }
  commit(element, out);
  currentInstance.element = previous;
};

/**
 * **Commits what a setup returned — called with the component as the owner.** Its render is installed as the
 * component's (a function re-runs on change; any other value is drawn once, statically, in both builds, and development
 * says why), then every first pass runs with NO owner — a hook created inside a render belongs to no one. The caller
 * restores the outer owner. No try/finally: nothing here throws to its caller — every hook reports its own error.
 */
const commit = (element: ComponentElement, out: unknown) => {
  if (out != null) {
    useRender(out, element);
    if (__DEV__ && typeof out !== 'function') staticReturn(element, out);
  }
  currentInstance.element = null;
  firstPasses(element);
  /** Development: the first pass has committed, so there is a subtree to check for markup no module claimed. */
  if (__DEV__) unclaimedMarkup(element);
};

/** Set the first time ANY setup is async: until then the define wrapper never reads `_$s$`, a field ordinary components lack. */
let anyAsync = false;

/**
 * **An async setup** — rare, so out of line: `initWith`'s size is what every synchronous component pays. It commits
 * when it settles, if the element is still this generation and connected. Kept on `_$s$` for the
 * `customElements.define` wrapper below, which hands it to whoever awaits the connect — a server. It is the HANDLED
 * chain, so it never rejects: a setup that rejects commits nothing (like one that throws) and is reported once through
 * the `'error'` chain — never as an unhandled rejection.
 */
const pending = (element: ComponentElement, out: PromiseLike<unknown>, generation: number) => {
  anyAsync = true;
  (element as Moving)._$s$ = out.then(
    (value) => {
      if (element._$g$ !== generation || !element.isConnected) return;
      const previous = currentInstance.element;
      currentInstance.element = element;
      try {
        commit(element, value);
      } finally {
        currentInstance.element = previous;
      }
    },
    (error) =>
      reportHookError(error, element, __DEV__ ? diagnostic('core', `<${element.localName}>`, 'setup-rejected', __DEV__ && PROSE['setup-rejected']()) : '[vera] setup-rejected')
  );
};

/**
 * **Retires a generation — the ONE place, for a removal and for a re-init alike.** Everything a generation owns ends
 * here: its effects' pending cleanups run (each through `runCleanup`, so one that throws is reported and the rest still
 * run), and its hooks leave every store they joined (see `retire`). A re-init that only replaced the hook lists would
 * drop the first generation's cleanups, so an interval or listener outlived its hooks (found 2026-10-10).
 */
const retireGeneration = (element: ComponentElement) => {
  const cleanups = element._$c$;
  if (cleanups !== undefined) {
    cleanups.forEach((cleanup) => runCleanup(cleanup, element));
    cleanups.clear();
  }
  retire(element);
};

/** Development: an invalid app default or own `shadow`, and an unknown option key — said by name, before the fallback. */
const checkShadow = (element: ComponentElement, options: InitOptions | undefined, shadow: InitOptions['shadow']) => {
  const own = options?.shadow;
  if (own === undefined && shadow !== undefined && !warnedAboutDefault && !validShadow(shadow)) {
    warnedAboutDefault = true;
    console.warn(diagnostic('core', 'renderer({ shadow })', 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(shadow), platformRefuses(shadow))));
  }
  if (options) {
    for (const key in options)
      if (key !== 'host' && key !== 'shadow')
        console.warn(diagnostic('core', 'init()', 'unknown-option', __DEV__ && SHARED.unknownOption(key, 'host, shadow')));
    if (own !== undefined && !validShadow(own))
      console.warn(diagnostic('core', `<${element.localName}>`, 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(own), platformRefuses(own))));
  }
};

/**
 * Development: a component declaring `static styles` with nothing adopting them renders unstyled, silently — so it is
 * said, once. Asked of `@verajs/styles` itself (its development `$module` mark), not "any init module".
 */
const unwiredStyles = (element: ComponentElement) => {
  if (
    !warnedAboutStyles &&
    (element.constructor as { styles?: unknown }).styles !== undefined &&
    !inserts.get('init')?.some((fn) => (fn as { $module?: string }).$module === 'styles')
  ) {
    warnedAboutStyles = true;
    console.warn(diagnostic('core', `<${element.localName}>`, 'unwired-styles', __DEV__ && PROSE['unwired-styles']()));
  }
};

/** Development: a setup returned a value, not a render function — drawn once, statically; said once per class. */
const staticReturn = (element: ComponentElement, out: unknown) => {
  if (saidStatic.has(element.constructor)) return;
  saidStatic.add(element.constructor);
  const kind = Array.isArray(out) ? 'an array' : typeof out === 'object' ? 'a template or object' : `a ${typeof out}`;
  console.error(diagnostic('core', `<${element.localName}>`, 'setup-returned-value', __DEV__ && PROSE['setup-returned-value'](kind)));
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
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as Moving & { connectedCallback?: () => unknown };
    const own = proto.disconnectedCallback;
    const connected = proto.connectedCallback;
    const teardown = (element: Moving) => {
      own?.call(element);
      retireGeneration(element);
      element._$x$ = true;
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
       * result. A class defined before core loaded is not wrapped; on a server the app imports core first. `_$s$` is read
       * only once any setup has been async (`anyAsync`): an ordinary component lacks the field, and that miss walks the
       * whole DOM prototype chain on every connect.
       */
      const result = connected?.call(this);
      return (anyAsync && this._$s$) || (result as PromiseLike<unknown> | undefined)?.then ? Promise.resolve(result).then(() => this._$s$) : result;
    };
    return nativeDefine(name, Class, options);
  };
}
