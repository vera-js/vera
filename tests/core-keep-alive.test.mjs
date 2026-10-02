/**
 * **A move is not a removal.** A component moved in ONE DOM operation (`append`/`insertBefore` of a connected node) is
 * still connected when its `disconnectedCallback` runs — the platform runs the callbacks after the operation (Chrome,
 * Firefox and Safari measured, `.probe/move-fact/`) — so core tears nothing down and the reconnect sets nothing up. A
 * real removal tears down synchronously, exactly as before. Pins from vera-5a's review.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
const dom = new JSDOM('<!doctype html><body><iframe></iframe></body>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','Node','Element','DocumentFragment','Text','Comment','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame','MutationObserver']) globalThis[k] = dom.window[k];
const { html, wire, init, render, useEffect } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const log = [];
const count = (word) => log.filter((l) => l.startsWith(word)).length;
customElements.define('ka-kid', class extends dom.window.HTMLElement {
  connectedCallback() { log.push(`setup ${this.id}`); init(this); useEffect(() => () => log.push(`cleanup ${this.id}`)); render(() => html`<i>${this.id}</i>`); }
  disconnectedCallback() { log.push(`dc ${this.id}`); }
});
/** A plain container for kids: not a slot host (no dash), so slots never captures its children. */
const box = () => { const d = doc.createElement('div'); doc.body.append(d); return d; };

/**
 * jsdom runs the callbacks after the operation, as the three engines do (vera-5a pin 2) — measured WITHOUT core in
 * `.probe/move-fact/pending-run.mjs` (core wraps every class's callbacks, so a class here cannot observe it raw); the
 * next test passing under jsdom is the same fact seen through core.
 */
test('a one-op move keeps the component: no dc, no cleanup, no second setup', async () => {
  log.length = 0;
  const a = box(); const b = box();
  const kid = doc.createElement('ka-kid'); kid.id = 'm'; a.append(kid); await frame();
  b.insertBefore(kid, null); await tick();
  assert.deepEqual(log, ['setup m']);
});

test('a real removal tears down SYNCHRONOUSLY, as before', async () => {
  log.length = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 'r'; box().append(kid); await frame();
  kid.remove();
  assert.deepEqual(log, ['setup r', 'dc r', 'cleanup r'], 'in the same task as the removal');
});

test('a two-step move (remove, then re-add) tears down and sets up, as before', async () => {
  log.length = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 't'; const a = box(); a.append(kid); await frame();
  kid.remove(); a.append(kid); await frame();
  assert.equal(count('setup'), 2); assert.equal(count('cleanup'), 1);
});

test('a move into ANOTHER document is a real teardown and setup (pins 1 and 3)', async () => {
  log.length = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 'x'; box().append(kid); await frame();
  doc.querySelector('iframe').contentDocument.body.append(kid); await tick();
  assert.equal(count('cleanup x'), 1, 'cleanup once');
  assert.equal(count('setup x'), 2, 'and set up again in the other document');
});

test('a subtree moved in one operation keeps every component in it (pin 4)', async () => {
  log.length = 0;
  const a = box(); const b = box();
  const outer = doc.createElement('section');
  for (const id of ['s1', 's2']) { const k = doc.createElement('ka-kid'); k.id = id; outer.append(k); }
  a.append(outer); await frame();
  b.insertBefore(outer, null); await tick();
  assert.equal(count('setup'), 2, 'one setup each'); assert.equal(count('cleanup'), 0); assert.equal(count('dc'), 0);
});

test('a keyed reorder of component rows keeps every component (pin 5: the generalization)', async () => {
  log.length = 0;
  const host = box();
  const rows = (ids) => html`${ids.map((id) => keyed(id, html`<ka-kid id=${id}></ka-kid>`))}`;
  renderInto(rows(['k1', 'k2', 'k3']), host); await frame();
  renderInto(rows(['k3', 'k1', 'k2']), host); await frame();
  assert.deepEqual(log.filter((l) => l.startsWith('setup')), ['setup k1', 'setup k2', 'setup k3'], 'one setup per row, through the reorder');
  assert.equal(count('cleanup'), 0, 'nothing torn down');
  assert.equal([...host.querySelectorAll('ka-kid')].map((k) => k.id).join(), 'k3,k1,k2', 'CONTROL: the rows really moved');
});

test('hold parks into a fragment — a real disconnect — and still tears down and sets up as before (pin 5)', async () => {
  log.length = 0;
  const host = box();
  const draw = (on) => html`<p>${hold(on ? html`<ka-kid id="h"></ka-kid>` : null)}</p>`;
  renderInto(draw(true), host); await frame();
  renderInto(draw(false), host); renderInto(draw(true), host); await frame();
  assert.equal(count('setup h'), 2, 'parked and returned: set up again, as today');
  assert.equal(count('cleanup h'), 1);
});

test('a dc that saw the element connected but was never followed by a reconnect cannot skip a later setup (pin 6)', async () => {
  log.length = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 'z'; const a = box(); a.append(kid); await frame();
  kid.disconnectedCallback();                 // synthetic: connected, so marked moved, and no cc follows
  kid.remove();                               // a real removal: must tear down, and clear the mark
  a.append(kid); await frame();               // a real reconnect: must set up
  assert.equal(count('cleanup z'), 1, 'the real removal tore down');
  assert.equal(count('setup z'), 2, 'and the reconnect set up again');
});

