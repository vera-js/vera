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
const COLOURS = ['red','yellow','blue','green','pink','brown','purple','white','black','orange'];
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
    const label = `${ADJECTIVES[(rnd() * ADJECTIVES.length) | 0]} ${COLOURS[(rnd() * COLOURS.length) | 0]} ${NOUNS[(rnd() * NOUNS.length) | 0]}`;
    data[i] = { id: nextId++, label };
  }
  return data;
};

export const resetIds = () => { nextId = 1; };

/* ── VeraJS ─────────────────────────────────────────────────────────────────── */

import { init, ref, shallowRef, render as veraRender, setHtml, setRenderer } from '@verajs/core';
import { html as litHtml, render as litRender, nothing } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';

const veraImpl = (mount) => {
  setHtml(litHtml);
  setRenderer(litRender);

  const host = document.createElement('div');
  mount.appendChild(host);

  /**
   * `shallowRef`, deliberately, and this is what makes the comparison fair.
   *
   * The row objects are immutable snapshots — every operation replaces the array rather than
   * mutating a row — so deep-proxying them would be pure overhead. It would also not match what
   * the others do: Lit holds rows in a reactive property, React in `useState`, Van in a state cell,
   * and in all three the row objects are plain data. `shallowRef` is the exact equivalent.
   *
   * An earlier version used `createStore({ rows })`, which proxies all 1 000 rows. That is the
   * analogue of wrapping the whole dataset in Vue's `reactive()`, which no other implementation
   * here does, and it cost 2.6 ms per render pass against 0.03 ms.
   */
  const rows = shallowRef([]);
  const selected = ref(-1);

  init(host);
  veraRender(() => {
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
      return litHtml`<table><tbody>
        ${repeat(
          this.rows,
          (r) => r.id,
          (r) => litHtml`<tr class=${this.selected === r.id ? 'selected' : nothing}>
            <td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td>
          </tr>`
        )}
      </tbody></table>`;
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

/* ── Van.js ─────────────────────────────────────────────────────────────────── */

import van from 'vanjs-core';

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

import { render as veraDomRender } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';

/**
 * The configuration the project advertises: core plus `@verajs/renderer`, no lit-html.
 *
 * The renderer is template-identity based (the ground-up rewrite): the row template parses once,
 * every update commits only changed values, and the list reconciles keyed via `keyed()`. Note there
 * is no `repeat` import and no `nothing` sentinel — keying is built in, and `null` removes an
 * attribute.
 */
const rawHtml = (strings, ...values) => ({ _$litType$: 1, strings, values });

const veraOwnImpl = (mount) => {
  setHtml(rawHtml);
  setRenderer(veraDomRender);

  const host = document.createElement('div');
  mount.appendChild(host);

  const rows = shallowRef([]);
  const selected = ref(-1);

  init(host);
  veraRender(() => {
    const list = rows.value;
    const sel = selected.value;
    return rawHtml`<table><tbody>${list.map((r) =>
      keyed(
        r.id,
        rawHtml`<tr class="${sel === r.id ? 'selected' : null}"><td>${r.id}</td><td><a>${r.label}</a></td><td><a>x</a></td></tr>`
      )
    )}</tbody></table>`;
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

export const IMPLEMENTATIONS = [
  { name: 'VeraJS', note: 'core + lit-html', factory: veraImpl },
  { name: 'VeraJS own', note: 'core + @verajs/renderer', factory: veraOwnImpl },
  { name: 'Lit', note: 'LitElement', factory: litImpl },
  { name: 'Solid', note: 'solid-js, no JSX', factory: solidImpl },
  { name: 'Vue', note: 'vue runtime, h()', factory: vueImpl },
  { name: 'Van.js', note: 'vanjs-core', factory: vanImpl },
  { name: 'Svelte', note: 'svelte 5 runes (needs a compiler)', factory: svelteImpl },
  { name: 'Preact', note: 'preact + hooks', factory: preactImpl },
  { name: 'React', note: 'react-dom, flushSync', factory: reactImpl },
];
