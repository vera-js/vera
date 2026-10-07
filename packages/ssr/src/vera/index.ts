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
  beginBudget,
  bounded,
  endBudget,
  pendingDefinitionNames,
  resetPendingDefinitions,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
  LOCATION_PARTS,
} from './shim.js';
import { serializeTemplate, serializeValue } from './serializer.js';
import { decode as decodeEntities } from './parse.js';
import { ATTRIBUTE, renderComponentTags } from './scan.js';
import type { InsertFunctionMap, SettleInsert, SlotInsert } from '@verajs/core';
import { distributeLight } from './slots.js';
import type { ElementShim } from './nodes.js';
import { thrownMessage } from './escaping.js';
import type { SsrRenderOptions, SsrRenderResult, SsrTemplate } from './types.js';

/**
 * A component instance as a render drives it: the shim its class extends, plus what the class may
 * declare and what this module hangs on it between the two halves of the lifecycle.
 */
interface ComponentInstance extends ElementShim {
  connectedCallback?: () => unknown;
  /** The host's own children, held out of the template render for the light-DOM slots module. */
  _veraSlotSource?: SlotSource;
}

/** A host's children, held out of its render for the light-DOM slots distributor (`slots.ts`). */
type SlotSource = ElementShim['childNodes'][number][];

/** The chains this module reads, typed as it reads them — `'slot'` only as a marker: light-DOM slots are wired. */
type ServerChains = { slot: SlotInsert; settle: SettleInsert };

/** One failure collected during a render, and the component it happened in. */
type Failure = { error: unknown; tag: string | undefined };

/** A component's markup before assembly: its open tag, its shadow root, and its two halves. */
type Pieces = { open: string; root: ElementShim['_shadowRoot']; shadow: string; light: string };

/** A component's markup, assembled: the open tag, and everything between it and the close tag. */
type Assembled = { open: string; inner: string };

/** An option `CHECKS` validates, or the module URL. */
type Checked = keyof SsrRenderOptions | 'url';

installShims();
const { wire, inserts } = await import('@verajs/core');
/** `static styles` are part of what a browser renders, so the server adopts them unconditionally. */
const { styles } = await import('@verajs/styles');
wire([styles]);

/* ── one render's state ──────────────────────────────────────────────────────────────────────── */

/** The tags this render touched — only their hoisted styles reach its page. */
const renderedTags = new Set<string>();

/** The components whose wait the render's `timeout` cut — named by the warning, which otherwise named only the page. */
const timedOut = new Set<string>();

/**
 * **Every failure during a render, from every channel** — a hook (core's `'error'` insert), a frame
 * callback, a `'settle'` handler. Collected rather than swallowed: on a server there is no next render
 * to recover in, and serializing a component whose render threw ships it EMPTY into a 200. Thrown once
 * the walk is over, naming every component that failed. The `'error'` insert is registered at priority
 * 10 so an app's own reporter, at the default 50, is kept beside it.
 */
const failures: Failure[] = [];
const failed = (tag: string | undefined) => (error: unknown) => failures.push({ error, tag });
wire({ on: 'error', fn: (error: unknown, element?: HTMLElement) => failed(element?.localName)(error), priority: 10 });

/* ── the server renderer ─────────────────────────────────────────────────────────────────────── */

/**
 * What this renderer last wrote into a container, and what sat in front of it. **`render()` owns its own
 * range** on the client, and that holds over time: content already in the container stays before it, a
 * node appended afterwards stays after it, across every re-render. The string form of a range is the text
 * either side of it.
 */
const written = new WeakMap<HTMLElement, { before: string; ours: string }>();

/**
 * A template in, its markup into the container. Anything that is not a template flattens exactly as a
 * child value does — so a returned string is escaped text, as it is on the client.
 */
