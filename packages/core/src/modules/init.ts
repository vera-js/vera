import { diagnostic, misuse, SHARED } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { InitInsert } from '@verajs/inserts';
import { currentInstance, MINE, tracking } from '../store/store.js';
import type { Mine } from '../store/store.js';
import { adoptProps } from './adoptProps.js';
import { firstPasses } from './mount.js';
import { drawInto } from '../hooks/drawInto.js';
import { EFFECT_PRIORITY, LAYOUT_PRIORITY, reportHookError, retire, runCleanup } from './createHook.js';
import type { ComponentElement, InitOptions, Setup } from '../types.js';

/**
 * Development: markup addressed to a module nobody wired (`data-vd-*` with no directives engine) is said once
 * (`@verajs/directives` claims `data-vd-` from both its doors).
 * `Symbol.for` because the two packages share no runtime; the `Symbol.for` sits INSIDE the function so production —
 * where every caller folds away — drops it whole (a top-level one survives: a call with effects terser cannot prove).
 */
let saidUnwiredDirectives = false;
/** Development: `static styles` with nothing adopting them — said once per page. */
let saidUnadoptedStyles = false;
const claimed = (prefix: string): boolean =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.claims')] as Set<string> | undefined)?.has(prefix) === true;
const unclaimedMarkup = (element: ComponentElement) => {
  if (saidUnwiredDirectives || claimed('data-vd-')) return;
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
        saidUnwiredDirectives = true;
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
/** Defined up front like `$S`, so every connect's read of the `foreignNodes` default is a hit. */
(inserts as unknown as { $F?: unknown }).$F = undefined;
/**
 * **How long a removed component whose async setup is still PENDING stays paused** (2026-10-22): long enough for
 * "away and straight back" to keep the in-flight setup (one setup, one fetch, never doubled), short enough that a
 * removed tree is not held. Brian's number to set; 5 s proposed.
 */
const PENDING_SECONDS = 5;
/** Set by the first `persist` option seen: until then a removal never reads `_$P$` (a miss walks the DOM prototype chain). */
let anyPersist = false;
const OPEN: ShadowRootInit = { mode: 'open' };
const CLOSED: ShadowRootInit = { mode: 'closed' };
/**
 * Development: what was said once per component class — a static setup return, a near-miss `setup` spelling.
 * `@__PURE__`: read only under `__DEV__`, so production drops the allocation with the reads.
 */
const saidStatic = /* @__PURE__ */ new WeakSet<object>();
const saidNearMiss = /* @__PURE__ */ new WeakSet<object>();
const saidOptions = /* @__PURE__ */ new WeakSet<object>();
/** Development: the built-in-host warning, said once per page. */
let saidBuiltIn = false;
/** Development: an invalid app default is said once per page (a component's own invalid option, at each connect). */
let saidShadowDefault = false;
/** What `shadow` may be: `false`, `'open'`, `'closed'`, or a `ShadowRootInit` naming one of the two modes. */
const validShadow = (value: unknown) =>
  value === false || value === 'open' || value === 'closed' || (value as ShadowRootInit | null)?.mode === 'open' || (value as ShadowRootInit | null)?.mode === 'closed';
/** What `foreignNodes` may be. */
const validForeign = (value: unknown) => value === 'preserve' || value === 'drop';
/** Development: an invalid `foreignNodes` app default is said once per page, like `shadow`'s. */
let saidForeignDefault = false;
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
 * The legacy window — `init(this)`, hooks, then `render()` or `mount()` to close it — was removed (2026-10-10).
 */
export const init = (target: ComponentElement | InitOptions, setup?: Setup) =>
  isOptions(target)
    ? initWith((target as InitOptions).host as ComponentElement, target as InitOptions, setup)
    : initWith(target as ComponentElement, undefined, setup);

/**
 * An options object is a plain object; an element never is. `constructor` is an ordinary read (a hit on the class's
 * prototype) — where `nodeType` would be a DOM getter, a call into the engine on every connect. Two plain objects carry
 * no `Object` of THIS realm: one made with `Object.create(null)` (no constructor) and a literal written in another
 * window (a pop-out's own `Object`) — both still options. An author class literally named `Object` would be misread; it
 * is not supported.
 */
const isOptions = (target: unknown) => {
  const made = (target as { constructor?: { name?: string } } | null)?.constructor;
  return made === Object || (target != null && (made === undefined || made.name === 'Object'));
};

/**
 * The `'init'` inserts, OUT OF LINE: true when one answered `false` (it defers the setup). The loop inside `initWith` —
 * never even run on a page with no `'init'` insert — cost Firefox's component creation +2.4%, 6 of 6 sessions;
 * with the loop as it was, the same build measured −1.0%: `initWith`'s size, not its work (the inlining cliff,
 * CLAUDE.md). Here it costs `initWith` one call, made only where inserts exist. A plain loop: no closure per connect (a
 * `forEach` arrow captured `element` on every connect of every styled app).
 */
const runInits = (initInserts: unknown[], element: ComponentElement, options: InitOptions | undefined, given: Setup | undefined) => {
  for (let i = 0; i < initInserts.length; i++) if ((initInserts[i] as InitInsert)(element, options, given) === false) return true;
  return false;
};

/**
 * The one entry `init` and `define` share: the host and its options SEPARATELY, so `define`'s generated class can
 * hand over one options object per tag and allocate nothing per connect.
 *
 * **ONE straight line per connect, and every piece in its cheapest measured form** (2026-10-11 — rebuilt from the
 * earlier `init` + `render()` one piece at a time, each measured on Chrome's interpreted first render, which the first
 * `init(host, setup)` had made ≈10% slower). What a fresh, synchronous, light-DOM component does: a generation, its
 * hook lists, its document, its props and the `'init'` inserts; its setup, untracked; its render installed and every
 * first pass run. Everything else is paid only by the components that need it: a re-init's cleanup (a previous
 * generation exists), a root (a `shadow` asks for one), an async branch (a promise came back), the cleanup Set (an
 * effect returned a cleanup — see `coalesce`).
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
  (element as Mine)[MINE] = true;
  /**
   * Development: a BUILT-IN element (no hyphen in its name, and not a customized built-in: `getName`) has no lifecycle
   * core hears, so it is never released when removed — unless `@verajs/renderer/native-elements` is wired (`$ne`). Said
   * once per page. Production carries none of it (2026-10-21).
   */
  if (__DEV__ && !saidBuiltIn && element.localName.indexOf('-') < 0 && (inserts as unknown as { $ne?: unknown }).$ne === undefined &&
    !(element.ownerDocument.defaultView?.customElements as { getName?: (c: unknown) => string | null } | undefined)?.getName?.(element.constructor)) {
    saidBuiltIn = true;
    console.warn(diagnostic('core', `<${element.localName}>`, 'built-in-host-unwired', __DEV__ && PROSE['built-in-host-unwired']()));
  }
  const setup = typeof given === 'function' ? given : typeof (element as { setup?: unknown }).setup === 'function' ? callMethod : undefined;
  /**
   * Development: `init` on a host from inside ITS OWN setup starts a new generation and discards the hooks that setup
   * registered so far — the one form's only window-open second init (a sequential `init(this, s1); init(this, s2)` never
   * warned; a reconnect is a legitimate restart).
   */
  if (__DEV__ && currentInstance.element === element && element._$h$?.length) {
    const count = element._$h$.length;
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
    /** The old generation's list goes; the new one is made by its first hook (`register`), so a fresh element writes none. */
    element._$h$ = undefined;
    /** A released root is cleared NOW, before the `'init'` inserts below put anything in it (the renderer's `$y`). */
    (inserts as unknown as { $y?: (element: Node) => void }).$y?.(element);
  }
  element._$g$ = (generation ?? 0) + 1;
  /** The document of its last connect: a move into ANOTHER keeps it and re-homes it (`rehomeElement`, the wrapper below). */
  (element as Moving)._$d$ = element.ownerDocument;
  /**
   * The root: the component's own `shadow` (an explicit `false` included), else the app default `renderer({ shadow })`
   * on the registry (`$S`), else light DOM. Written without optional chaining — an ordinary component carries no options
   * object, and its path is one comparison and one read. An object naming a mode goes to the platform AS IS (an unknown
   * mode is refused by `attachShadow` itself, in both builds); anything else that is not a root is light DOM.
   */
  const shadow =
    options !== undefined && options.shadow !== undefined ? options.shadow : (inserts as unknown as { $S?: InitOptions['shadow'] }).$S;
  /**
   * **Whether the template owns the root** — `foreignNodes` (nodes placed in a component's root by anything other than its
   * own template): the component's own, else the app default `renderer({ foreignNodes })` (`$F`, which sets component
   * roots only — never a container handed to `renderInto`), else `'drop'`. Any value but `'preserve'` owns.
   */
  const owns =
    (options !== undefined && options.foreignNodes !== undefined ? options.foreignNodes : (inserts as unknown as { $F?: InitOptions['foreignNodes'] }).$F) !==
    'preserve';
  if (__DEV__) checkOptions(element, options, shadow);
  /** `persist`: seconds paused after a removal — a finite number, 0 or more (0: torn down at once); else 0, and development names it. */
  if (options !== undefined && options.persist !== undefined) {
    const seconds = options.persist;
    const valid = typeof seconds === 'number' && seconds >= 0 && seconds < Infinity;
    if (__DEV__ && !valid) console.warn(diagnostic('core', `<${element.localName}>`, 'persist-not-seconds', __DEV__ && PROSE['persist-not-seconds'](String(seconds))));
    anyPersist = true;
    (element as Moving)._$P$ = valid ? seconds : 0;
  }
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
  /**
   * Each is handed the component's options object too: a module's own key travels on it (`observeSlots`, slots) — and
   * the setup as given (`@verajs/renderer/native-elements` sets a built-in host up again when it returns, 2026-10-21).
   * An insert that answers `false` DEFERS the setup (Brian, 2026-10-21): native-elements holds a built-in host's setup
   * until its first connect, as a custom element's runs in its connectedCallback — so a host built off the page and
   * never attached links nothing.
   */
  if (initInserts !== undefined && runInits(initInserts, element, options, given)) return;
  if (__DEV__) unwiredStyles(element);
  /**
   * **The setup: this component is the owner while it runs, and nothing it reads is tracked** (the tracking cell is
   * cleared for it). A setup that throws is rethrown (the author's own call) with the outer owner restored, and commits
   * nothing — the hooks it registered never run; the next connect resets them.
   */
  const previous = currentInstance.element;
  currentInstance.element = element;
  let out: unknown;
  if (setup !== undefined) {
    const reader = tracking.hook;
    tracking.hook = undefined;
    try {
      out = (setup as (e: ComponentElement) => unknown)(element);
    } catch (error) {
      currentInstance.element = previous;
      throw error;
    } finally {
      tracking.hook = reader;
    }
  }
  /** A render function — the common return — is never a promise: one `typeof`, not a `.then` miss on every component. */
  if (typeof out !== 'function' && typeof (out as PromiseLike<unknown> | null)?.then === 'function') {
    currentInstance.element = previous;
    pending(element, out as PromiseLike<unknown>, element._$g$, owns);
    return;
  }
  commit(element, out, owns);
  currentInstance.element = previous;
};

