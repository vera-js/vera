/**
 * Vera-native SSR. Node resolves the module graph (`import()`), execution registers component classes
 * (through `customElements.define`, which the shim owns), templates flatten through the sigil-aware
 * serializer, and nested components are found by scanning the markup just written for tags the registry
 * knows (`scan.js`) — never by parsing HTML. Client takeover is `@verajs/renderer/hydrate`, which adopts
 * this markup in place, markerless.
 *
 * Import THIS module first — before anything that imports `@verajs/renderer`, which needs the shims at
 * import time.
 *
 * **One render at a time** (`takeTurn`): the per-render state below is module-level, so renders are
 * queued rather than interleaved — synchronous and asynchronous alike. Everything a render touches that
 * outlives it (the location, the document title, static mode) is applied inside that render's turn and
 * restored in one `finally`, so no request can see another's.
 */
import {
  installShims,
  registry,
  hoistedStyles,
  escapeHtml,
  escapeStyleText,
  setRenderingTag,
  beginHoisting,
  flushFrames,
  flushFramesAsync,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
  LOCATION_PARTS,
} from './shim.js';
import { serializeTemplate, serializeValue } from './serializer.js';
import { decode as decodeEntities } from './parse.js';
import { ATTRIBUTE, renderComponentTags } from './scan.js';

installShims();
const { wire, inserts } = await import('@verajs/core');
/** `static styles` are part of what a browser renders, so the server adopts them unconditionally. */
const { styles } = await import('@verajs/styles');
wire([styles]);

/* ── one render's state ──────────────────────────────────────────────────────────────────────── */

/** The tags this render touched — only their hoisted styles reach its page. */
const renderedTags = new Set();

/**
 * **Every failure during a render, from every channel** — a hook (core's `'error'` insert), a frame
 * callback, a `'settle'` handler. Collected rather than swallowed: on a server there is no next render
 * to recover in, and serializing a component whose render threw ships it EMPTY into a 200. Thrown once
 * the walk is over, naming every component that failed. The `'error'` insert is registered at priority
 * 10 so an app's own reporter, at the default 50, is kept beside it.
 */
const failures = [];
const failed = (tag) => (error) => failures.push({ error, tag });
wire({ on: 'error', fn: (error, element) => failed(element?.localName)(error), priority: 10 });

/* ── the server renderer ─────────────────────────────────────────────────────────────────────── */

/**
 * What this renderer last wrote into a container, and what sat in front of it. **`render()` owns its own
 * range** on the client, and that holds over time: content already in the container stays before it, a
 * node appended afterwards stays after it, across every re-render. The string form of a range is the text
 * either side of it.
 */
const written = new WeakMap();

/**
 * A template in, its markup into the container. Anything that is not a template flattens exactly as a
 * child value does — so a returned string is escaped text, as it is on the client.
 */
const serverRenderer = (template, container) => {
  const ours = template?.strings ? serializeTemplate(template) : serializeValue(template);
  const current = container.innerHTML;
  const last = written.get(container);
  /** Still shaped as we left it: our range is where we wrote it. Otherwise it is gone; start at the end. */
  const before = last !== undefined && current.startsWith(last.before + last.ours) ? last.before : current;
  const after = before === current ? '' : current.slice(before.length + last.ours.length);
  container.innerHTML = before + ours + after;
  written.set(container, { before, ours });
};
wire({ on: 'render', fn: serverRenderer, priority: 50 });

/* ── static mode, as a store module ──────────────────────────────────────────────────────────── */

/**
 * **`static: true` — this page will not be interactive, so its stores need not be reactive.** A server
 * render is one shot, and the proxy's tracking is the whole reactivity cost of one: turning it off is
 * worth about 3x, with identical markup. A `'store'` insert wrapping every handler core or a module
 * chooses, so a store's reads during a static render bypass tracking and a WRITE is refused by name —
 * a write would change nothing anyone renders, silently. The flag is read at each operation, because a
 * store module decides once per value and a store must be reactive again the moment the render ends.
 */
