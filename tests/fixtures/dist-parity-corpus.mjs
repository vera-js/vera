/**
 * Renders a fixed corpus and prints what the DOM became, one line per item.
 *
 * Run twice by `tests/dist-parity.test.mjs` — once against `dist/development/*.js` and once against
 * `dist/*.min.js` — and the two outputs must be identical.
 *
 * **The suites already run twice; this is a different question.** Each of them asserts its own
 * expectations in each build, and none has ever asked whether the two builds agree *with each
 * other*. Production is a different program: properties mangled, `__DEV__` folded to `false` and its
 * branches deleted, workspace dependencies inlined. A behaviour that differs between them is
 * invisible until it is in someone's hands.
 *
 * **Adding to it is cheap and worth doing** — every line is a behaviour pinned across both builds.
 * Keep each item deterministic (no clocks, no randomness, no iteration order that depends on a
 * hash) and keep the framework's own `<!---->` part markers in the output: where they are placed is
 * part of what has to match.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const n of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','MouseEvent'])
  globalThis[n] = dom.window[n];

const which = process.env.VERA_DIST === 'production' ? 'production' : 'development';
const load = async (spec) => import(spec);
const core = await load('@verajs/core');
const { html, init, render, createStore, ref, useEffect, useSyncEffect, wire, mount: commit, untrack, shallowRef, css } = core;
const { renderer, renderInto, hold } = await load('@verajs/renderer');
const { keyed } = await load('@verajs/renderer/keyed');
const { spread } = await load('@verajs/renderer/spread');
const { tag, html: tagHtml } = await load('@verajs/renderer/tag');
const { computed } = await load('@verajs/reactivity');
const { collections } = await load('@verajs/reactivity/collections');
wire([renderer, collections]);

const D = dom.window.document;
const host = D.getElementById('host');
const settle = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const out = [];
const say = (label, value) => out.push(`${label} :: ${value}`);
/** A throw in one build and not the other is exactly what this is looking for, so record it. */
const attempt = (label, run) => {
  try { say(label, run()); } catch (e) { say(label, `THREW ${e.name}: ${String(e.message).slice(0, 90)}`); }
};
/** Framework part markers are bookkeeping; both builds must place them identically, so they stay. */
const shape = (el) => el.innerHTML;

/* ── 1. every binding kind, and the values that behave oddly ────────────────────────────────── */
{
  const draw = (v) =>
    html`<div class=${v} ?hidden=${v} .title=${v} @click=${typeof v === 'function' ? v : null}>${v}</div>`;
  for (const [label, value] of [
    ['string', 'a'], ['empty', ''], ['zero', 0], ['NaN', NaN], ['null', null], ['undefined', undefined],
    ['false', false], ['true', true], ['array', ['x', 'y']], ['object', { a: 1 }], ['bigint', 3n],
    ['symbol-ish', Symbol.iterator.toString()], ['negative zero', -0], ['Infinity', Infinity],
  ]) {
    const container = D.createElement('div');
    renderInto(draw(value), container);
    attempt(`bindings/${label}`, () => shape(container));
  }
}

/* ── 2. child positions across kinds ────────────────────────────────────────────────────────── */
{
  const draw = (v) => html`<p>[${v}]</p>`;
  const node = D.createElement('b');
  node.textContent = 'n';
  for (const [label, value] of [
    ['nested', html`<i>t</i>`], ['array of templates', [html`<i>1</i>`, html`<i>2</i>`]],
    ['node', node], ['keyed', [keyed('k', html`<i>k</i>`)]], ['empty array', []],
    ['nested arrays', [['a', ['b']], 'c']], ['date', new Date(0).toISOString()],
  ]) {
    const container = D.createElement('div');
    renderInto(draw(value), container);
    attempt(`child/${label}`, () => shape(container));
  }
}

/* ── 3. sequences, where a part changes kind ────────────────────────────────────────────────── */
{
  const draw = (v) => html`<p>${v}</p>`;
  const container = D.createElement('div');
  const steps = ['a', null, ['x', 'y'], html`<i>t</i>`, 0, [], 'b', undefined, html`<i>t2</i>`, 'c'];
  for (const [i, v] of steps.entries()) {
    renderInto(draw(v), container);
    attempt(`sequence/${i}`, () => shape(container));
  }
}

