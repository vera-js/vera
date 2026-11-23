/**
 * Vera-native SSR. Node resolves the module graph (`import()`), execution registers component classes
 * (through `customElements.define`, which the shim owns), templates flatten through the sigil-aware
 * serializer, and nested components are found by scanning the markup just written for tags the registry
 * knows (`scan.js`) — never by parsing HTML. Client takeover is `hydration` (`@verajs/renderer/hydration`, wired beside
 * the renderer), which adopts this markup in place, markerless but for light slots' region comments.
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
  setCoreFlush,
  beginBudget,
  bounded,
  endBudget,
  pendingDefinitionNames,
  resetPendingDefinitions,
  pendingInstances,
  INSTANCE_ATTRIBUTE,
  unmarked,
  LOCATION_PARTS,
} from './shim.js';
import { UNSAFE_ATTRIBUTE_NAME, serializeTemplate, serializeValue } from './serializer.js';
import { decode as decodeEntities, heldAt } from './parse.js';
import { ATTRIBUTE, ATTRIBUTE_TIGHT, renderComponentTags, spacedEquals } from './scan.js';
import type { InsertFunctionMap, SettleInsert, SlotInsert } from '@verajs/core';
import { distributeLight } from './slots.js';
import { currentRenderingTag } from './stylesheets.js';
import { discard as discardFrames } from './frames.js';
import { inRender, stale } from './render-context.js';
import type { ElementShim, ShadowRootShim } from './nodes.js';
import { INLINE_HANDLER, asciiLower, thrownMessage } from './escaping.js';
import { PROSE } from './diagnostics.js';
import { isOwn, once, own, quoted, ssrMisuse, ssrWarning } from './report.js';
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

installShims(stale);
const { wire, inserts, flush } = await import('@verajs/core');
/**
 * **A process with working web storage** hands it to every component this renders, because they run against the
 * process's own globals — so the `typeof localStorage` guard components are taught passes here, and one visitor's state
 * is served to the next. Node 26 gives every process an in-memory `sessionStorage`, shared by every request, and
 * `--localstorage-file` adds a `localStorage`. Asked of the STORAGE, not of the flags that might make it: the flag's text
 * alone warned on Node 24, where it does nothing without `--experimental-webstorage`. `localStorage` is touched only
 * when the flag was given — on Node 26 a read of it without the flag prints Node's own ExperimentalWarning — and a
 * getter that throws is no storage. Said once, at import, in every build (2026-11-20). No `process` in a worker.
 */
const working = (name: 'sessionStorage' | 'localStorage'): boolean => {
  try {
    return typeof (globalThis as unknown as Record<typeof name, { getItem?: unknown } | undefined>)[name]?.getItem === 'function';
  } catch {
    return false;
  }
};
if (
  working('sessionStorage') ||
  (typeof process !== 'undefined' &&
    [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)].some((arg) => arg.startsWith('--localstorage-file')) &&
    working('localStorage'))
)
  console.warn(ssrWarning('the server', 'ssr-process-storage', PROSE['ssr-process-storage']!()));
setCoreFlush(flush);
/** Core's server-render turn: what a render creates leaves every store when its turn ends. */
const serverTurnOf = (inserts as unknown as { $ss?: (delta: number) => void }).$ss;
/**
 * A server's DOCUMENT: modules that would touch a client's lifecycle (`@verajs/renderer/native-elements`) stand aside for
 * its elements (`_$srv$`) — on the document, never the registry, so a process that also renders on a client DOM (a
 * hydration test, a dev server) keeps its client elements' lifecycle.
 */
(globalThis.document as unknown as { _$srv$?: boolean })._$srv$ = true;
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

/**
 * True while a `static: true` render runs. Shared because every static-aware store handler reads it at each operation
 * (see static mode below): a handler is made once per handler it wraps, not once per render.
 */
let staticRender = false;

/**
 * One static-aware handler per handler it wraps, never one per value: a copy per value cost a small
 * render about 1.2 µs (a fifth of it) in allocation, and gave every nested proxy a handler of its own.
 * Shared for the life of the process, because a store module's handler is.
 */
const staticAware = new WeakMap<ProxyHandler<object>, ProxyHandler<object>>();

