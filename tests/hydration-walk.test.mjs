/**
 * **`@verajs/renderer/hydration` — verify, then commit.** The pins the design rests on (vera-5a's review, 2026-10-02):
 * NOTHING user-observable runs for a container that is then discarded; the base commit's sink checks run on every
 * adopted value (wrap, never bypass); seeding only ATTR/BOOLEAN, on exact equality, with the client value; text
 * converted once per binding position; iterables read once; `'value'` handlers asked in phase 2 with base precedence;
 * one warning per cause per pass, in every build.
 *
 * Server markup is made the way the server makes it — markerless: a client render's HTML with its anchor comments
 * stripped (`serverOf`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { isProduction, load } from './dist.mjs';
import { hydrating } from './hydration.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const doc = dom.window.document;

/** Core's own registry — the one `hydrating()` wires into. A production `@verajs/inserts` bundle is a SECOND map. */
const { html, inserts } = await load('core');
const renderInto = await hydrating();

/** The server's markup for `result`: a client render's HTML, its anchor comments stripped — markerless. */
const serverOf = (result) => {
  const scratch = doc.createElement('div');
  renderInto(result, scratch);
  return scratch.innerHTML.replace(/<!---->/g, '');
};
/** A container holding `markup`, attached. */
const holding = (markup) => {
  const container = doc.createElement('div');
  container.innerHTML = markup;
  doc.body.append(container);
  return container;
};
/** Runs `work`, collecting `console.warn` — the text; `elements` holds what rode along (the container). */
const elements = [];
const warnings = (work) => {
  const said = [];
  elements.length = 0;
  const real = console.warn;
  console.warn = (message, ...rest) => {
    said.push(String(message));
    elements.push(...rest);
  };
  try {
    work();
  } finally {
    console.warn = real;
  }
  return said;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ── nothing runs for a discarded container ──────────────────────────────────────────────────────── */

test('a mismatch at the LAST marker of a container yields exactly the client render — and nothing ran first', async () => {
  const events = [];
  const ref = (el) => events.push(`ref ${el?.localName}`);
  const click = () => events.push('click');
  const draw = (tail) => html`<section><p ${ref} @click=${click} title=${'t'}>${'a'}</p><span>${tail}</span></section>`;
  /** The server wrote a different LAST value's element: everything before it matches. */
  const container = holding(serverOf(draw('server')).replace('<span>server</span>', '<i>server</i>'));
  /** `serverOf` rendered once, client-side, to make the markup — its ref ran for that scratch element. */
  events.length = 0;
  const serverP = container.querySelector('p');
  const said = warnings(() => renderInto(draw('client'), container));
  await tick();
  assert.equal(said.length, 1, `exactly one fallback warning: ${said}`);
  /** Development says the whole sentence; production (Brian's option C) the KIND and the first node that disagreed. */
  assert.match(said[0], isProduction ? /^\[vera\] hydration: element: found <i> — https:\/\/verajs\.dev\/e\/hydration-fallback$/ : /^\[vera\] hydration: expected <span>/);
  assert.deepEqual(elements, [container], 'the container rides along, for devtools to reveal');
  assert.equal(container.querySelector('p') === serverP, false, 'the server <p> was discarded, not adopted');
  assert.equal(container.querySelector('span').textContent, 'client');
  /** The ref ran ONCE — for the client render's element, never for the discarded server one. */
  assert.deepEqual(events, ['ref p']);
  serverP.dispatchEvent(new dom.window.Event('click'));
  assert.deepEqual(events, ['ref p'], 'no listener was ever attached to the discarded server node');
  container.querySelector('p').dispatchEvent(new dom.window.Event('click'));
  assert.deepEqual(events, ['ref p', 'click'], 'CONTROL: the client render\'s listener works');
  container.remove();
});

test('a setter on a server custom element is not called for a discarded container', () => {
  let sets = 0;
  if (!customElements.get('hw-setter'))
    customElements.define('hw-setter', class extends dom.window.HTMLElement {
      set item(v) {
        sets++;
      }
    });
  const draw = (tail) => html`<hw-setter .item=${1}></hw-setter><b>${tail}</b>`;
  const container = holding(serverOf(draw('x')).replace('<b>x</b>', '<u>x</u>'));
  sets = 0;
  warnings(() => renderInto(draw('y'), container));
  assert.equal(sets, 1, 'called once — by the client render, never by an adoption that was then discarded');
  container.remove();
});

test('on SUCCESS: every binding commits once, the listener works, the ref is handed the ADOPTED element', async () => {
  const events = [];
  const draw = () => html`<p ${(el) => events.push(el)} @click=${() => events.push('click')}>${'a'}</p>`;
  const container = holding(serverOf(draw()));
  events.length = 0;
  const serverP = container.querySelector('p');
  const said = warnings(() => renderInto(draw(), container));
  await tick();
  assert.deepEqual(said, [], 'adopted, without a warning');
  assert.equal(container.querySelector('p'), serverP, 'node identity kept');
  assert.deepEqual(events, [serverP]);
  serverP.dispatchEvent(new dom.window.Event('click'));
  assert.equal(events[1], 'click', 'a hydrated @click fires (an EVENT is never seeded)');
  container.remove();
});

/* ── phase 1 runs NOTHING, pinned as a whole ─────────────────────────────────────────────────────── */

/**
 * **vera-5a's bar for queue-then-run** — nothing user-observable happens before the decision but the walk's text splits,
 * its comments, and text conversion. A container with every kind of client work, mismatching at its LAST marker: before
 * the clear, ZERO of every callback but `toString`; the clear causes exactly one disconnect; and the CONTROL, the same
 * container matching, shows every counter moving once the queue runs — so the zeros are not a probe measuring nothing.
 */
test('before a mismatch is declined, the walk has only split text and put in comments — no user code ran but text conversion (CONTROL: a matching container runs it all)', () => {
  const counts = { connected: 0, disconnected: 0, attributeChanged: 0, set: 0, listen: 0, ref: 0, apply: 0, child: 0, value: 0, toString: 0 };
  if (!customElements.get('hw-cb'))
    customElements.define('hw-cb', class extends dom.window.HTMLElement {
      static observedAttributes = ['title'];
      connectedCallback() {
        counts.connected++;
      }
      disconnectedCallback() {
        counts.disconnected++;
      }
      attributeChangedCallback() {
        counts.attributeChanged++;
      }
      set item(v) {
        counts.set++;
      }
      addEventListener(...args) {
        if (args[0] === 'click') counts.listen++;
        return super.addEventListener(...args);
      }
    });
  const claimed = Symbol('claimed');
  const handler = (part, value) => {
    counts.value++;
    if (value?.[claimed] !== true) return false;
    part._$commit$('claimed');
    return true;
  };
  const applier = { _$apply$: () => counts.apply++ };
  const childApplier = { _$child$: () => counts.child++ };
  /** Text conversion is the one exception: an object's text is read during the walk, to match it. */
  const spoken = { toString: () => (counts.toString++, 'spoken') };
  const handled = { [claimed]: true, toString: () => 'handled' };
  /** A NODE value too: placing an element is queued, never done by the walk. */
  const clientNode = doc.createElement('mark');
  /** The server wrote title="x"; the client says "y" — a REPAIR, which is a commit, and so queued. */
  const draw = (title, tail) =>
    html`<div ${() => counts.ref++} ${applier}><hw-cb title=${title} .item=${1} @click=${() => {}}></hw-cb>${'text'}${spoken}<span>${childApplier}</span><p>${handled}</p>${clientNode}</div>${tail}`;
  /** The server never asks handlers: its markup is made BEFORE the handler is wired, so `handled` is written as its text. */
  /** Nor can a server render a live node: the client's `<mark>` is not in what it wrote. */
  const markup = serverOf(draw('x', html`<b>end</b>`)).replace('<mark></mark>', '');
  inserts.set('value', [...(inserts.get('value') ?? []), handler]);
  try {
    const run = (served) => {
      const container = holding(served);
      const records = [];
      const observer = new MutationObserver((r) => records.push(...r));
      observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
      let before = null;
      let atClear = null;
      const real = container.removeChild.bind(container);
      container.removeChild = (node) => {
        /** The first removal through the container IS the fallback's clear — the walk is over by then. */
        if (before === null) {
          before = [...records, ...observer.takeRecords()];
          atClear = { ...counts };
        }
        return real(node);
      };
      /** The server's custom element upgraded on parse, before any hydration: counted from here. */
      const server = container.querySelector('hw-cb');
      const start = { ...counts };
      const said = warnings(() => renderInto(draw('y', html`<b>end</b>`), container));
      observer.disconnect();
      const delta = (at) => Object.fromEntries(Object.entries(at).map(([k, v]) => [k, v - start[k]]));
      const result = { said, before, atClear: atClear && delta(atClear), after: delta(counts), kept: container.querySelector('hw-cb') === server };
      container.remove();
      return result;
    };
    const missed = run(markup.replace('<b>end</b>', '<i>end</i>'));
    assert.equal(missed.said.length, 1, 'CONTROL: it did fall back');
    assert.match(missed.said[0], /<i\b/, 'CONTROL: at the LAST marker — the tail — not somewhere earlier');
    assert.notEqual(missed.before, null, 'CONTROL: the fallback cleared the container');
    const only = missed.before.every(
      (r) =>
        /** Text and comments in; out, only the walk's own root markers (comments) as it declines. */
        (r.type === 'childList' && [...r.removedNodes].every((n) => n.nodeType === 8) && [...r.addedNodes].every((n) => n.nodeType === 3 || n.nodeType === 8)) ||
        (r.type === 'characterData' && r.target.nodeType === 3)
    );
    assert.equal(only, true, 'the walk did something other than split text and put in comments');
    assert.ok(missed.before.length > 0, 'CONTROL: the walk did split text and put in its anchors');
    assert.deepEqual(
      missed.atClear,
      { connected: 0, disconnected: 0, attributeChanged: 0, set: 0, listen: 0, ref: 0, apply: 0, child: 0, value: 0, toString: 1 },
      'user code ran before the clear'
    );
    /** The clear disconnects the server's element, once; the client render then does all of it, once. */
    assert.equal(missed.after.disconnected, 1, 'the clear disconnected the server element exactly once');
    const matched = run(markup);
    assert.deepEqual(matched.said, [], 'CONTROL: the matching container hydrated');
    assert.equal(matched.kept, true, 'CONTROL: the server element was adopted, not replaced');
    assert.deepEqual(
      matched.after,
      { connected: 0, disconnected: 0, attributeChanged: 1, set: 1, listen: 1, ref: 1, apply: 1, child: 1, value: 4, toString: 1 },
      'CONTROL: once the queue runs, every piece of client work happened once (the handler is asked of each object value)'
    );
  } finally {
    inserts.set('value', (inserts.get('value') ?? []).filter((h) => h !== handler));
  }
});

/**
 * **The queue runs the client's work in the client's order.** The same template, rendered fresh into an empty container
 * and hydrated from the server's markup, logs the same calls in the same sequence — refs, element appliers, setters on a
 * nested component, child appliers — through nested templates and a keyed list.
 */
test('hydration calls user code in exactly the order a client render does (nested templates, a list, a nested component)', () => {
  const log = [];
  if (!customElements.get('hw-order'))
    customElements.define('hw-order', class extends dom.window.HTMLElement {
      set item(v) {
        log.push(`set ${v}`);
      }
    });
  const ref = (name) => () => log.push(`ref ${name}`);
  const applier = (name) => ({ _$apply$: () => log.push(`apply ${name}`) });
  const child = (name) => ({ _$child$: () => log.push(`child ${name}`) });
  const row = (n) => html`<li ${ref(`li${n}`)}><hw-order .item=${`row${n}`}></hw-order>${`r${n}`}</li>`;
  const draw = () =>
    html`<section ${ref('section')} ${applier('section')}>
      <header><hw-order .item=${'head'} ${ref('head')}></hw-order></header>
      <ul>${[1, 2, 3].map(row)}</ul>
      ${html`<p ${applier('p')}><span>${child('span')}</span></p>`}
      <footer ${ref('footer')}>${'end'}</footer>
    </section>`;
  const markup = serverOf(draw());
  log.length = 0;
  const fresh = doc.createElement('div');
  doc.body.append(fresh);
  renderInto(draw(), fresh);
  const client = log.splice(0);
  const container = holding(markup);
  const said = warnings(() => renderInto(draw(), container));
  assert.deepEqual(said, [], 'it hydrated — a fallback would be a client render, and the comparison would prove nothing');
  /** CONTROL: the client render did log every kind — a silent log on both sides would match perfectly. */
  assert.ok(['ref', 'apply', 'set', 'child'].every((k) => client.some((e) => e.startsWith(k))), client.join(', '));
  assert.deepEqual(log, client);
  fresh.remove();
  container.remove();
});

test('a javascript: URL the server wrote is refused through hydration exactly as on a fresh render', () => {
  const draw = (href) => html`<a href=${href}>x</a>`;
  const bad = 'javascript:alert(1)';
  /** The server markup carries the attribute as if it had been written (the server refuses it too — forged here). */
  const container = holding(`<a href="${bad}">x</a>`);
  const said = warnings(() => renderInto(draw(bad), container));
  assert.equal(container.querySelector('a').hasAttribute('href'), false, 'refused and removed, as a fresh render does');
  assert.equal(container.querySelector('a').textContent, 'x', 'CONTROL: the element was adopted, not re-rendered');
  if (said.length > 0) assert.match(said[0], /javascript: URL — refused/, 'the same message as a fresh render (dev)');
  container.remove();
});

/**
 * **A matched binding that names no URL commits NOTHING at hydration** — its commit would return at `value ===
 * committed`, so none is queued — while a URL-bearing one always commits (the `javascript:` refusal runs through the
 * base). The seed is what a client render stores: the next render with the same values writes nothing, a different one
 * writes. Counted through the hand-off's commit, which is what the queue calls.
 */
test('a fully matched element queues no commit but its URL binding; later renders fast-path or write as after a client render', () => {
  /** The hand-off is an array; the base commit sits at `HANDOFF_COMMIT` (8, `packages/renderer/src/kinds.ts`). */
  const H = inserts.$H;
  const COMMIT = 8;
  assert.equal(typeof H?.[COMMIT], 'function', 'CONTROL: the hand-off is reachable');
  const real = H[COMMIT];
  let commits = 0;
  H[COMMIT] = (...args) => (commits++, real(...args));
  try {
    /** A number and a boolean too: the seed is the RAW value a client render stores, never its text ("5" !== 5). */
    const draw = (cls, x, hidden, href, n = 5, b = true) =>
      html`<p class=${cls} data-x=${x} data-n=${n} data-b=${b} ?hidden=${hidden}><a href=${href}>x</a></p>`;
    const container = holding('<p data-x="t" data-n="5" data-b="true"><a href="/ok">x</a></p>');
    const p = container.querySelector('p');
    const records = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(container, { subtree: true, attributes: true });
    const said = warnings(() => renderInto(draw(null, 't', false, '/ok'), container));
    assert.deepEqual(said, []);
    assert.equal(container.querySelector('p'), p, 'CONTROL: adopted');
    assert.equal(commits, 1, 'only the URL-bearing href committed — class (both absent), data-x/-n/-b and ?hidden were elided');
    renderInto(draw(null, 't', false, '/ok'), container);
    assert.equal(observer.takeRecords().length + records.length, 0, 'the same values again: nothing written');
    renderInto(draw('c', 'u', true, '/ok', 6, false), container);
    const written = observer.takeRecords().map((r) => r.attributeName).sort();
    assert.deepEqual(written, ['class', 'data-b', 'data-n', 'data-x', 'hidden'], 'different values: each one written, as after a client render');
    observer.disconnect();
    container.remove();
  } finally {
    H[COMMIT] = real;
  }
});

test('a matching attribute costs no write; a differing one is repaired; null removes the server\'s', () => {
  const draw = (cls, title) => html`<p class="item ${cls}" title=${title}>x</p>`;
  const container = holding('<p class="item a" title="server">x</p>');
  const p = container.querySelector('p');
  const writes = [];
  const real = p.setAttribute.bind(p);
  p.setAttribute = (name, value) => {
    writes.push(name);
    return real(name, value);
  };
  renderInto(draw('a', null), container);
  assert.equal(container.querySelector('p'), p, 'CONTROL: adopted');
  assert.deepEqual(writes, [], 'the matching multi-part class was seeded: zero setAttribute calls');
  assert.equal(p.hasAttribute('title'), false, 'the client binds null and the server wrote one: removed');
  renderInto(draw('b', 't'), container);
  assert.equal(p.getAttribute('class'), 'item b', 'and updates write as always');
  container.remove();
});

test('text is converted ONCE per binding position, as a client render converts it — the same object twice, twice', () => {
  let calls = 0;
  const value = { toString: () => (calls++, 'V') };
  const draw = (v) => html`<p>${v}</p><q>${v}</q>`;
  const container = holding('<p>V</p><q>V</q>');
  renderInto(draw(value), container);
  assert.equal(container.querySelector('p').textContent, 'V', 'CONTROL: adopted');
  assert.equal(calls, 2, 'two positions, two conversions — never one per phase');
  container.remove();
});

test('an attribute with an object value converts as a client render does: no seed, one conversion', () => {
  let calls = 0;
  const value = { toString: () => (calls++, 'o') };
  const container = holding('<p title="a o">x</p>');
  renderInto(html`<p title="a ${value}">x</p>`, container);
  assert.equal(calls, 1, 'converted once, by the base commit');
  assert.equal(container.querySelector('p').getAttribute('title'), 'a o');
  container.remove();
});

test('a generator-valued list hydrates with every row (iterables are read once)', () => {
  const rows = ['a', 'b', 'c'];
  const draw = (items) => html`<ul>${items}</ul>`;
  const container = holding(serverOf(draw(rows.map((r) => html`<li>${r}</li>`))));
  const serverLis = [...container.querySelectorAll('li')];
  function* generate() {
    for (const r of rows) yield html`<li>${r}</li>`;
  }
  const said = warnings(() => renderInto(draw(generate()), container));
  assert.deepEqual(said, []);
  assert.deepEqual([...container.querySelectorAll('li')], serverLis, 'every row adopted, none lost to a second iteration');
  container.remove();
});

test('record-only is PROPERTY-name gated: .value stands, .href is written', () => {
  const container = holding('<input value="server"><a href="/s">x</a>');
  const input = container.querySelector('input');
  input.value = 'typed before the script';
  renderInto(html`<input .value=${'client'}><a .href=${'/c'}>x</a>`, container);
  assert.equal(input.value, 'typed before the script', 'a form control\'s state stands');
  assert.match(container.querySelector('a').href, /\/c$/, 'a non-form property is written');
  container.remove();
});

/* ── 'value' handlers: phase 2 only, base precedence ─────────────────────────────────────────────── */

test('a value handler claims in phase 2 only — called once, replacing what the server wrote', () => {
  const claimed = Symbol('claimed');
  let calls = 0;
  const handler = (part, value) => {
    if (value?.[claimed] !== true) return false;
    calls++;
    part._$commit$('client-rendered');
    return true;
  };
  inserts.set('value', [...(inserts.get('value') ?? []), handler]);
  try {
    const thing = { [claimed]: true, toString: () => '[thing]' };
    const container = holding('<p>[thing]</p>');
    const p = container.querySelector('p');
    const said = warnings(() => renderInto(html`<p>${thing}</p>`, container));
    assert.deepEqual(said, [], 'no fallback');
    assert.equal(container.querySelector('p'), p, 'CONTROL: the element was adopted');
    assert.equal(calls, 1, 'asked once — in phase 2, never in phase 1');
    assert.equal(p.textContent, 'client-rendered', 'the server text was replaced, nothing doubled');
    container.remove();
  } finally {
    inserts.set('value', (inserts.get('value') ?? []).filter((h) => h !== handler));
  }
});

test('an object with NO handler hydrates as the server wrote it: its text', () => {
  const when = { toString: () => 'Tuesday' };
  const container = holding('<p>Tuesday</p>');
  const text = container.querySelector('p').firstChild;
  const said = warnings(() => renderInto(html`<p>${when}</p>`, container));
  assert.deepEqual(said, []);
  assert.equal(container.querySelector('p').firstChild, text, 'the text node adopted, identity kept');
  container.remove();
});

/* ── the warning ─────────────────────────────────────────────────────────────────────────────────── */

test('a placeholder: client render plus ONE warning for two containers — development names replaceChildren, production links the page that does', () => {
  const draw = () => html`<main>app</main>`;
  const a = holding('Loading…');
  const b = holding('Loading…');
  const said = warnings(() => {
    renderInto(draw(), a);
    renderInto(draw(), b);
  });
  assert.equal(said.length, 1, `one warning per cause, not per container: ${said.length}`);
  if (isProduction) {
    assert.match(said[0], /verajs\.dev\/e\/hydration-fallback$/);
    /** The page production links to is the one that names the fix: the published table says it. */
    const page = JSON.parse(readFileSync(new URL('../packages/renderer/diagnostics.json', import.meta.url), 'utf8'));
    assert.match(page.entries.find((e) => e.code === 'hydration-fallback').fix, /replaceChildren/);
  } else assert.match(said[0], /replaceChildren/);
  assert.deepEqual(elements, [a], 'the first container rides along');
  if (!isProduction) assert.match(said[0], /its template begins `<main>app<\/main>`/, 'development names the template to search for');
  assert.equal(a.textContent, 'app');
  assert.equal(b.textContent, 'app');
  a.remove();
  b.remove();
});

test('the same page after replaceChildren(): no warning', () => {
  const container = holding('Loading…');
  container.replaceChildren();
  const said = warnings(() => renderInto(html`<main>app</main>`, container));
  assert.deepEqual(said, []);
  assert.equal(container.textContent, 'app');
  container.remove();
});

/* ── the edges vera-5a named ─────────────────────────────────────────────────────────────────────── */

/**
 * An applier's content is its own: phase 1 cannot verify it (it is the applier's code that decides), so it runs in
 * phase 2, after the container is committed — it cannot decline the container; it adopts or replaces ITS region.
 */
test('an applier at a SOLE position replaces its own region; the container around it stays adopted', () => {
  const applier = { _$child$: (part, previous, adopting) => (part._$commit$(adopting ? 'fresh' : 'x'), {}) };
  const container = holding('<section><h1>title</h1><div>server-written</div></section>');
  const h1 = container.querySelector('h1');
  const said = warnings(() => renderInto(html`<section><h1>title</h1><div>${applier}</div></section>`, container));
  assert.deepEqual(said, []);
  assert.equal(container.querySelector('h1'), h1, 'the container was adopted');
  assert.equal(container.querySelector('div').textContent, 'fresh', 'the applier replaced its own region');
  container.remove();
});

/**
 * **The one known exception — the platform's.** A custom element that is already defined upgrades as the server
 * markup is parsed and runs its own setup BEFORE any hydration starts; a parent mismatch then discards it, so that
 * setup runs again for the client render. No walk design can prevent it: pinned so it stays a known number.
 */
test('a defined server custom element under a mismatched parent sets up twice (the platform upgraded it on parse)', () => {
  let setups = 0;
  if (!customElements.get('hw-parsed')) customElements.define('hw-parsed', class extends dom.window.HTMLElement { connectedCallback() { setups++; } });
  const container = holding('<hw-parsed></hw-parsed><i>server</i>');
  assert.equal(setups, 1, 'CONTROL: it set up on parse, before hydration');
  warnings(() => renderInto(html`<hw-parsed></hw-parsed><b>client</b>`, container));
  assert.equal(setups, 2, 'and once more for the client render — exactly twice, never more');
  container.remove();
});

test('a value handler claiming an ARRAY replaces the server\'s entries, without a warning', () => {
  const owned = new WeakSet();
  const handler = (part, value) => {
    if (!owned.has(value)) return false;
    part._$commit$(`[${value.length} owned]`);
    return true;
  };
  inserts.set('value', [...(inserts.get('value') ?? []), handler]);
  try {
    const list = ['a', 'b'];
    owned.add(list);
    const container = holding('<ul>ab</ul>');
    const ul = container.querySelector('ul');
    const said = warnings(() => renderInto(html`<ul>${list}</ul>`, container));
    assert.deepEqual(said, []);
    assert.equal(container.querySelector('ul'), ul, 'CONTROL: adopted');
    assert.equal(ul.textContent, '[2 owned]', 'the server\'s entries replaced, nothing doubled');
  } finally {
    inserts.set('value', (inserts.get('value') ?? []).filter((h) => h !== handler));
  }
});

test('a value handler rendering LATER leaves its range empty at once, and its content on resolve', async () => {
  const pending = new WeakSet();
  const handler = (part, value) => {
    if (!pending.has(value)) return false;
    setTimeout(() => part._$commit$('resolved'), 0);
    return true;
  };
  inserts.set('value', [...(inserts.get('value') ?? []), handler]);
  try {
    const thing = { toString: () => 'later' };
    pending.add(thing);
    const container = holding('<p>later</p>');
    const said = warnings(() => renderInto(html`<p>${thing}</p>`, container));
    assert.deepEqual(said, []);
    assert.equal(container.querySelector('p').textContent, '', 'the server text went with the claim');
    await tick();
    assert.equal(container.querySelector('p').textContent, 'resolved');
  } finally {
    inserts.set('value', (inserts.get('value') ?? []).filter((h) => h !== handler));
  }
});

test('a claimed span holding server custom elements disconnects each exactly once', () => {
  let gone = 0;
  if (!customElements.get('hw-gone')) customElements.define('hw-gone', class extends dom.window.HTMLElement { disconnectedCallback() { gone++; } });
  const owned = new WeakSet();
  const handler = (part, value) => {
    if (!owned.has(value)) return false;
    part._$commit$('mine');
    return true;
  };
  inserts.set('value', [...(inserts.get('value') ?? []), handler]);
  try {
    const items = [html`<hw-gone></hw-gone>`, html`<hw-gone></hw-gone>`];
    owned.add(items);
    const container = holding('<div><hw-gone></hw-gone><hw-gone></hw-gone></div>');
    gone = 0;
    warnings(() => renderInto(html`<div>${items}</div>`, container));
    assert.equal(container.querySelector('div').textContent, 'mine', 'CONTROL: the handler claimed the span');
    assert.equal(gone, 2, 'two server elements, two disconnects — once each');
  } finally {
    inserts.set('value', (inserts.get('value') ?? []).filter((h) => h !== handler));
  }
});

/* ── re-entrancy (vera-5a, RUN on c65b53e: the outer render threw) ───────────────────────────────── */

/**
 * Phase 2 runs user code, and user code can render: a setter that renders into its own element adopts THAT container
 * in the middle of this one. Each adoption has its own walk state; shared, the nested one reset the outer's texts and
 * the outer render threw.
 */
test('a setter that renders into its own element during the outer adoption: both adopt, nothing throws', () => {
  let runs = 0;
  if (!customElements.get('hw-in'))
    customElements.define('hw-in', class extends dom.window.HTMLElement {
      set item(v) {
        runs++;
        renderInto(html`<b>${v}</b>`, this);
      }
    });
  const outer = (a, v, b) => html`<p>${a}</p><hw-in .item=${v}></hw-in><p>${b}</p>`;
  const container = holding('<p>A</p><hw-in><b>v</b></hw-in><p>B</p>');
  const [p1, p2] = container.querySelectorAll('p');
  const b = container.querySelector('b');
  const said = warnings(() => renderInto(outer('A', 'v', 'B'), container));
  assert.deepEqual(said, []);
  assert.equal(runs, 1);
  assert.equal(container.querySelectorAll('p')[0], p1, 'the outer adopted');
  assert.equal(container.querySelectorAll('p')[1], p2);
  assert.equal(container.querySelector('b'), b, 'and the inner adopted too');
  container.remove();
});

/**
 * **The queue is one array, each adoption owning its range** — a nested adoption runs its range and truncates back to
 * where it began, so the outer's work QUEUED AFTER the nesting setter still runs, on the right elements.
 */
test('work the outer adoption queued after a nested adoption still runs: a later ref and a later setter', () => {
  if (!customElements.get('hw-nest'))
    customElements.define('hw-nest', class extends dom.window.HTMLElement {
      set item(v) {
        renderInto(html`<b>${v}</b>`, this);
      }
    });
  const seen = [];
  if (!customElements.get('hw-after'))
    customElements.define('hw-after', class extends dom.window.HTMLElement {
      set item(v) {
        seen.push(`set ${v}`);
      }
    });
  const outer = (v) => html`<hw-nest .item=${v}></hw-nest><p ${(el) => seen.push(`ref ${el.localName}`)}>P</p><hw-after .item=${'late'}></hw-after>`;
  const container = holding('<hw-nest><b>v</b></hw-nest><p>P</p><hw-after></hw-after>');
  const b = container.querySelector('b');
  const said = warnings(() => renderInto(outer('v'), container));
  assert.deepEqual(said, []);
  assert.equal(container.querySelector('b'), b, 'CONTROL: the nested container adopted');
  assert.deepEqual(seen.sort(), ['ref p', 'set late'], 'the outer queue survived the nested one: both ran');
  container.remove();
});

test('a nested MISMATCH during the outer adoption falls back for the inner only; the outer stays adopted', () => {
  if (!customElements.get('hw-in2'))
    customElements.define('hw-in2', class extends dom.window.HTMLElement {
      set item(v) {
        renderInto(html`<b>${v}</b>`, this);
      }
    });
  const outer = (a, v) => html`<p>${a}</p><hw-in2 .item=${v}></hw-in2>`;
  /** The inner's server markup disagrees (an <i>, not a <b>); the outer's matches. */
  const container = holding('<p>A</p><hw-in2><i>v</i></hw-in2>');
  const p = container.querySelector('p');
  const said = warnings(() => renderInto(outer('A', 'v'), container));
  assert.equal(said.length, 1, `one warning — the inner's: ${said}`);
  assert.match(said[0], isProduction ? /element: found <i>/ : /expected <b> and found <i>/, 'naming the inner\'s disagreement, not leaking it into the outer');
  assert.deepEqual(elements, [container.querySelector('hw-in2')], 'and pointing at the INNER container');
  assert.equal(container.querySelector('p'), p, 'the outer stayed adopted');
  assert.equal(container.querySelector('hw-in2').innerHTML.replace(/<!---->/g, ''), '<b>v</b>', 'the inner rendered fresh');
  container.remove();
});

test('the warning is said once per KIND: two containers differing in their text detail, one warning', () => {
  const draw = (t) => html`<p>${t}</p>`;
  const a = holding('<p>server one</p>');
  const b = holding('<p>server two</p>');
  const said = warnings(() => {
    renderInto(draw('client one'), a);
    renderInto(draw('client two'), b);
  });
  assert.equal(said.length, 1, `two different details of one kind, one warning: ${said.length}`);
  assert.match(said[0], isProduction ? /value: found the text "server one"/ : /client one/, 'naming the first');
  a.remove();
  b.remove();
});