const serverRenderer = (template: unknown, container: HTMLElement): void => {
  const ours = (template as Partial<SsrTemplate> | null | undefined)?.strings
    ? serializeTemplate(template as SsrTemplate)
    : serializeValue(template);
  const current = container.innerHTML;
  const last = written.get(container);
  /** Still shaped as we left it: our range is where we wrote it. Otherwise it is gone; start at the end. */
  const before = last !== undefined && current.startsWith(last.before + last.ours) ? last.before : current;
  const after = before === current ? '' : current.slice(before.length + last!.ours.length);
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
 * store module decides once per type and a store must be reactive again the moment the render ends.
 */
let staticRender = false;
const refuseStatic = (prop: string | symbol) =>
  new TypeError(
    `ssr: this render declared itself static, so its stores are not reactive and writing ` +
      `\`${String(prop)}\` would change nothing. Remove \`static: true\` from renderToString, or stop ` +
      `writing to the store during the render.`
  );
/**
 * One static-aware handler per handler it wraps, never one per value: a copy per value cost a small
 * render about 1.2 µs (a fifth of it) in allocation, and gave every nested proxy a handler of its own.
 */
const staticAware = new WeakMap<ProxyHandler<object>, ProxyHandler<object>>();
const makeStaticAware = (handler: ProxyHandler<object>): ProxyHandler<object> => {
  const { get = Reflect.get, set = Reflect.set } = handler;
  return {
    ...handler,
    get: (obj: object, prop: string | symbol, receiver: unknown) =>
      (staticRender ? Reflect.get : get)(obj, prop, receiver),
    set: (obj: object, prop: string | symbol, next: unknown, receiver: unknown) => {
      if (staticRender) throw refuseStatic(prop);
      return set(obj, prop, next, receiver);
    },
  };
};
wire({
  on: 'store',
  priority: 90,
  fn: (type: string, handler: ProxyHandler<object> | undefined) => {
    if (!handler) return handler;
    let aware = staticAware.get(handler);
    if (!aware) staticAware.set(handler, (aware = makeStaticAware(handler)));
    return aware;
  },
});

/* ── instances ───────────────────────────────────────────────────────────────────────────────── */

/** The chains, typed as this module reads them. */
const chain = <K extends keyof ServerChains>(name: K) =>
  (inserts.get(name as keyof InsertFunctionMap) ?? []) as unknown as ServerChains[K][];

/**
 * The element a component tag renders as. A component the PARENT built — a child it appended, or the
 * instance its `.prop` bindings were delivered to — arrives as a marker attribute and is rendered as
 * itself, carrying what the parent gave it; the marker must name this very tag. The markup's attributes
 * land on it too (values decoded: they were read back out of markup this module escaped).
 */
const buildInstance = (tag: string, attrString: string): ComponentInstance => {
  /** A tag with no attributes — most of them — does no attribute work at all (`matchAll` copies its regex). */
  const attributes = attrString
    ? [...attrString.matchAll(ATTRIBUTE)].map(([, name, quoted, single, bare]): [string, string] => [
        name,
        decodeEntities(quoted ?? single ?? bare ?? ''),
      ])
    : undefined;
  const marker = attributes?.find(([name]) => name === INSTANCE_ATTRIBUTE)?.[1];
  const pending = marker === undefined ? undefined : pendingInstances.get(marker);
  const element = (pending?.localName === tag ? pending : new (registry.get(tag)!)()) as ComponentInstance;
  /**
   * Unregistered HERE, and only when picked up: a marker is an attribute, so a copy of it can sit on
   * another tag, and unregistering whatever marker an element carries let that copy rob the instance
   * it names of its pickup — rebuilt from the tag, without what the parent gave it.
   */
  if (element === pending) pendingInstances.delete(marker!);
  element.localName = tag;
  if (attributes) for (const [name, value] of attributes) element.setAttribute(name, value);
  return element;
};

/**
 * Before the lifecycle: the marker removed, `props` assigned, children placed — where a
 * client parser would already have put them — and, for light-DOM slots, the host's children held out so
 * the slots module can distribute them after the template renders.
 */
const prepareInstance = (
  element: ComponentInstance,
  tag: string,
  props: Record<string, unknown> | undefined,
  children: string | undefined
): string => {
  element._rendered = true;
  element.removeAttribute(INSTANCE_ATTRIBUTE);
  if (props)
    for (const [name, value] of Object.entries(props)) {
      /** `__proto__` would REPLACE the element's prototype — `JSON.parse` makes it an ordinary own key. */
      if (name === '__proto__') continue;
      try {
        (element as unknown as Record<string, unknown>)[name] = value;
      } catch (error) {
        throw new TypeError(
          `ssr: <${tag}> refused a value from \`props\` — ${thrownMessage(error)}. A read-only property ` +
            `cannot be set; pass it as an attribute, or give the class a setter.`,
          { cause: error }
        );
      }
    }
  if (children) element.innerHTML = children;
  if (chain('slot').length > 0) {
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
const finishInstance = (element: ComponentInstance, tag: string, previousTag: string): Pieces => {
  try {
    for (const settle of chain('settle')) settle(element as unknown as HTMLElement);
  } catch (error) {
    failed(tag)(error);
  }
  setRenderingTag(previousTag);
  const source = element._veraSlotSource;
  if (source !== undefined) {
    element._veraSlotSource = undefined;
    if (element._shadowRoot) for (const node of source) element.appendChild(node);
    else distributeLight(element, source);
  }
  const root = element._shadowRoot;
  return { open: element.openTag(), root, shadow: root?.innerHTML ?? '', light: element.innerHTML };
};

/**
 * The element's markup: a declarative shadow template (a CLOSED root is serialized too — the mode governs
 * who can reach in, not what is written) followed by the element's light DOM, or its light DOM alone.
 */
const assemble = ({ open, root }: Pieces, shadow: string, light: string): Assembled => ({
  open,
  inner: root ? `<template${root.templateAttributes()}>${root.styleTags()}${shadow}</template>${light}` : light,
});

/** One component tag found by the synchronous scan. */
const emit = (tag: string, attrString: string, depth: number, children: string | undefined): string => {
  const { open, inner } = renderInstance(buildInstance(tag, attrString), tag, depth, undefined, children);
  return open + inner;
};

/**
 * The synchronous chain. An `async connectedCallback` returns a promise it cannot wait for — the markup
 * would be empty — so it is refused by name; `renderToStringAsync` is the render that waits.
 */
const renderInstance = (
  element: ComponentInstance,
  tag: string,
  depth: number,
  props: Record<string, unknown> | undefined,
  children: string | undefined
): Assembled => {
  const previousTag = prepareInstance(element, tag, props, children);
  const pending = element.connectedCallback?.() as { then?: unknown } | null | undefined;
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
const scanAsync = async (markup: string, depth: number): Promise<string> => {
  const pending: Promise<string>[] = [];
  const scanned = renderComponentTags(markup, depth, (tag: string, attrString: string, at: number, children?: string) => {
    pending.push(renderInstanceAsync(buildInstance(tag, attrString), tag, at, undefined, children).then((r) => r.open + r.inner));
    return `${PLACEHOLDER}${pending.length - 1}_`;
  });
  if (!pending.length) return scanned;
  const parts = await Promise.all(pending);
  return scanned.replace(PLACEHOLDERS, (_: string, index: string) => parts[Number(index)]);
};
const renderInstanceAsync = async (
  element: ComponentInstance,
  tag: string,
  depth: number,
  props: Record<string, unknown> | undefined,
  children: string | undefined
): Promise<Assembled> => {
  const previousTag = prepareInstance(element, tag, props, children);
  const cut = await bounded(element.connectedCallback?.());
  if ((await flushFramesAsync(failed(tag))) || cut) timedOut.add(tag);
  const pieces = finishInstance(element, tag, previousTag);
  return assemble(pieces, await scanAsync(pieces.shadow, depth), await scanAsync(pieces.light, depth));
};

/* ── the entry points ────────────────────────────────────────────────────────────────────────── */

/**
 * The options, checked by one table: a wrong one otherwise surfaced as an internal
 * (`markup.includes is not a function`, `Cannot find package 'undefined'`) naming nothing the caller did.
 */
const isUrl = (value: unknown): value is string | URL => typeof value === 'string' || value instanceof URL;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const CHECKS: Array<{ name: Checked; valid: (value: unknown) => boolean; message: string }> = [
  { name: 'url', valid: isUrl, message: 'renderToString needs a module URL — a URL or a string' },
  {
    name: 'tag',
    valid: (v) => v === undefined || typeof v === 'string',
    message: '`tag` must be a custom element name',
  },
  {
    name: 'attributes',
    valid: (v) => typeof v === 'string' || isRecord(v),
    message: '`attributes` must be an object of names to values, or a string',
  },
  {
    name: 'props',
    valid: (v) => v === undefined || isRecord(v),
    message: '`props` must be an object of properties to assign',
  },
  { name: 'children', valid: (v) => typeof v === 'string', message: '`children` must be a markup string' },
  { name: 'seen', valid: (v) => v === undefined || v instanceof Set, message: '`seen` must be a Set' },
  { name: 'base', valid: (v) => v === undefined || isUrl(v), message: '`base` must be a URL or a path string' },
  { name: 'location', valid: (v) => v === undefined || isUrl(v), message: '`location` must be a URL or a path string' },
  { name: 'static', valid: (v) => typeof v === 'boolean', message: '`static` must be true or false' },
  /** Node turns a `setTimeout` past 2^31 − 1 ms into 1 ms, so that is the largest budget that means what it says. */
  {
    name: 'timeout',
    valid: (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 2 ** 31 - 1),
    message: '`timeout` must be a number of milliseconds, from 0 to 2147483647',
  },
];

/**
 * An attribute NAME that could not come out of one entry: the characters the engines' `setAttribute`
 * refuses, so an object entry can never write a second attribute (`{ 'a=1 onload': v }`) or leave the tag.
 */
const BAD_ATTRIBUTE_NAME = /[\0-\x20"'>/=\x7f]/;
const attributeMarkup = (attributes: string | Record<string, unknown>): string =>
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

/** The `timeout` an asynchronous render gets when none is given (see `beginBudget` in `frames.ts`). */
const DEFAULT_TIMEOUT = 2000;

/** `href -> entry tag`, so a module rendered again is not re-imported and re-searched. */
const entryTags = new Map<string, string>();

/**
 * **One render at a time**, so no render can see another's state — including a synchronous render fired
 * inside an asynchronous one's pause. A failed render must not stop the queue.
 */
let turn: Promise<unknown> = Promise.resolve();
const takeTurn = <T>(work: () => Promise<T>): Promise<T> => {
  const mine = turn.then(work);
  turn = mine.then(
    () => undefined,
    () => undefined
  );
  return mine;
};

const renderModule = async (
  url: string | URL,
  options: SsrRenderOptions = {},
  isAsync: boolean
): Promise<SsrRenderResult> => {
  /** From JavaScript, `options` can be anything; `null` used to surface as an unnamed destructuring error. */
  if (!isRecord(options)) throw new TypeError('ssr: `options` must be an object, or left out');
  const { tag: chosen, attributes = '', children = '', props, seen, base, location, static: isStatic = false, timeout } = options;
  const given = { url, tag: chosen, attributes, props, children, seen, base, location, static: isStatic, timeout };
  /**
   * Indexed, and objects rather than tuples: this runs once per render inside an async function, where V8
   * did not remove a `for…of`'s per-step result objects, nor array destructuring's iterator — tuples cost
   * ~1.4 KB of garbage per render, GC on every render after (+12% on a mixed load, measured).
   */
  for (let i = 0; i < CHECKS.length; i++) {
    const { name, valid, message } = CHECKS[i];
    if (!valid(given[name])) throw new TypeError(`ssr: ${message}`);
  }
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
    const module: Record<string, unknown> = await import(href);
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
  const place = globalThis.location as unknown as Record<(typeof LOCATION_PARTS)[number], string>;
  const title = globalThis.document.title;
  const saved = location === undefined ? undefined : LOCATION_PARTS.map((part) => place[part]);
  if (saved) {
    const next = new URL(String(location), place.href);
    for (const part of LOCATION_PARTS) place[part] = next[part];
  }
  renderedTags.clear();
  timedOut.clear();
  failures.length = 0;
  beginHoisting();
  resetPendingDefinitions();
  pendingInstances.clear();
  staticRender = isStatic;
  if (isAsync) beginBudget(timeout ?? DEFAULT_TIMEOUT);
  try {
    const element = buildInstance(tag, attrString);
    const { open, inner } = isAsync
      ? await renderInstanceAsync(element, tag, 0, props, children)
      : renderInstance(element, tag, 0, props, children);
    return finishPage(`${open}${inner}</${tag}>`, tag, seen);
  } finally {
    /**
     * Said in every build: a render that ran out of time served a different page than the one its code describes. It
     * names the components still waiting — on a large page the page's own tag says nothing about where to look — and
     * the commonest cause, a `whenDefined` wait for a tag the server never defines (lazily loaded, client-only or
     * unregistered here), with its fix: RETURN before that wait on the server. That serves the component's state from
     * before the wait, which is what a browser shows first, so hydration changes nothing. Skipping only the `await`
     * serves the state after it instead, which the browser then replaces: measured, a visible flash.
     */
    if (isAsync && endBudget()) {
      const list = (names: Iterable<string>) => [...names].map((name) => `<${name}>`).join(', ');
      const waits = pendingDefinitionNames();
      console.warn(
        `[vera] ssr: <${tag}> was served after its ${timeout ?? DEFAULT_TIMEOUT} ms \`timeout\` with a promise still pending` +
          (timedOut.size ? ` in ${list(timedOut)}` : '') +
          ` (an async connectedCallback, or a promise a frame callback returned), so the page is what had rendered by then.` +
          (waits.length
            ? ` Still waiting on customElements.whenDefined for ${list(waits)}, which the server never defined. If only the ` +
              `browser defines it, return before that wait on the server — \`if (globalThis.__veraSsrShimmed) return;\` — ` +
              `so the server serves what the component shows before the wait, as the browser does first.`
            : '') +
          ` Raise \`timeout\` if the wait is real, or find the promise that never settles.`
      );
    }
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
const finishPage = (rendered: string, tag: string, seen: Set<string> | undefined): SsrRenderResult => {
  const html = pendingInstances.size ? rendered.replaceAll(new RegExp(` ${INSTANCE_ATTRIBUTE}="\\d+"`, 'g'), '') : rendered;
  if (failures.length) {
    const [first] = failures;
    const others = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
    throw new Error(
      `ssr: <${first.tag ?? tag}> threw while rendering${others} — its markup would be empty. ${String((first.error as { message?: unknown } | null | undefined)?.message ?? first.error)}`,
      { cause: first.error }
    );
  }
  const css: string[] = [];
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
 * @param url The component's module URL
 * @param options
 * @param options.tag Picks the element when the module defines several
 * @param options.attributes The entry tag's attributes — an object,
 * whose values are escaped and whose names are checked; a string is written through untouched (**a sink**:
 * never put request data in the string form)
 * @param options.props Properties assigned before `connectedCallback` — how
 * structured data reaches a component
 * @param options.children Markup placed inside the entry tag — what a `<slot>` renders
 * (**raw markup**, a sink like the string form of `attributes`)
 * @param options.seen Shared across renders so a page of islands ships each component's
 * styles once
 * @param options.base A directory the module must resolve inside — pass it whenever any
 * part of `url` came from a request
 * @param options.static This page will not be interactive: stores skip reactivity (~3x), and a
 * write during the render throws
 * @param options.location This request's URL, applied for the render and restored after
 * @param options.timeout How long `renderToStringAsync` waits on what a component starts, in milliseconds (2000)
 */
export const renderToString = (url: string | URL, options?: SsrRenderOptions): Promise<SsrRenderResult> =>
  takeTurn(() => renderModule(url, options, false));

/**
 * Renders a component module to markup, **awaiting its lifecycle** — an `async connectedCallback`, and
 * work started inside a frame (a router's first navigation). Same options, same output.
 */
export const renderToStringAsync = (url: string | URL, options?: SsrRenderOptions): Promise<SsrRenderResult> =>
  takeTurn(() => renderModule(url, options, true));

export { registry, serializeTemplate };
export type { SsrRenderOptions, SsrRenderResult };
