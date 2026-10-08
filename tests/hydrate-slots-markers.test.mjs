/**
 * **Slots hydration through the region markers (step 4, format v2).** The server writes each filled slot as the client
 * leaves it — `<!--[-->`, its light nodes, `<!--]-->` — and hydration adopts those markers as the slot's region. These
 * rows pin what the marker format must guarantee beyond the general suite (`hydrate-slots`): the markers are adopted,
 * nothing moves, a component's own literal `[`/`]` comments are passed as comments, a slot NAME never reaches a comment,
 * and comments inside light content are the page's, never markers.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const server = (children, fixture) => {
  const script = `
    import { renderToString } from '@verajs/ssr';
    import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots');
    wire([slots]);
    const out = (await renderToString(new URL('./tests/fixtures/ssr/${fixture}.js', 'file://' + process.cwd() + '/'), { children: ${JSON.stringify(children)} })).html;
    process.stdout.write(out);
  `;
  return execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
};

const dom = new JSDOM('<div id="root"></div>');
for (const k of ['document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);
const settle = () => new Promise((r) => dom.window.setTimeout(r, 0));

const { wire } = await load('core');
const { renderInto, renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { slots, slotted } = await load('renderer/slots');
const { hydrateSlots } = await load('renderer/hydrate-slots');
wire([renderer, hydration, slots, hydrateSlots]);
const html = (strings, ...values) => ({ strings, values });
const card = () => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;

const hostFromServer = (serverHtml) => {
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = serverHtml;
  const host = wrap.firstElementChild;
  dom.window.document.getElementById('root').appendChild(host);
  return host;
};
/** Every `[vera]` warning during `fn` — an adoption that fell back says so. */
const warnings = async (fn) => {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return seen.filter((line) => line.startsWith('[vera]'));
};

const test = (await import('node:test')).default;

test('the server\'s markers ARE the slot\'s region after hydration, and no light node moves', async () => {
  const host = hostFromServer(server('<h2 slot="header">H</h2>body<b>B</b>', 'slot-card-ssr'));
  const h2 = host.querySelector('h2');
  const b = host.querySelector('b');
  const [rs, re] = [host.querySelector('main').firstChild, host.querySelector('main').lastChild];
  assert.equal(rs.nodeType === 8 && rs.data === '[' && re.nodeType === 8 && re.data === ']', true, 'CONTROL: the server marked the range');
  /** Every childList record that touches a light node is a move — hydration must make none. */
  const light = new Set([h2, b, b.previousSibling]);
  const moves = [];
  const observer = new dom.window.MutationObserver((records) => {
    for (const record of records)
      for (const node of [...record.addedNodes, ...record.removedNodes]) if (light.has(node)) moves.push(node);
  });
  observer.observe(host, { childList: true, subtree: true });
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  moves.push(...observer.takeRecords().flatMap((r) => [...r.addedNodes, ...r.removedNodes]).filter((n) => light.has(n)));
  observer.disconnect();
  assert.deepEqual(said, [], 'adopted, not fallen back');
  assert.equal(moves.length, 0, `no light node moved (${moves.length} childList records touched one)`);
  assert.equal(host.querySelector('main').firstChild, rs, 'the start marker is the region\'s, by identity');
  assert.equal(host.querySelector('main').lastChild, re, 'and the end marker');
  assert.equal(host.querySelector('h2'), h2, 'the named node kept its identity');
  assert.deepEqual(slotted(host, 'header'), [h2], 'the capture map holds it, by identity');
  assert.deepEqual(slotted(host).map((n) => n.textContent), ['body', 'B'], 'and the default nodes, in light order');
  host.remove();
});

