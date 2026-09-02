/**
 * **The shim must not take globals its host still needs — and must still install every one the
 * server has always had.**
 *
 * `installShims()` writes ~35 globals. On a server that is free: Node defines none of them, so it
 * is filling an empty room. Off the main thread it is not free, and three of those writes were
 * measured breaking a host that had every right to expect them (`.probe/ssr-in-browser/`):
 *
 *   - `self` is a getter-only property of `WorkerGlobalScope`, so assigning it **threw** and the
 *     shim never finished installing.
 *   - `postMessage` is the only channel back from a worker, so replacing it with a no-op severed
 *     the host's reporting **silently** — a worker that rendered perfectly looked exactly like one
 *     that had crashed.
 *   - `location` is a read-only `WorkerLocation`, so `renderToString`'s `location` option — which
 *     mutates the object in place — threw. `??=` could not see it: a worker *has* a location, so
 *     the guard short-circuited and left the immutable one in place.
 *
 * Each fix is environment-agnostic on purpose: "do not replace what the environment already
 * provides" rather than a branch on which environment this is, so there is no worker-only path that
 * could rot untested. That makes the *server* the place to hold them, which is what this file is —
 * the browser half is `tests/browser/ssr-worker.test.js`, and only a real worker can run it.
 *
 * The asymmetry between `postMessage` and `close` is deliberate and asserted below, because it is
 * the kind of thing a later reader would "tidy" into consistency.
 */
import '@verajs/ssr';
import assert from 'node:assert/strict';
import test from 'node:test';
/**
 * Reached by relative path because the shim is internal — the package exports only its entry, and
 * this asserts a fact *about* the install. Importing it again is inert: `installShims()` returns
 * early on its own `__veraSsrShimmed` guard, so the globals under test are the ones the entry above
 * installed.
 */
import { LOCATION_PARTS } from '../packages/ssr/src/vera/shim.js';

test('location is an own, writable property the render can mutate in place', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  assert.ok(descriptor, 'location must be an OWN property, not inherited from the environment');
  assert.equal(descriptor.writable, true, 'renderToString({ location }) reassigns nothing but needs a mutable object');
  assert.equal(descriptor.configurable, true);

  /** What `applyLocation` does, which a read-only `WorkerLocation` refuses. */
  const before = globalThis.location.pathname;
  globalThis.location.pathname = '/mutated';
  assert.equal(globalThis.location.pathname, '/mutated');
  globalThis.location.pathname = before;
});

test('location carries every part, from the one list that names them', () => {
  for (const part of LOCATION_PARTS) {
    assert.notEqual(
      globalThis.location[part],
      undefined,
      `location.${part} is undefined — the install and LOCATION_PARTS disagree, so a render would ` +
        `restore a part it never saved`
    );
  }
});

test('the globals a server has always had are still installed', () => {
  /** A spot-check across the shim's kinds — not the full surface, which `ssr-dom-surface` holds. */
  for (const name of ['window', 'self', 'document', 'customElements', 'HTMLElement', 'history'])
    assert.notEqual(globalThis[name], undefined, `${name} must still be installed on the server`);
  assert.equal(globalThis.self, globalThis, 'self is the other name for the global');
  assert.equal(globalThis.window, globalThis);
});

test('postMessage is inert here, because Node has none to preserve', () => {
  /**
   * The `??=` only steps aside where the environment already provides one. Node does not — on the
   * main thread or inside `worker_threads` — so the server still gets the inert function, and a
   * component calling `window.postMessage()` during setup still cannot crash a render.
   */
  assert.equal(typeof globalThis.postMessage, 'function');
  assert.equal(globalThis.postMessage('anything'), undefined);
});

test('close stays unconditionally inert, unlike postMessage', () => {
  /**
   * The opposite answer from the same reasoning, and the reason this is asserted: in a worker
   * `close()` *terminates* it, so a component calling `window.close()` during setup would kill the
   * render. A no-op is both what a browser does for a page it did not open and what protects the
   * render — so this one is never handed back to the environment.
   */
  assert.equal(typeof globalThis.close, 'function');
  assert.equal(globalThis.close(), undefined);
});
