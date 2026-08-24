/**
 * The element properties that are a *view of an attribute* — `dataset`, `style`, `classList`, `part`.
 *
 * Each returns an object whose every write goes through to the attribute it reflects, because a
 * plain object would accept `this.dataset.x = 'y'` and lose it. Shared from here rather than written
 * per class: `classList` and `part` are one token list over two attribute names, and having them as
 * two copies is how the shims drifted apart the first time.
 */

/** `backgroundColor` -> `background-color`, for the `style` and `dataset` views below. */
const dashed = (name) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * `dataset` and `style` are **views over an attribute**, not stores of their own: an assignment that
 * does not reach the markup is an assignment the server loses. Written as proxies over the element
 * so `this.dataset.userId = '7'` and `this.style.color = 'red'` end up in the tag, which is what
 * they do in a browser.
 */
export const datasetView = (element) =>
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
export const tokenListView = (element, attribute) => {
  const tokens = () => (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
  const write = (list) =>
    list.length ? element.setAttribute(attribute, list.join(' ')) : element.removeAttribute(attribute);
  return {
    add: (...names) => {
      const list = tokens();
      for (const name of names) if (!list.includes(name)) list.push(name);
      write(list);
    },
    remove: (...names) => write(tokens().filter((token) => !names.includes(token))),
    toggle: (name, force) => {
      const list = tokens();
      const wanted = force ?? !list.includes(name);
      write(wanted ? [...list.filter((token) => token !== name), name] : list.filter((token) => token !== name));
      return wanted;
    },
    contains: (name) => tokens().includes(name),
    get value() {
      return element.getAttribute(attribute) ?? '';
    },
    get length() {
      return tokens().length;
    },
    [Symbol.iterator]: () => tokens()[Symbol.iterator](),
  };
};

export const styleView = (element) => {
  const read = () =>
    new Map(
      (element.getAttribute('style') ?? '')
        .split(';')
        .map((rule) => rule.split(':'))
        .filter((pair) => pair.length === 2)
        .map(([name, value]) => [name.trim(), value.trim()])
    );
  /**
   * Each declaration ends in a semicolon, including the last, because that is what a browser writes
   * into the attribute when you set a property — `style.color = 'red'` gives `style="color: red;"`.
   * Dropping the final one made every component that styles itself disagree with the client on its
   * own host attribute.
   */
  const write = (rules) => {
    const text = [...rules].map(([name, value]) => `${name}: ${value};`).join(' ');
    if (text) element.setAttribute('style', text);
    else element.removeAttribute('style');
  };
  return new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'cssText') return element.getAttribute('style') ?? '';
        if (key === 'setProperty') return (name, value) => write(read().set(name, value));
        if (key === 'removeProperty') return (name) => { const rules = read(); rules.delete(name); write(rules); };
        return read().get(dashed(String(key))) ?? '';
      },
      set: (_, key, value) => {
        if (key === 'cssText') element.setAttribute('style', String(value));
        else write(read().set(dashed(String(key)), value));
        return true;
      },
    }
  );
};
