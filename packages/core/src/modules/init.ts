import { inserts, InitInsert } from '@verajs/inserts';
import { currentInstance } from '../store/store.js';
import { ComponentElement } from '../types.js';
import { reportHookError } from './createHook.js';

/** Dev-only, and once per page: a missing `@verajs/styles` is silent otherwise. */
let warnedAboutStyles = false;
/** The same, for markup asking for a module nothing wired. */
let warnedAboutClaims = false;

/**
 * **The attribute prefixes wired modules CLAIM — development only, on both sides.**
 *
 * A component pasted from a demo brings its markup with it, and markup addressed to a module the
 * app never wired does nothing at all: no error, no warning, an attribute that reads as supported
 * and is inert. `@verajs/directives` is the case that matters — `data-vd-on-click` on an app that
 * only wired the renderer is silent, because the thing that would have complained is the very
 * thing that is missing.
 *
 * Core cannot ask a module that was never loaded, so a loaded module says so instead: it adds its
 * prefix here when wired, and core warns about markup carrying a prefix nobody claimed. Kept on a
 * `Symbol.for` registry rather than an import because the two packages share no runtime — the
 * production bundles inline everything, so an import would be a second copy rather than a channel.
 *
 * **Both the write and the read sit inside `__DEV__`, so production carries neither**, which is
 * what makes the coupling acceptable: it exists only in the program where the diagnostic exists.
 *
 * The `Symbol.for` is INSIDE the function rather than a module-level constant, and that is the
 * difference between costing nothing and costing something: a top-level `Symbol.for('vera.claims')`
 * is a call with effects terser cannot prove away, so it survived into the production bundle even
 * though every reader of it had folded. Kept inside, the whole function goes unreferenced once the
 * `__DEV__` branches collapse and rollup drops it entire — verified, not assumed.
 */
const claimed = (prefix: string): boolean =>
  ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.claims')] as Set<string> | undefined)
    ?.has(prefix) === true;

/**
 * Inits the component, setting up an instanceInit reference in the instanceInit array,
 * sets up the shadowRoot if it doesn't already exist, and sets up the cleanUp function for
 * the element.
 *
 * `static styles` is **not** core's job — the `'init'` insert chain runs last, and
 * `@verajs/styles` registers into it. Core costs one `Map.get` per element when nothing is
 * registered, instead of carrying 307 B of stylesheet handling every app pays for.
 *
 * @param element The element to init
 * @param shadowProps Any desired shadowProps. Passing in null will create a light DOM instance
 */
