/**
 * **`@vera-hooks/labeled`: one hook wires a control to its label, hint, count and errors, and gives back exactly what
 * it found.** Each row is one line of the sign-off sheet (`labeled`'s surface and principles 1, 6, 8, 10, 11, 12).
 *
 * jsdom is the regression net here, never the oracle: the accessible name a browser computes, a label click focusing
 * the control, and axe live in the browser suite. These rows hold what the hook WRITES, which is decided in our code.
 * Each test builds its own document, so no row reads another row's ids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const GLOBALS = ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Event', 'CustomEvent'];

/** A fresh document holding `markup`, with the globals the hook may read pointed at it. */
const page = (markup) => {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { url: 'http://localhost/' });
  for (const key of GLOBALS) globalThis[key] = dom.window[key];
  return dom.window.document;
};

/** Every console.warn while `run` runs. */
const warnings = (run) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(String(args[0]));
  try {
    run();
  } finally {
    console.warn = warn;
  }
  return said;
};

/** The attributes a row compares, in a fixed order. */
const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Each copy is loaded once: `fresh` gives a second copy through a query, as two bundles on one page would be. */
const { labeled } = await load('vera-hooks/labeled');

test('a labelable control is named by label[for]; the control gets an id from the counter', () => {
  const doc = page('<label>Name</label><input>');
  const [label, input] = [doc.querySelector('label'), doc.querySelector('input')];
  labeled(input, { host: doc.body, label });
  assert.match(input.id, /^vu\d+$/);
  assert.equal(label.getAttribute('for'), input.id);
  assert.equal(input.hasAttribute('aria-labelledby'), false, 'never aria-labelledby where for works');
});

test('a focus target that is not labelable is named by aria-labelledby, and the label gets an id', () => {
  const doc = page('<label>Fruit</label><div role="combobox" tabindex="0"></div>');
  const [label, box] = [doc.querySelector('label'), doc.querySelector('[role]')];
  labeled(box, { host: doc.body, label });
  assert.equal(label.hasAttribute('for'), false, 'for names only a labelable control');
  assert.match(label.id, /^vu\d+$/);
  assert.equal(box.getAttribute('aria-labelledby'), label.id);
});

test('hint and count are described; errors are described only while shown, with aria-invalid', () => {
  const doc = page('<label>A</label><input><p class="hint">h</p><p class="count">0/9</p><p class="e1">e1</p><p class="e2">e2</p>');
  const q = (s) => doc.querySelector(s);
  const input = q('input');
  const wiring = labeled(input, { host: doc.body, label: q('label'), hint: q('.hint'), count: q('.count'), errors: [q('.e1'), q('.e2')] });
  assert.deepEqual(input.getAttribute('aria-describedby').split(' '), [q('.hint').id, q('.count').id]);
  assert.equal(input.hasAttribute('aria-invalid'), false);
  wiring.show(q('.e2'));
  assert.deepEqual(input.getAttribute('aria-describedby').split(' '), [q('.hint').id, q('.count').id, q('.e2').id]);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  wiring.show(q('.e1'));
  assert.deepEqual(input.getAttribute('aria-describedby').split(' '), [q('.hint').id, q('.count').id, q('.e1').id], 'one shown error at a time');
  wiring.show(null);
  assert.deepEqual(input.getAttribute('aria-describedby').split(' '), [q('.hint').id, q('.count').id]);
  assert.equal(input.hasAttribute('aria-invalid'), false);
});

test("the user's own describedby token survives wire, show and release, and stays first", () => {
  const doc = page('<label>A</label><input aria-describedby="mine"><p class="hint">h</p><p class="e">e</p><p id="mine">m</p>');
  const input = doc.querySelector('input');
  const wiring = labeled(input, { host: doc.body, label: doc.querySelector('label'), hint: doc.querySelector('.hint'), errors: [doc.querySelector('.e')] });
  assert.equal(input.getAttribute('aria-describedby').split(' ')[0], 'mine');
  wiring.show(doc.querySelector('.e'));
  assert.equal(input.getAttribute('aria-describedby').split(' ')[0], 'mine');
  wiring.release();
  assert.equal(input.getAttribute('aria-describedby'), 'mine');
});

