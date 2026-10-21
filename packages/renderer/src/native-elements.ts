/**
 * **`@verajs/renderer/native-elements` — `init` on a BUILT-IN host element, with a custom element's lifecycle.**
 *
 * ```js
 * wire([renderer, nativeElements]);
 * init(document.querySelector('#panel'), () => () => html`…`);
 * ```
 *
 * A custom element tells core when it leaves and comes back (its callbacks); a `div` given to `init` tells nobody, so
 * with strong links it was never released (step 2, 2026-10-21: 30 of 30 removed hosts retained). This module gives each
 * built-in host a CLOSED shadow root holding a default `<slot>` (its light content renders exactly as before; the root is
 * invisible to code and selectors) and a tiny SENTINEL custom element — which hears its host attached, moved, removed
 * and re-attached, identically in Chromium, Firefox and WebKit (BROWSER-LEDGER). Removed: core's own teardown (`$td`).
 * Re-attached: set up fresh (`$in`), as a custom element is. Moved — in one operation, or into another window's document
 * (a popped-out panel) — kept, with its state: cross-window moves that keep a component are R4's.
 *
 * Built on core's `'init'` insert, which hands it every element `init` sets up; it imports nothing (the registry
 * arrives through its connector), and an app that does not wire it pays nothing. Never on a server (ssr marks the
 * registry, `$srv`). Unsupported, said in development: a tag that cannot hold a shadow root, and a host with one already.
 */
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './native-elements-diagnostics.js';

type Host = HTMLElement & { _$x$?: boolean };
type Core = { $in(element: Host, options: unknown, setup: unknown): void; $td(element: Host): void; $srv?: unknown };

/** The setup each host was given, to set it up again on its return; per module COPY (two copies never share one). */
const SETUP = Symbol();
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
          /** Back after a removal: set up fresh. (A move — the host still connected at its disconnect — kept it.) */
          const host = hostOf(this);
          if (host._$x$ === true) setUp(host);
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

const onInit = (element: Host & { [SETUP]?: [unknown, unknown] }, options: unknown, setup: unknown) => {
  if (core!.$srv !== undefined) return;
  const win = element.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (win === null) return;
  /** A custom element has its own callbacks (customized built-ins included: `getName`). */
  if (element.localName.indexOf('-') >= 0 || (win.customElements as { getName?: (c: unknown) => string | null }).getName?.(element.constructor)) return;
  if (element[SETUP] === undefined) {
    let root: ShadowRoot;
    try {
      root = element.attachShadow({ mode: 'closed' });
    } catch {
      if (__DEV__ && !(said ??= new Set()).has(element.localName)) {
        said.add(element.localName);
        console.warn(diagnostic('native-elements', `<${element.localName}>`, 'native-host-unsupported', __DEV__ && PROSE['native-host-unsupported'](element.localName)));
      }
      return;
    }
    const doc = element.ownerDocument;
    root.append(doc.createElement('slot'), doc.createElement(sentinelFor(win)));
    /** Development: a later attachShadow on this host says why it cannot, by name. */
    if (__DEV__)
      element.attachShadow = () => {
        throw new Error(diagnostic('native-elements', `<${element.localName}>`, 'native-host-shadow', __DEV__ && PROSE['native-host-shadow']()));
      };
  }
  element[SETUP] = [options, setup];
};

/**
 * Wire it: `wire([renderer, nativeElements])`. A CONNECTOR (`wire` hands it the registry): core's setup (`$in`) and
 * teardown (`$td`) come off it, and `$ne` tells core's development check this module is wired.
 */
export const nativeElements = (registry: Core & { $ne?: unknown }, w: (item: unknown) => void) => {
  core = registry;
  registry.$ne = true;
  w({ on: 'init', fn: onInit, priority: 50 });
};