export const init = (element: ComponentElement, shadowProps?: ShadowRootInit) => {
  if (!element) throw new Error('init: element required');
  const shadowRoot = element.shadowRoot ?? element._root;

  /**
   * **A second `init()` in the same setup discards the hooks registered since the first, silently.**
   *
   * Dropping them is correct and load-bearing on a *reconnect* — `connectedCallback` runs again
   * every time an element is re-added, and a fresh generation is what stops effects doubling, as the
   * comment below says. Called twice in one setup it is a mistake instead, and the hooks between the
   * two calls simply never run: no error, no warning, an effect that looks registered and is not.
   *
   * Told apart from a reconnect by the same signal the deferred check below uses, read *before* this
   * call overwrites it: if this element is already the current instance, a setup is open, and a
   * second `init()` is closing nothing and starting over. On a reconnect the pointer has been
   * cleared by the `render()` or `mount()` that committed the last setup.
   *
   * `__DEV__`-only; production carries neither the check nor the message.
   */
  if (__DEV__ && currentInstance.element?.deref() === element && element._hooks?.length) {
    console.warn(
      `[vera] <${element.localName}> called init() twice in one setup, so the ${element._hooks.length} ` +
        `hook(s) registered since the first call were discarded and will never run.\n` +
        `init() starts a fresh generation of hooks — which is what makes it safe when a component ` +
        `reconnects — so anything registered before a second call is dropped. Call init() once, then ` +
        `register hooks, then render() or mount().`
    );
  }

  currentInstance.element = new WeakRef(element);

  /**
   * Setup has to be committed by `mount()` — or by `render()`, which is `useRender` plus the same
   * commit. Either runs the first pass of every hook registered since `init()` and then clears the
   * current instance. Without one the hooks exist and nobody ever runs them: silent, and easy to
   * write, because a component whose whole job is a side effect has no reason to call something
   * named `render`. That case is exactly what `mount()` is for.
   *
   * Detected without carrying any state: if this element is still the current instance once the
   * synchronous `connectedCallback` has finished, neither was called. A component mounting after
   * this one moves the pointer, so the check can miss a case but cannot invent one — the right
   * direction for a hint.
   *
   * `__DEV__`-only; production carries neither the check nor the message.
   */
  if (__DEV__) {
    queueMicrotask(() => {
      /**
       * Checked here rather than beside the `static styles` warning below, and the difference is
       * the whole reason this is a microtask: `static styles` is a class property and exists before
       * anything renders, while directives live in markup that `init()` runs BEFORE. Deferring to
       * the end of the synchronous `connectedCallback` means the first render has committed and
       * there is a subtree to look at — the same timing the setup-not-committed check relies on.
       *
       * Scoped to this element's own root, never the document: bounded work per component, and it
       * keeps catching markup that arrives later from an async component or CMS content, which a
       * one-shot page scan at boot would miss entirely.
       */
      if (!warnedAboutClaims && !claimed('data-vd-')) {
        const root = element.shadowRoot ?? element._root ?? element;
        for (const node of (root as ParentNode).querySelectorAll('*')) {
          const hit = [...node.attributes].find((a) => a.name.startsWith('data-vd-'));
          if (!hit) continue;
          warnedAboutClaims = true;
          console.warn(
            `[vera] <${element.localName}> renders \`${hit.name}\`, but no directives engine is wired, ` +
              `so that attribute does nothing.\n` +
              `Wire it once at your app entry:\n\n` +
              `  import { wire } from '@verajs/core';\n` +
              `  import { directives } from '@verajs/directives';\n` +
              `  wire([renderer, directives]);\n\n` +
              `Then wire the packs the markup uses, e.g.:\n\n` +
              `  import { wireDirectives, expressions, interaction } from '@verajs/directives';\n` +
              `  wireDirectives([expressions, ...interaction]);\n`
          );
          break;
        }
      }

      if (currentInstance.element?.deref() === element && element._hooks?.length) {
        console.warn(
          `[vera] <${element.localName}> registered ${element._hooks.length} hook(s) but its setup ` +
            `was never committed, so none of them will ever run.\n` +
            `init() opens the setup and one of these closes it:\n\n` +
            `  render(() => html\`…\`);   // a component with markup\n` +
            `  mount();                  // a component with none\n`
        );
      }
    });
  }

  /**
   * A new generation of hooks starts here, and the previous one stops.
   *
   * `connectedCallback` runs again every time an element is re-added — a router navigating back,
   * a list reordering, a conditional subtree returning — so `init()` and its closing call build a fresh
   * set of hooks. The old ones were dropped from `_hooks` below and left registered in the store,
   * which holds them **weakly**: correct in the end, but only once a garbage collection happens,
   * and until then the element had two live subscriptions and ran everything twice. A second
   * reconnect made it three times. Renders are idempotent so they merely cost; `useEffect` is not,
   * and duplicate effects mean duplicate fetches, subscriptions and analytics.
   *
   * A counter, checked in `createHook`, so a stale hook is inert the moment this runs rather than
   * whenever the collector gets to it.
   */
  element._gen = (element._gen ?? 0) + 1;

  element._hooks = [];
  element._hookPriorities = [];
  element.runHooks = () => {
    element._hooks?.forEach((hooks) => {
      for (const hook of hooks) {
        if (!hook) continue;
        hook({}, true);
      }
    });
  };

  /**
   * The returned root is **kept**, because `element.shadowRoot` is null for a closed one — that is
   * what closed means, and it applies to the framework too. Discarding it meant everything
   * downstream read `element.shadowRoot`, found null, and fell back to the element: content
   * rendered into the light DOM, styles never adopted, and the closed root left empty and
   * unreachable. Measured, with no SSR involved: `mode: 'closed'` put `<p>content</p>` in the
   * light DOM while `mode: 'open'` put it in the shadow root.
   *
   * Guarded on `_root` as well as `shadowRoot`, or a second `init` on a closed element would call
   * `attachShadow` again and throw.
   */
  if (shadowProps && !shadowRoot && !element._root) {
    element._root = element.attachShadow(shadowProps);
  }

  element._cleanups = new Set();
  /** A fresh connection: cleanups registered from here are owed a later removal again. */
  element._removed = false;

  const initInserts = inserts.get('init');
  initInserts?.forEach((callback) => (callback as InitInsert)(element));

  if (__DEV__) {
    /**
     * `static styles` with no adopter registered used to Just Work, so silence here would read as
     * a styling bug rather than a missing import. Warns once, and never in production.
     */
    if (
      !warnedAboutStyles &&
      !initInserts?.length &&
      (element.constructor as unknown as { styles?: unknown }).styles !== undefined
    ) {
      warnedAboutStyles = true;
      console.warn(
        `[vera] <${element.localName}> declares \`static styles\`, but nothing is adopting them.\n` +
          `Style adoption moved out of core. Wire it once at your app entry:\n\n` +
          `  import { wire } from '@verajs/core';\n` +
          `  import { styles } from '@verajs/styles';\n` +
          `  wire([styles]);\n`
      );
    }
  }
};

/**
 * Removal runs every cleanup an element's effects returned — the no-base-class replacement for
 * the old `EchoElement.disconnectedCallback` teardown, orphaned when the base class was removed.
 *
 * This must live on the **prototype at definition time**: the custom-elements reaction system
 * snapshots lifecycle callbacks when `define()` runs, so an instance property assigned later is
 * never invoked (verified empirically). Wrapping `customElements.define` is therefore the one
 * seam a no-base-class framework has. The author's own `disconnectedCallback` is chained first,
 * while subscriptions are still live. Non-Vera elements defined on the same page pass through
 * with a single undefined-property check on removal. Guarded for Node so SSR imports stay clean.
 */
if (typeof customElements !== 'undefined') {
  const nativeDefine = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const proto = Class.prototype as ComponentElement;
    const own = proto.disconnectedCallback;
    proto.disconnectedCallback = function (this: ComponentElement) {
      own?.call(this);
      this._cleanups?.forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          reportHookError(error, this);
        }
      });
      this._cleanups?.clear();
      /**
       * Marked *after* the sweep, so a cleanup registered from here on — an effect that called
       * `remove()` on itself and has not returned yet — is run immediately rather than added to a
       * set nothing will drain again. See `swapCleanup`.
       */
      this._removed = true;
    };
    return nativeDefine(name, Class, options);
  };
}
