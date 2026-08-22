/**
 * Vera-native SSR — strategy 4. No wcc, no lit, no acorn, no parse5: Node resolves the module
 * graph (`import()`), execution registers component classes (via `customElements.define`, which
 * the shim owns and core's own wrapper passes through), templates flatten through the
 * sigil-aware serializer, and nested components are discovered by scanning emitted markup for
 * tags the registry knows — never by parsing HTML.
 *
 * Import THIS module before anything that imports `@verajs/core` — the shims must exist before
 * core evaluates (core is dynamically imported below for exactly that reason).
 *
 * Client takeover is a re-render in place (the renderer has no `hydrate()` yet — known TODO);
 * for lit-marker hydration, strategy 2 (`@verajs/ssr`) remains available.
 */
import { installShims, registry, hoistedStyles } from './shim.js';
import { serializeTemplate } from './serializer.js';

installShims();
const { setRenderer, insert } = await import('@verajs/core');
/**
 * `static styles` moved out of core in 0.2.0 (`@verajs/styles`). Server rendering must still
 * serialize them — the markup a browser produces includes the component's styles — and nothing on
 * the server cares about the bytes, so SSR wires the adopter unconditionally rather than making
 * every caller remember to.
 *
 * `insert` comes from core, not from `@verajs/inserts`, so the registration lands in the map core
 * actually reads. Exactly why `setRenderer` above is taken from core too.
 */
const { adoptStyles } = await import('@verajs/styles');
insert('init', adoptStyles, 50);

/** The server renderer: template object in, markup into the (shadow) container shim. */
setRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : serializeTemplate(template);
});

/** Opening tags with a dash — only ones the registry knows get rendered. */
const CUSTOM_TAG = /<([a-z][\w]*-[\w-]*)((?:\s[^<>]*)?)>/g;
const ATTRIBUTE = /([\w-]+)(?:="([^"]*)")?/g;

const MAX_DEPTH = 32;

/**
 * Renders every registered component tag found in `markup` to declarative shadow DOM, spliced in
 * as strings right after each opening tag. Recursion covers components rendered by components.
 */
const renderComponentTags = (markup, depth) => {
  if (depth > MAX_DEPTH) throw new Error(`ssr: component nesting exceeded ${MAX_DEPTH} (cycle?)`);
  return markup.replace(CUSTOM_TAG, (match, tag, attrString) => {
    if (!registry.has(tag)) return match;
    return match + renderComponent(tag, attrString, depth + 1);
  });
};

/** Instantiates a registered component and returns its declarative-shadow (or light) markup. */
const renderComponent = (tag, attrString, depth) => {
  const element = new (registry.get(tag))();
  element.localName = tag;
  for (const [, name, value] of attrString.matchAll(ATTRIBUTE)) {
    element.setAttribute(name, value ?? '');
  }
  element.connectedCallback?.();

  if (element.shadowRoot) {
    const inner = renderComponentTags(element.shadowRoot.serialize(), depth);
    return `<template shadowrootmode="${element.shadowRoot.mode}">${inner}</template>`;
  }
  /** Light DOM: rendered content becomes the element's children (client re-render replaces). */
  return renderComponentTags(element.innerHTML, depth);
};

/**
 * Renders a component module to markup.
 *
 * @param url Module URL (the component's file; Node resolves its imports natively — the
 * `.ts`-via-`.js` convention included)
 * @param options `tag` picks the element when the module defines several; `attributes` is a
 * string of attributes for the entry tag
 * @return `{ html, styles }` — `styles` collects light-DOM `@scope` sheets for the page shell
 */
export const renderToString = async (url, { tag, attributes = '' } = {}) => {
  const before = new Set(registry.keys());
  const module = await import(url instanceof URL ? url.href : url);

  if (!tag) {
    if (module.default) {
      for (const [name, Class] of registry) if (Class === module.default) tag = name;
    }
    if (!tag) {
      for (const name of registry.keys()) if (!before.has(name)) tag = name;
    }
  }
  if (!tag || !registry.has(tag)) {
    throw new Error(`ssr: no custom element definition found for ${url} — pass { tag }`);
  }

  const attrs = attributes ? ` ${attributes}` : '';
  const html = `<${tag}${attrs}>${renderComponent(tag, attributes, 0)}</${tag}>`;
  return { html, styles: hoistedStyles.join('\n') };
};

export { registry, hoistedStyles, serializeTemplate };
