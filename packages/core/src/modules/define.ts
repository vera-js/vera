import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { initWith } from './init.js';
import { createStore } from './createStore.js';
import type { ComponentElement, DefinedClass, DefineOptions, InitOptions, Methods, Setup } from '../types.js';

/**
 * **`define(tag, setup)` / `define({ tag, …options }, setup)` — a component without writing a class** (R3, Brian
 * 2026-10-21). One ENTRY per tag, built once: the options as `init` receives them (a copy without `tag`) and the setup.
 *
 * - **The setup lives OFF the options object** (`entry.s`), so every `'init'` insert sees exactly today's options — the
 *   development unknown-option check (core's keys + the modules' claims) is unchanged, and no `tag` or `setup` key leaks
 *   to a module. It is the R6 swap seam: the dev module replaces `entry.s`; production carries no swap code.
 * - **The generated class defines ONE callback.** Core's `customElements.define` wrapper (init.ts) installs
 *   `connectedCallback` and `disconnectedCallback` on every class it is handed — move-keeping, the cross-document rule
 *   and the one teardown (`retireElement`) — and calls the class's own inside them; a teardown of the class's own would
 *   retire every removed element TWICE (vera-5a, 2026-10-21). Every callback a class defines is also per-instance
 *   creation work (CLAUDE.md: `adoptedCallback`, +7.4%).
 * - **`initWith` is not touched:** Firefox charges custom-element creation for `initWith`'s SIZE (#33, BROWSER-LEDGER
 *   2026-10-21), so everything `define` adds lives here, per tag.
 * - **The STRING form passes no options** — the ordinary path's one comparison, no object read. The object form passes
 *   the rest of its keys, an EMPTY object when it names only the tag (normalizing it to `undefined` costs bytes for one
 *   property miss per connect; vera-5a, 2026-10-21).
 * - The options copy is frozen in development: it is shared by every instance of the tag, so a module that wrote to it
 *   would leak state between them — it throws there instead (no package writes it, checked 2026-10-21).
 */
/** The cached props store's key — one Symbol per copy of core (see the props block). */
const PROPS = /* @__PURE__ */ Symbol();