test('release() restores every attribute it touched to what it found, user-set values included', () => {
  const doc = page(
    '<label for="other">A</label><input id="user-id" aria-invalid="grammar" aria-describedby="x y"><p class="hint" id="hint-own">h</p><p class="e">e</p>' +
      '<label class="l2">B</label><div role="combobox" tabindex="0" aria-labelledby="pre"></div>'
  );
  const input = doc.querySelector('input');
  const label = doc.querySelector('label');
  const before = [input, label, doc.querySelector('.hint'), doc.querySelector('.e')].map(attrs);
  const wiring = labeled(input, { host: doc.body, label, hint: doc.querySelector('.hint'), errors: [doc.querySelector('.e')] });
  wiring.show(doc.querySelector('.e'));
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  wiring.release();
  assert.deepEqual([input, label, doc.querySelector('.hint'), doc.querySelector('.e')].map(attrs), before);

  const [l2, box] = [doc.querySelector('.l2'), doc.querySelector('[role]')];
  const before2 = [l2, box].map(attrs);
  labeled(box, { host: doc.body, label: l2 }).release();
  assert.deepEqual([l2, box].map(attrs), before2, 'aria-labelledby and a generated label id, too');
});

test('a token the page already had is not removed at release (it was not ours)', () => {
  const doc = page('<label>A</label><input aria-describedby="h"><p id="h">h</p>');
  const input = doc.querySelector('input');
  labeled(input, { host: doc.body, label: doc.querySelector('label'), hint: doc.querySelector('#h') }).release();
  assert.equal(input.getAttribute('aria-describedby'), 'h');
});

test('an error the page already described stays described when the hook stops showing it', () => {
  const doc = page('<label>A</label><input aria-describedby="e1"><p class="hint">h</p><p id="e1">e1</p><p class="e2">e2</p>');
  const q = (s) => doc.querySelector(s);
  const input = q('input');
  const wiring = labeled(input, { host: doc.body, label: q('label'), hint: q('.hint'), errors: [q('#e1'), q('.e2')] });
  wiring.show(q('#e1'));
  wiring.show(q('.e2'));
  wiring.show(null);
  assert.ok(input.getAttribute('aria-describedby').split(' ').includes('e1'), 'the page put e1 there; the hook never added it, so never takes it');
  wiring.release();
  assert.equal(input.getAttribute('aria-describedby'), 'e1');
});

test('the control gets an id only where label[for] needs one', () => {
  const doc = page('<label>A</label><div role="combobox" tabindex="0"></div><input class="bare" aria-label="B"><p class="hint">h</p>');
  labeled(doc.querySelector('[role]'), { host: doc.body, label: doc.querySelector('label') });
  labeled(doc.querySelector('.bare'), { host: doc.body, hint: doc.querySelector('.hint') });
  assert.equal(doc.querySelector('[role]').hasAttribute('id'), false, 'named through aria-labelledby: nothing references the control');
  assert.equal(doc.querySelector('.bare').hasAttribute('id'), false, 'no label at all');
  assert.ok(doc.querySelector('.hint').id, 'CONTROL: the hint, which is referenced, got one');
});

test('the same host wiring again replaces its own wiring: the newest handle is the live one', () => {
  const doc = page('<label>A</label><input><p class="e">e</p>');
  const q = (s) => doc.querySelector(s);
  const first = labeled(q('input'), { host: doc.body, label: q('label'), errors: [q('.e')] });
  const second = labeled(q('input'), { host: doc.body, label: q('label'), errors: [q('.e')] });
  second.show(q('.e'));
  assert.equal(q('input').getAttribute('aria-invalid'), 'true', 'the second handle shows');
  first.release();
  assert.equal(q('input').getAttribute('aria-invalid'), 'true', 'the replaced handle owns nothing any more');
  second.release();
  assert.equal(q('input').hasAttribute('aria-invalid'), false);
  assert.equal(q('label').hasAttribute('for'), false);
});

