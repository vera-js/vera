/**
 * The element properties that are a *view of an attribute* — `dataset`, `style`, `classList`, `part`.
 *
 * Each returns an object whose every write goes through to the attribute it reflects, because a
 * plain object would accept `this.dataset.x = 'y'` and lose it. Shared from here rather than written
 * per class: `classList` and `part` are one token list over two attribute names, and having them as
 * two copies is how the shims drifted apart the first time.
 */

import type { ElementShim } from './nodes.js';

/** One declaration of a `style` attribute, by property name: its value and whether it was `!important`. */
type Declaration = { value: string; priority: string };

/**
 * `element.style` as this DOM answers it: `cssText`, the declaration count, the CSSOM methods, and every
 * property by name — camel-cased or custom — read as its value or `''`.
 */
type StyleView = {
  cssText: string;
  readonly length: number;
  setProperty(name: unknown, value: unknown, priority?: unknown): void;
  removeProperty(name: unknown): string;
  getPropertyValue(name: unknown): string;
  getPropertyPriority(name: unknown): string;
  item(index: number): string;
  [property: string]: unknown;
};

/** `backgroundColor` -> `background-color`, for the `style` and `dataset` views below. */
const dashed = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * `dataset` and `style` are **views over an attribute**, not stores of their own: an assignment that
 * does not reach the markup is an assignment the server loses. Written as proxies over the element
 * so `this.dataset.userId = '7'` and `this.style.color = 'red'` end up in the tag, which is what
 * they do in a browser.
 */
export const datasetView = (element: ElementShim): Record<string, string | undefined> =>
  new Proxy(
    {},
    {
      get: (_, key) => element.getAttribute(`data-${dashed(String(key))}`) ?? undefined,
      set: (_, key, value) => (element.setAttribute(`data-${dashed(String(key))}`, value), true),
      deleteProperty: (_, key) => (element.removeAttribute(`data-${dashed(String(key))}`), true),
      has: (_, key) => element.hasAttribute(`data-${dashed(String(key))}`),
    }
  );

/**
 * A `DOMTokenList` over a space-separated attribute — `class` for `classList`, `part` for `part`.
 *
 * Shared because they are the same thing: `classList` was written first and `part` would have been
 * a second copy of it, which is how `ElementShim` and `ShadowRootShim` came to disagree.
 */
export const tokenListView = (element: ElementShim, attribute: string) => {
  const tokens = (): string[] => (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
  /**
   * **Emptying an attribute is not removing it.** A browser leaves `class=""` behind when the last
   * token goes, and only leaves the attribute absent when it was never there to begin with. Removing
   * it outright made the server's markup differ from the client's for an element that had ever
   * carried a class, which is the whole class of difference this package exists not to produce.
   */
  const write = (list: string[]): void => {
    if (list.length) element.setAttribute(attribute, list.join(' '));
    else if (element.hasAttribute(attribute)) element.setAttribute(attribute, '');
  };
  /**
   * A token has to be a token. A browser throws on an empty string and on one containing whitespace,
   * with those two names, and it is worth throwing here for the same reason `connectedCallback` is
   * refused when it is `async`: code that cannot work in the browser should not quietly work here.
   */
  const check = (...names: string[]): void => {
    for (const name of names) {
      if (name === '') throw new DOMException('The token provided must not be empty.', 'SyntaxError');
      if (/\s/.test(String(name)))
        throw new DOMException(
          `The token provided ('${name}') contains HTML space characters, which are not valid in tokens.`,
          'InvalidCharacterError'
        );
    }
  };
  const list = {
    add: (...names: string[]): void => {
      check(...names);
      const current = tokens();
      for (const name of names) if (!current.includes(name)) current.push(name);
      write(current);
    },
    remove: (...names: string[]): void => {
      check(...names);
      write(tokens().filter((token) => !names.includes(token)));
    },
    toggle: (name: string, force?: boolean): boolean => {
      check(name);
      const current = tokens();
      const wanted = force ?? !current.includes(name);
      write(
        wanted ? [...current.filter((token) => token !== name), name] : current.filter((token) => token !== name)
      );
      return wanted;
    },
    /** Replaces in place, and answers `false` without writing when the old token is not there. */
    replace: (oldToken: string, newToken: string): boolean => {
      check(oldToken, newToken);
      const current = tokens();
      const at = current.indexOf(oldToken);
      if (at === -1) return false;
      current[at] = newToken;
      write(current.filter((token, index) => current.indexOf(token) === index));
      return true;
    },
    contains: (name: string): boolean => tokens().includes(name),
    /**
     * `supports` throws for these two lists in every engine — `class` and `part` define no supported
     * tokens, and the spec says a `DOMTokenList` with none raises `TypeError`. Present and throwing
     * is the accurate shim; absent would be a `TypeError` too, but the wrong one.
     */
    supports: (): never => {
      throw new TypeError('supports() is not applicable to this attribute.');
    },
    item: (index: number): string | null => tokens()[index] ?? null,
    forEach: (callback: (token: string, index: number, list: string[]) => void, thisArg?: unknown): void =>
      tokens().forEach(callback, thisArg),
    keys: (): ArrayIterator<number> => tokens().keys(),
    values: (): ArrayIterator<string> => tokens().values(),
    entries: (): ArrayIterator<[number, string]> => tokens().entries(),
    /** `String(el.classList)` is the attribute's value, not `[object Object]`. */
    toString: (): string => element.getAttribute(attribute) ?? '',
    get value(): string {
      return element.getAttribute(attribute) ?? '';
    },
    set value(text: unknown) {
      element.setAttribute(attribute, String(text));
    },
    get length(): number {
      return tokens().length;
    },
    [Symbol.iterator]: (): ArrayIterator<string> => tokens()[Symbol.iterator](),
  };
  /** `list[0]` is indexed access on a real `DOMTokenList`, which a plain object cannot answer. */
  return new Proxy(list, {
    get: (target, key, receiver) =>
      typeof key === 'string' && /^\d+$/.test(key) ? tokens()[Number(key)] : Reflect.get(target, key, receiver),
    has: (target, key) => (typeof key === 'string' && /^\d+$/.test(key) ? Number(key) < tokens().length : key in target),
  });
};

/**
 * The declarations in a `style` attribute, split on the semicolons that actually separate them.
 *
 * **A plain `split(';')` corrupts a value that contains one**, and the common case is not exotic:
 * `background: url("data:image/svg+xml;base64,…")` is how an inline SVG is written, and splitting it
 * produced `background: url("data:image/svg+xml` as one declaration and `base64,…")` as another —
 * so the *markup* came out as `background: url("data:x; color: red;`, an unterminated `url(` with
 * the rest of the declaration eaten. A quoted `;` in `content` did the same.
 *
 * Quotes and parentheses both nest a semicolon, and CSS allows one inside either.
 */
const declarations = (text: string): string[] => {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let at = 0; at < text.length; at++) {
    const ch = text[at];
    if (quote) {
      if (ch === '\\') at++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ';' && depth === 0) {
      out.push(text.slice(start, at));
      start = at + 1;
    }
  }
  out.push(text.slice(start));
  return out;
};

