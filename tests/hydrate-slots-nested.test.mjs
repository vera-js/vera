/**
 * **A template that places content INTO a light-slot component** (step 4, piece 2c). The outer template owns those nodes
 * and their bindings; the inner component distributes them, so on the server they sit in the INNER host's slot ranges,
 * not where the outer template has them. The outer walk reads the inner host's light children in LIGHT order: from slots'
 * live record when the inner host already has one (it was adopted first — the common order), else from the server's
 * statement (the lazy order), which it must then account for exactly. Nothing moves either way.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { printed } from './console-args.mjs';

const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-placed-ssr.js', 'file://' + process.cwd() + '/'))).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[k] = dom.window[k];
const settle = () => new Promise((r) => dom.window.setTimeout(r, 0));
const { wire, html } = await load('core');
const { renderInto, renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { slots, slotted } = await load('renderer/slots');
const { hydrateSlots } = await load('renderer/hydrate-slots');
wire([renderer, hydration, slots, hydrateSlots]);
const outer = (w, v) => html`<p>outer</p><slot-placed-inner><i>${w}</i><b slot="t">${v}</b></slot-placed-inner>`;
const inner = () => html`<div class="box"><slot name="t">T</slot><slot>FB</slot></div>`;
const page = (markup = served) => {
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = markup;
  const host = wrap.firstElementChild;
  dom.window.document.getElementById('root').appendChild(host);
  return [host, host.querySelector('slot-placed-inner, slot-run-inner, slot-placed-literal-inner, slot-shape-inner')];
};
const quietly = async (fn) => {
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(printed(args).join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return said.filter((line) => line.startsWith('[vera]'));
};
/** Every childList record touching one of `nodes` is a move. */
const moves = (root, nodes) => {
  const seen = [];
  const observer = new dom.window.MutationObserver((records) => {
    for (const r of records) for (const n of [...r.addedNodes, ...r.removedNodes]) if (nodes.includes(n)) seen.push(n);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    for (const r of observer.takeRecords()) for (const n of [...r.addedNodes, ...r.removedNodes]) if (nodes.includes(n)) seen.push(n);
    observer.disconnect();
    return seen.length;
  };
};

test('the LAZY order: the outer walks first, from the statement — adopts what it placed, in place, and updates it', async () => {
  assert.match(served, /<slot-placed-inner data-vm-light="1:1,0">/, 'CONTROL: light order (i, b) is not document order (b, i)');
  const [host, inside] = page();
  const [i, b] = [inside.querySelector('i'), inside.querySelector('b')];
  const moved = moves(host, [i, b]);
  const said = await quietly(async () => {
    renderInto(outer('I', 'B'), host);
    await settle();
  });
  assert.deepEqual(said, [], 'the outer adopted');
  assert.equal(moved(), 0, 'nothing moved');
  assert.equal(inside.getAttribute('data-vm-light'), '1:1,0', 'the inner host\'s statement is still its own to read');
  renderInto(outer('I2', 'B2'), host);
  await settle();
  assert.deepEqual([inside.querySelector('i'), inside.querySelector('b')], [i, b], 'the outer updated the nodes it placed, by identity');
  assert.deepEqual([i.textContent, b.textContent], ['I2', 'B2']);
  /** Then the inner adopts its own light — the same nodes, now with the outer's text. */
  const later = await quietly(async () => {
    renderInto(inner(), inside);
    await settle();
  });
  assert.deepEqual(later, [], 'the inner adopted after');
  assert.deepEqual(slotted(inside, 't'), [b], 'b is the named slot\'s');
  assert.deepEqual(slotted(inside), [i], 'i the default\'s');
  host.remove();
});

test('the LIVE order with drift: the inner adopted first, the user appended to it — the outer adopts its own, the user\'s untouched', async () => {
  const [host, inside] = page();
  const [i, b] = [inside.querySelector('i'), inside.querySelector('b')];
  await quietly(async () => {
    renderInto(inner(), inside);
    await settle();
  });
  assert.equal(inside.hasAttribute('data-vm-light'), false, 'CONTROL: the inner adopted, so its record is the source');
  const u = dom.window.document.createElement('u');
  u.textContent = 'USER';
  inside.append(u);
  await settle();
  assert.deepEqual(slotted(inside), [i, u], 'CONTROL: the user\'s node is light content, after i');
  const moved = moves(host, [i, b, u]);
  const said = await quietly(async () => {
    renderInto(outer('I', 'B'), host);
    await settle();
  });
  assert.deepEqual(said, [], 'the outer adopted — the user\'s node is the host\'s, not a disagreement');
  assert.equal(moved(), 0, 'nothing moved');
  assert.deepEqual(slotted(inside), [i, u], 'the user\'s node untouched, in place');
  assert.equal(inside.querySelectorAll('i').length + inside.querySelectorAll('u').length, 2, 'and nothing duplicated');
  renderInto(outer('I3', 'B3'), host);
  await settle();
  assert.deepEqual([i.textContent, b.textContent, u.textContent], ['I3', 'B3', 'USER'], 'the outer updates only its own');
  host.remove();
});

test('the statement is STRICT: a light child the outer template does not place is the standard fallback', async () => {
  const extra = served.replace('data-vm-light="1:1,0"', 'data-vm-light="1:1*2,0"').replace('<i>I</i>', '<i>I</i><s>X</s>');
  assert.notEqual(extra, served, 'CONTROL: the extra child is in the markup and the statement');
  const [host] = page(extra);
  const said = await quietly(async () => {
    renderInto(outer('I', 'B'), host);
    await settle();
  });
  assert.equal(said.length, 1, `one warning: ${said.join(' | ')}`);
  assert.match(said[0], /hydration-fallback/);
  host.remove();
});

/**
 * **A RUN: the outer template BINDS a list into the inner host.** On the client the run's nodes are one contiguous unit
 * in the inner host's holding, slots taking each to its slot and leaving a stand-in at its place; on the server they are
 * spread across the inner's ranges. After hydration the list must update exactly as a client-rendered one does.
 */
const runServed = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-run-ssr.js', 'file://' + process.cwd() + '/'))).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const runOuter = (items) => html`<p>outer</p><slot-run-inner>${items.map((x) => html`<i slot=${x === 'b' ? 't' : ''}>${x}</i>`)}</slot-run-inner>`;
const runInner = () => html`<div class="box"><slot name="t">T</slot><slot>FB</slot></div>`;
const shows = (inside) => [slotted(inside, 't').map((n) => n.textContent).join(''), slotted(inside).map((n) => n.textContent).join(''), inside.querySelector('.box').textContent];

/** The statement's strictness is the END check too: an extra light child after everything the template placed. */
test('the statement is STRICT at the end: a last light child the outer template does not place is the standard fallback', async () => {
  const extra = served.replace('data-vm-light="1:1,0"', 'data-vm-light="1:1,0,1"').replace('<i>I</i>', '<i>I</i><s>X</s>');
  assert.notEqual(extra, served, 'CONTROL: the extra child is last in light order');
  const [host] = page(extra);
  const said = await quietly(async () => {
    renderInto(outer('I', 'B'), host);
    await settle();
  });
  assert.equal(said.length, 1, `one warning: ${said.join(' | ')}`);
  assert.match(said[0], /hydration-fallback/);
  host.remove();
});

/**
 * **vera-5a's lazy-order pins.** (a) A literal `<!--[-->`…`<!--]-->` pair in the INNER host's own template, the outer
 * walking first: the statement cannot tell the inner template's literal pair from a real range — only the inner's own
 * template knows its statics — so the statement does not reconcile, the outer falls back, and the END STATE is what a
 * client render makes. A known limit of the lazy order, recorded here; with the inner adopted first, the inner's own
 * walk passes the literal as the comment it is (`hydrate-slots-markers`, W1 first).
 */
/**
 * The outer's fallback renders a CLIENT-MADE inner host holding the placed `<i>`: with no statement, its own first render
 * declines the walk and keeps `<i>` as light content (step 4's 2d — before it, the render took `<i>` for server output,
 * warned "expected <div> and found <i>", and cleared it).
 */
test('(a) a literal marker pair in the inner\'s own template, the outer first: the end state is the client\'s', async () => {
  const literal = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
    import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
    process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-placed-literal-ssr.js', 'file://' + process.cwd() + '/'))).html);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(literal, /<div><!--\[--><p>own<\/p><!--\]--><!--\[--><i>I<\/i><!--\]--><\/div>/, `CONTROL: a literal pair beside the real range: ${literal}`);
  const [host] = page(literal);
  const outerLiteral = (w) => html`<p>outer</p><slot-placed-literal-inner><i>${w}</i></slot-placed-literal-inner>`;
  const innerLiteral = () => html`<div><!--[--><p>own</p><!--]--><slot>FB</slot></div>`;
  await quietly(async () => {
    renderInto(outerLiteral('I'), host);
    await settle();
    renderInto(innerLiteral(), host.querySelector('slot-placed-literal-inner'));
    await settle();
  });
  const inside = host.querySelector('slot-placed-literal-inner');
  assert.equal(host.querySelector('p').textContent, 'outer', 'the outer\'s own content');
  assert.equal(inside.querySelector('div > p').textContent, 'own', 'the inner\'s own content, once');
  assert.equal(inside.querySelectorAll('p').length, 1, 'not duplicated');
  assert.deepEqual(slotted(inside).map((n) => n.textContent), ['I'], 'the outer\'s placed node is the inner\'s light content');
  assert.equal(inside.querySelector('slot'), null, 'and its slot shows it, not the fallback');
  host.remove();
});

/** (b) A served host whose class is NEVER defined: the outer adopts what it placed, and that host stands exactly as served. */
test('(b) an inner host never defined: the outer adopts its own, the inner\'s markup byte-identical, nothing moved', async () => {
  const [host, inside] = page();
  const before = inside.outerHTML;
  const nodes = [...inside.querySelectorAll('*'), ...[...inside.querySelectorAll('*')].flatMap((e) => [...e.childNodes])];
  const moved = moves(host, nodes);
  const said = await quietly(async () => {
    renderInto(outer('I', 'B'), host);
    await settle();
    await new Promise((r) => dom.window.requestAnimationFrame(r));
  });
  assert.deepEqual(said, [], 'the outer adopted');
  assert.equal(moved(), 0, 'nothing in the inner host moved');
  assert.equal(inside.outerHTML, before, 'the inner host is byte-identical');
  host.remove();
});

/**
 * Runs are adopted in the client's own shape (2c part 2, R1): whichever walk reaches the inner host first captures it,
 * the run a unit in holding — its part's anchors inside, a stand-in at each slotted node's place — so the renderer's
 * later inserts and removals land as on a client-distributed host. (Before R1, growing the list threw NotFoundError: the
 * end anchor sat at the host's level.)
 */
for (const order of ['outer first (statement)', 'inner first (live record)'])
  test(`a run the outer binds into the inner host, ${order}: adopted, then it updates as a client render does`, async () => {
    const [host, inside] = page(runServed);
    const [a, b, c] = [...inside.querySelectorAll('i')].sort((x, y) => x.textContent.localeCompare(y.textContent));
    const said = await quietly(async () => {
      if (order.startsWith('inner')) {
        renderInto(runInner(), inside);
        await settle();
      }
      renderInto(runOuter(['a', 'b', 'c']), host);
      await settle();
      if (order.startsWith('outer')) {
        renderInto(runInner(), inside);
        await settle();
      }
    });
    assert.deepEqual(said, [], 'both adopted');
    assert.deepEqual(shows(inside), ['b', 'ac', 'bac'], 'hydrated: b named, a and c default, in light order');
    assert.deepEqual([...inside.querySelectorAll('i')].sort((x, y) => x.textContent.localeCompare(y.textContent)), [a, b, c], 'by identity');
    renderInto(runOuter(['c', 'b', 'a']), host);
    await settle();
    assert.deepEqual(shows(inside), ['b', 'ca', 'bca'], 'reordered');
    renderInto(runOuter(['a', 'b', 'c', 'd']), host);
    await settle();
    assert.deepEqual(shows(inside), ['b', 'acd', 'bacd'], 'grown');
    renderInto(runOuter(['b']), host);
    await settle();
    assert.deepEqual(shows(inside), ['b', '', 'bFB'], 'shrunk: the default slot shows its fallback');
    renderInto(runOuter([]), host);
    await settle();
    assert.deepEqual(shows(inside), ['', '', 'TFB'], 'emptied: both fallbacks');
    host.remove();
  });

/**
 * **A TEXT binding placed into a light component — the commonest shape there is** (`<x-btn>${label}</x-btn>`): no anchors
 * are needed, so it is adopted in place — the light text node claimed, split from static text beside it — and its
 * updates write that node wherever the inner put it. Alone, and beside static text; both orders.
 */
const labelServed = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-label-ssr.js', 'file://' + process.cwd() + '/'))).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const labelOuter = (label, name) => html`<slot-label-btn>${label}</slot-label-btn><slot-label-btn>Hi ${name}!</slot-label-btn>`;
const labelInner = () => html`<button class="btn"><slot>no label</slot></button>`;
for (const order of ['outer first (statement)', 'inner first (live record)'])
  test(`a text binding placed into a light component, ${order}: adopted in place, and it updates`, async () => {
    const wrap = dom.window.document.createElement('div');
    wrap.innerHTML = labelServed;
    const host = dom.window.document.getElementById('root').appendChild(wrap.firstElementChild);
    const [one, two] = host.querySelectorAll('slot-label-btn');
    assert.equal(one.querySelector('button').textContent + '|' + two.querySelector('button').textContent, 'Save|Hi Ada!', 'CONTROL: served');
    const texts = [one, two].map((b) => b.querySelector('button').firstChild.nextSibling);
    const moved = moves(host, texts);
    const said = await quietly(async () => {
      if (order.startsWith('inner')) for (const b of [one, two]) renderInto(labelInner(), b);
      await settle();
      renderInto(labelOuter('Save', 'Ada'), host);
      await settle();
      if (order.startsWith('outer')) for (const b of [one, two]) renderInto(labelInner(), b);
      await settle();
    });
    assert.deepEqual(said, [], 'adopted, nothing said');
    assert.equal(moved(), 0, 'no light text moved');
    assert.equal(one.querySelector('button').firstChild.nextSibling, texts[0], 'the lone text node kept, by identity');
    renderInto(labelOuter('Saved', 'Grace'), host);
    await settle();
    assert.equal(one.querySelector('button').textContent, 'Saved', 'the lone label updated in place');
    assert.equal(two.querySelector('button').textContent, 'Hi Grace!', 'and the one beside static text');
    assert.deepEqual(slotted(two).map((n) => n.textContent).join(''), 'Hi Grace!', 'all of it the inner\'s light content');
    host.remove();
  });

/**
 * **Runs, held step by step** (R1, vera-5a's conditions): every shape a list takes after hydration — keyed REORDER (each
 * node kept by identity), GROW, SHRINK to EMPTY, REPLACE by a template and back, runs mixed with statics with one
 * emptied in the MIDDLE (its unit must stand before the static after it, never at the end) — in both orders, and
 * hydrating moves NOTHING the server rendered: the run is seated in holding, never by moving a light node.
 */
const shapesServed = (tag) => execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-run-shapes-ssr.js', 'file://' + process.cwd() + '/'), { tag: '${tag}' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const { keyed } = await load('renderer/keyed');
const keyedOuter = (items) => html`<p>outer</p><slot-run-inner>${items.map((x) => keyed(x, html`<i slot=${x === 'b' ? 't' : ''}>${x}</i>`))}</slot-run-inner>`;
const swapOuter = (items) => html`<p>outer</p><slot-run-inner>${items === null ? html`<u>ONE</u>` : items.map((x) => html`<i slot=${x === 'b' ? 't' : ''}>${x}</i>`)}</slot-run-inner>`;
const mixedOuter = (a, b) => html`<p>outer</p><slot-shape-inner><em>first</em>${a.map((x) => html`<i>${x}</i>`)}<u slot="t">mid</u>${b.map((x) => html`<s>${x}</s>`)}<em>last</em></slot-shape-inner>`;

/** Hydrates `markup` in `order` with `first`, counting every server-rendered node it inserted or removed. */
const hydrateRun = async (markup, order, first, drawInner = runInner) => {
  const [host, inside] = page(markup);
  const nodes = [...inside.querySelectorAll('*'), ...[...inside.querySelectorAll('*')].flatMap((e) => [...e.childNodes])].filter((n) => n.nodeType !== 8);
  const moved = moves(host, nodes);
  const said = await quietly(async () => {
    if (order.startsWith('inner')) {
      renderInto(drawInner(), inside);
      await settle();
    }
    renderInto(first, host);
    await settle();
    if (order.startsWith('outer')) {
      renderInto(drawInner(), inside);
      await settle();
    }
  });
  return { host, inside, said, moved: moved() };
};
const step = async (host, view) => {
  renderInto(view, host);
  await settle();
};

for (const order of ['outer first (statement)', 'inner first (live record)']) {
  test(`a KEYED run, ${order}: nothing moves hydrating; reorder keeps each node; grow, shrink to empty, refill`, async () => {
    const { host, inside, said, moved } = await hydrateRun(runServed, order, keyedOuter(['a', 'b', 'c']));
    assert.deepEqual(said, [], 'both adopted');
    assert.equal(moved, 0, 'hydrating moved no server-rendered node');
    const node = (x) => [...inside.querySelectorAll('i')].find((i) => i.textContent === x);
    const [a, b, c] = ['a', 'b', 'c'].map(node);
    assert.deepEqual(shows(inside), ['b', 'ac', 'bac'], 'hydrated');
    await step(host, keyedOuter(['c', 'a', 'b']));
    assert.deepEqual(shows(inside), ['b', 'ca', 'bca'], 'reordered');
    assert.deepEqual(['a', 'b', 'c'].map(node), [a, b, c], 'each keyed node kept by identity');
    await step(host, keyedOuter(['c', 'a', 'd', 'b']));
    assert.deepEqual(shows(inside), ['b', 'cad', 'bcad'], 'grown in the middle');
    await step(host, keyedOuter(['d']));
    assert.deepEqual(shows(inside), ['', 'd', 'Td'], 'shrunk: the named slot shows its fallback');
    await step(host, keyedOuter([]));
    assert.deepEqual(shows(inside), ['', '', 'TFB'], 'emptied');
    await step(host, keyedOuter(['b', 'e']));
    assert.deepEqual(shows(inside), ['b', 'e', 'be'], 'refilled');
    host.remove();
  });

  test(`a run REPLACED by a template and back, ${order}`, async () => {
    const { host, inside, said, moved } = await hydrateRun(runServed, order, swapOuter(['a', 'b', 'c']));
    assert.deepEqual(said, [], 'both adopted');
    assert.equal(moved, 0, 'hydrating moved no server-rendered node');
    await step(host, swapOuter(null));
    assert.deepEqual(shows(inside), ['', 'ONE', 'TONE'], 'replaced by a template');
    await step(host, swapOuter(['b', 'c']));
    assert.deepEqual(shows(inside), ['b', 'c', 'bc'], 'and a list again');
    host.remove();
  });

  test(`runs MIXED with statics, ${order}: one emptied in the middle stands before the static after it`, async () => {
    const { host, inside, said, moved } = await hydrateRun(shapesServed('slot-mixed-ssr'), order, mixedOuter(['a1', 'a2'], ['b1']));
    assert.deepEqual(said, [], 'both adopted');
    assert.equal(moved, 0, 'hydrating moved no server-rendered node');
    assert.deepEqual(shows(inside), ['mid', 'firsta1a2b1last', 'midfirsta1a2b1last'], 'hydrated');
    await step(host, mixedOuter([], ['b1']));
    assert.deepEqual(shows(inside), ['mid', 'firstb1last', 'midfirstb1last'], 'the first run emptied, in the middle');
    await step(host, mixedOuter(['a3'], ['b1']));
    assert.deepEqual(shows(inside), ['mid', 'firsta3b1last', 'midfirsta3b1last'], 'refilled where it stood');
    await step(host, mixedOuter(['a3'], []));
    assert.deepEqual(shows(inside), ['mid', 'firsta3last', 'midfirsta3last'], 'the second emptied');
    await step(host, mixedOuter(['a3', 'a4'], ['b2', 'b3']));
    assert.deepEqual(shows(inside), ['mid', 'firsta3a4b2b3last', 'midfirsta3a4b2b3last'], 'both grown');
    host.remove();
  });

  /**
   * **A run beside text, and a run whose component leaves a slot EMPTY** — found by a probe, all silently wrong before
   * (2026-10-07). The walk splits the server's merged text (`AtB`) into the pieces a client render makes, so the run is
   * seated against the light children as they stand THEN, never as the walk began (the pieces were never captured, and
   * the next distribution dropped them); and an empty named slot mounting first must not read the run's node, in the
   * default slot's served region not yet registered, as taken (outer first, it vanished — the commonest run shape).
   */
  for (const [label, tag, draw, views] of [
    ['alone, the named slot empty', 'slot-plainrun-ssr', (t, l) => html`<p>outer</p><slot-shape-inner>${l.map((x) => html`<i>${x}</i>`)}</slot-shape-inner>`, ['a', 'a|b', '', 'c']],
    ['after text split around a value', 'slot-split-ssr', (t, l) => html`<p>outer</p><slot-shape-inner>A${t}B${l.map((x) => html`<i>${x}</i>`)}</slot-shape-inner>`, ['A|t|B|a', 'A|u|B|a|b', 'A|v|B', 'A|w|B|c']],
    ['between a value and text', 'slot-textrun-ssr', (t, l) => html`<p>outer</p><slot-shape-inner>A${t}${l.map((x) => html`<i>${x}</i>`)}B</slot-shape-inner>`, ['A|t|a|B', 'A|u|a|b|B', 'A|v|B', 'A|w|c|B']],
    /** Served EMPTY between two texts, which the server merges (`AB`): the walk stands inside that text as the run begins. */
    ['empty, between two texts the server merged', 'slot-emptyrun-ssr', (t, l) => html`<p>outer</p><slot-shape-inner>A${(t === 't' ? [] : l).map((x) => html`<i>${x}</i>`)}B</slot-shape-inner>`, ['A|B', 'A|a|b|B', 'A|B', 'A|c|B']],
  ])
    test(`a run ${label}, ${order}: adopted, and every update is the client's`, async () => {
      const { host, inside, said, moved } = await hydrateRun(shapesServed(tag), order, draw('t', ['a']));
      assert.deepEqual(said, [], 'both adopted');
      assert.equal(moved, 0, 'hydrating moved no server-rendered node');
      const view = () => slotted(inside).map((n) => n.textContent).join('|');
      const seen = [view()];
      for (const [t, l] of [['u', ['a', 'b']], ['v', []], ['w', ['c']]]) {
        await step(host, draw(t, l));
        seen.push(view());
      }
      assert.deepEqual(seen, views, 'hydrated, grown, emptied, refilled — each piece of text a light child, as on the client');
      host.remove();
    });

  /** **What the first release of runs declines**: items that are not each one element — ONE standard fallback warning, never a throw. */
  for (const [label, tag, draw] of [['items of two elements each', 'slot-pairs-ssr', () => html`<p>outer</p><slot-shape-inner>${['a', 'b'].map((x) => html`<i>${x}</i><b>${x}</b>`)}</slot-shape-inner>`]])
    test(`a run of ${label}, ${order}: declined — one standard fallback warning, never a throw`, async () => {
      const [host, inside] = page(shapesServed(tag));
      const said = await quietly(async () => {
        if (order.startsWith('inner')) {
          renderInto(runInner(), inside);
          await settle();
        }
        renderInto(draw(), host);
        await settle();
      });
      assert.equal(said.length, 1, `one warning: ${said.join(' | ')}`);
      assert.match(said[0], /hydration-fallback/, 'the standard fallback, with its code');
      assert.equal(host.querySelector('p')?.textContent, 'outer', "the outer's own content rendered");
      host.remove();
    });
}
