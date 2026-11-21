import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/**
 * **`@verajs/hot` — redefine a component in development, and its live elements run the new code** (Brian 2026-09-30;
 * built 2026-10-22). `wire([renderer, hot])` FIRST in the entry, before any component module defines a tag; after that,
 * `define('x-card', …)` or `customElements.define('x-card', …)` again does not throw: the live `<x-card>`s swap to the new
 * code in place. Development only — production carries nothing of it (core's one read of `$hot` is in its development
 * branch).
 *
 * - **How a swap gets in, at zero production bytes.** At a tag's FIRST define, hot puts forwarders in front of the class's
 *   `connectedCallback`, `disconnectedCallback` and `attributeChangedCallback` before core's own `customElements.define`
 *   wrapper captures them, so core's lifecycle (moves kept, the one teardown) runs around them unchanged. A redefine points
 *   the forwarders at the new class's callbacks — whose closure already holds the new setup, options and prop defaults —
 *   copies its prototype members onto the registered prototype, and re-runs every live element: core's teardown (`$td`:
 *   old cleanups once, hooks retired), then its `connectedCallback`, which sets it up fresh, as a re-add does.
 * - **Kept across a swap:** the element itself (its place, focus, attributes, children, and every reference to it, the
 *   parent template's included), stores at module scope, and its props: hot holds the props record and its store across
 *   its own teardown call, so code outside the component that reads its props stays subscribed. Lost: what the setup
 *   created — the setup runs again.
 * - **What a live element cannot take is a RELOAD REQUEST:** a change of shadow-root mode (a root cannot be detached),
 *   `formAssociated` or `disabledFeatures` (frozen per tag by the platform). A cancelable `vera-hot-reload` event on the
 *   element's window carries `{ tag, reason }`; uncanceled, that window reloads. A class component's constructor or field
 *   changes apply to NEW elements only (an existing instance is never constructed again); reload for the live ones.
 * - **Attributes:** the platform snapshots `observedAttributes` at the first define. A name a new version stops observing
 *   is filtered out; a name it starts observing is watched per element (a `MutationObserver`) and its current value
 *   replayed once — asynchronously, where a native reaction is synchronous, until a reload.
 * - **Why it must be wired first, and through `wire`:** hot's `customElements.define` must sit OUTSIDE core's. It installs
 *   itself when wired (a connector), and wiring goes through core's `wire`, so core's wrapper is already there; hot checks
 *   that by defining a probe tag and refuses otherwise. A tag defined before hot was wired keeps its real class and says so
 *   on a redefine.
 */

type Element$ = HTMLElement & { _$raw$?: unknown; _$v$?: unknown };
type Callback = ((this: HTMLElement, ...args: unknown[]) => unknown) | undefined;
/** The registry and `wire` as a connector is handed them — typed as native-elements' are. */
type Registry = { get(name: never): unknown };
type Wire = (item: never) => void;
type Core = { $hot?: true; $td(element: HTMLElement): void };
type Statics = { formAssociated?: unknown; disabledFeatures?: unknown; observedAttributes?: readonly string[] };
type Tag = {
  /** The CURRENT class's own callbacks, which the forwarders call. */
  c: Callback;
  d: Callback;
  a: Callback;
  /** The live elements of the tag: added on connect, removed on a real removal (so it holds only live ones). */
  live: Set<Element$>;
  /** The platform's snapshot of `observedAttributes` (the first define's) and the current class's list. */
  base: readonly string[];
  observed: readonly string[];
  /** Names the current class observes that the snapshot does not: watched per element. */
  added: string[];
  watchers: WeakMap<Element$, MutationObserver>;
  /** The first define's frozen-per-tag statics. */
  form: unknown;
  disabled: unknown;
};

const CALLBACKS = ['constructor', 'connectedCallback', 'disconnectedCallback', 'attributeChangedCallback'];
const tags = new Map<string, Tag>();
/** Each element's options as `init` last received them (the `'init'` insert): a redefine compares the new ones. */
const optionsOf = new WeakMap<Element$, unknown>();
let core: Core;
/** Inside a swap's re-init loop: the `'init'` insert compares options only then. */
let swapping: Tag | undefined;
/** The elements whose new options need a NEW element (a shadow-mode change): one reload request per swap. */
let requested = false;
let probes = 0;

