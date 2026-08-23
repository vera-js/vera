/**
 * A `.prop=${…}` binding on a custom element that has not upgraded yet must survive the upgrade.
 *
 * This is the autoloader's normal case, not an edge case: a parent template renders
 * `<child-element .item=${store}>` and the autoloader only then fetches the child's module. The
 * property lands as an own property on an un-upgraded instance. When the module calls
 * `customElements.define`, the browser upgrades **synchronously** and the class's field
 * initializers run — and under ES2022 class-field semantics (`useDefineForClassFields`, the
 * default at target ES2022) a declared field compiles to a [[Define]]. So `item?: Thing` emits
 * `item;`, i.e. `Object.defineProperty(this, 'item', { value: undefined })`, and the bound value
 * is gone before the component ever reads it.
 *
 * Writing the field as `declare item?: Thing` avoids it, but that is a rule every consumer has to
 * know. The renderer re-applies the value once the definition exists instead — and only if the
 * slot was actually clobbered, so a component that assigns the property itself keeps its own value.
 */
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'customElements', 'HTMLElement', 'Node', 'Element', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];

const { render } = await load('renderer');
/** The shape core's built-in `html` tag produces, as the other renderer suites do it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

const host = document.getElementById('host');
const store = { message: 'Hello Dark World' };

/** 1. Bind to a tag nothing has defined yet — exactly what the autoloader leaves behind. */
render(html`<pre-upgrade-child .item=${store}></pre-upgrade-child>`, host);
await frame();
const child = host.querySelector('pre-upgrade-child');
check('binding applies before upgrade', child.item === store);

/** 2. The definition arrives, carrying the plain class field that ES2022 turns into a [[Define]]. */
class PreUpgradeChild extends HTMLElement {
  item = undefined;
}
customElements.define('pre-upgrade-child', PreUpgradeChild);
check('define upgrades synchronously', child instanceof PreUpgradeChild);

/** 3. `whenDefined` settles on a microtask, so the re-apply lands here. */
await frame();
check('bound property survives the upgrade', child.item === store,
  `got ${JSON.stringify(child.item)}`);

/** 4. A component that sets the property itself must keep its own value, not have it overwritten. */
const own = { message: 'chosen by the component' };
render(html`<pre-upgrade-opinionated .item=${store}></pre-upgrade-opinionated>`, host);
await frame();
const opinionated = host.querySelector('pre-upgrade-opinionated');
class Opinionated extends HTMLElement {
  constructor() { super(); this.item = own; }
}
customElements.define('pre-upgrade-opinionated', Opinionated);
await frame();
check('a component keeps a value it assigned itself', opinionated.item === own,
  `got ${JSON.stringify(opinionated.item)}`);

/** 5. Already-defined elements must not pay for any of this. */
class Defined extends HTMLElement {}
customElements.define('pre-upgrade-defined', Defined);
render(html`<pre-upgrade-defined .item=${store}></pre-upgrade-defined>`, host);
await frame();
check('already-defined element gets the property', host.querySelector('pre-upgrade-defined').item === store);

/** 6. A plain built-in must not be routed through customElements at all. */
render(html`<input .value=${'typed'} />`, host);
await frame();
check('plain elements still take properties', host.querySelector('input').value === 'typed');

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
