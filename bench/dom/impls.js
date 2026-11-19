/**
 * DOM benchmark implementations, in the shape of js-framework-benchmark.
 *
 * Every implementation must produce **identical markup** from **identical data** so the comparison
 * measures the framework rather than the app:
 *
 *   <tr class="{selected}"><td>{id}</td><td><a>{label}</a></td><td><a>x</a></td></tr>
 *
 * All lists are keyed by row id. Data comes from one seeded generator, so every framework renders
 * exactly the same strings in the same order.
 */

/* ── Shared data ────────────────────────────────────────────────────────────── */

const ADJECTIVES = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const COLORS = ['red','yellow','blue','green','pink','brown','purple','white','black','orange'];
const NOUNS = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

/** Deterministic PRNG (mulberry32) so every framework gets identical data. */
const makeRandom = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let nextId = 1;

export const buildData = (count, seed = 1) => {
  const rnd = makeRandom(seed);
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    const label = `${ADJECTIVES[(rnd() * ADJECTIVES.length) | 0]} ${COLORS[(rnd() * COLORS.length) | 0]} ${NOUNS[(rnd() * NOUNS.length) | 0]}`;
    data[i] = { id: nextId++, label };
  }
  return data;
};

export const resetIds = () => { nextId = 1; };

/* ── VeraJS ─────────────────────────────────────────────────────────────────── */

/**
 * `wire`, not `setRenderer` — that export was **removed** from core when `wire()` took over
 * registration, and this file kept importing it, so the browser benchmark had not built since. A
 * renderer is an insert at priority 50, and registering at a taken priority replaces, which is
 * exactly what the old call did.
 */
import * as vera from '@verajs/core';
import * as store from '@verajs/store';
const { init, createStore, setRenderScheduler, microtask, wire } = vera;
/** The raw hook: a public export until 2026-10-22, core's own hand-off since — by presence, so one page serves both builds. */
const createHook = vera.createHook ?? vera.inserts.$s?.[2];
/**
 * A reactive box for one value: `signal` (shallow by default) since 2026-10-22, `shallowRef` before it. Taken by
 * presence so the SAME page runs against a build from either side of the rename (a race's baseline may predate it).
 * Every box below holds a primitive or rows that are only ever replaced, so shallow is exact.
 */
