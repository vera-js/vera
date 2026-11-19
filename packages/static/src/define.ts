/**
 * **`@verajs/static`'s `define`**: `@verajs/core`'s call shape — `define(tag, setup)` or
 * `define({ tag, props, attributes, methods, shadow }, setup)` — rendered ONCE, by one `innerHTML` write at the first
 * connect (`render.ts`: written, judged by the parser, moved in). No reactivity: a prop or attribute is read when it renders, and a later write changes nothing (a component
 * that must update is `@verajs/lite`'s or `@verajs/core`'s, from the same source).
 *
 * - **Props:** each default is copied per element (an array or plain object, as core copies it); a value set before the
 *   tag was defined is kept. **Attributes** are read once, as their camel-cased props. **Methods** are on the prototype.
 * - **The setup returns a render function or the result itself** (static draws once either way).
 * - **`shadow`** renders into a shadow root — the one a server's declarative shadow root attached, when there is one.
 * - A component moved after it rendered keeps its markup (`_$r$` marks it).
 * - Development checks the definition in core's words (`checkDefinition`) and names an option only lite or core has.
 */
import { camel, checkDefinition, warnOnce } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { renderInto } from './render.js';
import type { DefinedClass, DefineOptions, Methods, StaticElement, WithAttributes } from './types.js';

/** An array or plain-object default, copied per element (core's rule); anything else as it is. */
const own = (value: unknown) =>
  Array.isArray(value) ? [...value] : (value as object | null)?.constructor === Object ? { ...(value as object) } : value;

export const define = <M extends Methods = Record<never, never>, P extends object = Record<never, never>, A extends readonly string[] = []>(
  target: string | (DefineOptions & { props?: P; attributes?: A; methods?: M & ThisType<HTMLElement & WithAttributes<P, A> & M> }),
  setup: (host: HTMLElement & WithAttributes<P, A> & M) => unknown
): DefinedClass<WithAttributes<P, A> & M> => {
  const { tag, props = {}, attributes = [], methods, shadow } = (typeof target === 'string' ? { tag: target } : target) as DefineOptions & {
    props?: Record<string, unknown>;
    attributes?: readonly string[];
    methods?: M;
  };
  if (__DEV__) {
    checkDefinition('static', tag, setup, methods, props, typeof target === 'string' ? undefined : target.attributes, false);
    if (typeof target !== 'string')
      for (const [key, value] of Object.entries(target))
        if (!['tag', 'props', 'attributes', 'methods', 'shadow'].includes(key))
          warnOnce('static', `define('${tag}')`, 'static-needs-renderer', __DEV__ && (() => PROSE['static-needs-renderer'](`\`${key}: ${typeof value === 'object' ? 'an object' : String(value)}\``)), `${tag} ${key}`);
  }
  class Class extends HTMLElement {
    connectedCallback(this: StaticElement) {
      if (this._$r$) return;
      const host = this as unknown as Record<string, unknown>;
      for (const key in props) if (key !== '__proto__' && !Object.hasOwn(this, key)) host[key] = own(props[key]);
      for (const name of attributes) host[camel(name)] = this.getAttribute(name);
      const out = setup(this as never);
      renderInto(typeof out === 'function' ? out() : out, (this._$r$ = shadow ? (this.shadowRoot ?? this.attachShadow({ mode: shadow })) : this));
    }
  }
  /**
   * A method never replaces what the class owns (`connectedCallback`): core's order, and what `define`'s development check
   * says (`define-method-ignored`). A `disconnectedCallback` in methods runs on removal, as core runs it.
   */
  if (methods)
    for (const key of Object.keys(methods))
      if (key !== '__proto__' && !Object.hasOwn(Class.prototype, key)) (Class.prototype as unknown as Record<string, unknown>)[key] = methods[key];
  customElements.define(tag, Class);
  return Class as unknown as DefinedClass<WithAttributes<P, A> & M>;
};