const shadowOf = (options: unknown) => {
  const shadow = (options as { shadow?: unknown } | undefined)?.shadow;
  return typeof shadow === 'object' && shadow !== null ? (shadow as { mode?: unknown }).mode : shadow;
};

/** A reload request, on the element's window (the page's when no element is live): cancelable; uncanceled, that window reloads. Once per swap. */
const reload = (element: Element$ | undefined, tag: string, reason: string) => {
  if (requested) return;
  requested = true;
  const view = element === undefined ? (globalThis as { window?: Window }).window : element.ownerDocument.defaultView;
  if (view == null) return;
  console.warn(diagnostic('hot', `<${tag}>`, 'hot-reload', __DEV__ && PROSE['hot-reload'](tag, reason)));
  if (view.dispatchEvent(new (view as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent('vera-hot-reload', { cancelable: true, detail: { tag, reason } }))) view.location.reload();
};

/**
 * The `'init'` insert (priority −1, before native-elements' 0): records each element's options, and during a swap defers
 * the setup (`false`) of an element whose new shadow-root MODE differs — a root cannot be changed, so it reloads instead.
 * `foreignNodes` swaps in place: the teardown released the template's hold, and the re-init renders into the same root.
 */
const onInit = (element: Element$, options: unknown): false | undefined => {
  const before = optionsOf.get(element);
  optionsOf.set(element, options);
  if (swapping !== undefined && before !== undefined && shadowOf(before) !== shadowOf(options)) {
    reload(element, element.localName, 'its shadow-root mode changed');
    return false;
  }
  return undefined;
};

/**
 * One element brought up to the tag's current definition: the props record kept across core's teardown, then set up again.
 * `$td` releases the props store (a removal's rule); a swap is not a removal, so the store is put back and code outside the
 * component that reads its props stays subscribed — unless the declared props changed (`fresh`): the old store was filled
 * by the old defaults, so it is left released and the new accessors build one over the kept values, adding the new
 * defaults (outside readers then subscribe again on their next run).
 */
const rerun = (element: Element$, fresh: boolean) => {
  const raw = element._$raw$;
  const store = element._$v$;
  core.$td(element);
  if (store !== undefined && !fresh) {
    element._$raw$ = raw;
    element._$v$ = store;
  }
  (element as unknown as { connectedCallback(): unknown }).connectedCallback();
};

/** Watches the names the platform does not observe for this element, and replays each one's current value once. */
const watch = (tag: Tag, element: Element$) => {
  tag.watchers.get(element)?.disconnect();
  tag.watchers.delete(element);
  if (tag.added.length === 0) return;
  const view = element.ownerDocument.defaultView;
  if (view === null) return;
  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      const name = record.attributeName!;
      tag.a?.call(element, name, record.oldValue, element.getAttribute(name));
    }
  });
  observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: tag.added });
  tag.watchers.set(element, observer);
  for (const name of tag.added) if (element.hasAttribute(name)) tag.a?.call(element, name, null, element.getAttribute(name));
};

/** A redefine: the new class's members and callbacks take over the registered prototype, then every live element re-runs. */
const swap = (tag: Tag, name: string, Registered: CustomElementConstructor, Next: CustomElementConstructor) => {
  const statics = Next as unknown as Statics;
  if (statics.formAssociated !== tag.form || statics.disabledFeatures !== tag.disabled) {
    requested = false;
    reload(tag.live.values().next().value, name, statics.formAssociated !== tag.form ? 'formAssociated changed' : 'disabledFeatures changed');
    return;
  }
  const from = Registered.prototype as Record<PropertyKey, unknown>;
  const to = Next.prototype as Record<PropertyKey, unknown>;
  /** The declared props are the prototype ACCESSORS; a different set means the kept store's defaults are stale. */
  const accessors = (proto: Record<PropertyKey, unknown>) =>
    Reflect.ownKeys(proto).filter((key) => Reflect.getOwnPropertyDescriptor(proto, key)!.get !== undefined).sort().join('\0');
  const fresh = accessors(from) !== accessors(to);
  /** Members the new version dropped go; its own (methods, prop accessors) are copied as they are, descriptors and all. */
  for (const key of Reflect.ownKeys(from)) if (!CALLBACKS.includes(key as string) && !Object.hasOwn(to, key)) Reflect.deleteProperty(from, key);
  for (const key of Reflect.ownKeys(to)) if (!CALLBACKS.includes(key as string)) Reflect.defineProperty(from, key, Reflect.getOwnPropertyDescriptor(to, key)!);
  tag.c = to.connectedCallback as Callback;
  tag.d = to.disconnectedCallback as Callback;
  tag.a = to.attributeChangedCallback as Callback;
  tag.observed = statics.observedAttributes ?? [];
  tag.added = tag.observed.filter((attribute) => !tag.base.includes(attribute));
  requested = false;
  swapping = tag;
  try {
    for (const element of [...tag.live]) {
      if (!element.isConnected) {
        tag.live.delete(element);
        continue;
      }
      rerun(element, fresh);
      watch(tag, element);
    }
  } finally {
    swapping = undefined;
  }
};