const signal = vera.signal ?? vera.shallowRef ?? store.signal;
import { html as litHtml, render as litRender, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';

const veraImpl = (mount) => {
  /**
   * The same scheduling model Lit and Vue use in this table: both flush on a microtask, so the
   * measurement window between "framework told to update" and paint contains no frame boundary.
   * `microtask` is core's documented scheduler for exactly this trade — see setRenderScheduler.
   */
  setRenderScheduler(microtask);
  wire({ on: 'render', fn: litRender, priority: 50 });

  const host = document.createElement('div');
  mount.appendChild(host);

  /**
   * A shallow `signal`, deliberately, and this is what makes the comparison fair.
   *
   * The row objects are immutable snapshots — every operation replaces the array rather than
   * mutating a row — so deep-proxying them would be pure overhead. It would also not match what
   * the others do: Lit holds rows in a reactive property, React in `useState`, Van in a state cell,
   * and in all three the row objects are plain data. A shallow signal is the exact equivalent.
   *
   * An earlier version used `createStore({ rows })`, which proxies all 1 000 rows. That is the
   * analog of wrapping the whole dataset in Vue's `reactive()`, which no other implementation
   * here does, and it cost 2.6 ms per render pass against 0.03 ms.
   */
  const rows = signal([]);
  const selected = signal(-1);

  init(host, () => {
    return () => {
      const list = rows.value;
      /** Read once, not once per row — the others close over a local too. */
      const sel = selected.value;
      return litHtml`<table><tbody>
      ${repeat(
        list,
        (r) => r.id,
        (r) => litHtml`<tr class=${sel === r.id ? 'selected' : nothing}>
          <td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td>
        </tr>`
      )}
    </tbody></table>`;
    };
  });

  return {
    create: (n, seed) => { rows.value = buildData(n, seed); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next;
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => { selected.value = rows.value[i]?.id ?? -1; },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/* ── Lit ────────────────────────────────────────────────────────────────────── */

import { LitElement } from 'lit';

const litImpl = (mount) => {
  class BenchTable extends LitElement {
    static properties = { rows: { state: true }, selected: { state: true } };
    /** Light DOM, so all four render into the same tree and paint costs are comparable. */
    createRenderRoot() { return this; }
    constructor() { super(); this.rows = []; this.selected = -1; }
    render() {
      return litHtml`<table><tbody>${repeat(
          this.rows,
          (r) => r.id,
          /** One line: the indentation was whitespace text nodes in every row, DOM no other implementation built (2026-10-18). */
          (r) => litHtml`<tr class=${this.selected === r.id ? 'selected' : nothing}><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`
      )}</tbody></table>`;
    }
  }
  if (!customElements.get('bench-table')) customElements.define('bench-table', BenchTable);

  const el = document.createElement('bench-table');
  mount.appendChild(el);
  const settle = () => el.updateComplete;

  return {
    create: (n, seed) => { el.rows = buildData(n, seed); return settle(); },
    append: (n, seed) => { el.rows = el.rows.concat(buildData(n, seed)); return settle(); },
    updateEvery10th: () => {
      const rows = el.rows.slice();
      for (let i = 0; i < rows.length; i += 10) rows[i] = { ...rows[i], label: rows[i].label + ' !!!' };
      el.rows = rows; return settle();
    },
    swap: () => {
      const rows = el.rows.slice();
      if (rows.length > 998) { const t = rows[1]; rows[1] = rows[998]; rows[998] = t; }
      el.rows = rows; return settle();
    },
    select: (i) => { el.selected = el.rows[i]?.id ?? -1; return settle(); },
    remove: (i) => { const rows = el.rows.slice(); rows.splice(i, 1); el.rows = rows; return settle(); },
    clear: () => { el.rows = []; return settle(); },
    teardown: () => { el.remove(); },
  };
};

/**
 * **P0: the userland ceiling of "rows as their own tracked scopes + a keyed selector"** (DESIGN-FINE-GRAINED S4 + S3,
 * 2026-10-18), with NO framework change: each row is an `init` component with its own store, the list re-renders only
 * when the ARRAY changes, and select / update write the affected rows' stores directly (the selector's effect, by
 * hand: the old and the new row only). Rows are `<div>`s, like "VeraJS components" (custom elements inside `<tbody>`
 * are foster-parented). Not the product's numbers: what the model can do at best today.
 */
class VeraFineRow extends HTMLElement {
  set rec(value) { this.r = value; }
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    const { id, s } = this.r;
    init(this, () => () => rawHtml`<div class="${s.sel ? 'selected' : null}"><span>${id}</span><a>${s.label}</a><a>x</a></div>`);
  }
}

const veraFineImpl = (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  if (!customElements.get('vb-frow')) customElements.define('vb-frow', VeraFineRow);
  const host = document.createElement('div');
  mount.appendChild(host);
  const rows = signal([]);
  let selected;
  const recs = (data) => data.map((d) => ({ id: d.id, s: createStore({ label: d.label, sel: false }) }));
  init(host, () => () => rawHtml`<div>${rows.value.map((r) => keyed(r.id, rawHtml`<vb-frow .rec=${r}></vb-frow>`))}</div>`);
  return {
    create: (n, seed) => { selected = undefined; rows.value = recs(buildData(n, seed)); },
    append: (n, seed) => { rows.value = rows.value.concat(recs(buildData(n, seed))); },
    updateEvery10th: () => { const r = rows.value; for (let i = 0; i < r.length; i += 10) r[i].s.label += ' !!!'; },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => {
      const next = rows.value[i];
      if (selected !== undefined) selected.s.sel = false;
      selected = next;
      if (next !== undefined) next.s.sel = true;
    },
    remove: (i) => { const next = rows.value.slice(); const [gone] = next.splice(i, 1); if (gone === selected) selected = undefined; rows.value = next; },
    clear: () => { selected = undefined; rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/**
 * **P1e: P1's shape emulated with public APIs** (DESIGN-FINE-GRAINED, 2026-10-18): TABLE markup, no component per row.
 * The list renders keyed `<tr>` shells, and each row gets its own store plus a core's raw hook (internal) (owner: a plain per-row
 * object, chained to the list's component) that renders its cells into its `<tr>` and sets its class. Select and
 * update write the affected rows' stores only. Emulation limits (not P1's): the hooks run on every write, not once per
 * flush; rows are disposed only with the list; each row is two template instances (shell + cells), where P1's `each`
 * would build one. A timing probe, never shipped.
 */
const veraFineP1eImpl = (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  const host = document.createElement('div');
  mount.appendChild(host);
  const rows = signal([]);
  let selected;
  const cells = (rec) => rawHtml`<td>${rec.id}</td><td><a>${rec.s.label}</a></td><td><a>x</a></td>`;
  /** The element ref of a row's `<tr>`: on its first element, the row's scope is made and run once. */
  const recs = (data) => data.map((d) => {
    const rec = { id: d.id, s: createStore({ label: d.label, sel: false }), el: null };
    rec.ref = { get value() { return rec.el; }, set value(el) {
      if (el === null || rec.el !== null) return;
      rec.el = el;
      const run = createHook({ priority: 50, element: rec.owner = {}, callback: () => {
        if (rec.s.sel) el.className = 'selected'; else el.removeAttribute('class');
        veraDomRender(cells(rec), el);
      } });
      run();
    } };
    return rec;
  });
  init(host, () => () => rawHtml`<table><tbody>${rows.value.map((r) => keyed(r.id, rawHtml`<tr ${r.ref}></tr>`))}</tbody></table>`);
  return {
    create: (n, seed) => { selected = undefined; rows.value = recs(buildData(n, seed)); },
    append: (n, seed) => { rows.value = rows.value.concat(recs(buildData(n, seed))); },
    updateEvery10th: () => { const r = rows.value; for (let i = 0; i < r.length; i += 10) r[i].s.label += ' !!!'; },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => {
      const next = rows.value[i];
      if (selected !== undefined) selected.s.sel = false;
      selected = next;
      if (next !== undefined) next.s.sel = true;
    },
    remove: (i) => { const next = rows.value.slice(); const [gone] = next.splice(i, 1); if (gone === selected) selected = undefined; rows.value = next; },
    clear: () => { selected = undefined; rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/**
 * **The creation ablation of P1e** (2026-10-18): which part of a reactive row costs at creation? `store` gives each row a
 * `createStore`; `split` renders the row as a `<tr>` shell plus its cells in a second instance (`renderInto` at ref time);
 * `hook` makes the cells a core's raw hook (internal) scope (reading the store when there is one). Creation rows only; timing probe.
 */
const veraAblationImpl = ({ store, split, hook }) => (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  const host = document.createElement('div');
  mount.appendChild(host);
  const rows = signal([]);
  const cells = (rec) => rawHtml`<td>${rec.id}</td><td><a>${store ? rec.s.label : rec.label}</a></td><td><a>x</a></td>`;
  const recs = (data) => data.map((d) => {
    const rec = { id: d.id, label: d.label, el: null };
    if (store) rec.s = createStore({ label: d.label, sel: false });
    if (split) rec.ref = { get value() { return rec.el; }, set value(el) {
      if (el === null || rec.el !== null) return;
      rec.el = el;
      if (hook) createHook({ priority: 50, element: rec.owner = {}, callback: () => veraDomRender(cells(rec), el) })();
      else veraDomRender(cells(rec), el);
    } };
    return rec;
  });
  init(host, () => () => rawHtml`<table><tbody>${rows.value.map((r) => keyed(r.id, split ? rawHtml`<tr ${r.ref}></tr>` : rawHtml`<tr>${cells(r)}</tr>`))}</tbody></table>`);
  return {
    create: (n, seed) => { rows.value = recs(buildData(n, seed)); },
    append: (n, seed) => { rows.value = rows.value.concat(recs(buildData(n, seed))); },
    updateEvery10th: () => {}, swap: () => {}, select: () => {}, remove: () => {},
    clear: () => { rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/**
 * **S6(a): O(changed) by ITEM IDENTITY** (DESIGN-FINE-GRAINED S6, 2026-10-18). `eachList(keyOf, renderRow)` keeps one
 * result per key and reuses it (the same object, marked reusable) while the row's item is the same object and the key
 * wasn't invalidated; the renderer's opt-in identity skip then passes it with one `===`. Immutable updates rebuild only
 * the rows whose item changed; select invalidates the old and new keys (the selector's whole job) and re-runs the list
 * once, so it's O(n) identity checks with 2 rows rebuilt. Needs the MARKED renderer (probe/marked): built through
 * scratch/s6/build-s6.mjs. Prototype: the cache keeps keys of removed rows (pruned by size only).
 */
const eachList = (keyOf, renderRow) => {
  let cache = new Map();
  let dirty = null;
  const list = (items) => {
    const out = new Array(items.length);
    const next = items.length < cache.size / 2 ? new Map() : cache;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const k = keyOf(item);
      let c = cache.get(k);
      if (c === undefined || c.item !== item || (dirty !== null && dirty.has(k))) {
        const r = keyed(k, renderRow(item));
        r._$same$ = 1;
        c = { item, result: r };
      }
      if (next !== cache || c !== cache.get(k)) next.set(k, c);
      out[i] = c.result;
    }
    cache = next;
    dirty = null;
    return out;
  };
  list.invalidate = (...keys) => { dirty ??= new Set(); for (const k of keys) dirty.add(k); };
  return list;
};

const veraS6aImpl = (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  const host = document.createElement('div');
  mount.appendChild(host);
  const rows = signal([]);
  const selected = signal(-1);
  const list = eachList((r) => r.id, (r) => rawHtml`<tr class="${selected.value === r.id ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`);
  init(host, () => () => { void selected.value; return rawHtml`<table><tbody>${list(rows.value)}</tbody></table>`; });
  return {
    create: (n, seed) => { rows.value = buildData(n, seed); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next;
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => { const id = rows.value[i]?.id ?? -1; list.invalidate(selected.value, id); selected.value = id; },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/**
 * **P1: `each` + a selector on `createStore`** (worktree probe/p1; DESIGN-FINE-GRAINED §P1). The selector is a store
 * of per-key flags: a row reads `flags[id]`, so core's per-key Set wakes exactly the old and the new row on a select.
 * `store` builds the rows in a `createStore` (mutated in place: Brian's idiom); otherwise rows are plain objects in a
 * shallow signal, replaced on update. Only in bundle-p1.js; elsewhere the entries are skipped.
 */
const veraP1Impl = (store) => (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  /** `lists` since 2026-10-22, `eachList` before: by presence, so one page serves builds on either side. */
  wire([keyedModule.lists ?? keyedModule.eachList]);
  const host = document.createElement('div');
  mount.appendChild(host);
  const flags = createStore({});
  let selected;
  const state = store ? createStore({ rows: [] }) : null;
  const plain = store ? null : signal([]);
  const rowsOf = () => (store ? state.rows : plain.value);
  const key = (r) => r.id;
  const row = (r) => rawHtml`<tr class="${flags[r.id] === true ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`;
  init(host, () => () => rawHtml`<table><tbody>${keyedModule.each(rowsOf(), key, row)}</tbody></table>`);
  const set = (next) => { if (store) state.rows = next; else plain.value = next; };
  return {
    create: (n, seed) => { selected = undefined; set(buildData(n, seed)); },
    append: (n, seed) => { if (store) state.rows.push(...buildData(n, seed)); else plain.value = plain.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      if (store) { const r = state.rows; for (let i = 0; i < r.length; i += 10) r[i].label += ' !!!'; }
      else { const next = plain.value.slice(); for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' }; plain.value = next; }
    },
    swap: () => {
      if (store) { const r = state.rows; if (r.length > 998) { const t = r[1]; r[1] = r[998]; r[998] = t; } }
      else { const next = plain.value.slice(); if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; } plain.value = next; }
    },
    select: (i) => {
      const id = rowsOf()[i]?.id;
      if (selected !== undefined) flags[selected] = false;
      selected = id;
      if (id !== undefined) flags[id] = true;
    },
    remove: (i) => { if (store) state.rows.splice(i, 1); else { const next = plain.value.slice(); next.splice(i, 1); plain.value = next; } },
    clear: () => { selected = undefined; set([]); },
    teardown: () => { host.remove(); },
  };
};

/** Today's idiom with `createStore` rows (no `each`): the fair baseline for a store app. */
/**
 * **Automatic `.map` lists** (2026-10-23, the pre-strip record row): a store array mapped inside the render with `lists`
 * wired and NO `keyed()` — rows key themselves by `id` — and selection through `createSelector`, which re-renders only
 * the old and the new row. Microtask scheduling, as VeraJS own, so the two differ only in how the list is written. Only
 * where the core has `lists` and `createSelector` (absent before 2026-10-22; the entry is skipped there).
 */
const veraAutoImpl = (mount) => {
  setRenderScheduler(microtask);
  wireVera();
  /** `lists` since 2026-10-22, `eachList` before: by presence, so one page serves builds on either side. */
  wire([keyedModule.lists ?? keyedModule.eachList]);
  const host = document.createElement('div');
  mount.appendChild(host);
  const state = createStore({ rows: [], selected: -1 });
  /** The selector is a hook, so it is made in the setup — the component owns it. */
  init(host, () => {
    const isSelected = keyedModule.createSelector(() => state.selected);
    return () => rawHtml`<table><tbody>${state.rows.map((r) => rawHtml`<tr class="${isSelected(r.id) ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`)}</tbody></table>`;
  });
  return {
    create: (n, seed) => { state.rows = buildData(n, seed); },
    append: (n, seed) => { state.rows.push(...buildData(n, seed)); },
    updateEvery10th: () => { const r = state.rows; for (let i = 0; i < r.length; i += 10) r[i].label += ' !!!'; },
    swap: () => { const r = state.rows; if (r.length > 998) { const t = r[1]; r[1] = r[998]; r[998] = t; } },
    select: (i) => { state.selected = state.rows[i]?.id ?? -1; },
    remove: (i) => { state.rows.splice(i, 1); },
    clear: () => { state.rows = []; },
    teardown: () => { host.remove(); },
  };
};

const veraStoreDefaultImpl = (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  const host = document.createElement('div');
  mount.appendChild(host);
  const state = createStore({ rows: [], selected: -1 });
  init(host, () => () => {
    const sel = state.selected;
    return rawHtml`<table><tbody>${state.rows.map((r) => keyed(r.id, rawHtml`<tr class="${sel === r.id ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`))}</tbody></table>`;
  });
  return {
    create: (n, seed) => { state.rows = buildData(n, seed); },
    append: (n, seed) => { state.rows.push(...buildData(n, seed)); },
    updateEvery10th: () => { const r = state.rows; for (let i = 0; i < r.length; i += 10) r[i].label += ' !!!'; },
    swap: () => { const r = state.rows; if (r.length > 998) { const t = r[1]; r[1] = r[998]; r[998] = t; } },
    select: (i) => { state.selected = state.rows[i]?.id ?? -1; },
    remove: (i) => { state.rows.splice(i, 1); },
    clear: () => { state.rows = []; },
    teardown: () => { host.remove(); },
  };
};

/** Vue as its own benchmark entry writes it: a compiled template with keyed v-for and v-memo, labels edited in place. */
import VueRows from './vue/Rows.vue';
import { rows as vueRows, selected as vueSelected } from './vue/state.js';

import VueReactiveRows from './vue/ReactiveRows.vue';
import { state as vueState } from './vue/reactive-state.js';
const vueReactiveImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);
  vueState.rows = [];
  vueState.selected = -1;
  const app = createApp(VueReactiveRows);
  app.mount(host);
  return {
    create: (n, seed) => { vueState.rows = buildData(n, seed); return nextTick(); },
    append: (n, seed) => { vueState.rows.push(...buildData(n, seed)); return nextTick(); },
    updateEvery10th: () => { const r = vueState.rows; for (let i = 0; i < r.length; i += 10) r[i].label += ' !!!'; return nextTick(); },
    swap: () => { const r = vueState.rows; if (r.length > 998) { const t = r[1]; r[1] = r[998]; r[998] = t; } return nextTick(); },
    select: (i) => { vueState.selected = vueState.rows[i]?.id ?? -1; return nextTick(); },
    remove: (i) => { vueState.rows.splice(i, 1); return nextTick(); },
    clear: () => { vueState.rows = []; return nextTick(); },
    teardown: () => { app.unmount(); host.remove(); },
  };
};
const vueCompiledImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);
  vueRows.value = [];
  vueSelected.value = -1;
  const app = createApp(VueRows);
  app.mount(host);
  const settle = () => nextTick();
  const setRows = (next = vueRows.value.slice()) => { vueRows.value = next; };
  return {
    create: (n, seed) => { setRows(buildData(n, seed)); return settle(); },
    append: (n, seed) => { setRows(vueRows.value.concat(buildData(n, seed))); return settle(); },
    updateEvery10th: () => { const r = vueRows.value; for (let i = 0; i < r.length; i += 10) r[i].label += ' !!!'; setRows(); return settle(); },
    swap: () => { const r = vueRows.value; if (r.length > 998) { const t = r[1]; r[1] = r[998]; r[998] = t; setRows(); } return settle(); },
    select: (i) => { vueSelected.value = vueRows.value[i]?.id ?? -1; return settle(); },
    remove: (i) => { vueRows.value.splice(i, 1); setRows(); return settle(); },
    clear: () => { setRows([]); return settle(); },
    teardown: () => { app.unmount(); host.remove(); },
  };
};

/* ── Van.js ─────────────────────────────────────────────────────────────────── */

import van from 'vanjs-core';

/**
 * Van.js as its own benchmark entry writes it (krausest/js-framework-benchmark frameworks/keyed/vanjs/src/Main.js,
 * checked 2026-10-18): rows are added one by one, each a binding over a per-row `deleted` state, labels are states,
 * selection is ONE derive that touches the old and new row, and swap moves two DOM nodes. Van has no keyed list, so this
 * is how its authors write one. Adapted to this harness's markup: no ids or handlers on rows, and the old row's class
 * is removed (not set to "") so an unselected row carries no class attribute, as in every other implementation. The
 * harness removes by INDEX where upstream removes by row, so deleted rows are filtered before each op (upstream filters
 * lazily, at half deleted): one pass over the rows, a few µs.
 */
const vanIdiomaticImpl = (mount) => {
  const { table, tbody, tr, td, a } = van.tags;
  const body = tbody();
  mount.appendChild(table(body));
  let rows = [];
  let numDeleted = 0;
  /** Upstream finds a row's element by its `id` attribute; this markup has none, so a map does the same O(1) lookup. */
  const byId = new Map();
  const selected = van.state(-1);
  van.derive(() => {
    const { val, oldVal } = selected;
    byId.get(oldVal)?.el?.removeAttribute('class');
    const now = byId.get(val);
    if (now?.el) now.el.className = 'selected';
  });
  const live = () => { if (numDeleted) { rows = rows.filter((r) => !r.deleted.val); numDeleted = 0; } };
  const addRows = (data) => {
    for (const { id, label } of data) {
      const row = { id, label: van.state(label), deleted: van.state(false), el: null };
      van.add(body, () => (row.deleted.val ? null : (row.el = tr(td(String(id)), td(a(row.label)), td(a('x'))))));
      rows.push(row);
      byId.set(id, row);
    }
  };
  const clear = () => { body.textContent = ''; rows = []; byId.clear(); numDeleted = 0; };
  return {
    create: (n, seed) => { clear(); addRows(buildData(n, seed)); },
    append: (n, seed) => { addRows(buildData(n, seed)); },
    updateEvery10th: () => { live(); for (let i = 0; i < rows.length; i += 10) rows[i].label.val += ' !!!'; },
    swap: () => {
      live();
      if (rows.length > 998) {
        const t = rows[1]; rows[1] = rows[998]; rows[998] = t;
        const spare = document.createElement('span');
        const dom1 = body.childNodes[1], dom2 = body.childNodes[998];
        dom1.replaceWith(spare); dom2.replaceWith(dom1); spare.replaceWith(dom2);
      }
    },
    select: (i) => { live(); selected.val = rows[i]?.id ?? -1; },
    remove: (i) => { live(); rows[i].deleted.val = true; numDeleted++; },
    clear,
    teardown: () => { mount.textContent = ''; },
  };
};

const vanImpl = (mount) => {
  const { table, tbody, tr, td, a } = van.tags;
  const rows = van.state([]);
  const selected = van.state(-1);

  /**
   * The derived child is the `tbody` itself — wrapping one in another produced nested `<tbody>`
   * elements. `class` is a reactive *prop* binding so selecting a row does not rebuild every row.
   *
   * Note this is genuinely how Van.js works: it has no keyed reconciliation, so any change to
   * `rows` rebuilds the list. That is a property of the library, not a flaw in this harness.
   */
  const host = table(() =>
    tbody(
      rows.val.map((r) =>
        tr(
          { class: () => (selected.val === r.id ? 'selected' : '') },
          td(String(r.id)),
          td(a(r.label)),
          td(a('x'))
        )
      )
    )
  );
  mount.appendChild(host);

  return {
    create: (n, seed) => { rows.val = buildData(n, seed); },
    append: (n, seed) => { rows.val = rows.val.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.val.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.val = next;
    },
    swap: () => {
      const next = rows.val.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.val = next;
    },
    select: (i) => { selected.val = rows.val[i]?.id ?? -1; },
    remove: (i) => { const next = rows.val.slice(); next.splice(i, 1); rows.val = next; },
    clear: () => { rows.val = []; },
    teardown: () => { host.remove(); },
  };
};

/* ── React ──────────────────────────────────────────────────────────────────── */

import { createElement as h, useState, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const reactImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);
  const root = createRoot(host);

  let setRows, setSelected;

  const Row = memo(({ row, selected }) =>
    h('tr', { className: selected ? 'selected' : undefined },
      h('td', null, row.id),
      h('td', null, h('a', null, row.label)),
      h('td', null, h('a', null, 'x'))
    )
  );

  function App() {
    const [rows, _setRows] = useState([]);
    const [selected, _setSelected] = useState(-1);
    setRows = _setRows;
    setSelected = _setSelected;
    return h('table', null,
      h('tbody', null, rows.map((r) => h(Row, { key: r.id, row: r, selected: selected === r.id })))
    );
  }

  /** flushSync makes React's work synchronous so it is timed like the others, not deferred. */
  const sync = (fn) => flushSync(fn);
  flushSync(() => root.render(h(App)));

  let current = [];
  return {
    create: (n, seed) => { current = buildData(n, seed); sync(() => setRows(current)); },
    append: (n, seed) => { current = current.concat(buildData(n, seed)); sync(() => setRows(current)); },
    updateEvery10th: () => {
      const next = current.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      current = next; sync(() => setRows(current));
    },
    swap: () => {
      const next = current.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      current = next; sync(() => setRows(current));
    },
    select: (i) => { const id = current[i]?.id ?? -1; sync(() => setSelected(id)); },
    remove: (i) => { const next = current.slice(); next.splice(i, 1); current = next; sync(() => setRows(current)); },
    clear: () => { current = []; sync(() => setRows(current)); },
    teardown: () => { root.unmount(); host.remove(); },
  };
};

/* ── VeraJS + its own renderer ──────────────────────────────────────────────── */

import { renderInto as veraDomRender } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';
/** P1 probe only: `each` / `eachList` exist in the P1 worktree's keyed build (bundle-p1.js); undefined elsewhere. */
import * as keyedModule from '@verajs/renderer/keyed';
import { renderer as veraRenderer } from '@verajs/renderer';
import { slots as veraSlots } from '@verajs/renderer/slots';

/**
 * How the Vera implementations are wired, chosen by the page's `?vera=` (2026-10-18), so ONE bundle races wired two
 * ways: absent, the bare render descriptor this benchmark has always used; `app`, `wire([renderer])`, what an app
 * writes; `slots`, `wire([renderer, slots])`. Every page is its own browser in `race.mjs`, so a wiring never leaks
 * into the next variant.
 */
const wireVera = () => {
  const mode = new URLSearchParams(location.search).get('vera');
  /** What actually got wired, read off the registry (`_$capture$` is slots' protocol), for `race.mjs` to check against the variant. */
  const seen = (label) => (registry) => { window.__VERA_WIRING__ = registry._$capture$ !== undefined ? `${label}+slots` : label; window.__VERA_REGISTRY__ = registry; };
  if (mode === 'slots') wire([veraRenderer, veraSlots, seen('slots')]);
  else if (mode === 'app') wire([veraRenderer, seen('app')]);
  else wire([{ on: 'render', fn: veraDomRender, priority: 50 }, seen('legacy')]);
};

/**
 * The configuration the project advertises: core plus `@verajs/renderer`, no lit-html.
 *
 * The renderer is template-identity based (the ground-up rewrite): the row template parses once,
 * every update commits only changed values, and the list reconciles keyed via `keyed()`. Note there
 * is no `repeat` import and no `nothing` sentinel — keying is built in, and `null` removes an
 * attribute.
 */
const rawHtml = (strings, ...values) => ({ _$litType$: 1, strings, values });

/**
 * The scheduler core starts with, captured before any implementation replaces it: what an app gets by not calling
 * `setRenderScheduler` at all (frames before 2026-10-08; since, a microtask within a per-frame budget).
 */
const DEFAULT_SCHEDULER = setRenderScheduler(microtask);
setRenderScheduler(DEFAULT_SCHEDULER);

/**
 * `textarea` (2026-11-18): the row's label is a hole inside a `<textarea>` — the form case, raced for a change that moves
 * text-only elements' holes off the plain text path (create writes each, update every 10th rewrites one in ten).
 */
const veraOwnImpl = (mount, scheduler = microtask, textarea = false) => {
  /** Microtask scheduling, matching Lit and Vue — see the note in veraImpl. */
  setRenderScheduler(scheduler);
  wireVera();

  const host = document.createElement('div');
  mount.appendChild(host);

  const rows = signal([]);
  const selected = signal(-1);

  const view = () => {
    const list = rows.value;
    const sel = selected.value;
    return rawHtml`<table><tbody>${list.map((r) =>
      keyed(
        r.id,
        textarea
          ? rawHtml`<tr class="${sel === r.id ? 'selected' : null}"><td>${r.id}</td><td><textarea>${r.label}</textarea></td><td><a>x</a></td></tr>`
          : rawHtml`<tr class="${sel === r.id ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`
      )
    )}</tbody></table>`;
  };
  /**
   * The setup in whichever form the core has (2026-10-23), so ONE page measures a core of either era: a core that
   * exports `render` and `mount` (the released engine) opens with `init(host)` and installs the render with `render()`;
   * today's takes the setup as `init`'s function. The template is the same either way.
   */
  if (typeof vera.render === 'function' && typeof vera.mount === 'function') {
    init(host);
    vera.render(view);
  } else init(host, () => view);

  return {
    create: (n, seed) => { rows.value = buildData(n, seed); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next;
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => { selected.value = rows.value[i]?.id ?? -1; },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/**
 * **Each row a LIGHT custom element** (2026-10-18): a plain `init` component with no slot, the shape a real
 * app's list has. Raced with slots unwired and wired, it is where slots' tax on plain components (#16) shows, which
 * the template rows above cannot. Rows are `<div>`s, since a custom element inside `<tbody>` is foster-parented out of
 * the table when a template is parsed.
 */
class VeraBenchRow extends HTMLElement {
  constructor() { super(); this.r = signal(undefined); this.s = signal(false); this.started = false; }
  set row(value) { this.r.value = value; }
  set sel(value) { this.s.value = value; }
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    init(this, () => () => {
      const row = this.r.value;
      return rawHtml`<div class="${this.s.value ? 'selected' : null}"><span>${row.id}</span><a>${row.label}</a><a>x</a></div>`;
    });
  }
}

const veraComponentsImpl = (mount) => {
  setRenderScheduler(DEFAULT_SCHEDULER);
  wireVera();
  if (!customElements.get('vb-row')) customElements.define('vb-row', VeraBenchRow);

  const host = document.createElement('div');
  mount.appendChild(host);

  const rows = signal([]);
  const selected = signal(-1);

  init(host, () => {
    return () => {
      const list = rows.value;
      const sel = selected.value;
      return rawHtml`<div>${list.map((r) => keyed(r.id, rawHtml`<vb-row .row=${r} .sel=${sel === r.id}></vb-row>`))}</div>`;
    };
  });

  return {
    create: (n, seed) => { rows.value = buildData(n, seed); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next;
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => { selected.value = rows.value[i]?.id ?? -1; },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; },
    teardown: () => { host.remove(); },
  };
};

/* ── Vue ────────────────────────────────────────────────────────────────────── */

import { createApp, h as vueH, shallowRef as vueShallowRef, nextTick } from 'vue';

const vueImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);

  const rows = vueShallowRef([]);
  const selected = vueShallowRef(-1);

  const app = createApp({
    setup: () => () =>
      vueH('table', null, [
        vueH(
          'tbody',
          null,
          rows.value.map((r) =>
            vueH('tr', { key: r.id, class: selected.value === r.id ? 'selected' : undefined }, [
              vueH('td', null, String(r.id)),
              vueH('td', null, vueH('a', null, r.label)),
              vueH('td', null, vueH('a', null, 'x')),
            ])
          )
        ),
      ]),
  });
  app.mount(host);

  /** Vue flushes on a microtask; nextTick is its "DOM is written" signal. */
  const settle = () => nextTick();

  return {
    create: (n, seed) => { rows.value = buildData(n, seed); return settle(); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); return settle(); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next; return settle();
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next; return settle();
    },
    select: (i) => { selected.value = rows.value[i]?.id ?? -1; return settle(); },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; return settle(); },
    clear: () => { rows.value = []; return settle(); },
    teardown: () => { app.unmount(); host.remove(); },
  };
};

/* ── Solid ──────────────────────────────────────────────────────────────────── */

import { createSignal, For } from 'solid-js';
import { render as solidRender } from 'solid-js/web';
import solidH from 'solid-js/h';

/** Hyperscript rather than JSX, so the harness needs no compiler. Solid updates synchronously. */
const solidImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);

  let setRows, setSelected, getRows;

  const dispose = solidRender(() => {
    const [rows, _setRows] = createSignal([]);
    const [selected, _setSelected] = createSignal(-1);
    setRows = _setRows;
    setSelected = _setSelected;
    getRows = rows;

    return solidH(
      'table',
      solidH(
        'tbody',
        solidH(For, { each: () => rows() }, (r) =>
          solidH(
            'tr',
            { class: () => (selected() === r.id ? 'selected' : '') },
            solidH('td', () => r.id),
            solidH('td', solidH('a', () => r.label)),
            solidH('td', solidH('a', 'x'))
          )
        )
      )
    );
  }, host);

  return {
    create: (n, seed) => { setRows(buildData(n, seed)); },
    append: (n, seed) => { setRows(getRows().concat(buildData(n, seed))); },
    updateEvery10th: () => {
      const next = getRows().slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      setRows(next);
    },
    swap: () => {
      const next = getRows().slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      setRows(next);
    },
    select: (i) => { setSelected(getRows()[i]?.id ?? -1); },
    remove: (i) => { const next = getRows().slice(); next.splice(i, 1); setRows(next); },
    clear: () => { setRows([]); },
    teardown: () => { dispose(); host.remove(); },
  };
};

/** Solid as Solid's own js-framework-benchmark entry writes it: compiled JSX, `<For>`, `createSelector`, a signal per label. */
import { mountSolid } from './solid/Rows.jsx';
/** No framework at all, the same markup, one JS array of rows: what the page costs with nothing reactive (2026-11-01, the churn tail's control). */
const vanillaImpl = (mount, holdNodes = false) => {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  mount.appendChild(table);
  let rows = [];
  let refs = [];
  const makeRow = ({ id, label }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${id}</td><td><a>${label}</a></td><td><a>x</a></td>`;
    /** `Vanilla refs`: JS holding each row's nodes and one closure listener per row, what any code holding DOM does, with no framework. */
    if (holdNodes) {
      const held = { tr, id: tr.firstChild, a: tr.children[1].firstChild };
      tr.addEventListener('click', () => { held.a.textContent += ''; });
      refs.push(held);
    }
    return tr;
  };
  const add = (n, seed) => { const made = buildData(n, seed).map(makeRow); rows = rows.concat(made); tbody.append(...made); };
  return {
    create: (n, seed) => { tbody.textContent = ''; rows = []; refs = []; add(n, seed); },
    append: (n, seed) => { add(n, seed); },
    updateEvery10th: () => { for (let i = 0; i < rows.length; i += 10) { const a = rows[i].children[1].firstChild; a.textContent += ' !!!'; } },
    swap: () => { if (rows.length > 998) { const a = rows[1], b = rows[998], after = b.nextSibling; a.before(b); tbody.insertBefore(a, after); rows[1] = b; rows[998] = a; } },
    select: (i) => { for (const r of tbody.querySelectorAll('.selected')) r.className = ''; if (rows[i]) rows[i].className = 'selected'; },
    remove: (i) => { rows[i]?.remove(); rows.splice(i, 1); },
    clear: () => { tbody.textContent = ''; rows = []; refs = []; },
    teardown: () => { table.remove(); },
  };
};
import { mountSolidStore } from './solid/StoreRows.jsx';
const solidStoreImpl = (mount) => { const host = document.createElement('div'); mount.appendChild(host); return mountSolidStore(host, buildData); };
const solidCompiledImpl = (mount) => { const host = document.createElement('div'); mount.appendChild(host); return mountSolid(host, buildData); };

/* ── Preact ─────────────────────────────────────────────────────────────────── */

import { createElement as ph, render as preactRender } from 'preact';
import { useState as pUseState } from 'preact/hooks';
import { memo as pMemo } from 'preact/compat';

/**
 * Preact renders synchronously by default, so unlike React there is no `flushSync` — the operation
 * has finished writing the DOM by the time the setter returns.
 */
const preactImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);

  let setRows, setSelected;

  const Row = pMemo(({ row, selected }) =>
    ph('tr', { class: selected ? 'selected' : undefined },
      ph('td', null, row.id),
      ph('td', null, ph('a', null, row.label)),
      ph('td', null, ph('a', null, 'x'))
    )
  );

  function App() {
    const [rows, _setRows] = pUseState([]);
    const [selected, _setSelected] = pUseState(-1);
    setRows = _setRows;
    setSelected = _setSelected;
    return ph('table', null,
      ph('tbody', null, rows.map((r) => ph(Row, { key: r.id, row: r, selected: selected === r.id })))
    );
  }

  preactRender(ph(App), host);

  let current = [];
  return {
    create: (n, seed) => { current = buildData(n, seed); setRows(current); },
    append: (n, seed) => { current = current.concat(buildData(n, seed)); setRows(current); },
    updateEvery10th: () => {
      const next = current.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      current = next; setRows(current);
    },
    swap: () => {
      const next = current.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      current = next; setRows(current);
    },
    select: (i) => { const id = current[i]?.id ?? -1; setSelected(id); },
    remove: (i) => { const next = current.slice(); next.splice(i, 1); current = next; setRows(current); },
    clear: () => { current = []; setRows(current); },
    teardown: () => { preactRender(null, host); host.remove(); },
  };
};

/* ── Svelte ─────────────────────────────────────────────────────────────────── */

import { mount as svelteMount, unmount as svelteUnmount, flushSync as svelteFlush } from 'svelte';
import SvelteRows from './svelte/Rows.svelte';
import { store as svelteStore } from './svelte/state.svelte.js';

/**
 * The only entry here that needs a compiler — `.svelte` and `.svelte.js` are compiled by the
 * esbuild plugin in `build.mjs`. `flushSync` makes Svelte's scheduled work synchronous so an
 * operation is timed the same way as React's `flushSync` and everyone else's synchronous writes.
 */
const svelteImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);
  svelteStore.rows = [];
  svelteStore.selected = -1;
  const app = svelteMount(SvelteRows, { target: host });

  const sync = (fn) => svelteFlush(fn);
  let current = [];
  return {
    create: (n, seed) => { current = buildData(n, seed); sync(() => (svelteStore.rows = current)); },
    append: (n, seed) => { current = current.concat(buildData(n, seed)); sync(() => (svelteStore.rows = current)); },
    updateEvery10th: () => {
      const next = current.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      current = next; sync(() => (svelteStore.rows = current));
    },
    swap: () => {
      const next = current.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      current = next; sync(() => (svelteStore.rows = current));
    },
    select: (i) => { const id = current[i]?.id ?? -1; sync(() => (svelteStore.selected = id)); },
    remove: (i) => { const next = current.slice(); next.splice(i, 1); current = next; sync(() => (svelteStore.rows = current)); },
    clear: () => { current = []; sync(() => (svelteStore.rows = current)); },
    teardown: () => { svelteUnmount(app); host.remove(); },
  };
};

import SvelteRowsRunes from './svelte/RowsRunes.svelte';
import { runes as svelteRunes, Row as SvelteRow } from './svelte/runes-state.svelte.js';

/** Svelte as its own benchmark entry writes it: runes mode, `$state.raw` rows and selection, a `$state.raw` label per row. */
const svelteRunesImpl = (mount) => {
  const host = document.createElement('div');
  mount.appendChild(host);
  svelteRunes.rows = [];
  svelteRunes.selected = -1;
  const app = svelteMount(SvelteRowsRunes, { target: host });
  const rowsOf = (data) => data.map((d) => new SvelteRow(d.id, d.label));
  return {
    create: (n, seed) => { const next = rowsOf(buildData(n, seed)); svelteFlush(() => (svelteRunes.rows = next)); },
    append: (n, seed) => { const more = rowsOf(buildData(n, seed)); svelteFlush(() => (svelteRunes.rows = [...svelteRunes.rows, ...more])); },
    updateEvery10th: () => svelteFlush(() => { const r = svelteRunes.rows; for (let i = 0; i < r.length; i += 10) r[i].label = r[i].label + ' !!!'; }),
    swap: () => svelteFlush(() => {
      const r = svelteRunes.rows;
      if (r.length > 998) { const next = r.slice(); const t = next[1]; next[1] = next[998]; next[998] = t; svelteRunes.rows = next; }
    }),
    select: (i) => svelteFlush(() => (svelteRunes.selected = svelteRunes.rows[i]?.id ?? -1)),
    remove: (i) => svelteFlush(() => { const next = svelteRunes.rows.slice(); next.splice(i, 1); svelteRunes.rows = next; }),
    clear: () => svelteFlush(() => (svelteRunes.rows = [])),
    teardown: () => { svelteUnmount(app); host.remove(); },
  };
};

/* ── The small tiers against core: one component source (2026-11-16) ────────────────────────────────────────── */

import * as veraLite from '@verajs/lite';

/**
 * **One component SOURCE, rendered by a tier and by core** — the subset rule as a benchmark: `define`, `signal` and `html`
 * from the API under test, the rows an UNKEYED `.map` (lite has no `keyed`; core is raced unkeyed here so the two do the
 * same work: a swap or a removal rewrites rows in place, by index). The signals are made once per TAG (so the A/A copy
 * shares nothing with its twin) and reset on teardown: a tag is defined once per page and its setup closes over them. Core gets its renderer and its
 * default scheduler, as an app wires it; the tier needs neither.
 */
const tierState = new Map();
const tierImpl = (api, tag, wirePro) => (mount) => {
  if (wirePro) {
    setRenderScheduler(DEFAULT_SCHEDULER);
    wireVera();
  }
  let state = tierState.get(tag);
  if (state === undefined) tierState.set(tag, (state = { rows: api.signal([]), selected: api.signal(-1) }));
  const { rows, selected } = state;
  if (!customElements.get(tag))
    api.define(tag, () => () => {
      const list = rows.value;
      /** Read once, not once per row, as every other implementation here. */
      const sel = selected.value;
      return api.html`<table><tbody>${list.map((r) => api.html`<tr class=${sel === r.id ? 'selected' : null}><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`)}</tbody></table>`;
    });
  const el = document.createElement(tag);
  mount.appendChild(el);
  return {
    create: (n, seed) => { rows.value = buildData(n, seed); },
    append: (n, seed) => { rows.value = rows.value.concat(buildData(n, seed)); },
    updateEvery10th: () => {
      const next = rows.value.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.value = next;
    },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => { selected.value = rows.value[i]?.id ?? -1; },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; },
    teardown: () => { el.remove(); rows.value = []; selected.value = -1; },
  };
};

/**
 * **Lite with rows as components: Van's per-row idiom, through lite's public API only** (2026-11-17). Each row is a
 * `define`d element holding its record, whose label and selection are signals of its own, so an update10 or a select
 * re-renders only the rows it touches; swap and remove go through the list (unkeyed: props rewritten by position).
 * Rows are `<div>`s, as "VeraJS components" (a custom element is not allowed in `<tbody>`). No new bytes: this is the
 * idiom lite already has. `row` is the row's template with its tag written out (a template's tag names are its static
 * text, so each entry passes its own).
 */
const tierRowsState = new Map();
const tierRowsImpl = (api, tag, rowTag, row) => (mount) => {
  let state = tierRowsState.get(tag);
  if (state === undefined) tierRowsState.set(tag, (state = { rows: api.signal([]), selected: undefined }));
  const { rows } = state;
  if (!customElements.get(rowTag))
    api.define({ tag: rowTag, props: { r: null } }, (host) => () => {
      const r = host.r;
      return r && api.html`<div class=${r.sel.value ? 'selected' : null}><span>${r.id}</span><a>${r.label.value}</a><a>x</a></div>`;
    });
  if (!customElements.get(tag))
    api.define(tag, () => () => api.html`<div>${rows.value.map(row)}</div>`);
  const el = document.createElement(tag);
  mount.appendChild(el);
  const records = (data) => data.map(({ id, label }) => ({ id, label: api.signal(label), sel: api.signal(false) }));
  return {
    create: (n, seed) => { rows.value = records(buildData(n, seed)); },
    append: (n, seed) => { rows.value = rows.value.concat(records(buildData(n, seed))); },
    updateEvery10th: () => { const list = rows.value; for (let i = 0; i < list.length; i += 10) list[i].label.value += ' !!!'; },
    swap: () => {
      const next = rows.value.slice();
      if (next.length > 998) { const t = next[1]; next[1] = next[998]; next[998] = t; }
      rows.value = next;
    },
    select: (i) => {
      if (state.selected) state.selected.sel.value = false;
      state.selected = rows.value[i];
      if (state.selected) state.selected.sel.value = true;
    },
    remove: (i) => { const next = rows.value.slice(); next.splice(i, 1); rows.value = next; },
    clear: () => { rows.value = []; state.selected = undefined; },
    teardown: () => { el.remove(); rows.value = []; state.selected = undefined; },
  };
};

export const IMPLEMENTATIONS = [
  { name: 'VeraJS', note: 'core + lit-html', factory: veraImpl },
  { name: 'VeraJS own', note: 'core + @verajs/renderer', factory: veraOwnImpl },
  { name: 'VeraJS default', note: 'core + @verajs/renderer, default scheduler', factory: (mount) => veraOwnImpl(mount, DEFAULT_SCHEDULER) },
  { name: 'VeraJS textarea', note: 'VeraJS default with each label in a <textarea> (the form case)', factory: (mount) => veraOwnImpl(mount, DEFAULT_SCHEDULER, true) },
  /** The same entry again: the A/A control a race needs to tell a real gap from noise. */
  { name: 'VeraJS default 2', note: 'A/A copy of VeraJS default', factory: (mount) => veraOwnImpl(mount, DEFAULT_SCHEDULER) },
  { name: 'VeraJS components', note: 'each row a light init component, default scheduler', factory: veraComponentsImpl },
  { name: 'VeraJS store default', note: "today's idiom with createStore rows (the store app's baseline)", factory: veraStoreDefaultImpl },
  ...((keyedModule.lists ?? keyedModule.eachList) && keyedModule.createSelector ? [{ name: 'VeraJS auto', note: 'automatic .map lists: a store array, no keyed(), createSelector', factory: veraAutoImpl }] : []),
  ...(keyedModule.each ? [
    { name: 'VeraJS each', note: 'P1: each + a store selector, plain rows', factory: veraP1Impl(false) },
    { name: 'VeraJS each store', note: 'P1: each + a store selector, createStore rows', factory: veraP1Impl(true) },
  ] : []),
  { name: 'VeraJS S6a', note: 'S6(a): rows reused by item identity (marked renderer)', factory: veraS6aImpl },
  { name: 'abl inline', note: 'ablation: today, through the same factory', factory: veraAblationImpl({}) },
  { name: 'abl store', note: 'ablation: a store per row', factory: veraAblationImpl({ store: true }) },
  { name: 'abl split', note: 'ablation: shell + cells instance', factory: veraAblationImpl({ split: true }) },
  { name: 'abl split+hook', note: 'ablation: shell + cells as a hook', factory: veraAblationImpl({ split: true, hook: true }) },
  { name: 'abl full', note: 'ablation: split + hook + store (= P1e creation)', factory: veraAblationImpl({ split: true, hook: true, store: true }) },
  { name: 'VeraJS fine P1e', note: 'P1 emulated with public APIs: table rows, a store + createHook per row', factory: veraFineP1eImpl },
  { name: 'VeraJS fine P0', note: 'userland ceiling: rows as init components with their own store; select / update write rows directly', factory: veraFineImpl },
  { name: 'VeraJS unkeyed', note: 'core: core + @verajs/renderer, default scheduler, one define, an unkeyed .map (the tier comparison)', factory: tierImpl(vera, 'vb-tier-core', true) },
  { name: 'Tier lite', note: '@verajs/lite: the same component source (wires nothing, so not named VeraJS: the race checks VeraJS arms wired core)', factory: tierImpl(veraLite, 'vb-tier-lite') },
  { name: 'Tier lite rows', note: 'lite, rows as components with per-row signals (Van\'s idiom, public API only)', factory: tierRowsImpl(veraLite, 'vb-tier-lrows', 'vb-lrow', (r) => veraLite.html`<vb-lrow .r=${r}></vb-lrow>`) },
  { name: 'Tier lite 2', note: 'A/A copy of Tier lite (its own tag, the same bundle)', factory: tierImpl(veraLite, 'vb-tier-lite2') },
  { name: 'Lit', note: 'LitElement', factory: litImpl },
  { name: 'Vanilla', note: 'plain createElement rows and one JS array, no framework (the churn tail control)', factory: (mount) => vanillaImpl(mount) },
  { name: 'Vanilla refs', note: "the same, with JS holding each row's nodes and one closure listener per row", factory: (mount) => vanillaImpl(mount, true) },
  { name: 'Solid', note: 'solid-js compiled (babel-preset-solid), For + createSelector', factory: solidCompiledImpl },
  { name: 'Solid store', note: 'solid-js/store, a store proxy per row on first read (the churn test)', factory: solidStoreImpl },
  { name: 'Solid (h)', note: 'solid-js/h, no compiler (the race used this one until 2026-10-18)', factory: solidImpl },
  { name: 'Vue', note: 'vue compiled template, keyed v-for + v-memo', factory: vueCompiledImpl },
  { name: 'Vue reactive', note: 'vue reactive(), a reactive proxy per row on first read (the churn test)', factory: vueReactiveImpl },
  { name: 'Vue (h)', note: 'vue h(), no compiler or memo (the race used this one until 2026-10-18)', factory: vueImpl },
  { name: 'Van.js', note: 'vanjs-core, per-row states (its benchmark entry)', factory: vanIdiomaticImpl },
  { name: 'Van.js (rebuild)', note: 'vanjs-core, whole list rebuilt (the race used this one until 2026-10-18)', factory: vanImpl },
  { name: 'Svelte', note: 'svelte 5 runes, $state.raw (its benchmark entry)', factory: svelteRunesImpl },
  { name: 'Svelte (legacy)', note: 'svelte 5 legacy mode, deep $state (the race used this one until 2026-10-18)', factory: svelteImpl },
  { name: 'Preact', note: 'preact + hooks', factory: preactImpl },
  { name: 'React', note: 'react-dom, flushSync', factory: reactImpl },
];