/**
 * **Commits what a setup returned — called with the component as the owner.** Its render is installed as the
 * component's (a function re-runs on change; any other value is drawn once, statically, in both builds, and development
 * says why), then every first pass runs with NO owner — a hook created inside a render belongs to no one. The caller
 * restores the outer owner. No try/finally: nothing here throws to its caller — every hook reports its own error.
 */
const commit = (element: ComponentElement, out: unknown, owns: boolean) => {
  if (out != null) {
    /**
     * NOT inlined (2026-10-23): with this its only caller, the minifier pasted `drawInto` here as an immediately-invoked
     * arrow — a function object built on every component's creation — and headed Firefox paid ~1–2% on bound class
     * creation and churn (measured by restoring the call; `tests/minifier-iife-sites.test.mjs` guards the count).
     */
    /*@__NOINLINE__*/ drawInto(out, element, owns);
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
const pending = (element: ComponentElement, out: PromiseLike<unknown>, generation: number, owns: boolean) => {
  anyAsync = true;
  (element as Moving)._$w$ = true;
  (element as Moving)._$s$ = out.then(
    (value) => {
      settled(element as Moving);
      if (element._$g$ !== generation) return;
      const go = () => {
        const previous = currentInstance.element;
        currentInstance.element = element;
        try {
          commit(element, value, owns);
        } finally {
          currentInstance.element = previous;
        }
      };
      /**
       * Settled while PAUSED (out of the page, kept): the commit is HELD for the resume — nothing runs while it is out — and
       * dropped if the pause expires. Out and not paused: a removal tore it down; nothing to draw.
       */
      if (element.isConnected) go();
      else if ((element as Moving)._$m$) (element as Moving)._$q$ = go;
    },
    (error) => {
      settled(element as Moving);
      reportHookError(error, element, diagnostic('core', `<${element.localName}>`, 'setup-rejected', __DEV__ && PROSE['setup-rejected']()));
    }
  );
};
/** An async setup settled (resolved or rejected). A component paused for it and still out goes at its timer (its cleanups ran at the pause). */
const settled = (element: Moving) => {
  element._$w$ = false;
};

/** The element's own window — its timers belong to it. */
const windowOf = (element: Element) => element.ownerDocument.defaultView ?? globalThis;

/**
 * **Deferred teardown — ONE mechanism, two uses** (Brian 2026-10-22): a REMOVED component is PAUSED — the author's
 * `disconnectedCallback` runs, every hook's cleanup runs (listeners and intervals stop), its setup state, stores and DOM
 * stay — and a timer (the element's own window's) starts. Re-added in time it RESUMES (`resume`); the timer firing tears
 * it down through the one `retireElement`, once (a setup that settled while it was out has its commit HELD for the
 * resume, and dropped at expiry). If that window closes while it is paused, its timer never fires — the element is then
 * garbage with its document, unless it was adopted elsewhere. Used when the
 * component asked (`persist: seconds`) and, automatically, while its async setup is still PENDING: re-added, the
 * in-flight setup carries on — one setup, never two continuations doubling its effects. `_$m$`, the move mark, holds
 * the pause's TIMER: either way a connect finds the component kept, never sets it up again.
 */
const pause = (element: Moving, seconds: number) => {
  /** The hooks RETIRED but kept listed: each runs its cleanup and leaves every store (nothing wakes it while out); a resume's first pass links them again. */
  retire(element);
  element._$m$ = windowOf(element).setTimeout(() => {
    element._$m$ = false;
    element._$q$ = undefined;
    if (__DEV__ && element._$w$) console.warn(diagnostic('core', `<${element.localName}>`, 'setup-outlived-removal', __DEV__ && PROSE['setup-outlived-removal'](String(PENDING_SECONDS))));
    retireElement(element);
  }, seconds * 1000);
};
/**
 * Back in time: every hook runs once (the render first, by priority) — what it missed while out of the page included —
 * and, as a re-home does, its document is recorded and its styles re-applied (a move into another document empties a
 * shadow root's adopted sheets; within one, re-applying is a no-op's cost on a rare path).
 */
const resume = (element: Moving, timer: ReturnType<typeof setTimeout>) => {
  /** Cleared on the window that SET it — its document of the last connect — before a cross-window resume records the new one (timer ids are per window). */
  (element._$d$!.defaultView ?? globalThis).clearTimeout(timer);
  /** Resumed in ANOTHER window: adopted there (`'adopted'`); resumed where it left, nothing to hear. */
  const moved = element._$d$ !== element.ownerDocument;
  element._$d$ = element.ownerDocument;
  if (moved) adopted(element);
  /** A setup that settled while it was out commits now (its commit runs the first passes); otherwise every hook runs once. */
  const held = element._$q$;
  element._$q$ = undefined;
  if (held) held();
  else firstPasses(element);
};

/**
 * **Retires a generation — the ONE place, for a removal and for a re-init alike.** Everything a generation owns ends
 * here, in one fixed order: its hooks leave every store they joined and run their last cleanups, in priority order
 * (`retire`); then the cleanups OTHER packages registered in `_$c$` (`@verajs/hooks`' `useDismiss`, ui's select) run in
 * the order they were registered. Each through `runCleanup`, so one that throws is reported and the rest still run. A
 * re-init that only replaced the hook lists would drop the first generation's cleanups, so an interval or listener
 * outlived its hooks (found 2026-10-10).
 */
const retireGeneration = (element: ComponentElement) => {
  retire(element);
  const cleanups = element._$c$;
  if (cleanups !== undefined) {
    /** A plain loop: a `forEach` arrow captured `element` on every component removed. */
    for (const cleanup of cleanups) runCleanup(cleanup, element);
    cleanups.clear();
  }
};

/**
 * **`'adopted'` — a component now lives in ANOTHER document** (2026-10-26, Brian: the seam "as generalized as possible …
 * extendable … tiny and free speed wise"). The platform's name for a node changing document (`adoptedCallback`, which a class
 * must never define: it taxes every creation). Fired from core's two COLD cross-window paths only — a re-home and a paused
 * component resumed in another window — so a same-document render, move or resume never reads the chain. Every module that
 * keeps something per document or per window hangs here: `@verajs/styles` re-applies its sheets (a move empties a shadow
 * root's adopted sheets), `multiWindow` watches the new window. No removal chain: removal is a hot path.
 */
const adopted = (element: ComponentElement) => {
  const chain = inserts.get('adopted');
  if (chain !== undefined) for (let i = 0; i < chain.length; i++) (chain[i] as unknown as (element: Element) => void)(element);
};
/**
 * **A component moved into ANOTHER document — a pop-out window, an iframe — and back** (Brian 2026-10-21/22). It is
 * KEPT: its setup, its state and its DOM (which moved with it) stay. What belongs to a window re-runs, both ways:
 * - its layout effects and plain effects, EXACTLY those two priorities (by name): each runs its cleanup and then runs
 *   again, so a listener on the element's window, a frame loop or an observer re-binds to the new one (Brian: every
 *   effect, as if its inputs changed). A hook at any other priority — `resource()`'s, an `effect` with a `priority` of your own — is not
 *   re-run: a move never refetches;
 * - the `'adopted'` insert: `@verajs/styles` re-applies its sheets, because a move EMPTIES a shadow root's
 *   `adoptedStyleSheets` and the way back does not restore them (BROWSER-LEDGER 2026-10-22).
 * `_$d$` becomes the new document, so the way back re-homes too; a move within one document never gets here.
 */
export const rehomeElement = (element: ComponentElement) => {
  (element as Moving)._$d$ = element.ownerDocument;
  const hooks = element._$h$;
  if (hooks !== undefined)
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i]!;
      if (hook._y === LAYOUT_PRIORITY || hook._y === EFFECT_PRIORITY) hook.$n();
    }
  adopted(element);
};