export const define = <M extends Methods = Record<never, never>, P extends object = Record<never, never>>(
  target: string | (DefineOptions & { props?: P; methods?: M & ThisType<ComponentElement & P & M> }),
  setup: (host: ComponentElement & P & M) => unknown
): DefinedClass<P & M> => {
  let tag = target as string;
  let options: InitOptions | undefined;
  let methods: M | undefined;
  let props: Record<string, unknown> | undefined;
  /** One test, and the tag (and `methods`, `props`) read back out (the smaller form: −1 `typeof` in the bundle). */
  if (typeof target !== 'string')
    ({ tag, methods, props, ...(options as object) } = (target ?? {}) as DefineOptions & { methods?: M; props?: Record<string, unknown> });
  if (__DEV__) {
    checkDefine(tag, setup);
    if (methods) checkMethods(tag, methods, options);
    if (props !== undefined) checkProps(tag, props, methods);
    Object.freeze(options);
  }
  const entry = { o: options, s: setup as Setup };
  /** The declared names, once per tag: the connect-time pre-upgrade hand-over walks only these (none: no loop at all). */
  const keys = props && Object.keys(props);
  /**
   * **ONE assign builds the prototype** — `methods` (public methods: one function per tag, nothing per instance; `this` is
   * the element, as in a class; Brian 2026-10-21), then the class's `constructor` and the generated `connectedCallback`
   * LAST, so a key of either name in `methods` never replaces them, in either build (development says so).
   * - Writing an EXISTING prototype property keeps its attributes (measured): `constructor` stays non-enumerable, as a
   *   class has it. `connectedCallback` and the methods are NEW properties, so they are ENUMERABLE — unlike a class
   *   component's — the one-assign form being 11 B smaller than a class body plus a re-assert (6264 vs 6275 gz, vera-5a:
   *   take it). No platform behavior reads it: the registry captures callbacks by [[Get]] at define time; code walking
   *   the prototype already sees every WebIDL member, all enumerable.
   */
  const Class = class extends HTMLElement {};
  Object.assign(Class.prototype, methods, {
    constructor: Class,
    connectedCallback(this: ComponentElement) {
      /**
       * **A value set before the tag was defined** (`el.heading = …` on an element made before `define` ran) is an OWN
       * data property, which hides the prototype accessor: handed over through the setter, before the setup runs. Only
       * declared names; `Object.hasOwn`, never `in` (vera-5a). Here, never in `initWith` (#33: Firefox charges its size).
       */
      if (keys)
        for (const key of keys)
          if (Object.hasOwn(this, key)) {
            const value = (this as unknown as Record<string, unknown>)[key];
            delete (this as unknown as Record<string, unknown>)[key];
            (this as unknown as Record<string, unknown>)[key] = value;
          }
      initWith(this, entry.o, entry.s);
    },
  });
  /**
   * **Declared props** (R3 piece 2; Brian 2026-10-21: optional, names and defaults): a get/set pair per name on the
   * PROTOTYPE, backed by the element's ONE props store — `createStore(_$raw$)`, the store `adoptProps` keeps — so a write
   * from anywhere (a template, plain JS after connect, another framework) is a store write and the render that read it
   * repaints. ONE STORE, TWO VIEWS: this getter reads through the PROXY (tracked, for the component's own hooks); the
   * renderer's `!name` compare reads the raw TARGET (untracked — a parent's commit is never subscribed to a child).
   * - **Defaults are LAZY: creation pays nothing.** The first touch of ANY declared prop (a read or a write) writes every
   *   default the element does not hold into the RAW target (no notification) — reads after it go through the proxy,
   *   which subscribes the reader. An array or plain-object default is shallow-copied there, per element (`items: []`
   *   gives each its own list; nested values stay shared). `Object.hasOwn`, never `in`: a prop named `toString` would
   *   otherwise find Object.prototype's (vera-5a).
   * - Binding a value EQUAL to the default writes once, then matches; pinned.
   * - Assigned after `methods`, so a prop of a method's name wins (development says so).
   */
  if (keys) {
    /**
     * **The element's props store, CACHED on it** (race35: reading through `createStore` — a WeakMap lookup per access,
     * createProxy.ts — cost the parent-passes-new-props row +2.6% and the defaults row +11.8% on Chrome; the alternative
     * was written down before the run): under a Symbol PRIVATE to this copy of core (two copies on a page never see each
     * other's — never a string name), built at the FIRST touch of any declared prop, which also writes every missing
     * default at once into the raw target (no notification), so no read pays a `hasOwn`. The cached proxy points at the
     * raw record only — no back-pointer to the element, so no DOM↔JS cycle for Firefox's collector.
     */
    const copies = keys.map((key) => {
      const value = props![key];
      return Array.isArray(value) ? 1 : (value as object)?.constructor === Object ? 2 : 0;
    });
    const store = (element: Record<symbol, unknown> & ComponentElement) => {
      const raw = (element._$raw$ ??= {}) as Record<string, unknown>;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        if (!Object.hasOwn(raw, key)) {
          const value = props![key];
          raw[key] = copies[i] === 1 ? [...(value as unknown[])] : copies[i] === 2 ? { ...(value as object) } : value;
        }
      }
      return (element[PROPS] = createStore(raw)) as Record<string, unknown>;
    };
    for (const key of keys)
      Object.defineProperty(Class.prototype, key, {
        get(this: Record<symbol, unknown> & ComponentElement) {
          return ((this[PROPS] as Record<string, unknown> | undefined) ?? store(this))[key];
        },
        set(this: Record<symbol, unknown> & ComponentElement, value: unknown) {
          ((this[PROPS] as Record<string, unknown> | undefined) ?? store(this))[key] = value;
        },
        configurable: true,
        enumerable: true,
      });
  }
  customElements.define(tag, Class);
  return Class as unknown as DefinedClass<P & M>;
};