/** Core's wrapper is below when a class it is handed comes back with the `disconnectedCallback` core always installs. */
const coreBelow = () => {
  let name: string;
  do name = `vera-hot-probe-${probes++}`;
  while (customElements.get(name) !== undefined);
  const Probe = class extends HTMLElement {};
  customElements.define(name, Probe);
  return typeof (Probe.prototype as { disconnectedCallback?: unknown }).disconnectedCallback === 'function';
};

/**
 * Wire it: `wire([renderer, hot])`, first. A CONNECTOR: `wire` hands it the registry, which carries core's teardown
 * (`$td`); `$hot` tells core's development `define-twice` check that a redefine is a swap. Wired twice into the same
 * registry (two copies, or the module reloaded), the second does nothing.
 */
export const hot = (registry: Registry, w: Wire) => {
  const reg = registry as unknown as Core;
  if (reg.$hot || typeof customElements === 'undefined') return;
  if (!coreBelow()) throw new Error(diagnostic('hot', 'wire([hot])', 'hot-no-core', __DEV__ && PROSE['hot-no-core']()));
  core = reg;
  reg.$hot = true;
  w({ on: 'init', fn: onInit, priority: -1 } as never);
  const below = customElements.define.bind(customElements);
  customElements.define = (name: string, Class: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    const known = tags.get(name);
    const Registered = customElements.get(name);
    if (known !== undefined && Registered !== undefined) return swap(known, name, Registered, Class);
    if (Registered !== undefined) throw new Error(diagnostic('hot', `<${name}>`, 'hot-defined-first', __DEV__ && PROSE['hot-defined-first'](name)));
    const proto = Class.prototype as Record<string, Callback>;
    const statics = Class as unknown as Statics;
    const tag: Tag = {
      c: proto.connectedCallback,
      d: proto.disconnectedCallback,
      a: proto.attributeChangedCallback,
      live: new Set(),
      base: statics.observedAttributes ?? [],
      observed: statics.observedAttributes ?? [],
      added: [],
      watchers: new WeakMap(),
      form: statics.formAssociated,
      disabled: statics.disabledFeatures,
    };
    tags.set(name, tag);
    /**
     * **The class hot registers is marked** (`Symbol.for('vera.hot')`), so a component's own registration guard can tell
     * a hot-managed tag (define again, and hot swaps it) from a real second copy of the package (warn and stand down): the
     * registered class IS the original here, with no stand-in to recognize. Development only, like everything hot does.
     * Not on a frozen or sealed class (a library may freeze its statics): the write would throw in a module, so such a
     * class is simply unmarked, and a guard reads its tag as defined before hot (it stands down instead of redefining).
     */
    if (__DEV__ && Object.isExtensible(Class)) (Class as unknown as Record<symbol, unknown>)[Symbol.for('vera.hot')] = true;
    proto.connectedCallback = function (this: Element$) {
      tag.live.add(this);
      /** An element first connected AFTER a swap that added observed names is watched for them too (a swap watches its own). */
      if (swapping === undefined && tag.added.length !== 0 && !tag.watchers.has(this)) queueMicrotask(() => this.isConnected && watch(tag, this));
      return tag.c?.call(this);
    };
    proto.disconnectedCallback = function (this: Element$) {
      if (!this.isConnected) {
        tag.live.delete(this);
        tag.watchers.get(this)?.disconnect();
        tag.watchers.delete(this);
      }
      return tag.d?.call(this);
    };
    /** A name the current class stopped observing is filtered out here (the platform still delivers its snapshot's). */
    proto.attributeChangedCallback = function (this: Element$, attribute: unknown, old: unknown, value: unknown) {
      if (tag.observed.includes(attribute as string)) return tag.a?.call(this, attribute, old, value);
      return undefined;
    };
    return below(name, Class, options);
  };
};