let staticRender = false;
const refuseStatic = (prop) =>
  new TypeError(
    `ssr: this render declared itself static, so its stores are not reactive and writing ` +
      `\`${String(prop)}\` would change nothing. Remove \`static: true\` from renderToString, or stop ` +
      `writing to the store during the render.`
  );
wire({
  on: 'store',
  priority: 90,
  fn: (value, handler) =>
    handler && {
      ...handler,
      get: (obj, prop, receiver) => (staticRender || !handler.get ? Reflect.get : handler.get)(obj, prop, receiver),
      set: (obj, prop, next, receiver) => {
        if (staticRender) throw refuseStatic(prop);
        return (handler.set ?? Reflect.set)(obj, prop, next, receiver);
      },
    },
});

/* ── instances ───────────────────────────────────────────────────────────────────────────────── */

/** The slot strategy and settle chain carry members their insert types cannot name. */
const chain = (name) => /** @type {any[]} */ (/** @type {any} */ (inserts).get(name) ?? []);

/**
 * The element a component tag renders as. A component the PARENT built — a child it appended, or the
 * instance its `.prop` bindings were delivered to — arrives as a marker attribute and is rendered as
 * itself, carrying what the parent gave it; the marker must name this very tag. The markup's attributes
 * land on it too (values decoded: they were read back out of markup this module escaped).
 */
const buildInstance = (tag, attrString) => {
  /** `matchAll` copies its regex on every call, so a tag with no attributes — most of them — skips it. */
  const attributes = attrString
    ? [...attrString.matchAll(ATTRIBUTE)].map(([, name, quoted, single, bare]) => [
        name,
        decodeEntities(quoted ?? single ?? bare ?? ''),
      ])
    : [];
  const marker = attributes.find(([name]) => name === INSTANCE_ATTRIBUTE)?.[1];
  const pending = marker === undefined ? undefined : pendingInstances.get(marker);
  const element = pending?.localName === tag ? pending : new (registry.get(tag))();
  /**
   * Unregistered HERE, and only when picked up: a marker is an attribute, so a copy of it can sit on
   * another tag, and unregistering whatever marker an element carries let that copy rob the instance
   * it names of its pickup — rebuilt from the tag, without what the parent gave it.
   */
  if (element === pending) pendingInstances.delete(marker);
  element.localName = tag;
  for (const [name, value] of attributes) element.setAttribute(name, value);
  return element;
};

/**
 * Before the lifecycle: the marker removed, `props` assigned, children placed — where a
 * client parser would already have put them — and, for light-DOM slots, the host's children held out so
 * the slots module can distribute them after the template renders.
 */
const prepareInstance = (element, tag, props, children) => {
  element._rendered = true;
  element.removeAttribute(INSTANCE_ATTRIBUTE);
  if (props)
    for (const [name, value] of Object.entries(props)) {
      /** `__proto__` would REPLACE the element's prototype — `JSON.parse` makes it an ordinary own key. */
      if (name === '__proto__') continue;
      try {
        element[name] = value;
      } catch (error) {
        throw new TypeError(
          `ssr: <${tag}> refused a value from \`props\` — ${String(/** @type {Error} */ (error).message)}. A read-only property ` +
            `cannot be set; pass it as an attribute, or give the class a setter.`
        );
      }
    }
  if (children) element.innerHTML = children;
  if (chain('slot')[0]?._$server$) {
    element._veraSlotSource = [...element.childNodes];
    for (const node of element._veraSlotSource) element.removeChild(node);
  }
  renderedTags.add(tag);
  const previousTag = setRenderingTag(tag);
  element.upgrade();
  return previousTag;
};

/**
 * After the lifecycle: the `'settle'` insert (the tree is final — `@verajs/directives` evaluates
 * declarative directives into the markup here), then light-DOM slots distributed — or a SHADOW host's
 * children put back as they were, since the platform projects those itself — and the element's two
 * halves, still to be scanned for nested components.
 */