export const styleView = (element: ElementShim): StyleView => {
  /** `[name, value, priority]` per declaration, in source order. */
  const read = (): Map<string, Declaration> => {
    /**
     * A loop rather than `map().filter(Boolean)`: the filter does not narrow, so the entries reach
     * `new Map` typed as `(any[] | null)[]` and the type check rejects them. Building the map directly
     * says the same thing without a cast.
     */
    const rules = new Map<string, Declaration>();
    for (const rule of declarations(element.getAttribute('style') ?? '')) {
      const at = rule.indexOf(':');
      if (at === -1) continue;
      const name = rule.slice(0, at).trim();
      let value = rule.slice(at + 1).trim();
      let priority = '';
      const important = /\s*!\s*important$/i.exec(value);
      if (important) {
        value = value.slice(0, important.index).trim();
        priority = 'important';
      }
      if (name && value) rules.set(name, { value, priority });
    }
    return rules;
  };
  /**
   * Each declaration ends in a semicolon, including the last, because that is what a browser writes
   * into the attribute when you set a property — `style.color = 'red'` gives `style="color: red;"`.
   * Dropping the final one made every component that styles itself disagree with the client on its
   * own host attribute.
   *
   * An emptied `style` stays as `style=""` rather than being removed, for the reason the token list
   * above does the same: a browser removes the declarations, not the attribute.
   */
  const write = (rules: Map<string, Declaration>): void => {
    const text = [...rules]
      .map(([name, { value, priority }]) => `${name}: ${value}${priority ? ' !important' : ''};`)
      .join(' ');
    if (text) element.setAttribute('style', text);
    else if (element.hasAttribute('style')) element.setAttribute('style', '');
  };
  /** A custom property keeps its name verbatim; everything else is camel-cased in JS and dashed in CSS. */
  const cssName = (key: string): string => (key.startsWith('--') ? key : dashed(key));
  const methods = {
    setProperty: (name: unknown, value: unknown, priority: unknown = ''): void =>
      write(read().set(cssName(String(name)), { value: String(value), priority: priority ? 'important' : '' })),
    removeProperty: (name: unknown): string => {
      const rules = read();
      const key = cssName(String(name));
      const previous = rules.get(key)?.value ?? '';
      rules.delete(key);
      write(rules);
      return previous;
    },
    getPropertyValue: (name: unknown): string => read().get(cssName(String(name)))?.value ?? '',
    getPropertyPriority: (name: unknown): string => read().get(cssName(String(name)))?.priority ?? '',
    item: (index: number): string => [...read().keys()][index] ?? '',
  };
  /** The target is never read — every trap answers from the attribute — so it is typed as the proxy's answers. */
  return new Proxy(
    {} as StyleView,
    {
      get: (_, key) => {
        if (key === 'cssText') return element.getAttribute('style') ?? '';
        if (key === 'length') return read().size;
        if (key in methods) return methods[key as keyof typeof methods];
        if (typeof key === 'string' && /^\d+$/.test(key)) return methods.item(Number(key));
        return read().get(cssName(String(key)))?.value ?? '';
      },
      set: (_, key, value) => {
        /** Round-tripped rather than stored verbatim, so `cssText = 'color: red'` normalizes the way a browser does. */
        if (key === 'cssText') {
          element.setAttribute('style', String(value));
          write(read());
        } else if (value === '' || value == null) methods.removeProperty(String(key));
        else write(read().set(cssName(String(key)), { value: String(value), priority: '' }));
        return true;
      },
      has: (_, key) => key === 'cssText' || key === 'length' || key in methods || read().has(cssName(String(key))),
    }
  );
};
