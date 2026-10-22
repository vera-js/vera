/**
 * **`@verajs/renderer/native-elements` — `init` on a BUILT-IN host element, with a custom element's lifecycle.**
 *
 * ```js
 * wire([renderer, nativeElements]);
 * init(document.querySelector('#panel'), () => () => html`…`);
 * ```
 *
 * A custom element tells core when it leaves and comes back (its callbacks); a `div` given to `init` tells nobody, so
 * with strong links it was never released (2026-10-21: 30 of 30 removed hosts retained). This module gives each
 * built-in host a CLOSED shadow root holding a default `<slot>` (its light content renders exactly as before; the root is
 * invisible to code and selectors) and a tiny SENTINEL custom element — which hears its host attached, moved, removed
 * and re-attached, identically in Chromium, Firefox and WebKit (BROWSER-LEDGER). Removed: core's own teardown (`$td`).
 * Re-attached: set up fresh (`$in`), as a custom element is. Moved — in one operation, or into another window's document
 * (a popped-out panel) — kept, with its state.
 *
 * Built on core's `'init'` insert, which hands it every element `init` sets up; it imports nothing (the registry
 * arrives through its connector), and an app that does not wire it pays nothing. Never on a server (ssr marks the
 * registry, `$srv`). Unsupported, said in development: a tag that cannot hold a shadow root, and a host with one already.
 */
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './native-elements-diagnostics.js';

type Host = HTMLElement & { _$x$?: boolean };
type Core = { $in(element: Host, options: unknown, setup: unknown): void; $td(element: Host): void; $rh(element: Host): void };

/** The setup each host was given, to set it up again on its return; per module COPY (two copies never share one). */
const SETUP = Symbol();
/** A host whose setup waits for its first connect (it was given `init` off the page). */
const PENDING = Symbol();
/** Each realm's sentinel name, per copy: `vera-s-` + the first number free in that realm's registry (deterministic). */
const names = new WeakMap<CustomElementRegistry, string>();
let core: Core | undefined;
/** Development: each unsupported tag said once. */
let said: Set<string> | undefined;

const hostOf = (sentinel: Element) => (sentinel.getRootNode() as ShadowRoot).host as Host & { [SETUP]?: [unknown, unknown] };

/** Sets a host up (again) from what it was given — never in a document with no window (it could never be released). */
const setUp = (host: Host & { [SETUP]?: [unknown, unknown] }) => {
  const given = host[SETUP];
  if (given !== undefined && host.ownerDocument.defaultView !== null) core!.$in(host, given[0], given[1]);
};

const sentinelFor = (win: Window & typeof globalThis) => {
  const registry = win.customElements;
  let name = names.get(registry);
  if (name === undefined) {
    let n = 0;
    while (registry.get((name = `vera-s-${n}`)) !== undefined) n++;
    registry.define(
      name,
      class extends win.HTMLElement {
        connectedCallback() {
          /**
           * Back after a removal: set up fresh. A move (the host still connected at its disconnect) kept it — and a move
           * into ANOTHER document re-homes it, as core does a component (R4).
           */
          const host = hostOf(this) as Host & { [PENDING]?: true; _$d$?: Document };
          if (host._$x$ === true || host[PENDING]) {
            host[PENDING] = undefined;
            setUp(host);
          } else if (host._$d$ !== undefined && host.ownerDocument !== host._$d$) core!.$rh(host);
        }
        disconnectedCallback() {
          const host = hostOf(this);
          /** Still connected: a MOVE in one operation (the platform runs reactions after it) — kept, as a component is. */
          if (!host.isConnected && host._$x$ !== true) core!.$td(host);
        }
      }
    );
    names.set(registry, name);
  }
  return name;
};

