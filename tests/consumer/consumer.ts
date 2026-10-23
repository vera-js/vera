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
import { define, init, createStore, wire, html, signal, effect, untrack, computed, microtask, setRenderScheduler, svg, mathml, inserts } from '@verajs/core';
import { renderer, hold, renderInto as domRender } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';
import { spread } from '@verajs/renderer/spread';
import { slots, slotted } from '@verajs/renderer/slots';
import { hydration } from '@verajs/renderer/hydration';
import { hydrateSlots } from '@verajs/renderer/hydrate-slots';
import { namespaces } from '@verajs/renderer/namespaces';
import { elements } from '@verajs/renderer/elements';
import type { ElementBehavior } from '@verajs/renderer/elements';
import { nativeElements } from '@verajs/renderer/native-elements';
import { portal } from '@verajs/renderer/portal';
import { tag, html as tagHtml, jsxName, BOOLEAN_ATTRIBUTES } from '@verajs/renderer/tag';
import { router, initRouter, navigate, resolve, setRouterRenderer, setMatchFunction, back, forward, go } from '@verajs/router';
import { autoloader } from '@verajs/autoloader';
import { adoptStyles, applyStyles, styles, css } from '@verajs/styles';
import { collections } from '@verajs/store';
/**
 * The SUBPATH entries too, not only the package they are re-exported from. A consumer may install
 * either spelling, and only these compile the declarations those subpaths actually publish — the
 * base entry's types say nothing about them.
 */
import { collections as collectionsEntry } from '@verajs/store/collections';
import { resource, type Resource } from '@verajs/store/resource';

interface Row { id: number; label: string }

class Demo extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ n: 0, rows: [] as Row[], m: new Map<string, number>() });
      const box = signal<HTMLInputElement | null>(null);
      const shallow = signal<Row[]>([]);
      void shallow.value;
      const total = computed(() => state.rows.length + state.n);

      effect((signal) => { void signal?.prop; return () => {}; });
      effect(() => {}, { timing: 'layout' });
      effect(() => {}, { timing: 'sync' });
      effect(() => {}, { owner: this, priority: 10 });
      untrack(() => state.n);

      return () => html`
        <input ${box} .value=${String(state.n)} ?disabled=${state.n > 3} @click=${() => state.n++}>
        <ul>${state.rows.map((r) => keyed(r.id, html`<li ${spread({ 'data-id': r.id })}>${r.label}</li>`))}</ul>
        <p>${hold(html`<em>${total.value}</em>`)}</p>
        ${svg`<svg><circle r=${state.n}/></svg>`}
        ${mathml`<math><mi>${state.n}</mi></math>`}
      `;
    });
  }
  static styles = css`.a { color: red }`;
}
customElements.define('x-demo', Demo);

/** A component with no markup: a setup returning nothing commits its effects all the same. */
class Headless extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const state = createStore({ online: true });
      effect(() => void state.online);
    });
  }
}
customElements.define('x-headless', Headless);

/**
 * The second argument is the SETUP. The old `init(this, { mode })` options object, which used to go there, is refused at build time here and
 * in development at runtime (`init-options`) — options travel with the host, `init({ host, shadow }, setup)`.
 */
// @ts-expect-error init's second argument is a setup function, not shadow-root options
init(document.createElement('x-headless'), { mode: 'open' });

const heading = tag`h1`;
const named = tagHtml`<${heading} class=${jsxName('className')}>x</${heading}>`;
void named; void BOOLEAN_ATTRIBUTES.has('disabled');

wire([renderer, router, collections, autoloader(import.meta.url, 'components')]);
wire([styles]);
/** The longhand still compiles — the module is a convenience over it, not a replacement. */
wire({ on: 'init', fn: adoptStyles, priority: 50 });
void applyStyles('.a{}', document.createElement('div') as never);
void inserts; void domRender;
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
import { allowRenderLoop } from '@verajs/core';
import type { StoreInsert } from '@verajs/inserts';
import {
  formatReport, getReport, isProfiling, profile, showProfiler, startProfiling, stopProfiling,
} from '@verajs/renderer/profiler';

class LateAdditions extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      allowRenderLoop(this);
    });
  }
}
customElements.define('x-late', LateAdditions);

/** A store module that wraps core's handler — the shape batching and devtools take. */
const observeWrites: StoreInsert = (value, handler, kit) =>
  handler?.set && {
    ...handler,
    set: (obj, prop, next, receiver) => {
      kit.trigger(obj, kit.shape, next, undefined);
      return handler.set!(obj, prop, next, receiver);
    },
  };
void observeWrites;

/** The profiler's own surface, in the order a user meets it. */
startProfiling();
void isProfiling();
void profile(() => 'work');
const report = getReport();
void formatReport(report);
showProfiler();
showProfiler({});
stopProfiling();


/**
 * **`@verajs/renderer/slots`, wired the documented way.** This exact line did not compile for any
 * TypeScript consumer: `'slot'` was never added to the insert type map, so a descriptor carrying it
 * was not assignable to `Registerable`. The insert existed at runtime and only there — every recipe
 * that wired it ran as JavaScript, and this file, which is the check that would have caught it, had
 * never imported the entry.
 */
wire([renderer, slots]);