/**
 * **A removal's whole teardown, one function** (lifted 2026-10-21 for `@verajs/renderer/native-elements`): the
 * generation retired, the hook lists DROPPED (each hook is a closure over its element: a removed element still holding
 * them is a DOM↔JS cycle only Firefox's cycle collector frees — 2026-10-11), the renderer's release of the
 * component's root part (`$x`; absent on a server), and `_$x$`. The define wrapper runs it after the author's own
 * `disconnectedCallback`; the native-elements module runs it (`$td`) when a built-in host leaves the document.
 */
export const retireElement = (element: ComponentElement) => {
  retireGeneration(element);
  element._$h$ = undefined;
  /**
   * **The props store, RELEASED** (2026-10-21): Firefox keeps a removed element's fields alive until its cycle
   * collector frees the node, so a record and store still hanging off it survived every GC and were swept from the
   * tenured heap (the private-store class never paid: its store hangs off `_$h$`, dropped above). The record is the
   * store's target — a WeakMap key — so it is SWAPPED for a plain copy (the values survive a re-add) and the store is
   * dropped; every accessor reads through `propsOf`, so the next read builds a store over the copy. Real removals only.
   */
  if (element._$v$ !== undefined) {
    element._$raw$ = { ...element._$raw$ };
    element._$v$ = undefined;
  }
  /** The renderer drops what its part holds of the component's JS — absent on a server, a no-op. */
  (inserts as unknown as { $x?: (element: Node) => void }).$x?.(element);
  element._$x$ = true;
};

