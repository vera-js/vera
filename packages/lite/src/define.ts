import { SHARED, camel, checkDefinition, errorOnce, warnOnce } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { queue, render, unlink } from './schedule.js';
import type { Methods, DefinedClass, DefineOptions, LiteElement, WithAttributes } from './types.js';

/** An array or plain-object default is copied per element, as core copies it; nested values stay shared. */
const own = (value: unknown) =>
  Array.isArray(value) ? [...value] : (value as object | null)?.constructor === Object ? { ...(value as object) } : value;

/** Lets go of a component for good: its signals stop queuing it, and a later connect runs its setup again (as core). */
const retire = (element: LiteElement) => {
  unlink(element);
  element._$f$ = undefined;
};

/** Development: an option only core has (`foreignNodes`, `persist`, a module's key, a `ShadowRootInit`), said once per tag and key. */
const checkOptions = (tag: string, options: object) => {
  for (const [key, value] of Object.entries(options))
    if (!['tag', 'props', 'attributes', 'methods', 'shadow'].includes(key) || (key === 'shadow' && ![undefined, false, 'open', 'closed'].includes(value)))
      warnOnce('lite', `define('${tag}')`, 'tier-needs-core', __DEV__ && (() => PROSE['tier-needs-core'](`\`${key}: ${typeof value === 'object' ? 'an object' : String(value)}\``)), `${tag} ${key}`);
};

/**
 * Development: what a setup returned, when it is not a render function — core's words: a value is drawn once (in both
 * packages), a promise is an async setup, which is core's.
 */
const checkSetupResult = (element: LiteElement, out: unknown) => {
  if (typeof (out as PromiseLike<unknown> | null)?.then === 'function')
    warnOnce('lite', `<${element.localName}>`, 'tier-needs-core', __DEV__ && (() => PROSE['tier-needs-core']('an async setup')), element.constructor);
  else if (out !== undefined && typeof out !== 'function') {
    const kind = Array.isArray(out) ? 'an array' : typeof out === 'object' ? 'a template or object' : `a ${typeof out}`;
    errorOnce('lite', `<${element.localName}>`, 'setup-returned-value', __DEV__ && (() => SHARED.setupReturnedValue(kind)), element.constructor);
  }
};

/**
 * **`@verajs/lite`'s `define`**, rendering through its one renderer (`patch.ts`, called by `render` in `schedule.ts`).
 * `@verajs/core`'s call shape — `define(tag, setup)` or `define({ tag, props, attributes, methods, shadow }, setup)` — with the
 * reactivity reduced to a setter: a declared prop is an accessor on the generated prototype over the element's ONE values
 * record (`_$v$`, core's name and meaning), and a write that differs by `Object.is` queues one render. An observed
 * attribute arrives as its camel-cased prop, one way, as in core.
 *
 * - **Setup runs once per life, as core's:** a component removed and re-added in the same task (a move) keeps it; one
 *   still out a microtask later is retired, and its next connect sets it up again. Props survive, as core's do.
 * - **A value set before the tag was defined** is an own property hiding the accessor: handed over through it at connect.
 * - **An own `__proto__` key** (`JSON.parse` makes one) is skipped in props and methods, as core skips it.
 * - **A setup that returns a value, not a render function, draws it once** (core's behavior and core's development error);
 *   one that returns nothing, or a promise (an async setup, core's alone), draws nothing.
 * - An author's `methods.disconnectedCallback` runs first on removal, as core chains it.
 * - Development checks the definition in core's words (`checkDefinition`) and names every option only core has.
 */