/**
 * **Hydration, and hydrating light slots, wired the documented way** — two connectors beside the renderer and slots:
 * each is handed the registry, so neither is a descriptor and both must still be assignable as `wire` takes them.
 */
wire([renderer, hydration, slots, hydrateSlots]);

/**
 * **`slots` is a dual, and its option is a module-owned key** (2026-10-17): called with options it is still a module to
 * `wire`, and `observeSlots` exists on `init`'s options because slots is imported here (core's `VeraInitOptions`, merged
 * globally — the renderer does not depend on core, so it cannot augment `@verajs/core` itself). A misspelled key is an
 * error, as any unknown option is.
 */
wire([renderer, slots({ observeSlots: 'eager' })]);
init({ host: document.createElement('x-observing'), observeSlots: 'eager' }, () => () => null);
// @ts-expect-error a misspelled module key is not an option
init({ host: document.createElement('x-observing'), observeSlot: 'eager' }, () => () => null);
// @ts-expect-error a value the option does not have
init({ host: document.createElement('x-observing'), observeSlots: 'eagre' }, () => () => null);

/**
 * **`@verajs/renderer/namespaces`, wired the documented way.** Its descriptor is `on: 'template'`,
 * and that point had to be added to `InsertFunctionMap` for this line to compile — `slots` was the
 * precedent: the insert existed at runtime while every TypeScript consumer failed to wire it.
 */
wire([renderer, namespaces]);

/**
 * **`@verajs/renderer/elements`, wired the documented way** — its `'element'` point had to be in
 * `InsertFunctionMap` for the claimant descriptor to compile, as `'slot'` and `'template'` did. The
 * behavior is typed through the public `ElementBehavior`, and `mount`'s context is checked by use.
 */
const focusOnMount: ElementBehavior = {
  mount: (element, { root, adopted }) => {
    if (!adopted && root !== null) (element as HTMLElement).focus();
  },
};
wire([
  renderer,
  elements,
  { on: 'element', fn: (el: Element) => (el.hasAttribute('autofocus') ? focusOnMount : undefined), priority: 50 },
]);

/** **`@verajs/renderer/native-elements`, wired the documented way** — a connector, beside the renderer. */
wire([renderer, nativeElements]);

const slotHost: Element = document.createElement('div');
const everything: Node[] = slotted(slotHost);
const byName: Node[] = slotted(slotHost, 'header');
/** The narrowing a component actually writes when it wants elements. */
const slottedElements: Element[] = slotted(slotHost, 'header').filter(
  (node): node is Element => node.nodeType === 1
);
void everything;
void byName;
void slottedElements;

void collectionsEntry;


/** `define`: the tag forms, options, and `methods` typed on the instances (`this` is the element inside them). */
define('x-consumer-plain', () => () => html`<p>plain</p>`);
const Dialog = define({ tag: 'x-consumer-dialog', shadow: 'open', methods: {
  open(times: number) {
    this.toggleAttribute('open', true);
    return times * 2;
  },
} }, () => () => html`<slot></slot>`);
const dialog = new Dialog();
const doubled: number = dialog.open(2);
void doubled;
// @ts-expect-error — a method it does not declare
dialog.close();
// @ts-expect-error — the argument is typed
dialog.open('twice');

/** `define` props: types inferred from the defaults — on the setup's host and on the instances — beside the methods. */
const Card = define({ tag: 'x-consumer-card', props: { heading: '', items: [] as string[] }, methods: {
  count() {
    return this.items.length;
  },
} }, (host) => () => html`<h2>${host.heading}</h2><p>${host.items.length}</p>`);
const card = new Card();
card.heading = 'typed';
const n: number = card.count();
void n;
// @ts-expect-error — heading is a string
card.heading = 42;

/** Attributes: each is a `string | null` prop under its camel name; one that shares a declared prop widens it. */
const Badge = define({ tag: 'x-consumer-badge', props: { count: 0 }, attributes: ['label', 'data-tone', 'count'] as const }, (host) => () => html`<b>${host.label ?? ''}${host.dataTone ?? ''}${String(host.count)}</b>`);
const badge = new Badge();
const label: string | null = badge.label;
const tone: string | null = badge.dataTone;
const count: number | string | null = badge.count;
void label; void tone; void count;
// @ts-expect-error — the shared prop is no longer just a number: the attribute hands it strings
const onlyNumber: number = badge.count;
void onlyNumber;

/** `resource`: a union that narrows — `value` is `T` only once neither loading nor errored. */
const user: Resource<{ name: string }> = resource((signal) => fetch('/u', { signal }).then((r) => r.json() as Promise<{ name: string }>), { key: 'user' });
if (!user.loading && user.error === undefined) {
  const name: string = user.value.name;
  void name;
}
// @ts-expect-error — while loading, `value` is undefined
const early: { name: string } = user.value;
void early;

/** `portal`: an `Element` or a fragment as the target; a template, or a function returning one (handed the change). */
define('x-consumer-portal', () => {
  portal(document.body, () => html`<aside>${String(count)}</aside>`);
  portal(document.createDocumentFragment(), html`<b></b>`);
  // @ts-expect-error — a target is a node to append to, not a selector
  portal('body', html`<b></b>`);
});