let saidClaimedTwice = false;
/**
 * Development: the option keys the wired `'init'` hooks claim (`$keys` on the hook function — never on its descriptor,
 * which `chain()` does not reach), each with the module that claims it. Two modules claiming one key, or a module
 * claiming one of core's, is said once per page; both hooks still get the object (core cannot know which one meant it).
 *
 * Read fresh each time, never cached: a hook REPLACED at a taken priority keeps the array's identity and length, so a
 * cache keyed on them goes stale. Development only, once per `init` that has options. Nothing at module scope
 * is constructed: production keeps a constructor call it cannot prove unused (+8 B measured).
 */
const claims = (): Map<string, string> => {
  const hooks = inserts.get('init') as unknown[] | undefined;
  const optionKeys = new Map<string, string>();
  for (const hook of hooks ?? []) {
    const { $keys, $module } = hook as { $keys?: string[]; $module?: string };
    for (const key of $keys ?? []) {
      const other = key === 'host' || key === 'shadow' || key === 'foreignNodes' ? 'core' : optionKeys.get(key);
      if (other !== undefined && !saidClaimedTwice) {
        saidClaimedTwice = true;
        console.warn(diagnostic('core', 'init()', 'option-claimed-twice', __DEV__ && PROSE['option-claimed-twice'](key, other, $module ?? 'a module')));
      }
      optionKeys.set(key, $module ?? 'a module');
    }
  }
  return optionKeys;
};
/**
 * Development: an invalid app default or own `shadow` or `foreignNodes`, and an unknown option key — said by name, before
 * the fallback (light DOM for `shadow`; `'drop'` for `foreignNodes`, the built-in default).
 */