/** Development: each host said once. */
let saidSlot: WeakSet<Element> | undefined;
const slotAttributeCheck = (host: Element) => {
  const children = host.children;
  for (let i = 0; i < children.length; i++)
    if (children[i]!.hasAttribute('slot') && !(saidSlot ??= new WeakSet()).has(host)) {
      saidSlot.add(host);
      console.warn(diagnostic('native-elements', `<${host.localName}>`, 'native-host-slot-attribute', __DEV__ && PROSE['native-host-slot-attribute'](children[i]!.localName)));
    }
};

const onInit = (element: Host & { [SETUP]?: [unknown, unknown] }, options: unknown, setup: unknown): false | undefined => {
  /**
   * A custom element has its own callbacks — tested FIRST, on the name alone: this insert runs for EVERY `init`, and on
   * Firefox a page of custom elements paid +1.7% creation and +3.7% churn (11 of 12 sessions each, 2026-10-21) when the
   * document and window reads below came before it; with this order it is level with the module unwired.
   */
  if (element.localName.indexOf('-') >= 0) return undefined;
  /** A server's document (ssr marks it): its elements are read once, never given a lifecycle. */
  if ((element.ownerDocument as Document & { _$srv$?: boolean })._$srv$) return undefined;
  const win = element.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (win === null) return undefined;
  /** A customized built-in (`is=`) is a custom element too: `getName` knows its class. */
  if ((win.customElements as { getName?: (c: unknown) => string | null }).getName?.(element.constructor)) return undefined;
  if (element[SETUP] === undefined) {
    let root: ShadowRoot;
    try {
      root = element.attachShadow({ mode: 'closed' });
    } catch {
      if (__DEV__ && !(said ??= new Set()).has(element.localName)) {
        said.add(element.localName);
        console.warn(diagnostic('native-elements', `<${element.localName}>`, 'native-host-unsupported', __DEV__ && PROSE['native-host-unsupported'](element.localName)));
      }
      return undefined;
    }
    const doc = element.ownerDocument;
    const sentinel = doc.createElement(sentinelFor(win));
    /**
     * No box (`hidden`): an element in the host's shadow tree is one of its layout children — a flex host laid its items
     * out around it (each 4 px narrower, the gap shifted; tests/browser/native-elements). Its callbacks need no box.
     */
    sentinel.hidden = true;
    root.append(doc.createElement('slot'), sentinel);
    /** Development: a later attachShadow on this host says why it cannot, by name. */
    if (__DEV__)
      element.attachShadow = () => {
        throw new Error(diagnostic('native-elements', `<${element.localName}>`, 'native-host-shadow', __DEV__ && PROSE['native-host-shadow']()));
      };
  }
  element[SETUP] = [options, setup];
  /**
   * Development: a DIRECT child with a `slot` attribute renders nowhere under the default-slot root (BROWSER-LEDGER) —
   * a silent disappearance, so it is said, once per host, after the render this setup is about to run.
   */
  if (__DEV__) queueMicrotask(() => slotAttributeCheck(element));
  /** Off the page: its setup waits for its first connect (core stops on `false`), so a host never attached links nothing. */
  if (element.isConnected) return undefined;
  (element as Host & { [PENDING]?: true })[PENDING] = true;
  return false;
};

/**
 * Wire it: `wire([renderer, nativeElements])`. A CONNECTOR (`wire` hands it the registry): core's setup (`$in`) and
 * teardown (`$td`) come off it, and `$ne` tells core's development check this module is wired.
 */
/** The registry and `wire` as a connector is handed them — typed as slots' are, so a strict consumer's `wire([…])` takes it. */
type Registry = { get(name: never): unknown };
type Wire = (item: never) => void;
export const nativeElements = (registry: Registry, w: Wire) => {
  /** Core's seams, typed loosely on the registry (as the keyed module's are): a connector is handed core's `Inserts`. */
  core = registry as unknown as Core;
  (registry as unknown as { $ne?: unknown }).$ne = true;
  /** FIRST of the `'init'` inserts (priority 0): a deferral stops every insert after it, so none runs on a detached host twice. */
  w({ on: 'init', fn: onInit, priority: 0 } as never);
};
