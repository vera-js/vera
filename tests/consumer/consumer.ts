/**
 * A realistic consumer, type-checked against the **shipped `.d.ts`** rather than the sources.
 *
 * `scripts/typecheck.mjs`'s root pass aliases every bare specifier to that package's `src` through
 * `paths`, which is what makes it a cross-boundary check — and also what makes it blind to the
 * declaration files a consumer actually installs. This config has no `paths` at all, so every import
 * here resolves the way npm resolves it: `node_modules` -> `exports` -> `types`.
 *
 * It found `wire([renderer, collections])` — the line in the README — failing to compile in a strict
 * project, twice over. The renderer's `connect` was typed against a structural shape narrower than
 * `Inserts`, which is not assignable, and the collections descriptor inferred `unknown` for `fn`,
 * which sent TypeScript into the wrong member of the insert union and produced an error about
 * `ProxyHandlerInsert`. Neither was visible from inside the repo.
 *
 * It never runs. Everything here exists to be compiled.
 */
import { init, createStore, render, wire, html, css, ref, shallowRef, useEffect, useLayoutEffect,
  useSyncEffect, createHook, untrack, deps, microtask, setRenderScheduler, setHtml, setCss,
  svg, mathml, inserts, useRender, mount } from '@verajs/core';
import { renderer, hold, renderInto as domRender } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';
import { spread } from '@verajs/renderer/spread';
import { tag, html as tagHtml, jsxName, BOOLEAN_ATTRIBUTES } from '@verajs/renderer/tag';
import { router, initRouter, navigate, resolve, setRouterRenderer, setMatchFunction, back, forward, go } from '@verajs/router';
import { autoloader } from '@verajs/autoloader';
import { adoptStyles, applyStyles, styles } from '@verajs/styles';
import { collections, computed } from '@verajs/reactivity';

interface Row { id: number; label: string }

class Demo extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 0, rows: [] as Row[], m: new Map<string, number>() });
    const box = ref<HTMLInputElement | null>(null);
    const shallow = shallowRef<Row[]>([]);
    void shallow.value;
    const total = computed(() => state.rows.length + state.n);

    useEffect((signal) => { void signal?.prop; return () => {}; });
    useLayoutEffect(() => {});
    useSyncEffect(() => {});
    createHook({ element: this, priority: 10, callback: () => {} });
    untrack(() => state.n);
    deps(state.n, state.rows);

    render(() => html`
      <input ${box} .value=${String(state.n)} ?disabled=${state.n > 3} @click=${() => state.n++}>
      <ul>${state.rows.map((r) => keyed(r.id, html`<li ${spread({ 'data-id': r.id })}>${r.label}</li>`))}</ul>
      <p>${hold(html`<em>${total.value}</em>`)}</p>
      ${svg`<svg><circle r=${state.n}/></svg>`}
      ${mathml`<math><mi>${state.n}</mi></math>`}
    `);
  }
  static styles = css`.a { color: red }`;
}
customElements.define('x-demo', Demo);

/** A component with no markup: `mount()` commits the setup so the effect actually runs. */
class Headless extends HTMLElement {
  connectedCallback() {
    init(this);
    const state = createStore({ online: true });
    useEffect(() => void state.online);
    mount();
  }
}
customElements.define('x-headless', Headless);

/**
 * The template is required, and this is the check that says so. A bare `render()` is exactly the
 * mistake `mount()` replaces; it still commits at runtime, but a typed caller is told at build time.
 */
// @ts-expect-error render() needs a template — a component with no markup calls mount()
render();

const heading = tag`h1`;
const named = tagHtml`<${heading} class=${jsxName('className')}>x</${heading}>`;
void named; void BOOLEAN_ATTRIBUTES.has('disabled');

wire([renderer, router, collections, autoloader(import.meta.url, 'components')]);
wire([styles]);
/** The longhand still compiles — the module is a convenience over it, not a replacement. */
wire({ on: 'init', fn: adoptStyles, priority: 50 });
void applyStyles('.a{}', document.createElement('div') as never);
void inserts; void useRender; void domRender; void setHtml; void setCss;
setRenderScheduler(microtask);
setMatchFunction(<P extends Record<string, string | string[] | undefined>>(pattern: string) =>
  (path: string) => (path === pattern ? { path, params: {} as P } : false));
initRouter(document.body, { view: 'main' });
void navigate('/x'); void resolve('home', {}); void setRouterRenderer(domRender);
back(); forward(); go(-1);

/**
 * **The exports nothing here referenced.** A derived sweep — every public export of every entry,
 * minus every name this file and `ssrcheck.ts` mention — came back with sixteen, among them the
 * whole of `@verajs/renderer/profiler`, which no consumer check imported at all.
 *
 * That gap is the same shape as an unexecuted recipe: the declaration is written, published and
 * installed, and nothing has ever compiled a line against it. A `.d.ts` is documentation that
 * compiles, so an unexercised one is an unverified claim.
 */
import { allowRenderLoop, setStaticStores } from '@verajs/core';
import { revision } from '@verajs/inserts';
import { GLOBAL, collectionMethod } from '@verajs/reactivity';
import {
  formatReport, getReport, isProfiling, profile, showProfiler, startProfiling, stopProfiling,
} from '@verajs/renderer/profiler';

class LateAdditions extends HTMLElement {
  connectedCallback() {
    init(this);
    allowRenderLoop(this);
    mount();
  }
}
customElements.define('x-late', LateAdditions);

setStaticStores(true);
void revision;
void GLOBAL;
void collectionMethod;

/** The profiler's own surface, in the order a user meets it. */
startProfiling();
void isProfiling();
void profile(() => 'work');
const report = getReport();
void formatReport(report);
showProfiler();
showProfiler({});
stopProfiling();