test('a slotted component sets up ONCE on its first distribution', async () => {
  log.length = 0;
  customElements.define('ka-host', class extends dom.window.HTMLElement {
    connectedCallback() { init(this); renderInto(html`<header><slot name="a"></slot></header><main><slot></slot></main>`, this); }
  });
  const page = box();
  renderInto(html`<ka-host><ka-kid id="k1" slot="a"></ka-kid><ka-kid id="k2"></ka-kid></ka-host>`, page);
  await frame(); await tick();
  assert.deepEqual(log.filter((l) => l.startsWith('setup')), ['setup k1', 'setup k2']);
  assert.equal(count('cleanup'), 0);
  assert.equal(page.querySelector('header ka-kid')?.id, 'k1', 'CONTROL: k1 really was moved into the named slot');
});

test('a throwing author disconnectedCallback still propagates on removal, as before', async () => {
  customElements.define('ka-throws', class extends dom.window.HTMLElement {
    connectedCallback() { init(this); render(() => html`t`); }
    disconnectedCallback() { throw new Error('author dc threw'); }
  });
  const el = doc.createElement('ka-throws'); box().append(el); await frame();
  const errors = []; const listen = (e) => { errors.push(String(e.error?.message ?? e.message)); e.preventDefault(); };
  dom.window.addEventListener('error', listen);
  el.remove();
  dom.window.removeEventListener('error', listen);
  assert.ok(errors.some((m) => m.includes('author dc threw')), `reported: ${JSON.stringify(errors)}`);
});

test('slots moves every slotted component in ONE operation: two named slots + unassigned content (vera-5a)', async () => {
  log.length = 0;
  customElements.define('ka-two', class extends dom.window.HTMLElement {
    connectedCallback() { init(this); renderInto(html`<header><slot name="a"></slot></header><footer><slot name="b"></slot></footer>`, this); }
  });
  const page = box();
  renderInto(html`<ka-two><ka-kid id="a1" slot="a"></ka-kid><ka-kid id="b1" slot="b"></ka-kid><ka-kid id="u1" slot="nowhere"></ka-kid><ka-kid id="a2" slot="a"></ka-kid></ka-two>`, page);
  await frame(); await tick();
  for (const id of ['a1', 'a2', 'b1']) {
    assert.equal(count(`setup ${id}`), 1, `${id}: set up once — it moved host → slot in one operation`);
    assert.equal(count(`cleanup ${id}`), 0, `${id}: never torn down`);
  }
  assert.equal(count('cleanup u1'), 1, 'the unassigned one IS disconnected (parked in holding) — the one real disconnect');
  assert.equal(page.querySelector('footer ka-kid')?.id, 'b1', 'CONTROL: b1 is in the second slot');
});

/**
 * **Only a component is kept.** Core's wrapper sees every class defined after it loads, Vera's or not; an element that
 * never called `init` is someone else's, and it gets the platform's callbacks on a move — both of them — untouched.
 */
test('a custom element that never called init keeps the platform\'s callbacks on a move', async () => {
  const seen = [];
  customElements.define('ka-plain', class extends dom.window.HTMLElement {
    connectedCallback() { seen.push('cc'); }
    disconnectedCallback() { seen.push('dc'); }
  });
  const a = box(); const b = box();
  const el = doc.createElement('ka-plain'); a.append(el);
  b.insertBefore(el, null);
  assert.deepEqual(seen, ['cc', 'dc', 'cc'], 'a move runs both, as the platform does');
});

/**
 * **Nothing is written to someone else's element** (vera-5a, 2026-10-02). Core's wrapper sees every class defined after
 * it loads, and the fields it keeps are mangled to single letters in PRODUCTION — where a minified library keeps fields
 * of its own. Published 0.3.1 set `this.t = true` on every custom element that disconnected. Every one-letter name
 * holds a value of the element's own, and the instance's own properties must be exactly as they were after a whole
 * lifecycle: connect, move, remove, reconnect, move into another document. Meaningful in both builds; the collision
 * itself exists only under `npm run test:prod`.
 */
test('a third-party element keeps every field of its own through connect, move, remove and reconnect', async () => {
  const LETTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'];
  customElements.define('ka-foreign', class extends dom.window.HTMLElement {
    constructor() { super(); for (const k of LETTERS) this[k] = `mine-${k}`; }
  });
  const el = doc.createElement('ka-foreign');
  const snapshot = () => Object.fromEntries(Object.keys(el).map((k) => [k, el[k]]));
  const before = snapshot();
  assert.equal(Object.keys(before).length, LETTERS.length, 'CONTROL: the fields were set');
  const a = box(); const b = box();
  a.append(el); b.insertBefore(el, null); el.remove(); a.append(el);
  doc.querySelector('iframe').contentDocument.body.append(el); el.remove();
  await tick();
  assert.deepEqual(snapshot(), before, 'core wrote to an element that is not its own');
});