test('a form-associated element wired BEFORE its upgrade is named through aria-labelledby, and stays so (caller order)', () => {
  const doc = page('<label>A</label><x-face tabindex="0"></x-face>');
  const face = doc.querySelector('x-face');
  labeled(face, { host: doc.body, label: doc.querySelector('label') });
  window.customElements.define('x-face', class extends window.HTMLElement { static formAssociated = true; });
  assert.ok(face.getAttribute('aria-labelledby'), 'not labelable when wired');
  assert.equal(doc.querySelector('label').hasAttribute('for'), false);
  const after = doc.createElement('x-face');
  doc.body.append(after);
  const label2 = doc.createElement('label');
  doc.body.append(label2);
  labeled(after, { host: doc.body, label: label2 });
  assert.equal(label2.getAttribute('for'), after.id, 'CONTROL: wired after its upgrade, it is labelable');
});

test('an id already on an element is kept, and no number is taken for it (a server render hydrates unchanged)', () => {
  const doc = page('<label id="server-l">A</label><input id="server-c"><p id="server-h">h</p>');
  const input = doc.querySelector('input');
  labeled(input, { host: doc.body, label: doc.querySelector('label'), hint: doc.querySelector('p') });
  assert.equal(input.id, 'server-c');
  assert.equal(doc.querySelector('label').getAttribute('for'), 'server-c');
  assert.equal(input.getAttribute('aria-describedby'), 'server-h');
});

test("an author's id that looks like ours is skipped at wire time", () => {
  const counter = globalThis[Symbol.for('vera.uid')];
  const next = `vu${(counter?.n ?? 0) + 1}`;
  const doc = page(`<label>A</label><input><span id="${next}"></span>`);
  const input = doc.querySelector('input');
  labeled(input, { host: doc.body, label: doc.querySelector('label') });
  assert.notEqual(input.id, next);
  assert.equal(doc.querySelectorAll(`#${input.id}`).length, 1);
});

test('LIMIT, pinned: an author element inserted AFTER wiring with a taken id collides (best-effort, as documented)', () => {
  const doc = page('<label>A</label><input>');
  const input = doc.querySelector('input');
  labeled(input, { host: doc.body, label: doc.querySelector('label') });
  const late = doc.createElement('span');
  late.id = input.id;
  doc.body.append(late);
  assert.equal(doc.querySelectorAll(`[id="${input.id}"]`).length, 2, 'the skip reads only what exists at wire time');
});

test('two copies of the hook on one page never hand out the same id', async () => {
  const other = await load('vera-hooks/labeled', '?copy=2');
  assert.notEqual(other.labeled, labeled, 'CONTROL: a second module instance');
  const doc = page('<label>A</label><input class="a"><label>B</label><input class="b">');
  const [la, lb] = doc.querySelectorAll('label');
  labeled(doc.querySelector('.a'), { host: doc.body, label: la });
  other.labeled(doc.querySelector('.b'), { host: doc.body, label: lb });
  assert.notEqual(doc.querySelector('.a').id, doc.querySelector('.b').id);
});

test('the NEAREST caller owns the wiring, in either upgrade order, and the DOM ends byte-identical', () => {
  const markup = '<div class="outer"><div class="inner"><label>A</label><input><p class="hint">h</p></div></div>';
  const run = (innerFirst) => {
    const doc = page(markup);
    const q = (s) => doc.querySelector(s);
    const outer = () => labeled(q('input'), { host: q('.outer'), label: q('label') });
    const inner = () => labeled(q('input'), { host: q('.inner'), label: q('label'), hint: q('.hint') });
    const handles = innerFirst ? [inner(), outer()] : [outer(), inner()];
    return { html: doc.body.innerHTML, handles, doc };
  };
  const a = run(false);
  const b = run(true);
  /** Ids differ between the two pages only by the counter; compare with each page's ids replaced by their order of first use. */
  const canon = (html) => {
    const seen = new Map();
    return html.replace(/vu\d+/g, (id) => (seen.has(id) ? seen.get(id) : (seen.set(id, `ID${seen.size}`), seen.get(id))));
  };
  assert.equal(canon(a.html), canon(b.html));
  assert.ok(b.doc.querySelector('input').getAttribute('aria-describedby'), 'CONTROL: the inner (nearer) wiring, with its hint, is the one in place');
  /** The farther caller's handle owns nothing: its release changes nothing. */
  const before = b.doc.body.innerHTML;
  b.handles[1].release();
  assert.equal(b.doc.body.innerHTML, before);
});

