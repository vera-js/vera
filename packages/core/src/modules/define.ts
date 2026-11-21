import { checkDefinition } from '@verajs/shared-utils';
import { initWith } from './init.js';
import { filledOf } from './adoptProps.js';
import type { ComponentElement, DefinedClass, DefineOptions, InitOptions, Methods, Setup, WithAttributes } from '../types.js';
import { seams } from '../services/seams.js';

/**
 * **`define(tag, setup)` / `define({ tag, …options }, setup)` — a component without writing a class** (Brian
 * 2026-10-21). One ENTRY per tag, built once: the options as `init` receives them (a copy without `tag`) and the setup.
 *
 * - **The setup lives OFF the options object** (`entry.s`), so every `'init'` insert sees exactly today's options — the
 *   development unknown-option check (core's keys + the modules' claims) is unchanged, and no `tag` or `setup` key leaks
 *   to a module. It is the swap seam: the dev module replaces `entry.s`; production carries no swap code.
 * - **The generated class defines ONE callback.** Core's `customElements.define` wrapper (init.ts) installs
 *   `connectedCallback` and `disconnectedCallback` on every class it is handed — move-keeping, the cross-document rule
 *   and the one teardown (`retireElement`) — and calls the class's own inside them; a teardown of the class's own would
 *   retire every removed element TWICE (2026-10-21). Every callback a class defines is also per-instance
 *   creation work (CLAUDE.md: `adoptedCallback`, +7.4%).
 * - **`initWith` is not touched:** Firefox charges custom-element creation for `initWith`'s SIZE (BROWSER-LEDGER
 *   2026-10-21), so everything `define` adds lives here, per tag.
 * - **The STRING form passes no options** — the ordinary path's one comparison, no object read. The object form passes
 *   the rest of its keys, an EMPTY object when it names only the tag (normalizing it to `undefined` costs bytes for one
 *   property miss per connect; 2026-10-21).
 * - The options copy is frozen in development: it is shared by every instance of the tag, so a module that wrote to it
 *   would leak state between them — it throws there instead (no package writes it, checked 2026-10-21).
 */