export const define = <M extends Methods = Record<never, never>, P extends object = Record<never, never>, A extends readonly string[] = []>(
  target: string | (DefineOptions & { props?: P; attributes?: A; methods?: M & ThisType<HTMLElement & WithAttributes<P, A> & M> }),
  setup: (host: HTMLElement & WithAttributes<P, A> & M) => (() => unknown) | void
): DefinedClass<WithAttributes<P, A> & M> => {
  let tag = target as string;
  let props: object | undefined;
  let attributes: readonly string[] = [];
  let methods: M | undefined;
  let shadow: DefineOptions['shadow'];
  if (typeof target !== 'string') ({ tag, props, attributes = [], methods, shadow } = target);
  if (__DEV__) {
    checkDefinition('lite', tag, setup, methods, props, typeof target === 'string' ? undefined : target.attributes, false);
    if (typeof target !== 'string') checkOptions(tag, target);
  }
  /** Each declared attribute is a prop under its camel name, default `null` unless a declared prop shares it. */
  const camels: Record<string, string> = {};
  const declared: Record<string, unknown> = {};
  for (const name of attributes) declared[(camels[name] = camel(name))] = null;
  const defaults: Record<string, unknown> = { ...declared, ...props };
  const keys = Object.keys(defaults).filter((key) => key !== '__proto__');
  const fill = () => {
    const record: Record<string, unknown> = {};
    for (const key of keys) record[key] = own(defaults[key]);
    return record;
  };
  const write = (element: LiteElement, key: string, value: unknown) => {
    const record = (element._$v$ ??= fill());
    if (!Object.is(record[key], value)) {
      record[key] = value;
      queue(element);
    }
  };
  const Class = class extends HTMLElement {};
  const installed: Record<string, unknown> = { ...methods };
  delete installed.__proto__;
  /** Methods first, so a method named like a callback never replaces one (core's order). */
  Object.assign(Class.prototype, installed, {
    constructor: Class,
    connectedCallback(this: LiteElement) {
      if (this._$f$ === undefined) {
        for (const key of keys)
          if (Object.hasOwn(this, key)) {
            const value = (this as unknown as Record<string, unknown>)[key];
            delete (this as unknown as Record<string, unknown>)[key];
            (this as unknown as Record<string, unknown>)[key] = value;
          }
        /** `shadowRoot` first: a declarative shadow root the server sent is the one to render into. */
        this._$r$ ??= shadow ? (this.shadowRoot ?? this.attachShadow({ mode: shadow })) : this;
        const out: unknown = setup(this as never);
        if (__DEV__) checkSetupResult(this, out);
        /** A promise is an async setup, which is core's: it draws nothing here (development says so). */
        this._$f$ =
          typeof out === 'function'
            ? (out as () => unknown)
            : out === undefined || typeof (out as PromiseLike<unknown>).then === 'function'
              ? null
              : () => out;
      }
      render(this);
    },
    disconnectedCallback(this: LiteElement) {
      (installed.disconnectedCallback as (() => void) | undefined)?.call(this);
      queueMicrotask(() => {
        /** Kept a CALL, never pasted in (CLAUDE.md, the one-caller rule): as this function's only caller, the minifier would substitute it here as an arrow made and invoked on every call — every removal. */
        if (!this.isConnected) /*@__NOINLINE__*/ retire(this);
      });
    },
  });
  /** Observed attributes only on a tag that declares some: every callback a class defines is creation work. */
  if (attributes.length) {
    (Class as unknown as { observedAttributes: readonly string[] }).observedAttributes = attributes;
    (Class.prototype as unknown as { attributeChangedCallback: unknown }).attributeChangedCallback = function (
      this: LiteElement,
      name: string,
      _old: string | null,
      value: string | null
    ) {
      write(this, camels[name]!, value);
    };
  }
  for (const key of keys)
    Object.defineProperty(Class.prototype, key, {
      get(this: LiteElement) {
        return (this._$v$ ??= fill())[key];
      },
      set(this: LiteElement, value: unknown) {
        write(this, key, value);
      },
      configurable: true,
      enumerable: true,
    });
  customElements.define(tag, Class);
  return customElements.get(tag) as unknown as DefinedClass<WithAttributes<P, A> & M>;
};
