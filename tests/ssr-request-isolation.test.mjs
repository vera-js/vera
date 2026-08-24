/**
 * The five defects the SSR audit found, each pinned. Four are about a *server* — a thing that
 * handles more than one request, which is the condition none of them survived.
 *
 * This import installs the server environment and MUST come before anything that pulls in
 * `@verajs/core`.
 */
import { renderToString, serializeTemplate } from '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const { html } = await import('@verajs/core');
const fixture = (name) => new URL(`./fixtures/ssr/${name}`, import.meta.url);

/* ── concurrent requests ──────────────────────────────────────────────────────────────────────
 * The entry tag used to be found by snapshotting the registry, awaiting the import, and diffing.
 * Two renders overlapping — the normal condition for a server — both saw both modules' new
 * registrations, and both picked the last. A request for one component was answered with another's
 * markup. Measured before the fix: both of these returned `race-b-ssr`.
 */
{
  const [a, b] = await Promise.all([
    renderToString(fixture('race-a-ssr.js')),
    renderToString(fixture('race-b-ssr.js')),
  ]);
  assert.ok(a.html.startsWith('<race-a-ssr>'), `concurrent request A got: ${a.html.slice(0, 40)}`);
  assert.ok(b.html.startsWith('<race-b-ssr>'), `concurrent request B got: ${b.html.slice(0, 40)}`);
}

/** A module that defines an element but exports nothing has to be told, not guessed at. */
{
  await assert.rejects(
    () => renderToString(fixture('attrs-parent-ssr.js'), { tag: 'no-such-tag' }),
    /no custom element definition found/,
    'an unknown tag is refused rather than substituted'
  );
}

/**
 * The entry tag is memoised per URL so a repeat render skips the import — awaiting an
 * already-cached module still costs a promise and a yield, 2.4 µs of a 9.5 µs render.
 *
 * The memo must not be reachable by naming a tag, though: the import is what *registers* the
 * component, so a first render of an unloaded module with `{ tag }` has to import it anyway. The
 * memo entry doubles as "this href has been imported", which is the only sound reason to skip.
 */
{
  const cold = await renderToString(fixture('shadow-ssr.js'), { tag: 'shadow-ssr' });
  assert.ok(cold.html.startsWith('<shadow-ssr>'), 'an explicit tag still imports the module');
  const warm = await renderToString(fixture('shadow-ssr.js'), { tag: 'shadow-ssr' });
  assert.equal(warm.html, cold.html, 'and the memoised path renders the same thing');
}

/* ── styles belong to the page that rendered them ─────────────────────────────────────────────
 * `hoistedStyles` was a flat array that no render ever scoped, so response two carried response
 * one's CSS and response fifty carried everyone's — every page shipping the whole design system,
 * and disclosing which components live on pages the visitor never asked for.
 */
{
  const first = await renderToString(fixture('styled-a-ssr.js'));
  assert.match(first.styles, /styled-a-ssr/, 'its own styles are present');

  const second = await renderToString(fixture('styled-b-ssr.js'));
  assert.match(second.styles, /styled-b-ssr/, 'its own styles are present');
  assert.doesNotMatch(second.styles, /styled-a-ssr/, 'and not the previous request’s');

  const third = await renderToString(fixture('styled-a-ssr.js'));
  assert.match(third.styles, /styled-a-ssr/, 'a repeat render still carries its styles');
  assert.doesNotMatch(third.styles, /styled-b-ssr/, 'and still only its own');
}