export const define = <M extends Methods = Record<never, never>, P extends object = Record<never, never>, A extends readonly string[] = []>(
  target: string | (DefineOptions & { props?: P; attributes?: A; methods?: M & ThisType<ComponentElement & WithAttributes<P, A> & M> }),
  setup: (host: ComponentElement & WithAttributes<P, A> & M) => unknown
): DefinedClass<WithAttributes<P, A> & M> => {
  let tag = target as string;
  let options: InitOptions | undefined;
  let methods: M | undefined;
  let props: Record<string, unknown> | undefined;
  let attributes: readonly string[] | undefined;
  let register: boolean | undefined;
  let formAssociated: boolean | undefined;
  /** One test, and the tag (and `methods`, `props`, `attributes`) read back out (the smaller form: −1 `typeof`). */
  if (typeof target !== 'string')
    ({ tag, methods, props, attributes, register, formAssociated, ...(options as object) } = (target ?? {}) as DefineOptions & {
      methods?: M;
      props?: Record<string, unknown>;
      attributes?: readonly string[];
    });
  /** A class not registered here cannot be a second definition of its tag, so `register: false` is quiet as hot is. */
  if (__DEV__) checkDefinition('core', tag, setup, methods, props, attributes, !!seams.$hot || register === false);
  /**
   * **Declared attributes** (Brian 2026-10-21: the platform way, `observedAttributes` — no MutationObserver):
   * each arrives as a PROP under its camel-cased name (`data-count` → `dataCount`), `string | null`, so attributes and
   * props are ONE path — the same accessors, the same store, the same hand-over. A name a declared prop also has SHARES
   * that prop (its default applies until the attribute appears); any other gets the default `null`. One way only:
   * attributes → props; a prop write never touches the attribute (no reflection). Removal writes `null`, not the default.
   * The camel name is written out here, not taken from `services/camel.ts` (its twin, which the checks and the small
   * tiers share): through the helper, core's production bundle measured +8 B gz and a different hash (2026-11-17).
   */
  const camels: Record<string, string> = {};
  if (attributes?.length) {
    const declared: Record<string, unknown> = {};
    for (const name of attributes) declared[(camels[name] = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()))] = null;
    props = { ...declared, ...props };
  }
  if (__DEV__) Object.freeze(options);
  const entry = { o: options, s: setup as Setup };
  let adoptPending: ((element: ComponentElement) => void) | undefined;
  /**
   * The declared names, once per tag: the connect-time pre-upgrade hand-over walks only these (none: no loop at all).
   * An own `__proto__` key (`JSON.parse` makes one; an object literal never does) is skipped in both builds, props
   * and methods alike: assigned onto the record or the class it would replace a prototype instead of adding a key.
   * Development says so (`define-proto-key`, `checkProps` / `checkMethods`).
   */
  const keys = props && Object.keys(props).filter((key) => key !== '__proto__');
  /**
   * **ONE assign builds the prototype** — `methods` (public methods: one function per tag, nothing per instance; `this` is
   * the element, as in a class; Brian 2026-10-21), then the class's `constructor` and the generated `connectedCallback`
   * LAST, so a key of either name in `methods` never replaces them, in either build (development says so).
   * - Writing an EXISTING prototype property keeps its attributes (measured): `constructor` stays non-enumerable, as a
   *   class has it. `connectedCallback` and the methods are NEW properties, so they are ENUMERABLE — unlike a class
   *   component's — the one-assign form being 11 B smaller than a class body plus a re-assert (6264 vs 6275 gz),
   *   so it was taken. No platform behavior reads it: the registry captures callbacks by [[Get]] at define time; code walking
   *   the prototype already sees every WebIDL member, all enumerable.
   */
  const Class = class extends HTMLElement {};
  /** A spread copies an own `__proto__` as a plain key (it DEFINES); deleting it then leaves only the methods. */
  const installed = { ...methods };
  delete installed.__proto__;
  Object.assign(Class.prototype, installed, {
    constructor: Class,
    connectedCallback(this: ComponentElement) {
      /**
       * **A value set before the tag was defined** (`el.heading = …` on an element made before `define` ran) is an OWN
       * data property, which hides the prototype accessor: handed over through the setter, before the setup runs. Only
       * declared names; `Object.hasOwn`, never `in`. Here, never in `initWith` (Firefox charges its size, measured).
       * A fresh element has no own enumerable property at all: one `Object.keys` guards the per-name test (measured).
       */
      if (keys && Object.keys(this).length !== 0)
        for (const key of keys)
          if (Object.hasOwn(this, key)) {
            const value = (this as unknown as Record<string, unknown>)[key];
            delete (this as unknown as Record<string, unknown>)[key];
            (this as unknown as Record<string, unknown>)[key] = value;
          }
      /** Adopted values pending on a define element — build the store with its defaults first. */
      adoptPending?.(this);
      initWith(this, entry.o, entry.s);
    },
  });
  /**
   * **Declared props** (Brian 2026-10-21: optional, names and defaults): a get/set pair per name on the
   * PROTOTYPE, backed by the element's ONE props store — `createStore(_$raw$)`, the store `adoptProps` keeps — so a write
   * from anywhere (a template, plain JS after connect, another framework) is a store write and the render that read it
   * repaints. ONE STORE, TWO VIEWS: this getter reads through the PROXY (tracked, for the component's own hooks); the
   * renderer's `!name` compare reads the raw TARGET (untracked — a parent's commit is never subscribed to a child).
   * - **Defaults are LAZY: creation pays nothing.** The first touch of ANY declared prop (a read or a write) writes every
   *   default the element does not hold into the RAW target (no notification) — reads after it go through the proxy,
   *   which subscribes the reader. An array or plain-object default is shallow-copied there, per element (`items: []`
   *   gives each its own list; nested values stay shared). `Object.hasOwn`, never `in`: a prop named `toString` would
   *   otherwise find Object.prototype's.
   * - Binding a value EQUAL to the default writes once, then matches; pinned.
   * - Assigned after `methods`, so a prop of a method's name wins (development says so).
   */
  if (keys) {
    /**
     * **The element's props store, CACHED on it** (measured: reading through `createStore` — a WeakMap lookup per
     * access, createProxy.ts — cost the parent-passes-new-props row +2.6% and the defaults row +11.8% on Chrome; the
     * alternative was written down before the run), built at the FIRST touch of any declared prop, which also writes
     * every missing default at once into the raw target (no notification), so no read pays a `hasOwn`. The cached proxy
     * points at the raw record only — no back-pointer to the element, so no DOM↔JS cycle for Firefox's collector.
     * - **A LITERAL, sigiled name (`_$v$`, "values"), never a computed key** — never `_$p$`, a RETIRED core field (the
     *   priority Sets, since removed): reusing it would give one name two meanings across versions. Firefox reads a DOM object's field by a computed key
     *   (`this[KEY]`, a Symbol OR a per-copy string) ~7% slower than by a literal name in the attribute-write path
     *   (headless: 244 / 251 vs 229 ms; Chrome no difference; BROWSER-LEDGER 2026-10-21). Sigiled, so no bundle mangles
     *   it. Shared by every copy of core on a page by design, as `_$raw$` is — and safe: an element has ONE class, and
     *   only that tag's generated accessors (one copy's) ever touch its `_$v$`.
     */
    const copies = keys.map((key) => {
      const value = props![key];
      return Array.isArray(value) ? 1 : (value as object)?.constructor === Object ? 2 : 0;
    });
    /**
     * The tag's DEFAULTS filler, on its prototype — `propsOf` (core's one props store, shared with adopted props) calls it
     * the first time it builds the store: the usual case, no record yet, gets it in ONE allocation from the defaults (as a
     * class's store literal is), then copies only the array/object defaults; a record already started (an adopted key, or
     * the copy core's teardown left) gets only the missing ones.
     */
    const fillDefaults = (record: Record<string, unknown> | undefined) => {
      const fill = record !== undefined;
      const raw = fill ? record : { ...props };
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        if (fill ? !Object.hasOwn(raw, key) : copies[i] !== 0) {
          const value = props![key];
          raw[key] = copies[i] === 1 ? [...(value as unknown[])] : copies[i] === 2 ? { ...(value as object) } : value;
        }
      }
      return raw;
    };
    const store = (element: ComponentElement) => filledOf(element, fillDefaults);
    adoptPending = (element: ComponentElement) => { if (element._$props$ !== undefined) store(element); };
    /**
     * The callback writes the STORE, not `this[name]`: an element given a property before the tag was defined still holds
     * it as an OWN data property at upgrade, when the platform delivers the attributes — `this[name] =` would overwrite
     * that own value and the attribute would win; through the store, the connect-time hand-over then moves the property's
     * value in, so a PROPERTY set before upgrade beats the markup's attribute (pinned).
     *
     * Observed attributes: the callbacks exist ONLY on a tag that declares some — an observed attribute is per-element
     * engine work, and every callback a class defines is creation work. Assigned after `methods`, so it wins over
     * a method of the same name (development says so). The platform calls it before `connectedCallback` for attributes
     * present at upgrade: that is a write through the setter before the setup runs, which the store handles.
     */
    if (attributes?.length) {
      (Class as unknown as { observedAttributes: readonly string[] }).observedAttributes = attributes;
      (Class.prototype as unknown as { attributeChangedCallback: unknown }).attributeChangedCallback = function (
        this: ComponentElement,
        name: string,
        _old: string | null,
        value: string | null
      ) {
        ((this as { _$v$?: Record<string, unknown> })._$v$ ?? store(this))[camels[name]!] = value;
      };
    }
    for (const key of keys)
      Object.defineProperty(Class.prototype, key, {
        get(this: ComponentElement) {
          return ((this as { _$v$?: Record<string, unknown> })._$v$ ?? store(this))[key];
        },
        set(this: ComponentElement, value: unknown) {
          ((this as { _$v$?: Record<string, unknown> })._$v$ ?? store(this))[key] = value;
        },
        configurable: true,
        enumerable: true,
      });
  }
  /**
   * **`formAssociated: true`**: the platform's static, set before the class is registered (it reads it there, once). The form
   * callbacks (`formResetCallback`, `formDisabledCallback`, `formStateRestoreCallback`, `formAssociatedCallback`) are
   * `methods`, which the platform reads off the prototype at the same moment. A class without it is unchanged: no callback
   * and no static, so a non-form element's creation does no form work.
   */
  if (formAssociated) (Class as unknown as { formAssociated: boolean }).formAssociated = true;
  /** `register: false`: the built class itself, for the caller to register (which class `new` then constructs is theirs). */
  if (register === false) return Class as unknown as DefinedClass<WithAttributes<P, A> & M>;
  customElements.define(tag, Class);
  /**
   * The REGISTERED class, not the local one (Brian 2026-10-22, +4 B gz): the same in every first define, and on a
   * development redefine — which `@verajs/hot` turns into a swap, so this local class is never registered — the one
   * `new` can construct and `instanceof` answers for.
   */
  return customElements.get(tag) as unknown as DefinedClass<WithAttributes<P, A> & M>;
};
