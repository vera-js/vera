/**
 * `@verajs/renderer/tag` — an element whose tag name is decided at runtime.
 *
 * A template renderer bakes tag names into its statics; that is what template identity is. So a
 * runtime tag becomes part of the statics *before* the renderer sees the template, and everything
 * downstream — the renderer, `@verajs/ssr`, hydration — receives an ordinary template and is
 * unaware this exists. These tests hold both halves of that: that it works, and that nothing
 * downstream had to learn anything.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { renderInto } = await load('renderer');
const { html, tag } = await load('renderer/tag');

const into = () => {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  return container;
};
const read = (container) => container.innerHTML.replace(/<!---->/g, '');

const HEADING = { 1: tag`h1`, 2: tag`h2`, 3: tag`h3` };

test('a tagged template renders the tag it was given, and updates in place', () => {
  const container = into();
  const draw = (level, text) =>
    renderInto(html`<section><${HEADING[level]} class="t">${text}</${HEADING[level]}></section>`, container);

  draw(1, 'one');
  const first = container.querySelector('.t');
  assert.equal(read(container), '<section><h1 class="t">one</h1></section>');

  draw(1, 'ONE');
  assert.equal(read(container), '<section><h1 class="t">ONE</h1></section>');
  assert.equal(container.querySelector('.t'), first, 'the same tag updates in place');

  draw(3, 'three');
  assert.equal(read(container), '<section><h3 class="t">three</h3></section>');
  assert.notEqual(container.querySelector('.t'), first, 'a different tag is a different element');
});

/**
 * The cache is what makes the first assertion above possible: `_shape === value.strings` is the
 * renderer's identity check, so a fresh statics array per render would rebuild the subtree every
 * time. Asserted through identity rather than through the cache, which is private.
 */
test('the spliced statics are stable per tag, and distinct between tags', () => {
  /**
   * **One call site.** The cache hangs off the call site's own `strings` array, so two template
   * literals in the source are two entries however identical they look — which is right for real
   * code, where a template lives at one place in a render function, and is the thing that catches
   * people writing tests for it.
   */
  const make = (level, text) => html`<${HEADING[level]}>${text}</${HEADING[level]}>`;
  const one = make(1, 'x');
  const again = make(1, 'y');
  const other = make(2, 'x');
  assert.equal(one.strings, again.strings, 'the same tag reuses its statics');
  assert.notEqual(one.strings, other.strings, 'a different tag gets its own');
  assert.equal(one.values.length, 1, 'the tag is a static, not a binding');
});

test('a template with no tag in it is the ordinary shape', () => {
  const result = html`<p>${'x'}</p>`;
  assert.equal(result._$litType$, 1);
  assert.deepEqual([...result.strings], ['<p>', '</p>']);
  assert.deepEqual(result.values, ['x']);
});

/**
 * The JSX half. A capitalized JSX tag compiles to `H({…})`, and a tag *is* that function — so the
 * same value works in both notations with no compiler change. This is the call the transform emits.
 */
test('a tag is a JSX component, and maps React names the way the transform does', () => {
  const container = into();
  const draw = (level, props) => renderInto(html`<section>${HEADING[level](props)}</section>`, container);

  draw(1, { className: 'title', children: ['one'] });
  assert.equal(read(container), '<section><h1 class="title">one</h1></section>');

  draw(1, { className: 'title', hidden: true, children: ['one'] });
  assert.equal(read(container), '<section><h1 class="title" hidden="">one</h1></section>');

  /** The case that makes the mapping a correctness matter rather than an ergonomic one. */
  draw(1, { className: 'title', hidden: false, children: ['one'] });
  assert.equal(
    container.querySelector('h1').hasAttribute('hidden'),
    false,
    'hidden={false} must not disable — raw, it becomes the attribute hidden="false"'
  );

  draw(2, { className: 'title', children: ['two'] });
  assert.equal(read(container), '<section><h2 class="title">two</h2></section>');
});

test('a JSX tag with no props renders bare', () => {
  const container = into();
  renderInto(html`<section>${HEADING[1]()}</section>`, container);
  assert.equal(read(container), '<section><h1></h1></section>');
});

/**
 * **A string can never become a tag.** Only another tag may be interpolated, so the set of tags an
 * app can produce is fixed by its source. That is what keeps a tag out of reach of a request — the
 * same reasoning behind there being no `unsafeHTML` — and it is incidentally what bounds the cache.
 */
test('a string cannot become a tag', () => {
  for (const hostile of ['img src=x onerror=alert(1)', 'h1', '', 'div class="x"']) {
    assert.throws(() => tag`${hostile}`, /only another tag may be interpolated/, JSON.stringify(hostile));
  }
});

test('a tag may be composed from other tags', () => {
  const h = tag`h`;
  const one = tag`${h}1`;
  const container = into();
  renderInto(html`<${one}>x</${one}>`, container);
  assert.equal(read(container), '<h1>x</h1>');
});

test('bindings on a dynamic element behave like bindings anywhere', () => {
  const container = into();
  const draw = (level, title, hidden) =>
    renderInto(html`<${HEADING[level]} title=${title} ?hidden=${hidden}>x</${HEADING[level]}>`, container);
  draw(1, 'a', false);
  assert.equal(read(container), '<h1 title="a">x</h1>');
  draw(1, null, true);
  assert.equal(read(container), '<h1 hidden="">x</h1>');
});

/* ── nothing downstream had to learn anything ────────────────────────────────────────────────── */
/**
 * The splice happens before the renderer or the serializer sees the template, so both receive an
 * ordinary one. That is the whole design, and this is what holds it: the server's markup for a
 * dynamic tag, and a client adopting it.
 *
 * The server half runs in a subprocess because `@verajs/ssr` installs DOM globals that jsdom's
 * would fight over.
 */
{
  const { execFileSync } = await import('node:child_process');
  const server = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { serializeTemplate } from '@verajs/ssr/vera';
        const { html, tag } = await import('@verajs/renderer/tag');
        const H = { 1: tag\`h1\`, 2: tag\`h2\` };
        const view = (level, text) => html\`<section><\${H[level]} class="t">\${text}</\${H[level]}></section>\`;
        process.stdout.write(JSON.stringify({
          one: serializeTemplate(view(1, 'one')),
          two: serializeTemplate(view(2, 'two')),
          jsx: serializeTemplate(html\`<section>\${H[1]({ className: 't', children: ['one'] })}</section>\`),
        }));
      `,
      ],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' }
    )
  );

  test('the server renders a dynamic tag as ordinary markup', () => {
    assert.equal(server.one, '<section><h1 class="t">one</h1></section>');
    assert.equal(server.two, '<section><h2 class="t">two</h2></section>');
  });

  test('and the JSX form serializes identically to the tagged-template form', () => {
    assert.equal(server.jsx, server.one, 'the two notations must not disagree on the server either');
  });

  test('a client adopts the server markup for a dynamic tag', async () => {
    const { renderInto: hydratingRender } = await load('renderer/hydrate');
    const container = into();
    container.innerHTML = server.one;
    const adopted = container.querySelector('.t');

    const draw = (level, text) =>
      hydratingRender(
        html`<section><${HEADING[level]} class="t">${text}</${HEADING[level]}></section>`,
        container
      );

    draw(1, 'one');
    assert.equal(container.contains(adopted), true, 'the server node was adopted, not rebuilt');

    draw(1, 'updated');
    assert.equal(container.querySelector('.t'), adopted, 'and it updates in place afterwards');
    assert.equal(read(container), '<section><h1 class="t">updated</h1></section>');
  });
}