const finishInstance = (element, tag, previousTag) => {
  try {
    for (const settle of chain('settle')) settle(element);
  } catch (error) {
    failed(tag)(error);
  }
  setRenderingTag(previousTag);
  const source = element._veraSlotSource;
  if (source !== undefined) {
    element._veraSlotSource = undefined;
    if (element._shadowRoot) for (const node of source) element.appendChild(node);
    else chain('slot')[0]?._$server$?.(element, source);
  }
  const root = element._shadowRoot;
  return { open: element.openTag(), root, shadow: root?.innerHTML ?? '', light: element.innerHTML };
};

/**
 * The element's markup: a declarative shadow template (a CLOSED root is serialized too — the mode governs
 * who can reach in, not what is written) followed by the element's light DOM, or its light DOM alone.
 */
const assemble = ({ open, root }, shadow, light) => ({
  open,
  inner: root ? `<template${root.templateAttributes()}>${root.styleTags()}${shadow}</template>${light}` : light,
});

/** One component tag found by the synchronous scan. */
const emit = (tag, attrString, depth, children) => {
  const { open, inner } = renderInstance(buildInstance(tag, attrString), tag, depth, undefined, children);
  return open + inner;
};

/**
 * The synchronous chain. An `async connectedCallback` returns a promise it cannot wait for — the markup
 * would be empty — so it is refused by name; `renderToStringAsync` is the render that waits.
 */
const renderInstance = (element, tag, depth, props, children) => {
  const previousTag = prepareInstance(element, tag, props, children);
  const pending = element.connectedCallback?.();
  flushFrames(failed(tag));
  if (typeof pending?.then === 'function')
    throw new Error(
      `ssr: <${tag}> has an async connectedCallback, which cannot be awaited during a synchronous render — ` +
        `its markup would be empty. Use renderToStringAsync, or load data first and pass it as attributes.`
    );
  const pieces = finishInstance(element, tag, previousTag);
  return assemble(pieces, renderComponentTags(pieces.shadow, depth, emit), renderComponentTags(pieces.light, depth, emit));
};

/**
 * The asynchronous chain: the lifecycle is awaited and frames drain with the microtask queue running
 * between rounds. The scan stays synchronous — a component tag becomes a placeholder and its render a
 * promise, substituted once everything beneath has settled — so both chains share one parser. The
 * placeholder's name is random per process, so a component's own markup cannot contain one.
 */
const PLACEHOLDER = `vera-async-${crypto.randomUUID()}`;
const PLACEHOLDERS = new RegExp(`${PLACEHOLDER}(\\d+)_`, 'gu');
const scanAsync = async (markup, depth) => {
  const pending = [];
  const scanned = renderComponentTags(markup, depth, (tag, attrString, at, children) => {
    pending.push(renderInstanceAsync(buildInstance(tag, attrString), tag, at, undefined, children).then((r) => r.open + r.inner));
    return `${PLACEHOLDER}${pending.length - 1}_`;
  });
  if (!pending.length) return scanned;
  const parts = await Promise.all(pending);
  return scanned.replace(PLACEHOLDERS, (_, index) => parts[Number(index)]);
};
const renderInstanceAsync = async (element, tag, depth, props, children) => {
  const previousTag = prepareInstance(element, tag, props, children);
  await element.connectedCallback?.();
  await flushFramesAsync(failed(tag));
  const pieces = finishInstance(element, tag, previousTag);
  return assemble(pieces, await scanAsync(pieces.shadow, depth), await scanAsync(pieces.light, depth));
};

/* ── the entry points ────────────────────────────────────────────────────────────────────────── */

/**
 * The options, checked by one table: a wrong one otherwise surfaced as an internal
 * (`markup.includes is not a function`, `Cannot find package 'undefined'`) naming nothing the caller did.
 */