/**
 * Development: the declared props, said by code — installed identically in both builds. A name a method also has (the
 * prop wins), a platform member's name, an object default that cannot be copied per element (a `Set`, a `Map`, a class
 * instance: SHARED by every instance — set it in the setup, or pass it in).
 */
const checkProps = (tag: string, props: unknown, methods: object | undefined) => {
  if (props === null || typeof props !== 'object') {
    console.warn(diagnostic('core', `define('${tag}') props`, 'define-props-not-object', __DEV__ && PROSE['define-props-not-object'](String(props))));
    return;
  }
  for (const name of Object.keys(props)) {
    const subject = `define('${tag}') props.${name}`;
    const value = (props as Record<string, unknown>)[name];
    if (methods && Object.hasOwn(methods, name)) console.warn(diagnostic('core', subject, 'define-prop-method', __DEV__ && PROSE['define-prop-method'](name)));
    else if (name in HTMLElement.prototype) console.warn(diagnostic('core', subject, 'define-shadows', __DEV__ && PROSE['define-shadows'](name)));
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && (value as object).constructor !== Object)
      console.warn(diagnostic('core', subject, 'define-prop-shared-default', __DEV__ && PROSE['define-prop-shared-default']()));
  }
};

/**
 * Development: each key of `methods`, said by code — never refused, so both builds INSTALL the same thing (Brian's rule:
 * one behavior, the words in development only). Read by descriptor, so a getter is reported, not run.
 */
const checkMethods = (tag: string, methods: object, options: InitOptions | undefined) => {
  for (const name of Object.keys(methods)) {
    const subject = `define('${tag}') methods.${name}`;
    const value = Object.getOwnPropertyDescriptor(methods, name)?.value as unknown;
    /** The two names core re-asserts. A comparison, not a module-level `Set`: a top-level `new Set` SURVIVES production
     *  (terser cannot prove the call free of effects — it cost +33 B gz here, 2026-10-21). */
    if (name === 'constructor' || name === 'connectedCallback') console.warn(diagnostic('core', subject, 'define-method-ignored', __DEV__ && PROSE['define-method-ignored'](name)));
    else if (typeof value !== 'function') console.warn(diagnostic('core', subject, 'define-method-not-function', __DEV__ && PROSE['define-method-not-function']()));
    else if (name === 'adoptedCallback') console.warn(diagnostic('core', subject, 'define-method-adopted', __DEV__ && PROSE['define-method-adopted']()));
    else if (name === 'attributeChangedCallback' && !(options as { attributes?: unknown[] } | undefined)?.attributes?.length)
      console.warn(diagnostic('core', subject, 'define-method-unobserved', __DEV__ && PROSE['define-method-unobserved']()));
    else if (name in HTMLElement.prototype) console.warn(diagnostic('core', subject, 'define-shadows', __DEV__ && PROSE['define-shadows'](name)));
  }
};

/** Development: what a misused `define` received, by code, before the platform's own refusal (which throws in both builds). */
const checkDefine = (tag: unknown, setup: unknown) => {
  if (typeof tag !== 'string' || tag.indexOf('-') < 1)
    throw new TypeError(misuse('define', 'define-tag', __DEV__ && PROSE['define-tag'](typeof tag === 'string' ? `'${tag}'` : String(tag))));
  if (typeof setup !== 'function') throw new TypeError(misuse('define', 'define-setup', __DEV__ && PROSE['define-setup'](String(setup))));
  if (customElements.get(tag) !== undefined) console.warn(diagnostic('core', `define('${tag}')`, 'define-twice', __DEV__ && PROSE['define-twice'](tag)));
};
