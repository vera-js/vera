import { hooksQueue, proxyCallbacks } from '../store/store.js';
import type { Signal } from '../types.js';

/** Records the running hook, if any, as depending on `obj[prop]`. */
const track = (obj: object, prop: PropertyKey) => {
  const hook = hooksQueue[hooksQueue.length - 1];
  if (hook === undefined) return;
  let props = proxyCallbacks.get(obj);
  if (props === undefined) proxyCallbacks.set(obj, (props = new Map()));
  let hooks = props.get(prop);
  if (hooks === undefined) props.set(prop, (hooks = new Set()));
  hooks.add(hook);
};

/** Wakes every live hook that read `obj[prop]`, dropping the ones whose element is gone. */
const trigger = (obj: object, prop: PropertyKey, signal: Signal<unknown>) => {
  const hooks = proxyCallbacks.get(obj)?.get(prop);
  if (hooks === undefined) return;
  for (const ref of hooks) {
    const hook = ref.deref();
    if (hook === undefined) hooks.delete(ref);
    else hook(signal);
  }
};

/** One handler for every store: a read subscribes, and a write that changes something wakes the readers. */
const handler: ProxyHandler<object> = {
  get(obj, prop, receiver) {
    const value = Reflect.get(obj, prop, receiver);
    track(obj, prop);
    return value !== null && typeof value === 'object' ? createProxy(value) : value;
  },
  set(obj, prop, value, receiver) {
    const prevValue = Reflect.get(obj, prop, receiver);
    if (prevValue === value) return true;
    const written = Reflect.set(obj, prop, value, receiver);
    if (written) trigger(obj, prop, { prop: prop as string, value, prevValue });
    return written;
  },
};

/**
 * Raw object → its proxy, for every store at once. The same object always comes back as the same
 * proxy — `state.a === state.a`, and `createStore(config) === createStore(config)` — where a fresh
 * proxy per read broke every identity comparison in consumer code (a list re-keying, a memo missing).
 * One map serves all stores because there is one handler: nothing about a proxy depends on which
 * store reached it.
 */
const proxies = new WeakMap<object, object>();

/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  let proxy = proxies.get(data);
  if (proxy === undefined) proxies.set(data, (proxy = new Proxy(data, handler)));
  return proxy as T;
};