test('a label in a different root from the control is not wired', () => {
  const doc = page('<label>A</label><div class="host"></div>');
  const root = doc.querySelector('.host').attachShadow({ mode: 'open' });
  root.innerHTML = '<input>';
  const input = root.querySelector('input');
  const said = warnings(() => labeled(input, { host: doc.querySelector('.host'), label: doc.querySelector('label') }));
  assert.equal(doc.querySelector('label').hasAttribute('for'), false, 'no dead reference across a shadow boundary');
  assert.equal(input.hasAttribute('aria-labelledby'), false);
  if (!isProduction) assert.ok(said.some((m) => m.includes('labeled-cross-root')), said.join('\n'));
});

test('a part whose id holds whitespace is left out of the reference, and development says so by code', () => {
  const doc = page('<label>A</label><input><p id="a b">h</p>');
  const input = doc.querySelector('input');
  const said = warnings(() => labeled(input, { host: doc.body, label: doc.querySelector('label'), hint: doc.querySelector('p') }));
  assert.equal(doc.querySelector('p').id, 'a b', 'the id is the page\'s, kept');
  assert.equal(input.hasAttribute('aria-describedby'), false, 'two tokens would reference two other elements');
  if (!isProduction) assert.equal(said.filter((m) => m.includes('labeled-id-token')).length, 1, said.join('\n'));
});

test("inside a user's own shadow root, a label and control in that root are wired", () => {
  const doc = page('<div class="host"></div>');
  const root = doc.querySelector('.host').attachShadow({ mode: 'open' });
  root.innerHTML = '<label>A</label><input>';
  labeled(root.querySelector('input'), { host: doc.querySelector('.host'), label: root.querySelector('label') });
  assert.equal(root.querySelector('label').getAttribute('for'), root.querySelector('input').id);
});

test('development warns once on a control with no name after wiring, and never on each named shape', { skip: isProduction && 'development diagnostics are folded out' }, () => {
  const doc = page('<input class="bare">');
  const bare = doc.querySelector('.bare');
  const said = warnings(() => {
    labeled(bare, { host: doc.body }).release();
    labeled(bare, { host: doc.body });
  });
  assert.equal(said.filter((m) => m.includes('labeled-unnamed')).length, 1, said.join('\n'));
  assert.ok(said[0].startsWith('[vera]'));

  /** [markup, whether the hook is handed the label] — the label[for] shape is the only one the hook itself names. */
  const named = [
    ['<label>A</label><input>', true],
    ['<label>A <input></label>', false],
    ['<input aria-label="A">', false],
    ['<span id="n">A</span><input aria-labelledby="n">', false],
    ['<input title="A">', false],
    ['<button>Go</button>', false],
  ];
  for (const [markup, handed] of named) {
    const d = page(markup);
    const control = d.querySelector('input, button');
    const quiet = warnings(() => labeled(control, { host: d.body, ...(handed ? { label: d.querySelector('label') } : {}) }));
    assert.deepEqual(quiet, [], markup);
  }
});

test('hostile ids already on the elements are kept untouched, and no element is created (seeded)', () => {
  /** Strings an attacker could plant as ids: markup, quotes, spaces (a token separator), selectors, a huge value. */
  const HOSTILE = ['"><img src=x onerror=alert(1)>', "a'b", 'a b', '#x, *', '</label>', 'x'.repeat(10000), 'vu1', '\u0000', ' '];
  for (const seed of extendSeeds([1, 2, 3])) {
    let state = seed >>> 0 || 1;
    const pick = () => HOSTILE[(state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % HOSTILE.length];
    const doc = page('<label>A</label><input><p>h</p>');
    const [label, input, hint] = ['label', 'input', 'p'].map((s) => doc.querySelector(s));
    const ids = [pick(), pick(), pick()];
    [label, input, hint].forEach((el, i) => el.setAttribute('id', ids[i]));
    const count = doc.getElementsByTagName('*').length;
    labeled(input, { host: doc.body, label, hint }).release();
    assert.deepEqual([label, input, hint].map((el) => el.getAttribute('id')), ids, `seed ${seed}`);
    assert.equal(doc.getElementsByTagName('*').length, count, `seed ${seed}: no element created`);
  }
});