test('a component\'s own literal `<!--[-->`…`<!--]-->` is a comment the walk passes, never a range (W1 first)', async () => {
  const served = server('USER', 'slot-literal-ssr');
  assert.match(served, /<article><!--\[--><p>own<\/p><!--\]--><main><!--\[-->USER<!--\]--><\/main><\/article>/, 'CONTROL: a literal pair beside the real range');
  const host = hostFromServer(served);
  const own = host.querySelector('p');
  const user = host.querySelector('main').childNodes[1];
  const said = await warnings(async () => {
    renderInto(html`<article><!--[--><p>own</p><!--]--><main><slot>fb</slot></main></article>`, host);
    await settle();
  });
  assert.deepEqual(said, [], 'hydrated: the literal pair was passed as the comment it is');
  assert.equal(host.querySelector('p'), own, 'the component\'s own node kept, as its own');
  assert.deepEqual(slotted(host), [user], 'only the REAL range is light content, by identity');
  assert.equal(host.querySelector('main').textContent, 'USER', 'and nothing of the component\'s landed in the slot');
  host.remove();
});

/**
 * **An unpaired literal `<!--[-->` beside a range is never its start** — on the RESCUE path, which finds ranges by
 * structure: a range is well-formed only if its `]` comes before another `[`, so the component's own text after its
 * literal is never taken for light content (it would be claimed, and shown in the slot beside the user's).
 */