const checkOptions = (element: ComponentElement, options: InitOptions | undefined, shadow: InitOptions['shadow']) => {
  const own = options?.shadow;
  if (own === undefined && shadow !== undefined && !saidShadowDefault && !validShadow(shadow)) {
    saidShadowDefault = true;
    console.warn(diagnostic('core', 'renderer({ shadow })', 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(shadow), platformRefuses(shadow))));
  }
  const ownForeign = options?.foreignNodes;
  const foreign = (inserts as unknown as { $F?: unknown }).$F;
  if (ownForeign === undefined && foreign !== undefined && !saidForeignDefault && !validForeign(foreign)) {
    saidForeignDefault = true;
    console.warn(diagnostic('core', 'renderer({ foreignNodes })', 'foreign-nodes-option', __DEV__ && PROSE['foreign-nodes-option'](shown(foreign))));
  }
  if (options) {
    const keys = claims();
    for (const key in options)
      if (key !== 'host' && key !== 'shadow' && key !== 'foreignNodes' && key !== 'persist' && !keys.has(key))
        console.warn(diagnostic('core', 'init()', 'unknown-option', __DEV__ && SHARED.unknownOption(key, ['foreignNodes', 'host', 'persist', 'shadow', ...keys.keys()].sort().join(', '))));
    if (own !== undefined && !validShadow(own))
      console.warn(diagnostic('core', `<${element.localName}>`, 'shadow-option', __DEV__ && PROSE['shadow-option'](shown(own), platformRefuses(own))));
    if (ownForeign !== undefined && !validForeign(ownForeign))
      console.warn(diagnostic('core', `<${element.localName}>`, 'foreign-nodes-option', __DEV__ && PROSE['foreign-nodes-option'](shown(ownForeign))));
  }
};

