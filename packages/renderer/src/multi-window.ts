/**
 * **`multiWindow` — components in the windows your page opens or embeds** (`@verajs/renderer/multi-window`; Brian
 * 2026-10-26). `wire([renderer, multiWindow])`. A component moved into a pop-out (`window.open`, an auxiliary browsing
 * context) or an iframe (a child navigable) is KEPT by core already (R4); this module releases the ones LEFT there when
 * that window goes away for good. Without it, a component left behind stays subscribed to this window's stores, alive and
 * running, for the life of the page.
 *
 * - **Which windows.** One a component of this core is ADOPTED into (core's `'adopted'` insert: moved there, or resumed
 *   there) or first CONNECTED in (an `'init'` insert: appended there directly). Each is watched once, in a WeakSet, so a
 *   dead window is never held.
 * - **When.** At that window's final `pagehide` (not `persisted`: a back/forward cached page comes back), on THIS realm's
 *   next task, so the app's own `pagehide` handlers run first, and moving a panel back home is what they do.
 * - **What.** The dead document is walked, shadow roots included (`_$r$` holds the closed ones core made), and every
 *   component of THIS core still in it is retired through core's own teardown (`$td`). Recognized by core's per-copy mark
 *   (`$m`), so two copies of core on one page never retire each other's components. A component moved back before the
 *   release is no longer there, and survives.
 * - **A connector**, as `@verajs/hot` is: each core it is wired into gets its own watch and release, against its own
 *   teardown and mark. It imports nothing.
 */
type Registry = { $td?: (element: Element) => void; $m?: symbol };
type Wire = (item: never) => void;

export const multiWindow = (registry: object, w: Wire) => {
  const core = registry as Registry;
  const watched = new WeakSet<object>();
  /** This realm's window: its timers run; a dead window's never fire. */
  const home = globalThis;
  const release = (dead: Document) => {
    const teardown = core.$td, mine = core.$m;
    if (teardown === undefined || mine === undefined) return;
    const walk = (root: ParentNode) => {
      for (const el of root.querySelectorAll('*')) {
        const inner = el.shadowRoot ?? (el as { _$r$?: ShadowRoot })._$r$;
        if (inner) walk(inner);
        if ((el as unknown as Record<symbol, unknown>)[mine] !== undefined && el.ownerDocument === dead) teardown(el);
      }
    };
    walk(dead);
  };
  const watch = (element: Element) => {
    const view = element.ownerDocument.defaultView;
    if (view === null || view === (home as unknown) || watched.has(view)) return;
    watched.add(view);
    view.addEventListener('pagehide', (event) => {
      if ((event as PageTransitionEvent).persisted) return;
      const dead = view.document;
      home.setTimeout(() => release(dead), 0);
    });
  };
  w([
    { name: '@verajs/renderer/multi-window', on: 'adopted', fn: watch, priority: 60 },
    { name: '@verajs/renderer/multi-window', on: 'init', fn: (element: Element) => { watch(element); }, priority: 60 },
  ] as never);
};
