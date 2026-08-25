/**
 * A `.prop=${…}` binding on a custom element that has not upgraded yet is destroyed when the
 * element upgrades, and the framework reports it rather than repairing it.
 *
 * The mechanism: the property lands as an own property on an un-upgraded instance. When the
 * definition arrives — lazily imported, code-split, or a module that simply had not run yet —
 * `customElements.define` upgrades **synchronously** and the class's field initializers execute.
 * At target ES2022, where `useDefineForClassFields` is on, a field declaration is a `[[Define]]`:
 * `item?: Thing` emits `item;`, i.e. `Object.defineProperty(this, 'item', { value: undefined })`.
 * The bound value is gone before the component reads it, and nothing throws.
 *
 * Repair was implemented and then removed deliberately, which is what most of this file pins down.
 * Re-applying the value when the slot came back `undefined` handled `item?: Thing` but not
 * `item = someDefault` — that overwrites with the default and never looks clobbered, so the repair
 * was silently partial and made one mistake behave two different ways depending on spelling. It
 * also cost 74 B in every app while leaving `declare` mandatory regardless, because a property
 * assigned imperatively cannot be recovered by anyone: the renderer never saw it, and by the time
 * `init()` runs in `connectedCallback` the value is already gone.
 *
 * Detection covers both spellings and costs production nothing.
 */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { load, isProduction, distUrl } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'customElements', 'HTMLElement', 'Node', 'Element', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];

const { render } = await load('renderer');
/** List rendering is a module now; this suite drives the renderer directly, so it uses the
 *  no-registry door rather than `wire([domRender, lists])`. */
const { lists } = await load('renderer/lists');
(await load('renderer')).handle(lists.fn);
/** The shape core's built-in `html` tag produces, as the other renderer suites do it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const mount = () => { const h = document.createElement('div'); document.body.appendChild(h); return h; };

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

/** Captures warnings for one upgrade, so each case is measured on its own. */
const warned = [];
const realWarn = console.warn;
console.warn = (...args) => warned.push(args.join(' '));
const since = () => { const n = warned.length; return () => warned.slice(n); };

const store = { message: 'Hello Dark World' };

/* ── the binding lands before the definition exists ───────────────────────────────────────────── */
let host = mount();
render(html`<preup-undef .item=${store}></preup-undef>`, host);
await frame();
const undef = host.querySelector('preup-undef');
check('binding applies before upgrade', undef.item === store);

let took = since();
customElements.define('preup-undef', class extends HTMLElement { item; });
check('define upgrades synchronously', undef instanceof customElements.get('preup-undef'));
check('the class field clobbers the bound value', undef.item === undefined,
  `got ${JSON.stringify(undef.item)}`);
await frame();
check(`${isProduction ? 'production is silent' : 'development warns'} about a bare field`,
  took().filter((w) => w.includes('item')).length === (isProduction ? 0 : 1));

/* ── the spelling the removed repair could not see ────────────────────────────────────────────── */
host = mount();
render(html`<preup-default .count=${5}></preup-default>`, host);
await frame();
const dflt = host.querySelector('preup-default');
took = since();
customElements.define('preup-default', class extends HTMLElement { count = 0; });
await frame();
check('a field with a default also destroys the binding', dflt.count === 0,
  `got ${JSON.stringify(dflt.count)}`);
check(`${isProduction ? 'production is silent' : 'development warns'} about a defaulted field too`,
  took().filter((w) => w.includes('count')).length === (isProduction ? 0 : 1),
  'this is the case the removed repair handled silently and wrongly');

/* ── nothing wrong, nothing said ──────────────────────────────────────────────────────────────── */
customElements.define('preup-defined', class extends HTMLElement {});
host = mount();
took = since();
render(html`<preup-defined .item=${store}></preup-defined>`, host);
await frame();
check('an already-defined element keeps the property', host.querySelector('preup-defined').item === store);
check('and says nothing', took().length === 0, took().join(' | '));

host = mount();
took = since();
render(html`<input .value=${'typed'} />`, host);
await frame();
check('plain built-ins still take properties', host.querySelector('input').value === 'typed');
check('and say nothing', took().length === 0, took().join(' | '));

/* ── a definition that never clobbers must stay quiet ─────────────────────────────────────────── */
host = mount();
render(html`<preup-clean .item=${store}></preup-clean>`, host);
await frame();
const clean = host.querySelector('preup-clean');
took = since();
customElements.define('preup-clean', class extends HTMLElement {});   // what `declare` emits
await frame();
check('a `declare`d field keeps the bound value', clean.item === store);
check('and warns about nothing', took().length === 0, took().join(' | '));

console.warn = realWarn;

/* ── production carries none of it ────────────────────────────────────────────────────────────── */
if (isProduction) {
  const bundle = await readFile(new URL(distUrl('renderer')), 'utf8');
  check('production drops the whenDefined subscription', !bundle.includes('whenDefined'));
  check('production drops the message', !bundle.includes('declare'));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