/** `href -> entry tag`, so a module rendered again is not re-imported and re-searched: shared across renders. */
const entryTags = new Map<string, string>();

/** The tail of the render queue (`takeTurn`): shared, because every render, from any caller, waits on the one before. */
let turn: Promise<unknown> = Promise.resolve();

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
  /**
   * The render's own read, markers kept (`markedHTML`), from the shim's containers; a process that also runs the
   * client renderer hands this a real element too (its `innerHTML` holds no marker).
   */
  const current = typeof (container as unknown as Partial<ElementShim>).markedHTML === 'function' ? (container as unknown as ElementShim).markedHTML() : container.innerHTML;
  const last = written.get(container);
  /** Still shaped as we left it: our range is where we wrote it. Otherwise it is gone; start at the end. */
  const before = last !== undefined && current.startsWith(last.before + last.ours) ? last.before : current;
  const after = before === current ? '' : current.slice(before.length + last!.ours.length);
  container.innerHTML = before + ours + after;
  written.set(container, { before, ours });
};
wire({ on: 'render', fn: serverRenderer, priority: 50 });

/* ── static mode, as a store module ──────────────────────────────────────────────────────────── */

const refuseStatic = (prop: string | symbol) =>
  own(new TypeError(ssrMisuse('ssr-static-write', PROSE['ssr-static-write']!(quoted(String(prop))))));
