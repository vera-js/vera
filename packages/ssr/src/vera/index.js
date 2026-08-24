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
 * Client takeover is `@verajs/renderer/hydrate`, which adopts this markup in place — markerless,
 * so nothing here carries framework comments. (This comment used to say the renderer had no
 * `hydrate()` yet and point at a "strategy 2"; both stopped being true when that entry shipped.)
 */
import { installShims, registry, hoistedStyles, escapeStyleText, setRenderingTag } from './shim.js';
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

/**
 * `name`, `name="v"`, `name='v'` and `name=v` — every form an author may have written.
 *
 * Only the double-quoted form used to be recognised. `<x-y a='one' b=two>` gave the child three
 * empty attributes *and invented two more*, because the value text fell through to the next
 * iteration and matched as a name.
 */
const ATTRIBUTE = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Numeric and the five named references — everything `escapeHtml` can emit, plus what authors write. */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/**
 * Attribute values arrive **escaped**, because they were read back out of markup this module just
 * wrote. Handing that to `setAttribute` gave a nested component `Tom &#38; Jerry` where the parent
 * had passed `Tom & Jerry`, and re-escaping on the way out produced `Tom &#38;#38; Jerry` — entity
 * codes visible on the page, and a mismatch against whatever the client computes on hydration.
 */
const decodeEntities = (value) =>
  value.replace(/&#(\d+);|&([a-zA-Z]+);/g, (match, code, name) =>
    code ? String.fromCharCode(Number(code)) : (NAMED_ENTITIES[name] ?? match)
  );

const MAX_DEPTH = 32;

/** Tags rendered during the current `renderToString`, so only their styles reach the page shell. */
let renderedTags = new Set();

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
  for (const [, name, quoted, single, bare] of attrString.matchAll(ATTRIBUTE)) {
    element.setAttribute(name, decodeEntities(quoted ?? single ?? bare ?? ''));
  }

  renderedTags.add(tag);
  const previousTag = setRenderingTag(tag) ?? tag;
  element.connectedCallback?.();
  setRenderingTag(previousTag);

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
  const module = await import(url instanceof URL ? url.href : url);

  /**
   * The entry tag is found by matching this module's **exports** against the registry, never by
   * diffing the registry around the import.
   *
   * The diff was unsound the moment two renders overlapped, which for a server is the normal
   * condition: both snapshot the registry, both await their import, and both then see both
   * modules' registrations as "new" — so a request for one component was answered with another's
   * markup. Verified before the change: concurrent renders of `race-a` and `race-b` both returned
   * `race-b`. Identity matching depends on nothing outside the module being asked about.
   */
  if (!tag) {
    for (const exported of [module.default, ...Object.values(module)]) {
      if (typeof exported !== 'function') continue;
      for (const [name, Class] of registry) if (Class === exported) tag = name;
      if (tag) break;
    }
  }
  if (!tag || !registry.has(tag)) {
    throw new Error(
      `ssr: no custom element definition found for ${url} — export the component's class, or pass { tag }`
    );
  }

  /** Synchronous from here, so the per-render bookkeeping below cannot interleave with another. */
  renderedTags = new Set();
  const attrs = attributes ? ` ${attributes}` : '';
  const html = `<${tag}${attrs}>${renderComponent(tag, attributes, 0)}</${tag}>`;
  /**
   * Escaped on the way out. The caller places this string themselves — typically into a `<style>`
   * in their page shell — which makes that their render boundary, and handing them CSS that can
   * close the element is handing them an XSS. The escape is transparent to the CSS parser, so
   * there is no reason to make it their problem.
   */
  const styles = [];
  for (const rendered of renderedTags) for (const css of hoistedStyles.get(rendered) ?? []) styles.push(css);
  return { html, styles: styles.map(escapeStyleText).join('\n') };
};

export { registry, hoistedStyles, serializeTemplate };
