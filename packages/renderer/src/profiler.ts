/**
 * `@verajs/renderer/profiler` — a development-only render profiler.
 *
 * **What it is for.** The renderer commits a template by identity: if `strings` is the same array
 * as last time, values are written in place; if it is a different array, the subtree is destroyed
 * and rebuilt. Writing `${cond ? html`<a/>` : html`<b/>`}` swaps identity on every toggle, so what
 * looks like an update is a teardown — which is why the house guidance is a stable shape with
 * `?hidden=${…}`. Nothing surfaces that today. This does: it counts in-place updates against
 * rebuilds and names the template pairs that churn.
 *
 * **How to use it.** This entry re-exports the renderer's whole public API, so point your importmap
 * (or bundler alias) at it instead of `@verajs/renderer` and nothing else changes:
 *
 * ```js
 * import { render, startProfiling, stopProfiling, formatReport } from '@verajs/renderer/profiler';
 * startProfiling();
 * // …drive the app…
 * console.log(formatReport(stopProfiling()));
 * ```
 *
 * **Development only, by construction.** The instrumentation in `renderer.ts` sits behind
 * `__DEV__`, which the build folds to `false` before terser runs — so a production renderer carries
 * no hook, no call sites and no cost, and this entry is not built for production at all. Profiling
 * minified, property-mangled output would not be meaningful anyway.
 *
 * Like `./hydrate.ts`, this bundle contains its own copy of the renderer. Import the app's renderer
 * *through* this entry; importing both side by side gives you two renderer modules with two
 * template caches, and the profiler would observe an instance nothing renders into.
 */
import {
  _setProfileHook,
  PROFILE_UPDATE,
  PROFILE_CREATE,
  PROFILE_REBUILD,
  PROFILE_FRAME_START,
  PROFILE_FRAME_END,
} from './renderer.js';
import type { ChildPart } from './renderer.js';
import { mountOverlay } from './overlay.js';
import type { OverlayOptions } from './overlay.js';

export type { OverlayOptions } from './overlay.js';

export { render, keyed, hold, domRender } from './renderer.js';
export type { TemplateResult } from './renderer.js';

/** One template identity replacing another at the same position, and how often. */
export interface Churn {
  /** The template that was torn down, rendered readably. */
  from: string;
  /** The template that replaced it. */
  to: string;
  /** How many times this exact swap happened while profiling. */
  count: number;
  /** Where in the DOM it happened, e.g. `main#app > ul.list`. First occurrence only. */
  where: string;
}

export interface ProfileReport {
  /** Completed top-level `render()` calls. Nested renders are folded into their outermost frame. */
  frames: number;
  /** Total milliseconds spent inside `render()`. */
  ms: number;
  /** The slowest single frame, in milliseconds. */
  slowestFrameMs: number;
  /** Templates committed in place — the good path. */
  updates: number;
  /** Templates rendered into a slot that held nothing. Unavoidable and not a problem. */
  creates: number;
  /** Templates that replaced a *different* template — a teardown, not an update. */
  rebuilds: number;
  /** Rebuilds grouped by template pair, worst first. */
  churn: Churn[];
}

let active = false;
let frames = 0;
let updates = 0;
let creates = 0;
let rebuilds = 0;
let totalMs = 0;
let slowestMs = 0;
let depth = 0;
let frameStart = 0;
let churn = new Map<string, Churn>();

/** Stable ids for template identities, so grouping a rebuild costs two lookups and a concat. */
let nextId = 1;
const ids = new WeakMap<TemplateStringsArray, number>();
const idOf = (strings: TemplateStringsArray) => {
  let id = ids.get(strings);
  if (id === undefined) ids.set(strings, (id = nextId++));
  return id;
};

/** Readable one-line form of a template, cached — a rebuild loop would otherwise rebuild it too. */
const described = new WeakMap<TemplateStringsArray, string>();
const describe = (strings: TemplateStringsArray) => {
  let text = described.get(strings);
  if (text === undefined) {
    text = strings.join('${…}').replace(/\s+/g, ' ').trim();
    if (text.length > 72) text = text.slice(0, 71) + '…';
    described.set(strings, text);
  }
  return text;
};

/**
 * `parentElement` is null across a shadow boundary, which is exactly where components live — so
 * step to the host rather than reporting `(detached)` for every shadow root.
 */
const up = (node: Node): Element | null => {
  const parent = (node as Element).parentElement;
  if (parent !== null) return parent;
  const root = node.getRootNode();
  return root !== node && (root as ShadowRoot).host !== undefined ? (root as ShadowRoot).host : null;
};