/* ── 4. spread, including the names that must be skipped ────────────────────────────────────── */
{
  for (const [label, props] of [
    ['plain', { a: '1', b: '2' }],
    ['sigils', { '.title': 't', '?hidden': true, '@click': () => {} }],
    ['bad names', { 'a b': '1', 'a=b': '2', 'ok': '3' }],
    ['nullish values', { a: null, b: undefined, c: '' }],
    ['numeric and boolean', { a: 0, b: false, c: 1 }],
  ]) {
    const container = D.createElement('div');
    renderInto(html`<div ${spread(props)}>x</div>`, container);
    const el = container.querySelector('div');
    attempt(`spread/${label}`, () => [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' '));
  }
}

/* ── 5. a runtime tag ───────────────────────────────────────────────────────────────────────── */
{
  /** `html` comes from the `/tag` entry, not core's — the README is explicit and this is the
   * documented shape. Splicing happens before the renderer sees the template. */
  for (const [label, H] of [['section', tag`section`], ['custom', tag`my-widget`], ['heading', tag`h3`]]) {
    const container1 = D.createElement('div');
    try {
      renderInto(tagHtml`<${H} class="t">x</${H}>`, container1);
      say(`tag/${label}`, shape(container1));
    } catch (e) {
      say(`tag/${label}`, `THREW ${e.name}: ${String(e.message).slice(0, 90)}`);
    }
  }
}

/* ── 6. keyed reconciliation over a fixed script ────────────────────────────────────────────── */
{
  const row = (k) => keyed(k, html`<li data-k=${k}>${k}</li>`);
  const draw = (items) => html`<ul>${items.map(row)}</ul>`;
  const container = D.createElement('div');
  for (const items of [[], ['a'], ['a','b','c'], ['c','a','b'], ['b'], ['b','d','a'], ['a','b','c','d'], []]) {
    renderInto(draw(items), container);
    attempt(`keyed/${items.join('-') || 'empty'}`, () => shape(container));
  }
}

/* ── 7. hold ────────────────────────────────────────────────────────────────────────────────── */
{
  const draw = (editing) => html`<div>${hold(editing ? html`<input class="e" />` : html`<span class="v">v</span>`)}</div>`;
  const container = D.createElement('div');
  for (const editing of [true, false, true, false]) {
    renderInto(draw(editing), container);
    attempt(`hold/${editing}`, () => shape(container));
  }
}

/* ── 8. a real component: hooks, stores, computed, collections ──────────────────────────────── */
{
  const state = createStore({ n: 1, tags: new Set(['a']), map: new Map([['k', 1]]) });
  const doubled = computed(() => state.n * 2);
  const box = ref();
  const effects = [];
  const tagName = 'x-p25';
  dom.window.customElements.define(tagName, class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      useEffect(() => { effects.push(`effect ${state.n}`); return () => effects.push(`cleanup ${state.n}`); });
      useSyncEffect(() => { effects.push(`sync ${state.n}`); });
      render(() => html`<i ${box}>${doubled.value}</i><b>${[...state.tags].join(',')}</b><u>${state.map.size}</u>`);
    }
  });
  const element = D.createElement(tagName);
  host.appendChild(element);
  await settle();
  attempt('component/initial', () => element.shadowRoot.innerHTML);
  state.n = 2;
  state.tags.add('b');
  state.map.set('j', 2);
  await settle();
  attempt('component/after writes', () => element.shadowRoot.innerHTML);
  say('component/effects', JSON.stringify(effects));
  say('component/ref', box.value?.localName ?? String(box.value));
  say('component/untracked', String(untrack(() => state.n)));
  const shallow = shallowRef({ deep: { n: 1 } });
  let shallowRuns = 0;
  const t2 = 'x-p25-shallow';
  dom.window.customElements.define(t2, class extends dom.window.HTMLElement {
    connectedCallback() { init(this, { mode: 'open' }); useSyncEffect(() => { void shallow.value.deep.n; shallowRuns++; }); commit(); }
  });
  host.appendChild(D.createElement(t2));
  await settle();
  const before = shallowRuns;
  shallow.value.deep.n = 5;
  say('component/shallowRef is shallow', String(shallowRuns - before));
  element.remove();
  await settle();
  say('component/effects after removal', JSON.stringify(effects));
}

