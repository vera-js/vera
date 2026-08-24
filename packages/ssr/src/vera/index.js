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
import { installShims, registry, hoistedStyles, escapeHtml, escapeStyleText, setRenderingTag } from './shim.js';
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

/**
 * Elements whose content is text, not markup. Anything between their tags is left alone.
 */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/**
 * The index just past the `>` that closes the tag starting at `start`, respecting quoted attribute
 * values.
 *
 * `>` is legal unescaped inside an attribute value, and a regex that stops at the first one cuts
 * the tag in half: `<mark-comp title="x > y">` was read as a tag ending after `x `, giving the
 * component an attribute value of `"x` and leaving ` y">` behind as text next to it.
 */
const tagEnd = (markup, start) => {
  let quote = '';
  for (let i = start + 1; i < markup.length; i++) {
    const char = markup[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i + 1;
  }
  return markup.length;
};

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
const renderedTags = new Set();

/**
 * `href -> tag`, so a component rendered twice is looked up once.
 *
 * `import()` is cached by Node, but awaiting a cached module still builds a promise and yields:
 * 2.36 µs of a 9.5 µs render, measured, which a server pays on every request for a page it has
 * already served. ESM modules are immutable once evaluated, so remembering the answer changes
 * nothing except how long it takes to get it.
 */
const entryTags = new Map();

/**
 * Renders every registered component tag found in `markup` to declarative shadow DOM, spliced in
 * as strings right after each opening tag. Recursion covers components rendered by components.
 */
const renderComponentTags = (markup, depth) => {
  if (depth > MAX_DEPTH) throw new Error(`ssr: component nesting exceeded ${MAX_DEPTH} (cycle?)`);
  /** No dash, no custom element — cheaper to ask than to walk the string and find nothing. */
  if (!markup.includes('-')) return markup;

  let out = '';
  let at = 0;
  while (at < markup.length) {
    const open = markup.indexOf('<', at);
    if (open === -1) {
      out += markup.slice(at);
      break;
    }
    out += markup.slice(at, open);

    /**
     * A comment is text. Markup inside one used to be rendered — a `<!-- <some-comp> -->` produced
     * a whole shadow template inside the comment, which is wasted work at best and breaks the
     * comment at worst.
     */
    if (markup.startsWith('<!--', open)) {
      const close = markup.indexOf('-->', open + 4);
      const stop = close === -1 ? markup.length : close + 3;
      out += markup.slice(open, stop);
      at = stop;
      continue;
    }

    const end = tagEnd(markup, open);
    const tagText = markup.slice(open, end);
    const name = /^<([a-z][\w]*(?:-[\w-]*)?)/.exec(tagText)?.[1];

    /**
     * `<textarea>`, `<script>`, `<style>`, `<title>`: their content is text. A component named
     * inside one was rendered into it, so the markup showed up as the textarea's value or the
     * script's source.
     */
    if (name && RAW_TEXT.has(name)) {
      const closeTag = markup.toLowerCase().indexOf(`</${name}`, end);
      const stop = closeTag === -1 ? markup.length : closeTag;
      out += tagText + markup.slice(end, stop);
      at = stop;
      continue;
    }

    if (name && registry.has(name)) {
      /** Rewritten, not kept — the component may have changed its own attributes. */
      const rendered = renderComponent(name, tagText.slice(1 + name.length, -1), depth + 1);
      out += rendered.open + rendered.inner;
    } else {
      out += tagText;
    }
    at = end;
  }
  return out;
};

/** Instantiates a registered component and returns its declarative-shadow (or light) markup. */
const renderComponent = (tag, attrString, depth) => {
  const element = new (registry.get(tag))();
  element.localName = tag;
  if (attrString) {
    for (const [, name, quoted, single, bare] of attrString.matchAll(ATTRIBUTE)) {
      element.setAttribute(name, decodeEntities(quoted ?? single ?? bare ?? ''));
    }
  }

  renderedTags.add(tag);
  const previousTag = setRenderingTag(tag) ?? tag;
  const pending = element.connectedCallback?.();
  setRenderingTag(previousTag);

  /**
   * Rendering is synchronous end to end — the recursion runs inside `String.replace`, which cannot
   * await — so an `async connectedCallback` returns a promise nobody can wait for, and everything
   * after its first `await` happens long after the markup was serialized. That produced an empty
   * component and said nothing about it, which is the worst of the available outcomes.
   *
   * Load data before `renderToString` and pass it in through attributes.
   */
  if (pending && typeof pending.then === 'function') {
    throw new Error(
      `ssr: <${tag}> has an async connectedCallback, which cannot be awaited during a synchronous ` +
        `render — its markup would be empty. Load data before renderToString and pass it as attributes.`
    );
  }

  const open = element.openTag();
  if (element.shadowRoot) {
    /** Styles are prepended after the scan, never passed through it — see `styleTags`. */
    const inner = renderComponentTags(element.shadowRoot.innerHTML, depth);
    return {
      open,
      inner: `<template shadowrootmode="${element.shadowRoot.mode}">${element.shadowRoot.styleTags()}${inner}</template>`,
    };
  }
  /** Light DOM: rendered content becomes the element's children (client re-render replaces). */
  return { open, inner: renderComponentTags(element.innerHTML, depth) };
};

/**
 * Renders a component module to markup.
 *
 * @param url Module URL (the component's file; Node resolves its imports natively — the
 * `.ts`-via-`.js` convention included)
 * @param options `tag` picks the element when the module defines several; `attributes` sets the
 * entry tag's attributes — **an object, whose values are escaped**; `children` is markup placed
 * inside the entry tag, which is what a `<slot>` renders
 * @return `{ html, styles }` — `styles` collects light-DOM `@scope` sheets for the page shell
 */
export const renderToString = async (url, { tag, attributes = '', children = '' } = {}) => {
  const href = url instanceof URL ? url.href : url;

  /**
   * The import is what registers the component, so it cannot be skipped merely because the caller
   * named a `tag` — a first render with `{ tag }` would then look for a definition nothing had
   * created. `entryTags` having the href is proof the module has already been imported, and that
   * is the only condition under which the import is skipped.
   */
  if (!entryTags.has(href)) {
    const module = await import(href);
    let derived;

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
    for (const exported of [module.default, ...Object.values(module)]) {
      if (typeof exported !== 'function') continue;
      for (const [name, Class] of registry) if (Class === exported) derived = name;
      if (derived) break;
    }
    /** Recorded either way — the entry doubles as "this href has been imported". */
    entryTags.set(href, derived ?? '');
  }

  tag = tag || entryTags.get(href);
  if (!tag || !registry.has(tag)) {
    throw new Error(
      `ssr: no custom element definition found for ${url} — export the component's class, or pass { tag }`
    );
  }

  /**
   * An object is escaped; a string is written through untouched.
   *
   * The string form was the only one, and it is a hole: `attributes` reaches the markup verbatim, so
   * a value taken from a request could close the tag and open a `<script>`. It stays, because a
   * caller may genuinely need to write markup only they can produce, but it is no longer the
   * ordinary way to do the ordinary thing — an object cannot escape the tag it describes.
   */
  const attrString =
    typeof attributes === 'string'
      ? attributes
      : Object.entries(attributes)
          .filter(([, value]) => value != null && value !== false)
          .map(([name, value]) => ` ${name}="${escapeHtml(value === true ? '' : value)}"`)
          .join('');

  /** Synchronous from here, so the per-render bookkeeping below cannot interleave with another. */
  renderedTags.clear();
  /**
   * `children` is what a `<slot>` in the component renders. Without it a component built around a
   * slot could be server-rendered only empty — the entry tag's contents were the shadow template
   * and nothing else.
   */
  const entry = renderComponent(tag, attrString, 0);
  const html = `${entry.open}${entry.inner}${renderComponentTags(children, 0)}</${tag}>`;
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