/** Three levels of ancestry is enough to locate a slot without printing a whole path. */
const label = (node: Node | null): string => {
  const path: string[] = [];
  let el = node === null ? null : node.nodeType === 1 ? (node as Element) : up(node);
  for (let i = 0; i < 3 && el !== null; i++) {
    let part = el.localName;
    if (el.id) part += '#' + el.id;
    else {
      const cls = el.getAttribute('class');
      if (cls) part += '.' + cls.trim().split(/\s+/)[0];
    }
    path.unshift(part);
    el = up(el);
  }
  return path.length === 0 ? '(detached)' : path.join(' > ');
};

const hook = (kind: number, subject: unknown, shape: TemplateStringsArray | null) => {
  if (kind === PROFILE_UPDATE) {
    updates++;
    return;
  }
  if (kind === PROFILE_FRAME_START) {
    if (depth++ === 0) frameStart = performance.now();
    return;
  }
  if (kind === PROFILE_FRAME_END) {
    if (--depth === 0) {
      const elapsed = performance.now() - frameStart;
      totalMs += elapsed;
      if (elapsed > slowestMs) slowestMs = elapsed;
      frames++;
    }
    return;
  }
  if (kind === PROFILE_CREATE) {
    creates++;
    return;
  }
  if (kind !== PROFILE_REBUILD) return;

  rebuilds++;
  const part = subject as ChildPart;
  const from = part._shape;
  if (from === null || shape === null) return;
  const key = idOf(from) + '>' + idOf(shape);
  let record = churn.get(key);
  if (record === undefined) {
    churn.set(
      key,
      (record = { from: describe(from), to: describe(shape), count: 0, where: label(part._start) })
    );
  }
  record.count++;
};

const reset = () => {
  frames = updates = creates = rebuilds = depth = 0;
  totalMs = slowestMs = frameStart = 0;
  churn = new Map();
};

/** Begin collecting. Calling this while already profiling restarts the collection. */
export const startProfiling = () => {
  reset();
  active = true;
  _setProfileHook(hook);
};

/** What has been measured so far, without ending the session. Drives the live overlay. */
export const getReport = (): ProfileReport => ({
  frames,
  ms: totalMs,
  slowestFrameMs: slowestMs,
  updates,
  creates,
  rebuilds,
  churn: [...churn.values()].sort((a, b) => b.count - a.count),
});

/** Stop collecting and return what was measured. Safe to call when not profiling. */
export const stopProfiling = (): ProfileReport => {
  _setProfileHook(null);
  active = false;
  return getReport();
};

export const isProfiling = () => active;

/** Profile one synchronous stretch of work. */
export function profile<T>(fn: () => Promise<T>): Promise<{ result: T; report: ProfileReport }>;
export function profile<T>(fn: () => T): { result: T; report: ProfileReport };
export function profile<T>(fn: () => T | Promise<T>) {
  startProfiling();
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (error) {
    stopProfiling();
    throw error;
  }
  /**
   * An **async** driver is awaited before the report is taken.
   *
   * Driving an application means awaiting frames — the render scheduler is `requestAnimationFrame`,
   * so nothing commits within one synchronous turn. Stopping immediately therefore reported zero
   * updates, zero rebuilds and no churn for a page doing plenty of all three: a plausible-looking
   * answer, and the reader's conclusion is "nothing to fix here".
   */
  if (result && typeof (result as Promise<T>).then === 'function')
    return (result as Promise<T>).then(
      (value) => ({ result: value, report: stopProfiling() }),
      (error) => {
        stopProfiling();
        throw error;
      }
    );
  return { result: result as T, report: stopProfiling() };
}

/**
 * Mounts a live panel in the corner of the page and starts profiling. Returns a function that
 * removes it and stops. Plain DOM in a closed shadow root — it never renders itself through the
 * renderer, which would fold its own commits into the numbers it reports.
 */
export const showProfiler = (options?: OverlayOptions): (() => void) => {
  startProfiling();
  const unmount = mountOverlay(getReport, isProfiling, { start: startProfiling, stop: stopProfiling }, options);
  return () => {
    unmount();
    stopProfiling();
  };
};

/** Human-readable summary. The overlay renders the same data; this is for a console or a log. */
export const formatReport = (report: ProfileReport): string => {
  const committed = report.updates + report.creates + report.rebuilds;
  const share = committed === 0 ? 0 : Math.round((report.rebuilds / committed) * 100);
  const lines = [
    `${report.frames} frame(s), ${report.ms.toFixed(1)}ms total, slowest ${report.slowestFrameMs.toFixed(1)}ms`,
    `${report.updates} updated in place, ${report.creates} created, ${report.rebuilds} rebuilt (${share}% of commits)`,
  ];
  if (report.churn.length > 0) {
    lines.push('', 'Template identity churn — these were torn down, not updated:');
    for (const entry of report.churn) {
      lines.push(`  ${entry.count}x  at ${entry.where}`, `      ${entry.from}`, `   -> ${entry.to}`);
    }
    lines.push('', 'Prefer one stable template with ?hidden=${…} over swapping subtrees.');
  }
  return lines.join('\n');
};