/**
 * Development: a component declaring `static styles` with nothing adopting them renders unstyled, silently — so it is
 * said, once. Asked of `@verajs/styles` itself (its development `$module` mark), not "any init module".
 */
const unwiredStyles = (element: ComponentElement) => {
  if (
    !saidUnadoptedStyles &&
    (element.constructor as { styles?: unknown }).styles !== undefined &&
    !inserts.get('init')?.some((fn) => (fn as { $module?: string }).$module === 'styles')
  ) {
    saidUnadoptedStyles = true;
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

/** `_$m$`: `true` while a move is under way, a pause's TIMER while paused (`pause`), else falsy. */
type Moving = ComponentElement & { _$m$?: boolean | ReturnType<typeof setTimeout>; _$d$?: Document; _$s$?: PromiseLike<unknown>; _$w$?: boolean; _$P$?: number; _$q$?: () => void };

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
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as Moving & { connectedCallback?: () => unknown };
    const own = proto.disconnectedCallback;
    const connected = proto.connectedCallback;
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
      if ((this as Mine)[MINE] === undefined) return own?.call(this);
      this._$m$ = this.isConnected;
      if (!this._$m$) {
        own?.call(this);
        /** Paused instead of torn down: asked for (`persist`), or its async setup is still pending. Read only once either exists. */
        const seconds = (anyPersist && this._$P$) || (anyAsync && this._$w$ ? PENDING_SECONDS : 0);
        if (seconds) pause(this, seconds);
        else retireElement(this);
      }
    };
    /**
     * A move into ANOTHER document (a pop-out window, an iframe) is kept as well (R4), and re-homed: its effects re-run
     * against the new window and its styles are re-applied. Inserting into another document adopts the node first.
     *
     * On a FIRST connect `_$adopt$` is still undefined here — the author's `connectedCallback`, below, is what runs `init`
     * — and that is correct: a first connect has nothing to keep. Do not move `init` earlier to "fix" it.
     */
    proto.connectedCallback = function (this: Moving) {
      let kept;
      if ((this as Mine)[MINE] !== undefined && (kept = this._$m$)) {
        this._$m$ = false;
        /** A paused component back in time: resumed (every hook once), never set up again. */
        if (kept !== true) resume(this, kept);
        /** A move into another document is kept too, and re-homed: what belongs to a window re-runs (see `rehomeElement`). */
        else if (this.ownerDocument !== this._$d$) rehomeElement(this);
        return;
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