/* ── 9. css and static styles ───────────────────────────────────────────────────────────────── */
{
  const sheet = css`:host { color: red; } .a { --x: 1px; }`;
  say('css/type', Object.prototype.toString.call(sheet));
  say('css/text', String(sheet.cssText ?? sheet).replace(/\s+/g, ' ').trim());
}

/* ── 10. misuse ─────────────────────────────────────────────────────────────────────────────── */
/**
 * **The half this corpus was missing.** Every section above feeds the framework code that is
 * *correct*, and correct code is the case least likely to diverge — the branches that differ between
 * builds are the ones guarding against mistakes, and `__DEV__` is where those guards live.
 *
 * The defect that prompted this: `spread`'s refusal of a non-object props bag sat inside `__DEV__`
 * together with its warning, so development applied nothing and production iterated a string by
 * character index onto attributes named `0`, `1`, `2`, `3`. Development behaved *better* than
 * production, which is the direction that hides a bug rather than surfacing it — the app under test
 * looked right and only the shipped one was wrong.
 *
 * A dev-only **throw** is the opposite and is fine: development is stricter, so the mistake is caught
 * in the build where someone is looking. What must never differ is what the program *does* with input
 * it accepts in both.
 *
 * **So this section deliberately does not exercise the dev-only validation throws** — `keyed`
 * without a template, `wire` with a bad descriptor, `tag` with a string. Those are supposed to
 * diverge, each is already covered by its own suite (which asserts the throw under development and
 * skips under production), and including them here would make this test fail for the one kind of
 * difference the project wants. Every case below is input **both** builds accept.
 *
 * Warnings are silenced here because the messages are development-only by design; the point is the
 * DOM either side of them.
 */
{
  const warn = console.warn;
  console.warn = () => {};
  try {
    /** Bad props bags — the case that was diverging. */
    for (const bad of ['text', 42, ['a'], null, undefined, true]) {
      const h = D.createElement('div');
      renderInto(html`<p ${spread(bad)}></p>`, h);
      const el = h.querySelector('p');
      say(`misuse/spread ${String(bad)}`, el ? [...el.attributes].map((a) => `${a.name}=${a.value}`).join(',') || '(none)' : '(no element)');
    }

    /** Keys an attribute name cannot hold, and values that are not strings. */
    const h2 = D.createElement('div');
    renderInto(html`<p ${spread({ 'a b': 1, 'a>b': 2, ok: 3, '': 4, '.value': 'v', '@click': null })}></p>`, h2);
    attempt('misuse/spread keys', () => h2.querySelector('p').outerHTML);

    /** A listener that cannot listen — warned about, and applied identically either way. */
    const h3 = D.createElement('div');
    let fired = 0;
    for (const handler of ['string', 42, {}, null, false, () => fired++]) {
      renderInto(html`<button @click=${handler}>b</button>`, h3);
      h3.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click'));
    }
    say('misuse/uncallable listeners fired', String(fired));

    /** Values in child position that are not renderable. */
    const h4 = D.createElement('div');
    for (const value of [undefined, null, false, 0, NaN, Symbol.iterator ? [] : [], {}, () => {}]) {
      attempt(`misuse/child ${String(value)}`, () => {
        renderInto(html`<p>${value}</p>`, h4);
        return h4.querySelector('p').innerHTML;
      });
    }

    /**
     * Duplicate keys in a keyed list. Both builds accept it and render — which of the two nodes keeps
     * its DOM is undefined, so only the text is compared, not identity.
     */
    const h5 = D.createElement('div');
    attempt('misuse/duplicate keys', () => {
      renderInto(html`<ul>${[1, 1, 2].map((n) => keyed(n, html`<li>${n}</li>`))}</ul>`, h5);
      return h5.querySelector('ul').textContent;
    });

    /**
     * **Not included: a write to a store over a frozen source.** It throws the engine's own
     * `TypeError: 'set' on proxy: trap returned falsish` in *both* builds — a proxy invariant, not a
     * divergence — and this harness disqualifies any item that throws in development. Recorded here
     * so it is not re-added: the parity question about it is settled, and whether that bare engine
     * message should be a `[vera]` one is a separate question from this file's.
     */
  } finally {
    console.warn = warn;
  }
}

console.log(`### ${which}`);
for (const line of out) console.log(line);
