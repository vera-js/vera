import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { initWith } from './init.js';
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
export const define = <M extends Methods = Record<never, never>>(
  target: string | (DefineOptions & { methods?: M & ThisType<ComponentElement & M> }),
  setup: Setup
): DefinedClass<M> => {
  let tag = target as string;
  let options: InitOptions | undefined;
  let methods: M | undefined;
  /** One test, and the tag (and `methods`) read back out (the smaller form: −1 `typeof` in the bundle). */
  if (typeof target !== 'string') ({ tag, methods, ...(options as object) } = (target ?? {}) as DefineOptions & { methods?: M });
  if (__DEV__) {
    checkDefine(tag, setup);
    if (methods) checkMethods(tag, methods, options);
    Object.freeze(options);
  }
  const entry = { o: options, s: setup };
  const Class = class extends HTMLElement {
    connectedCallback() {
      initWith(this as unknown as ComponentElement, entry.o, entry.s);
    }
  };
  /**
   * **Methods: public methods on the generated PROTOTYPE** (Brian, 2026-10-21; +13 B) — one function per tag, nothing per
   * instance; `this` is the element, as in a class. The generated `connectedCallback` and the class's `constructor` are
   * RE-ASSERTED last, so a key of either name in `methods` never replaces them, in either build (development says so).
   * Writing an EXISTING prototype property keeps its attributes (measured 2026-10-21), so both stay non-enumerable, as a
   * class has them; the methods themselves are enumerable, like the element's own interface.
   */
  if (methods) {
    const proto = Class.prototype;
    Object.assign(proto, methods, { constructor: Class, connectedCallback: proto.connectedCallback });
  }
  customElements.define(tag, Class);
  return Class as unknown as DefinedClass<M>;
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
    else if (name in HTMLElement.prototype) console.warn(diagnostic('core', subject, 'define-method-shadows', __DEV__ && PROSE['define-method-shadows'](name)));
  }
};

/** Development: what a misused `define` received, by code, before the platform's own refusal (which throws in both builds). */
const checkDefine = (tag: unknown, setup: unknown) => {
  if (typeof tag !== 'string' || tag.indexOf('-') < 1)
    throw new TypeError(misuse('define', 'define-tag', __DEV__ && PROSE['define-tag'](typeof tag === 'string' ? `'${tag}'` : String(tag))));
  if (typeof setup !== 'function') throw new TypeError(misuse('define', 'define-setup', __DEV__ && PROSE['define-setup'](String(setup))));
  if (customElements.get(tag) !== undefined) console.warn(diagnostic('core', `define('${tag}')`, 'define-twice', __DEV__ && PROSE['define-twice'](tag)));
};