const isUrl = (value) => typeof value === 'string' || value instanceof URL;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @type {Array<[string, (value: any) => boolean, string]>} */
const CHECKS = [
  ['url', isUrl, 'renderToString needs a module URL — a URL or a string'],
  ['tag', (v) => v === undefined || typeof v === 'string', '`tag` must be a custom element name'],
  ['attributes', (v) => typeof v === 'string' || isRecord(v), '`attributes` must be an object of names to values, or a string'],
  ['props', (v) => v === undefined || isRecord(v), '`props` must be an object of properties to assign'],
  ['children', (v) => typeof v === 'string', '`children` must be a markup string'],
  ['seen', (v) => v === undefined || v instanceof Set, '`seen` must be a Set'],
  ['base', (v) => v === undefined || isUrl(v), '`base` must be a URL or a path string'],
  ['location', (v) => v === undefined || isUrl(v), '`location` must be a URL or a path string'],
  ['static', (v) => typeof v === 'boolean', '`static` must be true or false'],
];

/**
 * An attribute NAME that could not come out of one entry: the characters the engines' `setAttribute`
 * refuses, so an object entry can never write a second attribute (`{ 'a=1 onload': v }`) or leave the tag.
 */
const BAD_ATTRIBUTE_NAME = /[\0-\x20"'>/=\x7f]/;
const attributeMarkup = (attributes) =>
  typeof attributes === 'string'
    ? attributes
    : Object.entries(attributes)
        .filter(([, value]) => value != null && value !== false)
        .map(([name, value]) => {
          if (name === '' || BAD_ATTRIBUTE_NAME.test(name))
            throw new TypeError(
              `ssr: \`attributes\` cannot use ${JSON.stringify(name)} as a name — an attribute name may not contain ` +
                `whitespace, a quote, "/", "=" or ">"; setAttribute refuses it in the browser too.`
            );
          return ` ${name}="${escapeHtml(value === true ? '' : value)}"`;
        })
        .join('');

/** `href -> entry tag`, so a module rendered again is not re-imported and re-searched. */
const entryTags = new Map();

/**
 * **One render at a time**, so no render can see another's state — including a synchronous render fired
 * inside an asynchronous one's pause. A failed render must not stop the queue.
 */
let turn = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
const takeTurn = (work) => {
  const mine = turn.then(work);
  turn = mine.then(
    () => undefined,
    () => undefined
  );
  return mine;
};

const renderModule = async (url, options = {}, isAsync) => {
  const { tag: chosen, attributes = '', children = '', props, seen, base, location, static: isStatic = false } = options;
  const given = { url, tag: chosen, attributes, props, children, seen, base, location, static: isStatic };
  for (const [name, valid, message] of CHECKS) if (!valid(given[name])) throw new TypeError(`ssr: ${message}`);
  const href = url instanceof URL ? url.href : url;

  /**
   * **A module URL is bounded to `base` when one is given** — `import()` executes whatever it is handed,
   * and `new URL` has already resolved any `../` by now. Read as a directory whether or not it was written
   * as one: that can only tighten the bound.
   */
  if (base !== undefined) {
    const directory = String(base instanceof URL ? base.href : base);
    const root = new URL('.', directory.endsWith('/') ? directory : `${directory}/`).href;
    if (!href.startsWith(root)) throw new Error(`ssr: refused ${href} — resolves outside ${root}`);
  }

  /** The entry is found by matching the module's EXPORTS to the registry — a registry diff around the
   *  import is unsound once two first renders overlap. */
  if (!entryTags.has(href)) {
    const module = await import(href);
    let found = '';
    for (const exported of [module.default, ...Object.values(module)])
      for (const [name, Class] of registry) if (!found && Class === exported) found = name;
    entryTags.set(href, found);
  }
  const tag = chosen || entryTags.get(href);
  if (!tag || !registry.has(tag))
    throw new Error(`ssr: no custom element definition found for ${url} — export the component's class, or pass { tag }`);
  const attrString = attributeMarkup(attributes);

  /** An app that wired a renderer after this module was imported displaced the server's, and every
   *  component would render empty. */
  if (!inserts.get('render')?.includes(serverRenderer))
    throw new Error(
      'ssr: the server renderer has been replaced — something wired a renderer after @verajs/ssr was imported, ' +
        'and every component would render empty. Guard the client wiring (`if (!globalThis.__veraSsrShimmed)`) ' +
        'or keep it out of the module the server imports.'
    );

  /**
   * The request's globals, applied inside this turn and restored in one `finally`, on every path. The
   * location is saved only when it is replaced: reading every part of it cost more than a small render.
   */
  const place = globalThis.location;
  const title = globalThis.document.title;
  const saved = location === undefined ? undefined : LOCATION_PARTS.map((part) => place[part]);
  if (saved) {
    const next = new URL(String(location), place.href);
    for (const part of LOCATION_PARTS) place[part] = next[part];
  }
  renderedTags.clear();
  failures.length = 0;
  beginHoisting();
  pendingInstances.clear();
  staticRender = isStatic;
  try {
    const element = buildInstance(tag, attrString);
    const { open, inner } = isAsync
      ? await renderInstanceAsync(element, tag, 0, props, children)
      : renderInstance(element, tag, 0, props, children);
    return finishPage(`${open}${inner}</${tag}>`, tag, seen);
  } finally {
    staticRender = false;
    globalThis.document.title = title;
    saved?.forEach((value, i) => (place[LOCATION_PARTS[i]] = value));
  }
};

/**
 * The page: a marker nothing consumed (inside a template, a raw-text element) must not ship; the
 * collected failures throw, naming every component; the styles this render is responsible for come back
 * escaped — the caller places them into a `<style>`, which makes that their render boundary — with each
 * component's styles once across a page of islands that share `seen`; and the title this render set.
 */
const finishPage = (rendered, tag, seen) => {
  const html = pendingInstances.size ? rendered.replaceAll(new RegExp(` ${INSTANCE_ATTRIBUTE}="\\d+"`, 'g'), '') : rendered;
  if (failures.length) {
    const [first] = failures;
    const others = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
    throw new Error(
      `ssr: <${first.tag ?? tag}> threw while rendering${others} — its markup would be empty. ${String(first.error?.message ?? first.error)}`,
      { cause: first.error }
    );
  }
  const css = [];
  for (const done of renderedTags) {
    if (seen?.has(done)) continue;
    seen?.add(done);
    css.push(...(hoistedStyles.get(done) ?? []));
  }
  return { html, styles: css.map(escapeStyleText).join('\n'), title: globalThis.document.title };
};

/**
 * Renders a component module to markup.
 *
 * @param {string | URL} url The component's module URL
 * @param {object} [options]
 * @param {string} [options.tag] Picks the element when the module defines several
 * @param {string | Record<string, unknown>} [options.attributes] The entry tag's attributes — an object,
 * whose values are escaped and whose names are checked; a string is written through untouched (**a sink**:
 * never put request data in the string form)
 * @param {Record<string, unknown>} [options.props] Properties assigned before `connectedCallback` — how
 * structured data reaches a component
 * @param {string} [options.children] Markup placed inside the entry tag — what a `<slot>` renders
 * (**raw markup**, a sink like the string form of `attributes`)
 * @param {Set<string>} [options.seen] Shared across renders so a page of islands ships each component's
 * styles once
 * @param {string | URL} [options.base] A directory the module must resolve inside — pass it whenever any
 * part of `url` came from a request
 * @param {boolean} [options.static] This page will not be interactive: stores skip reactivity (~3x), and a
 * write during the render throws
 * @param {string | URL} [options.location] This request's URL, applied for the render and restored after
 * @return {Promise<{ html: string, styles: string, title: string }>}
 */
export const renderToString = (url, options) => takeTurn(() => renderModule(url, options, false));

/**
 * Renders a component module to markup, **awaiting its lifecycle** — an `async connectedCallback`, and
 * work started inside a frame (a router's first navigation). Same options, same output.
 *
 * @param {string | URL} url @param {object} [options] @return {Promise<{ html: string, styles: string, title: string }>}
 */
export const renderToStringAsync = (url, options) => takeTurn(() => renderModule(url, options, true));

export { registry, serializeTemplate };