test('a component\'s own unpaired `<!--[-->` right before a filled slot: the rescue takes only the real range', async () => {
  const served = server('USER', 'slot-literal-open-ssr');
  assert.match(served, /<main><!--\[-->own<!--\[-->USER<!--\]--><\/main>/, 'CONTROL: the literal sits right before the real range');
  const host = hostFromServer(served);
  const user = host.querySelector('main').lastChild.previousSibling;
  const said = await warnings(async () => {
    renderInto(html`<section><main>own<slot>fb</slot></main></section>`, host);
    await settle();
  });
  assert.equal(said.length, 1, `CONTROL: the template changed, so the rescue ran: ${said.join(' | ')}`);
  assert.deepEqual(slotted(host), [user], 'only the real range is light content, by identity');
  assert.equal(host.querySelector('main').textContent, 'ownUSER', "the component's own text once, never claimed into the slot");
  host.remove();
});

test('a slot NAME never reaches a comment: a hostile name serves no markup and hydrates', async () => {
  const name = 'a-->x<img src=x>';
  const served = server(`<h2 slot="${name.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">H</h2>`, 'slot-hostile-name-ssr');
  const parsed = dom.window.document.createElement('div');
  parsed.innerHTML = served;
  assert.equal(parsed.querySelector('img') === null, true, `no element the markup did not write: ${served}`);
  assert.equal(parsed.querySelector('h2')?.textContent, 'H', 'CONTROL: the named content distributed');
  const host = hostFromServer(served);
  const said = await warnings(async () => {
    renderInto(html`<header><slot name="a-->x<img src=x>">fb</slot></header>`, host);
    await settle();
  });
  assert.deepEqual(said, [], 'hydrated');
  assert.equal(host.querySelector('img') === null, true, 'and nothing was created from the name');
  assert.equal(slotted(host, name).length, 1, 'the named node is assigned by its name');
  host.remove();
});

test('comments INSIDE light content are the page\'s, never markers — even ones spelled like them', async () => {
  const served = server('<div slot="header"><!--[-->inner<!--]--></div>', 'slot-card-ssr');
  const host = hostFromServer(served);
  const div = host.querySelector('div');
  const inner = [...div.childNodes];
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  assert.deepEqual(said, [], 'hydrated');
  assert.equal(host.querySelector('div'), div, 'the light element kept its identity');
  assert.deepEqual([...div.childNodes], inner, 'and its own comments are untouched, by identity');
  assert.deepEqual(slotted(host, 'header'), [div], 'it is the one light node of its slot');
  host.remove();
});

/**
 * **Comment-stripped server HTML is an ordinary mismatch — the way React, Lit and Solid treat a missing marker**
 * (Brian, 2026-10-07). No special diagnostic: the standard fallback warning, every build, and a fresh render. Static
 * light content whose markers were stripped cannot be told from the component's own markup, so it is not kept — the
 * README states the requirement (serve the server's HTML unmodified). Content a hydrating TEMPLATE owns is re-rendered
 * by that template: pinned with the page-side walk (step 4, 2c).
 */
test('stripped comments: the standard fallback warning, and a fresh render', async () => {
  const stripped = server('<h2 slot="header">H</h2>body', 'slot-card-ssr').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(stripped.includes('<!--'), false, 'CONTROL: every comment is gone');
  const host = hostFromServer(stripped);
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  assert.equal(said.length, 1, `exactly one warning: ${said.join(' | ')}`);
  assert.match(said[0], /^\[vera\] hydration: .*hydration-fallback/, 'the standard fallback warning, with its code');
  assert.equal(host.querySelector('article > header') !== null, true, 'and the component rendered fresh');
  host.remove();
});

/**
 * **The server's format carries a NUMBER** (Brian, 2026-10-02): `data-vm-light="FORMAT:runs"`. A page from a server whose
 * format this renderer does not read renders fresh — its light content KEPT — and every build names the fix.
 */
test('a foreign format number: a full client render, the content kept, and the fix named in every build', async () => {
  const served = server('<h2 slot="header">H</h2>body', 'slot-card-ssr');
  assert.match(served, /data-vm-light="1:/, 'CONTROL: the server states format 1');
  const host = hostFromServer(served.replace('data-vm-light="1:', 'data-vm-light="2:'));
  const h2 = host.querySelector('h2');
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  assert.equal(said.length, 1, `exactly one warning: ${said.join(' | ')}`);
  assert.match(said[0], /hydration-fallback/, 'the standard fallback code');
  assert.match(said[0], /update @verajs\/ssr and @verajs\/renderer together/, 'and the fix, in this build');
  assert.deepEqual(slotted(host, 'header'), [h2], 'the light node kept, by identity, and distributed by the fresh render');
  assert.deepEqual(slotted(host).map((n) => n.textContent), ['body'], 'and the default content');
  host.remove();
});

/**
 * **Slots' capture is a versioned seam** (vera-5a's condition): a slots from another release meets hydration — forced here
 * by re-stamping the seam — and the served host declines through the ordinary fallback with ONE warning: no throw, and no
 * light node placed anywhere.
 */
test('a slots seam of another protocol: one warning, the ordinary fallback, nothing misplaced', async () => {
  let registry;
  wire([(given) => (registry = given)]);
  const seam = registry._$capture$;
  assert.equal(Array.isArray(seam) && typeof seam[1] === 'function', true, 'CONTROL: slots installed its stamped capture');
  registry._$capture$ = [seam[0] + 1, seam[1]];
  try {
    const host = hostFromServer(server('<h2 slot="header">H</h2>body', 'slot-card-ssr'));
    const h2 = host.querySelector('h2');
    const said = await warnings(async () => {
      renderInto(card(), host);
      await settle();
    });
    assert.equal(said.length, 1, `exactly one warning: ${said.join(' | ')}`);
    assert.match(said[0], /hydration-fallback/, 'the standard fallback code');
    assert.match(said[0], /protocol/, 'naming the protocol');
    assert.equal(host.querySelector('article > header') !== null, true, 'the component rendered fresh');
    assert.equal(h2.isConnected, false, 'and the server\'s light node is not placed anywhere');
    host.remove();
  } finally {
    registry._$capture$ = seam;
  }
});

/**
 * **Light ORDER across slots is what the statement carries** — the one thing the markers cannot: `1` and `3` sit in the
 * header range, `2` in the default range after it, so document order is 1, 3, 2 while the light order is 1, 2, 3. A
 * re-slot shows the difference: moving `2` into the header must land it BETWEEN 1 and 3, as on a client-distributed host.
 * Pinned for an adopted host, for a rescued one (the rescue reads the statement too), against a client-only control.
 */
const interleaved = '<b slot="header">1</b><i>2</i><b slot="header">3</b>';
const reslotted = async (host) => {
  host.querySelector('i').setAttribute('slot', 'header');
  await settle();
  return slotted(host, 'header').map((n) => n.textContent);
};
test('CONTROL: a client-distributed host re-slots into light order', async () => {
  const host = dom.window.document.createElement('my-order');
  dom.window.document.getElementById('root').appendChild(host);
  /** Rendered empty, its light children appended after: with hydration wired, children already there are server output. */
  renderInto(card(), host);
  await settle();
  const children = dom.window.document.createElement('template');
  children.innerHTML = interleaved;
  host.append(...children.content.childNodes);
  await settle();
  assert.deepEqual(slotted(host, 'header').map((n) => n.textContent), ['1', '3'], 'CONTROL: distributed');
  assert.deepEqual(await reslotted(host), ['1', '2', '3']);
  host.remove();
});
test('an adopted host keeps the light order across slots through a re-slot', async () => {
  const served = server(interleaved, 'slot-card-ssr');
  assert.match(served, /data-vm-light="1:0,1,0"/, 'CONTROL: the server stated the interleaving');
  const host = hostFromServer(served);
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  assert.deepEqual(said, [], 'adopted');
  assert.deepEqual(await reslotted(host), ['1', '2', '3']);
  host.remove();
});
test('a rescued host keeps the light order across slots through a re-slot', async () => {
  const host = hostFromServer(server(interleaved, 'slot-card-ssr'));
  const said = await warnings(async () => {
    /** Disagrees at the root: the rescue runs. */
    renderInto(html`<section><header><slot name="header">fb</slot></header><main><slot>fb</slot></main></section>`, host);
    await settle();
  });
  assert.equal(said.length, 1, 'CONTROL: it fell back');
  assert.deepEqual(await reslotted(host), ['1', '2', '3']);
  host.remove();
});
/**
 * **A statement that does not account for the content is a mismatch** (vera-5a's condition): the true light order is then
 * unknowable, so it is never silently replaced by document order on an adopted host — the standard fallback warning, the
 * content kept.
 */
test('a statement that does not account for the content: the standard fallback, the content kept', async () => {
  const host = hostFromServer(server(interleaved, 'slot-card-ssr').replace('data-vm-light="1:0,1,0"', 'data-vm-light="1:0,1"'));
  const nodes = [...host.querySelectorAll('b, i')];
  const said = await warnings(async () => {
    renderInto(card(), host);
    await settle();
  });
  assert.equal(said.length, 1, `exactly one warning: ${said.join(' | ')}`);
  assert.match(said[0], /hydration-fallback/, 'the standard fallback');
  assert.deepEqual(
    [...slotted(host, 'header'), ...slotted(host)].sort((a, b) => a.textContent.localeCompare(b.textContent)),
    nodes.sort((a, b) => a.textContent.localeCompare(b.textContent)),
    'every light node kept, by identity'
  );
  host.remove();
});

/**
 * **A filled slot's fallback is committed fresh inside its detached copy** — the server never wrote it (the slot stepped
 * out), so a value in it is rendered as a client render renders it, and it is live: unfill the slot and the fallback is
 * there; re-render and it updates. A TEMPLATE value, so the part path runs, not only the text one.
 */
test('a filled slot\'s fallback holding a template value: committed fresh, shown when unfilled, and live', async () => {
  const host = hostFromServer(server('<b slot="s">S</b>', 'slot-fallback-part-ssr'));
  const light = host.querySelector('b');
  const draw = (b) => html`<s><slot name="s">fb:${html`<i>${b}</i>`}</slot></s>`;
  const said = await warnings(async () => {
    renderInto(draw('B'), host);
    await settle();
  });
  assert.deepEqual(said, [], 'adopted');
  assert.equal(host.querySelector('b'), light, 'the light node adopted in place');
  light.remove();
  await settle();
  assert.equal(host.querySelector('s').textContent, 'fb:B', 'unfilled: the fallback, rendered fresh');
  assert.equal(host.querySelector('s i') !== null, true, 'its template value is real markup');
  renderInto(draw('B2'), host);
  await settle();
  assert.equal(host.querySelector('s').textContent, 'fb:B2', 'and it updates');
  host.remove();
});

/** **The piece's own seam is versioned too**: a `hydrateSlots` of another protocol is the ordinary fallback, said once. */
test('a hydrateSlots seam of another protocol: one warning, the ordinary fallback, nothing misplaced', async () => {
  let registry;
  wire([(given) => (registry = given)]);
  const seam = registry._$hydrateSlots$;
  assert.equal(Array.isArray(seam) && typeof seam[1] === 'function', true, 'CONTROL: the piece installed its stamped seam');
  registry._$hydrateSlots$ = [seam[0] + 1, ...seam.slice(1)];
  try {
    const host = hostFromServer(server('<h2 slot="header">H</h2>body', 'slot-card-ssr'));
    const h2 = host.querySelector('h2');
    const said = await warnings(async () => {
      renderInto(card(), host);
      await settle();
    });
    assert.equal(said.length, 1, `exactly one warning: ${said.join(' | ')}`);
    assert.match(said[0], /hydration-fallback/, 'the standard fallback code');
    assert.match(said[0], /hydrateSlots protocol/, 'naming the seam');
    assert.equal(host.querySelector('article > header') !== null, true, 'the component rendered fresh');
    assert.equal(h2.isConnected, false, 'and the server\'s light node is not placed anywhere');
    host.remove();
  } finally {
    registry._$hydrateSlots$ = seam;
  }
});

/**
 * **An ordinary server-rendered component — no `<slot>` in its template — on a page that wires slots hydrates** (vera-5a,
 * 2026-10-08: the decline's boundary, settled by a pin). The decline renders a custom element WITHOUT a light-tree
 * statement on the client, as client-made; that is only safe because a server with slots wired states EVERY component
 * host it renders — `N:` for one with no light content — so "no statement" reliably means "not the server's".
 */
test('a server-rendered component with NO slot in its template hydrates on a slots page: its nodes kept, nothing parked, no warning', async () => {
  const served = server('', 'slot-free-ssr');
  assert.match(served, /<slot-free-ssr data-vm-light="1:">/, 'CONTROL: the server states it — no light content, but a statement');
  const host = hostFromServer(served);
  const [section, input] = [host.querySelector('section'), host.querySelector('input')];
  input.value = 'typed before hydration';
  const said = await warnings(async () => {
    renderInto(html`<section><h1>Plain</h1><input value="server"><button>go</button></section>`, host);
    await settle();
  });
  assert.deepEqual(said, [], 'adopted: no warning');
  assert.equal(host.querySelector('section'), section, 'the server node kept, by identity');
  assert.equal(host.querySelector('input'), input, 'and the input');
  assert.equal(input.value, 'typed before hydration', 'with the state typed before hydration');
  assert.equal(host.querySelector('[data-vm-unassigned]'), null, 'nothing parked as unassigned');
  assert.equal(host.hasAttribute('data-vm-light'), false, 'the statement consumed');
  host.remove();
});

/** The documented consequence of a server WITHOUT slots wired: its hosts state nothing, so the client renders them. */
test('the same markup with NO statement (a server without slots) is rendered on the client, its server nodes kept hidden — the documented consequence', async () => {
  const host = hostFromServer(server('', 'slot-free-ssr').replace(' data-vm-light="1:"', ''));
  const section = host.querySelector('section');
  renderInto(html`<section><h1>Plain</h1><input value="server"><button>go</button></section>`, host);
  await settle();
  assert.notEqual(host.querySelector('section:not([data-vm-unassigned] section)'), section, 'not adopted: a client render');
  assert.equal(section.closest('[data-vm-unassigned]') !== null, true, 'the server node kept, held as unassigned light content');
  host.remove();
});
