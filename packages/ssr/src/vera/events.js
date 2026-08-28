/**
 * Event dispatch with a propagation path.
 *
 * **Bubbling was absent, and the README said why**: this DOM held children as a string, so there was
 * no ancestor chain to walk and an event reached its own target's listeners and stopped. Child nodes
 * are retained now, so the chain exists and the reason has expired — a component dispatching a
 * `CustomEvent` that a parent listens for worked in the browser and did nothing on the server.
 *
 * The listeners live here rather than in the `EventTarget` these classes extend, because that one
 * cannot be asked to run *only* its capturing listeners: a direct dispatch runs them all, so the
 * three phases could not be told apart. What it did give — `once`, `handleEvent` objects, and a
 * return value reflecting `preventDefault` — is reproduced here and covered by the same tests.
 */

/** @param {any} options */
const capturing = (options) => (typeof options === 'boolean' ? options : Boolean(options?.capture));

/**
 * The path from a node out to its furthest ancestor, crossing a shadow boundary only for an event
 * declared `composed` — which is the rule that keeps a component's internals private.
 *
 * @param {any} node @param {boolean} composed
 */
export const pathFrom = (node, composed) => {
  const path = [];
  for (let current = node; current; ) {
    path.push(current);
    if (current._parent) {
      current = current._parent;
      continue;
    }
    current = composed && current._host ? current._host : null;
  }
  return path;
};

/** @param {any} node */
export const addListener = (node, type, callback, options) => {
  if (!callback) return;
  const listeners = (node._listeners ??= new Map());
  const key = `${type}`;
  const entries = listeners.get(key) ?? [];
  const capture = capturing(options);
  /** The platform ignores a duplicate registration of the same callback in the same phase. */
  if (entries.some((entry) => entry.callback === callback && entry.capture === capture)) return;
  entries.push({ callback, capture, once: Boolean(options?.once) });
  listeners.set(key, entries);
  options?.signal?.addEventListener?.('abort', () => removeListener(node, type, callback, options));
};

/** @param {any} node */
export const removeListener = (node, type, callback, options) => {
  const entries = node._listeners?.get(`${type}`);
  if (!entries) return;
  const capture = capturing(options);
  const index = entries.findIndex((entry) => entry.callback === callback && entry.capture === capture);
  if (index !== -1) entries.splice(index, 1);
};

/**
 * Run the listeners registered on one node for one phase.
 *
 * @param {any} node @param {any} event @param {'capture' | 'target' | 'bubble'} phase
 * @param {() => boolean} immediatelyStopped
 */
const runListeners = (node, event, phase, immediatelyStopped) => {
  const entries = node._listeners?.get(event.type);
  if (!entries?.length) return;
  Object.defineProperty(event, 'currentTarget', { value: node, configurable: true });
  /** A copy, because a listener may add or remove listeners while this runs. */
  for (const entry of [...entries]) {
    if (phase === 'capture' && !entry.capture) continue;
    if (phase === 'bubble' && entry.capture) continue;
    if (entry.once) removeListener(node, event.type, entry.callback, entry.capture);
    try {
      if (typeof entry.callback === 'function') entry.callback.call(node, event);
      else entry.callback?.handleEvent?.(event);
    } catch (error) {
      /** A listener that throws must not take the dispatch down, exactly as in a browser. */
      console.error('[vera] ssr: a listener threw', error);
    }
    if (immediatelyStopped()) return;
  }
};

/**
 * @param {any} node @param {any} event
 * @returns {boolean} false when a cancelable event was prevented, as the platform reports
 */
export const dispatch = (node, event) => {
  if (!event || typeof event.type !== 'string')
    throw new TypeError(`Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.`);

  const path = pathFrom(node, Boolean(event.composed));
  let stopped = false;
  let immediate = false;

  /**
   * Wrapped rather than read back: `cancelBubble` reflects `stopPropagation` on this platform's
   * `Event`, but nothing exposes `stopImmediatePropagation`, and the two have to be told apart —
   * one ends the walk, the other ends only the current node's listeners.
   */
  const original = {
    stop: event.stopPropagation?.bind(event),
    immediate: event.stopImmediatePropagation?.bind(event),
  };
  Object.defineProperty(event, 'stopPropagation', {
    value: () => {
      stopped = true;
      original.stop?.();
    },
    configurable: true,
  });
  Object.defineProperty(event, 'stopImmediatePropagation', {
    value: () => {
      stopped = true;
      immediate = true;
      original.immediate?.();
    },
    configurable: true,
  });
  Object.defineProperty(event, 'target', { value: node, configurable: true });
  Object.defineProperty(event, 'composedPath', { value: () => [...path], configurable: true });

  const immediatelyStopped = () => {
    if (!immediate) return false;
    immediate = false;
    return true;
  };

  /** Capturing runs outermost first, and never on the target itself. */
  for (let index = path.length - 1; index >= 1 && !stopped; index--)
    runListeners(path[index], event, 'capture', immediatelyStopped);

  if (!stopped) runListeners(path[0], event, 'target', immediatelyStopped);

  if (event.bubbles)
    for (let index = 1; index < path.length && !stopped; index++)
      runListeners(path[index], event, 'bubble', immediatelyStopped);

  Object.defineProperty(event, 'currentTarget', { value: null, configurable: true });
  return !event.defaultPrevented;
};