/**
 * **`static: true` — this page will not be interactive, so its stores need not be reactive.** A server
 * render is one shot, and the proxy's tracking is the whole reactivity cost of one: turning it off is
 * worth about 3x, with identical markup. A `'store'` insert wrapping every handler core or a module
 * chooses, so a store's reads during a static render bypass tracking and a WRITE is refused by name —
 * a write would change nothing anyone renders, silently. The flag (`staticRender`) is read at each operation, because
 * a store module decides once per type and a store must be reactive again the moment the render ends.
 */
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
const buildInstance = (tag: string, attrString: string, enclosing: ShadowRootShim | null): ComponentInstance => {
  /**
   * A tag with no attributes — most of them — does no attribute work at all. The rest are read by `exec` on the shared
   * regex, not `matchAll`, which copies its regex per call; nothing runs between the reads but `decodeEntities`, so the
   * shared `lastIndex` is this loop's alone. The instance marker is found in the same pass: the first, as `heldAt` keeps.
   */
  let attributes: Array<[string, string]> | undefined;
  let marker: string | undefined;
  if (attrString) {
    const grammar = spacedEquals(attrString) ? ATTRIBUTE : ATTRIBUTE_TIGHT;
    attributes = [];
    grammar.lastIndex = 0;
    for (let read = grammar.exec(attrString); read !== null; read = grammar.exec(attrString)) {
      const name = asciiLower(read[1]!);
      const value = decodeEntities(read[2] ?? read[3] ?? read[4] ?? '');
      if (marker === undefined && name === INSTANCE_ATTRIBUTE) marker = value;
      attributes.push([name, value]);
    }
  }
  const pending = marker === undefined ? undefined : pendingInstances.get(marker);
  /**
   * This tag is the one rendering while it is constructed, so a constructor that throws is named by it, not by the
   * component whose markup holds it (`renderThrew`). Restored at once: no try/catch on a per-instance path, and a throw
   * leaves this tag current for the render's catch to read.
   */
  const previousTag = setRenderingTag(tag);
  const element = (pending?.localName === tag ? pending : new (registry.get(tag)!)()) as ComponentInstance;
  setRenderingTag(previousTag);
  /**
   * Unregistered HERE, and only when picked up: a marker is an attribute, so a copy of it can sit on
   * another tag, and unregistering whatever marker an element carries let that copy rob the instance
   * it names of its pickup — rebuilt from the tag, without what the parent gave it.
   */
  if (element === pending) pendingInstances.delete(marker!);
  element.localName = tag;
  /**
   * Where the instance sits: the server renders each one detached, so this is what its `getRootNode()` answers (a
   * light component inside a served shadow root puts its styles in that root). Written for every instance, null at
   * the page, so all of them carry the field the same way.
   */
  element._enclosing = enclosing;
  /**
   * The first of a repeated name, as the parser keeps it (`heldAt`): the child reads what the browser's parse gives it.
   * A name led by `=` is skipped: the gap between HTML's parser, which keeps it (a client-built child holds `=title`),
   * and `setAttribute`, which refuses it and is the only way in here. So the server's child lacks it and the served
   * tag does not carry it. The first attribute, the only one on most tags, asks no `heldAt`; the pair is indexed, not
   * destructured, which runs the iterator in cold code (both measured on a page's cold renders, 2026-11-23).
   */
  if (attributes)
    for (let i = 0; i < attributes.length; i++) {
      const pair = attributes[i]!;
      const name = pair[0];
      if (name.charCodeAt(0) !== 61 && (i === 0 || !heldAt(attributes, i, name))) element.setAttribute(name, pair[1]);
    }
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
        throw own(new TypeError(ssrMisuse('ssr-prop-refused', PROSE['ssr-prop-refused']!(tag, quoted(thrownMessage(error)))), { cause: error }));
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
  return { open: element.openTag(), root, shadow: root?.markedHTML() ?? '', light: element.markedHTML() };
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
const emit = (tag: string, attrString: string, depth: number, children: string | undefined, enclosing: ShadowRootShim | null): string => {
  const { open, inner } = renderInstance(buildInstance(tag, attrString, enclosing), tag, depth, undefined, children);
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
    throw own(new Error(ssrMisuse('ssr-async-connected', PROSE['ssr-async-connected']!(tag))));
  const pieces = finishInstance(element, tag, previousTag);
  /** What its template renders sits in its shadow root; what it holds in light DOM sits where it does. */
  return assemble(pieces, renderComponentTags(pieces.shadow, depth, emit, pieces.root), renderComponentTags(pieces.light, depth, emit, element._enclosing ?? null));
};

/**
 * The asynchronous chain: the lifecycle is awaited and frames drain with the microtask queue running
 * between rounds. The scan stays synchronous — a component tag becomes a placeholder and its render a
 * promise, substituted once everything beneath has settled — so both chains share one parser. The
 * placeholder's name is random per process, so a component's own markup cannot contain one.
 */
const PLACEHOLDER = `vera-async-${crypto.randomUUID()}`;
const PLACEHOLDERS = new RegExp(`${PLACEHOLDER}(\\d+)_`, 'gu');
const scanAsync = async (markup: string, depth: number, enclosing: ShadowRootShim | null): Promise<string> => {
  const pending: Promise<string>[] = [];
  const scanned = renderComponentTags(markup, depth, (tag: string, attrString: string, at: number, children: string | undefined, root: ShadowRootShim | null) => {
    pending.push(renderInstanceAsync(buildInstance(tag, attrString, root), tag, at, undefined, children).then((r) => r.open + r.inner));
    return `${PLACEHOLDER}${pending.length - 1}_`;
  }, enclosing);
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
  let cut;
  /** Named HERE, where the tag is known: a sibling's preparation may run while this callback awaits (see `renderThrew`). */
  try {
    cut = await bounded(element.connectedCallback?.());
  } catch (error) {
    throw isOwn(error) ? error : renderThrew(tag, '', error);
  }
  if ((await flushFramesAsync(failed(tag))) || cut) timedOut.add(tag);
  const pieces = finishInstance(element, tag, previousTag);
  return assemble(pieces, await scanAsync(pieces.shadow, depth, pieces.root), await scanAsync(pieces.light, depth, element._enclosing ?? null));
};

/* ── the entry points ────────────────────────────────────────────────────────────────────────── */

/**
 * A `URL` or a `Set` from any realm, by its tag: `instanceof` asks about THIS realm's class, so jsdom's window's `URL`
 * or a `vm` context's `Set` was refused as the wrong kind of option. A URL object is read through `String()`, its `href`.
 */
const tagged = (value: unknown, tag: string): boolean => Object.prototype.toString.call(value) === `[object ${tag}]`;
const isUrl = (value: unknown): value is string | URL => typeof value === 'string' || tagged(value, 'URL');
/**
 * A `Set` by its brand, which holds across realms: one only tagged `Set` passed the tag and then threw the internal
 * `seen?.has is not a function` this table exists to prevent. A URL keeps the tag check: jsdom's `URL` is a class of
 * its own, so Node's `href` getter refuses it, and a fake one read through `String()` is no more than a string.
 */
const isSet = (value: unknown): boolean => {
  try {
    Set.prototype.has.call(value, undefined);
    return true;
  } catch {
    return false;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * The options, checked by one table: a wrong one otherwise surfaced as an internal
 * (`markup.includes is not a function`, `Cannot find package 'undefined'`) naming nothing the caller did.
 */
const CHECKS: Array<{ name: Checked; valid: (value: unknown) => boolean; expected: string }> = [
  { name: 'url', valid: isUrl, expected: 'a module URL — a URL or a string' },
  {
    name: 'tag',
    valid: (v) => v === undefined || typeof v === 'string',
    expected: 'a custom element name',
  },
  {
    name: 'attributes',
    valid: (v) => typeof v === 'string' || isRecord(v),
    expected: 'an object of names to values, or a string',
  },
  {
    name: 'props',
    valid: (v) => v === undefined || isRecord(v),
    expected: 'an object of properties to assign',
  },
  { name: 'children', valid: (v) => typeof v === 'string', expected: 'a markup string' },
  { name: 'seen', valid: (v) => v === undefined || isSet(v), expected: 'a Set' },
  /**
   * `base` is a directory URL, absolute (2026-11-23): its message offered "a path string", but a path such as
   * `'/srv/components/'` has no URL to resolve against, so the bound threw `Invalid URL` from inside the check. A `file:`
   * URL is a directory on disk (`pathToFileURL(dir)`).
   */
  {
    name: 'base',
    valid: (v) => v === undefined || tagged(v, 'URL') || (typeof v === 'string' && URL.canParse(v)),
    expected: 'a URL or an absolute URL string (for a directory on disk, a file: URL)',
  },
  { name: 'location', valid: (v) => v === undefined || isUrl(v), expected: 'a URL or a path string' },
  { name: 'static', valid: (v) => typeof v === 'boolean', expected: 'true or false' },
  /** Node turns a `setTimeout` past 2^31 − 1 ms into 1 ms, so that is the largest budget that means what it says. */
  {
    name: 'timeout',
    valid: (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 2 ** 31 - 1),
    expected: 'a number of milliseconds, from 0 to 2147483647',
  },
];
/** Every option's name, read off `CHECKS` (one entry per option, and `url`), so the list lives in one place. */
const OPTION_NAMES = new Set<string>(CHECKS.map((check) => check.name).filter((name) => name !== 'url'));
const OPTION_LIST = [...OPTION_NAMES].join(', ');

/**
 * An attribute NAME is checked by the rule a spread's keys follow (`UNSAFE_ATTRIBUTE_NAME`), because it is the same
 * thing: data written into the served tag. So an object entry can never write a second attribute
 * (`{ 'a=1 onload': v }`) or leave the tag. It was the set the engines' `setAttribute` refuses, which takes a quote,
 * `<` and every control but the parser's whitespace (2026-11-23), and its message said `setAttribute` refuses quotes.
 */
const attributeMarkup = (attributes: string | Record<string, unknown>): string =>
  typeof attributes === 'string'
    ? attributes
    : Object.entries(attributes)
        .filter(([, value]) => value != null && value !== false)
        .map(([name, value]) => {
          if (UNSAFE_ATTRIBUTE_NAME.test(name))
            throw own(new TypeError(ssrMisuse('ssr-attribute-name', PROSE['ssr-attribute-name']!(quoted(name)))));
          /** A runtime value never becomes a handler: the one rule a template binding's `on…` name is refused by. */
          if (INLINE_HANDLER.test(name))
            throw own(new TypeError(ssrMisuse('ssr-attribute-handler', PROSE['ssr-attribute-handler']!(quoted(name)))));
          return ` ${name}="${escapeHtml(value === true ? '' : value)}"`;
        })
        .join('');

/** The id counter's cross-copy key (`@vera-hooks/labeled` and every hook that numbers ids read it; see the reset below). */
const UID = Symbol.for('vera.uid');
/** The `timeout` an asynchronous render gets when none is given (see `beginBudget` in `frames.ts`). */
const DEFAULT_TIMEOUT = 2000;

/**
 * **One render at a time**, so no render can see another's state — including a synchronous render fired
 * inside an asynchronous one's pause. A failed render must not stop the queue.
 */
const takeTurn = <T>(work: () => Promise<T>): Promise<T> => {
  const mine = turn.then(() => inRender(work));
  turn = mine.then(
    () => undefined,
    () => undefined
  );
  return mine;
};

/** A specifier `import()` reads as a URL rather than a package name: relative, absolute, or with a scheme. */
const URL_LIKE = /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i;

const renderModule = async (
  url: string | URL,
  options: SsrRenderOptions = {},
  isAsync: boolean
): Promise<SsrRenderResult> => {
  /** From JavaScript, `options` can be anything; `null` used to surface as an unnamed destructuring error. */
  if (!isRecord(options)) throw own(new TypeError(ssrMisuse('ssr-option', PROSE['ssr-option']!('options', 'an object, or left out'))));
  /**
   * **An option this function does not have is refused**, as a wrong type is: `timeOut`, `prop` or `attrs` reads like
   * the real thing at a glance and configured nothing, so the page rendered with the default and nothing said why.
   * `for…in` with a Set lookup allocates nothing per render.
   */
  for (const key in options) if (!OPTION_NAMES.has(key)) throw own(new TypeError(ssrMisuse('ssr-option-unknown', PROSE['ssr-option-unknown']!(quoted(key), OPTION_LIST))));
  const { tag: chosen, attributes = '', children = '', props, seen, base, location, static: isStatic = false, timeout } = options;
  const given = { url, tag: chosen, attributes, props, children, seen, base, location, static: isStatic, timeout };
  /**
   * Indexed, and objects rather than tuples: this runs once per render inside an async function, where V8
   * did not remove a `for…of`'s per-step result objects, nor array destructuring's iterator — tuples cost
   * ~1.4 KB of garbage per render, GC on every render after (+12% on a mixed load, measured).
   */
  for (let i = 0; i < CHECKS.length; i++) {
    const { name, valid, expected } = CHECKS[i];
    if (!valid(given[name])) throw own(new TypeError(ssrMisuse('ssr-option', PROSE['ssr-option']!(name, expected))));
  }
  /**
   * **With `base`, the URL checked is the URL imported**: a URL-like string (`./`, `../`, `/`, or a scheme) is
   * resolved first, exactly as `import()` resolves one (against this module), so a `../` or `%2e%2e` segment after
   * the base is collapsed before the bound reads it. Compared as written, `<base>/../x.mjs` began with the base,
   * passed, and `import()` ran the module outside it. A bare specifier resolves through `node_modules`, which no URL
   * here can follow, so it is left as written and the bound refuses it, as it always has.
   */
  const href = typeof url !== 'string' ? String(url) : base !== undefined && URL_LIKE.test(url) ? new URL(url, import.meta.url).href : url;

  /**
   * **A module URL is bounded to `base` when one is given** — `import()` executes whatever it is handed. Read as a
   * directory whether or not it was written as one: that can only tighten the bound.
   */
  if (base !== undefined) {
    const directory = String(base);
    const root = new URL('.', directory.endsWith('/') ? directory : `${directory}/`).href;
    if (!href.startsWith(root)) throw own(new Error(ssrMisuse('ssr-url-refused', PROSE['ssr-url-refused']!(quoted(href), quoted(root)))));
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
    throw own(new Error(ssrMisuse('ssr-no-definition', PROSE['ssr-no-definition']!(quoted(String(url))))));
  const attrString = attributeMarkup(attributes);

  /** An app that wired a renderer after this module was imported displaced the server's, and every
   *  component would render empty. */
  if (!inserts.get('render')?.includes(serverRenderer))
    throw own(new Error(ssrMisuse('ssr-renderer-replaced', PROSE['ssr-renderer-replaced']!())));

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
  /**
   * **Generated ids restart at each render** (2026-11-21): the hooks that give elements ids count through one record
   * shared by every copy of the library (`Symbol.for('vera.uid')`), which in a server lives as long as the process, so
   * the same page served `vu1…` to one request and `vu4…` to the next: different markup per request, no stable cache
   * or ETag, and a count leaking across requests. Renders take turns (`takeTurn`), so none sees another's count. The
   * record is MUTATED, never replaced: a hook holds the object it found when it loaded. The trade: ids are unique
   * within a render, so a page assembled from two renders can repeat one (render a page in one call).
   */
  (((globalThis as Record<symbol, unknown>)[UID] ??= { n: 0 }) as { n: number }).n = 0;
  staticRender = isStatic;
  if (isAsync) beginBudget(timeout ?? DEFAULT_TIMEOUT);
  /**
   * **This render's turn, for core** (2026-10-21): every hook the render creates links as usual — a write
   * inside it must still re-render before serialization — and leaves every store when the turn ends (`$ss(-1)` below).
   * Opened AFTER the module's import, so module-scope state (a store, a computed) is the process's, and stays live.
   */
  serverTurnOf?.(1);
  try {
    const element = buildInstance(tag, attrString, null);
    let rendered: Assembled;
    try {
      rendered = isAsync ? await renderInstanceAsync(element, tag, 0, props, children) : renderInstance(element, tag, 0, props, children);
    } catch (error) {
      /**
       * A component's `connectedCallback` that throws is named, as a frame's throw is (`finishPage`): the README promises
       * it, and a bare error from a page of components said nothing about which one. In the synchronous chain the tag
       * being rendered when it threw is the thrower's, a nested one's included; the async chain names its own above.
       */
      throw isOwn(error) ? error : renderThrew(currentRenderingTag() || tag, failures.length > 0 ? ` (and ${failures.length} more)` : '', error);
    }
    return finishPage(`${rendered.open}${rendered.inner}</${tag}>`, tag, seen);
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
      if (once('ssr-timeout', tag))
        console.warn(ssrWarning(`<${tag}>`, 'ssr-timeout', PROSE['ssr-timeout']!(String(timeout ?? DEFAULT_TIMEOUT), list(timedOut), list(waits))));
    }
    staticRender = false;
    /**
     * No tag is left rendering: a component that threw leaves its own tag current (the catch above names it from that),
     * and the NEXT render's module, imported before that render begins, hoisted a sheet it adopts at module scope under
     * the stale tag, so it came back in the thrower's `styles` on its next render. Reset here, not at a render's start,
     * because the import runs first.
     */
    setRenderingTag('');
    /**
     * Nor is a frame left queued: one a component requested before its `connectedCallback` threw never reached the drain
     * that runs after the callback returns, and ran inside the next render instead, a later request's (its location,
     * its title). Discarded at the end and not at the start, because the next render's module import may queue frames
     * of its own.
     */
    discardFrames();
    globalThis.document.title = title;
    saved?.forEach((value, i) => (place[LOCATION_PARTS[i]] = value));
    serverTurnOf?.(-1);
  }
};

/**
 * **A render's failure, one form**: the component that threw, how many others did, and its own error — quoted when it is
 * not ours, whose text is code-shaped — as the cause, the identical object. Its text is read by `thrownMessage`, as
 * every other report here reads it: `String()` on a thrown `Object.create(null)` threw, so the render rejected with
 * `Cannot convert object to primitive value` and no component named (2026-11-23).
 */
const renderThrew = (tag: string, others: string, error: unknown): Error =>
  own(new Error(
    ssrMisuse('ssr-render-threw', PROSE['ssr-render-threw']!(tag, others, isOwn(error) ? (error as Error).message : quoted(thrownMessage(error)))),
    { cause: error }
  ));

/**
 * The page: a marker nothing consumed (inside a template, a raw-text element) must not ship; the
 * collected failures throw, naming every component; the styles this render is responsible for come back
 * escaped — the caller places them into a `<style>`, which makes that their render boundary — with each
 * component's styles once across a page of islands that share `seen`; and the title this render set.
 */
const finishPage = (rendered: string, tag: string, seen: Set<string> | undefined): SsrRenderResult => {
  const html = unmarked(rendered);
  if (failures.length) {
    const [first] = failures;
    const others = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
    throw renderThrew(first.tag ?? tag, others, first.error);
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