/* ── attributes survive the round trip ────────────────────────────────────────────────────────
 * Nested components are found by scanning the markup this module just wrote, so their attribute
 * values arrive escaped. Handing that straight to `setAttribute` gave the child `Tom &#38; Jerry`
 * and re-escaping produced `&#38;#38;` — entity codes on the page, and a mismatch against whatever
 * the client computes on hydration.
 */
{
  const { html: markup } = await renderToString(fixture('attrs-parent-ssr.js'));

  assert.ok(!/&#38;#/.test(markup), `double-escaped output: ${markup}`);
  assert.match(markup, /<p>Tom &#38; Jerry &#60;b&#62;&#34;quoted&#34;<\/p>/,
    'the child rendered exactly what the parent passed, escaped once');

  /** Single-quoted, unquoted and valueless statics all parse; none invent extra attributes. */
  assert.match(markup, /<b>single\|unquoted\|<\/b>/, `attribute forms mis-parsed: ${markup}`);
}

/* ── a slot is classified by where it is, not by what precedes it ─────────────────────────────
 * `PLAIN_ATTRIBUTE_TAIL` and the sigil test ran on any static ending the right way, wherever it
 * sat. Text ending in `total=` was written as an unquoted attribute, so the server produced
 * `<p>total="5"</p>` where the client — which hands markup to the platform's parser — produced
 * `<p>total=5</p>`.
 */
{
  assert.equal(serializeTemplate(html`<p>total=${5}</p>`), '<p>total=5</p>');
  assert.equal(serializeTemplate(html`<p>Ratio a=${1} b=${2}</p>`), '<p>Ratio a=1 b=2</p>');
  assert.equal(serializeTemplate(html`<p>set ?open=${1} and .value=${2}</p>`),
    '<p>set ?open=1 and .value=2</p>', 'sigils in text are text');

  /** And every genuine binding kind still resolves, including one spanning several slots. */
  assert.equal(serializeTemplate(html`<p class=${'x'}>t</p>`), '<p class="x">t</p>');
  assert.equal(serializeTemplate(html`<p class="a ${'b'} c" id=${'i'}>t</p>`), '<p class="a b c" id="i">t</p>');
  assert.equal(serializeTemplate(html`<p ?hidden=${true}>t</p>`), '<p hidden="">t</p>');
  assert.equal(serializeTemplate(html`<p ?hidden=${false}>t</p>`), '<p>t</p>');
  assert.equal(serializeTemplate(html`<input .value=${'v'} />`), '<input value="v" />');
  assert.equal(serializeTemplate(html`<button @click=${() => {}}>b</button>`), '<button>b</button>');
  assert.equal(serializeTemplate(html`<p class=${'x'}>total=${5}</p>`), '<p class="x">total=5</p>',
    'the tag closing puts the next slot back in text');
}

/* ── a scan for elements must not read a stylesheet ───────────────────────────────────────────
 * The shadow serializer used to concatenate its `<style>` tags with the content and hand the whole
 * string to the nested-component scan, which then read CSS as markup: a `content: "<some-comp>"`
 * was enough to have that component rendered *inside* the stylesheet.
 */
{
  const { html: markup } = await renderToString(fixture('css-tagname-ssr.js'));
  assert.ok(!markup.includes('INJECTED'), `a component was rendered inside CSS: ${markup}`);
  assert.match(markup, /<style vera-styles>/, 'the styles are still there');
  assert.match(markup, /injected-comp/, 'and the tag name is still in the CSS text, as written');
}

/* ── an async connectedCallback is refused, not silently emptied ──────────────────────────────
 * The recursion runs inside `String.replace`, which cannot await, so everything after the first
 * `await` in a component happens long after its markup was serialized. That rendered an empty
 * element and said nothing.
 */
{
  await assert.rejects(
    () => renderToString(fixture('async-lifecycle-ssr.js')),
    /async connectedCallback/,
    'an async lifecycle is reported rather than rendered empty'
  );
}

/* ── attributes and slotted children ──────────────────────────────────────────────────────────
 * `attributes` was a raw string spliced into the markup, so a value taken from a request could
 * close the tag and open a `<script>`. The object form escapes; the string form stays for a caller
 * who genuinely needs to write markup only they can produce.
 */
{
  const { html: markup } = await renderToString(fixture('slotted-ssr.js'), {
    attributes: { id: 'a"><script>alert(1)</script', hidden: true, skip: null, n: 3 },
  });
  assert.ok(!markup.includes('<script>'), `attribute value escaped the tag: ${markup}`);
  assert.match(markup, /hidden=""/, 'true becomes a valueless attribute');
  assert.ok(!markup.includes('skip='), 'null is omitted');
  assert.match(markup, /n="3"/, 'numbers serialize');

  const legacy = await renderToString(fixture('slotted-ssr.js'), { attributes: 'data-x="1"' });
  assert.match(legacy.html, /^<slotted-ssr data-x="1">/, 'the string form still writes through');
}

/**
 * A component built around a `<slot>` could only ever be rendered empty — the entry tag's contents
 * were the shadow template and nothing else.
 */
{
  const { html: markup } = await renderToString(fixture('slotted-ssr.js'), {
    children: '<p>slotted</p><slotted-ssr></slotted-ssr>',
  });
  assert.match(markup, /<\/template><p>slotted<\/p>/, 'children follow the shadow template');
  assert.equal(markup.split('shadowrootmode').length - 1, 2, 'a component in children renders too');
}

/* ── the tag scan reads markup, not text ──────────────────────────────────────────────────────
 * A single regex cannot tell one from the other. `>` is legal unescaped inside an attribute value,
 * and stopping at the first one cut the tag in half; a component named inside a comment or a
 * `<textarea>` was rendered into it.
 */
{
  const { html: markup } = await renderToString(fixture('adversarial-ssr.js'));

  assert.equal(markup.split('<b>MARK</b>').length - 1, 2,
    `expected exactly the two real components to render:\n${markup}`);
  assert.match(markup, /<mark-comp title="x &#62; y">/,
    'a `>` inside an attribute value keeps the whole value');
  assert.ok(!/<!--[^>]*shadowrootmode/.test(markup), 'nothing is rendered inside a comment');
  assert.ok(!/<textarea>[^<]*<mark-comp><template/.test(markup), 'nothing is rendered inside a textarea');
  assert.match(markup, /<div id="a" title="a > b">/, 'a plain element with `>` in an attribute is untouched');
}

/* ── the light-DOM path ───────────────────────────────────────────────────────────────────────
 * Far less exercised than the shadow one: no `<template>`, content becomes the element's children,
 * and styles are hoisted to the page shell as `@scope` rules instead of travelling with the markup.
 */
{
  const { html: markup, styles } = await renderToString(fixture('light-dom-ssr.js'));

  assert.ok(!markup.includes('shadowrootmode'), 'a light-DOM component renders no shadow template');
  assert.match(markup, /^<light-dom-ssr>/, 'the entry tag is the element itself');
  assert.match(markup, /<light-child data-child="">/, 'a nested light-DOM component renders, with its own attributes');
  assert.match(markup, /<i class="c">child<\/i>/, 'and its content');
  assert.match(styles, /@scope \(light-dom-ssr\)/, 'the entry hoists its styles');
  assert.match(styles, /@scope \(light-child\)/, 'and so does the nested component');
}

/** A component that renders itself is stopped, rather than running until the stack gives out. */
{
  await assert.rejects(() => renderToString(fixture('cycle-ssr.js')), /nesting exceeded/,
    'a self-rendering component is cut off');
}

/* ── structured data reaches a component ──────────────────────────────────────────────────────
 * Attributes carry strings and nothing else, so a component that takes rows, a config object or
 * anything shaped could not be server-rendered with real data — it had to be handed JSON and parse
 * it back. `props` assigns before `connectedCallback`, which is where a client parent would.
 */
{
  const url = fixture('props-ssr.js');
  const { html: markup } = await renderToString(url, { props: { rows: [{ label: 'a & b' }, { label: 'c' }] } });
  assert.match(markup, /<li>a &#38; b<\/li><li>c<\/li>/, `props did not reach the component: ${markup}`);

  const { html: bare } = await renderToString(url);
  assert.match(bare, /<ul><\/ul>/, 'and a render without them is still valid');
}

/* ── a page of several islands ────────────────────────────────────────────────────────────────
 * Each render correctly returns the styles of what *it* rendered, so two islands sharing a
 * component each carry that component's CSS and the assembled page ships it twice. A `Set` carried
 * across the calls emits each component's styles once.
 */
{
  const solo = await renderToString(fixture('island-a-ssr.js'));
  assert.equal(solo.styles.split('@scope').length - 1, 2, 'a single render is unchanged');

  const seen = new Set();
  const a = await renderToString(fixture('island-a-ssr.js'), { seen });
  const b = await renderToString(fixture('island-b-ssr.js'), { seen });
  const page = [a.styles, b.styles].filter(Boolean).join('\n');

  assert.equal(page.split('@scope (shared-badge)').length - 1, 1, 'the shared component appears once');
  assert.match(page, /@scope \(island-a-ssr\)/, 'and each island keeps its own');
  assert.match(page, /@scope \(island-b-ssr\)/);
}

/**
 * Sustained load retains nothing. Measured with `--expose-gc` this plateaus: the first few thousand
 * renders grow the heap by a couple of hundred bytes each — JIT, caches, template plans — and
 * every batch after that is flat. Asserted loosely here, since a suite cannot force a collection.
 */
{
  const url = fixture('stateful-ssr.js');
  for (let i = 0; i < 400; i++) await renderToString(url);
  const outputs = new Set();
  for (let i = 0; i < 20; i++) outputs.add((await renderToString(url)).html);
  assert.equal(outputs.size, 1, 'output stays identical across hundreds of renders');
}

/** Concurrency at volume: every response is the component that was asked for. */
{
  const results = await Promise.all([
    ...Array.from({ length: 50 }, () => renderToString(fixture('race-a-ssr.js'))),
    ...Array.from({ length: 50 }, () => renderToString(fixture('race-b-ssr.js'))),
  ]);
  const wrong = results.filter((result, index) =>
    !result.html.startsWith(index < 50 ? '<race-a-ssr>' : '<race-b-ssr>')
  );
  assert.equal(wrong.length, 0, `${wrong.length} of 100 concurrent responses were the wrong component`);
}

/* ── bounding the module URL ──────────────────────────────────────────────────────────────────
 * `import()` executes what it is given. `new URL` resolves `../` before this function sees the
 * string, so mapping a route to a component file — the obvious way to use a server renderer — puts
 * the traversal upstream of any check. `base` is where it gets caught.
 */
{
  const dir = new URL('./fixtures/ssr/', import.meta.url);
  const inside = await renderToString(new URL('hello-ssr.js', dir), { base: dir });
  assert.match(inside.html, /^<hello-ssr>/, 'a module inside the base renders');

  for (const [label, target] of [
    ['upward traversal', new URL('../../packages/core/dist/development/vera.js', dir)],
    ['an absolute path elsewhere', new URL('file:///etc/hosts.js')],
    ['a request-shaped escape', new URL(`${'../'.repeat(4)}evil.js`, dir)],
  ]) {
    await assert.rejects(() => renderToString(target, { base: dir }), /refused/, `${label} was not refused`);
  }

  /** Opt-in: a call without it behaves exactly as before. */
  const unbounded = await renderToString(new URL('hello-ssr.js', dir));
  assert.match(unbounded.html, /^<hello-ssr>/);
}

/**
 * A component that throws takes its own render down and nothing else. Rendering keeps per-render
 * bookkeeping in module state — which tags were rendered, which one is hoisting styles — so a
 * failure part-way through is exactly where that could be left dirty for the next request.
 */
{
  await assert.rejects(() => renderToString(fixture('throwing-ssr.js')), /component blew up/);

  const after = await renderToString(fixture('island-a-ssr.js'));
  assert.match(after.html, /^<island-a-ssr>/, 'the next render is unaffected');
  assert.ok(!after.styles.includes('throwing-ssr'), 'and inherits none of the failed one\'s styles');

  const again = await renderToString(fixture('island-a-ssr.js'));
  assert.equal(again.styles, after.styles, 'and stays stable');
}

/* ── the wiring an app already has ────────────────────────────────────────────────────────────
 * These are configuration *combinations*, which is where the last few passes found everything:
 * options work alone and break together, or break because the app does something ordinary.
 */
{
  /** Every option at once, which nothing had ever tried. */
  const seen = new Set();
  const { html: markup } = await renderToString(fixture('combo-ssr.js'), {
    tag: 'combo-ssr',
    attributes: { id: 'x', hidden: true },
    props: { extra: 1 },
    children: '<p>slotted</p><combo-child></combo-child>',
    seen,
    base: new URL('./fixtures/ssr/', import.meta.url),
  });
  assert.match(markup, /^<combo-ssr id="x" hidden="">/, 'attributes applied');
  assert.match(markup, /<p>slotted<\/p>/, 'children placed');
  assert.equal(markup.split('shadowrootmode').length - 1, 3, 'nested and slotted components both rendered');
}

/**
 * An app entry doing the ordinary thing — `setRenderer(domRender)` — displaces the server renderer
 * the moment that module is imported server-side, because `setRenderer` registers at priority 50 and
 * a taken priority replaces. Every component then rendered empty, with no error and nothing in the
 * output to suggest why.
 */
{
  const { setRenderer } = await import('@verajs/core');
  setRenderer(() => {});
  await assert.rejects(
    () => renderToString(fixture('hello-ssr.js')),
    /server renderer has been replaced/,
    'a displaced renderer is reported rather than rendering everything empty'
  );
}

console.log('ssr request isolation ok — concurrency, per-page styles, attribute round trip, slot position');
