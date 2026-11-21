/**
 * **A light component inside a shadow root, rendered on the server, is styled at first paint** (2026-11-21). Its
 * `@scope (tag)` block goes where its root is: into EACH served declarative shadow root it renders in, and into the
 * page's styles only for an instance in the page. Before, every light block went to the page, which a shadow root's
 * content never sees, so those instances painted unstyled until hydration. The server DOM's shadow root is a root by the
 * same structural test the client uses (node type 11 with a `host`). Counts are exact.
 *
 * **todo until @verajs/ssr 0.3.7**: the server renders every component DETACHED (its `getRootNode()` is itself, its
 * `parentNode` null), so the light branch cannot see the declarative root it is served in and hoists to the page. The
 * fix carries the enclosing root per instance through the scan (never module state: the async scan renders nested
 * components concurrently). These rows are its red-first rows; until then the README states the limit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const fixture = new URL('./fixtures/ssr/styles-light-in-shadow.js', import.meta.url);
/** The served declarative shadow roots of `tag`, in order. */
const rootsOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*><template shadowrootmode="open">([\\s\\S]*?)</template>`, 'g'))].map((m) => m[1]);
const count = (text, needle) => text.split(needle).length - 1;
const LIGHT = '@scope (ssr-root-light)';
const TODO = { todo: 'server half lands with @verajs/ssr 0.3.7 (the enclosing root carried per instance through the scan)' };
const ONLY = '@scope (ssr-root-only)';

const check = (rendered, label) => {
  const [shell] = rootsOf(rendered.html, 'ssr-root-shell');
  const [shell2] = rootsOf(rendered.html, 'ssr-root-shell2');
  assert.ok(shell?.includes('<ssr-root-light') && shell2?.includes('<ssr-root-light'), `${label}: CONTROL: both shells rendered the light component: ${rendered.html}`);
  assert.equal(count(shell, LIGHT), 1, `${label}: its block inside the first shadow root`);
  assert.equal(count(shell2, LIGHT), 1, `${label}: and inside the second, which the first's CSS cannot reach`);
  assert.equal(count(shell, ONLY), 1, `${label}: the shadow-only component's block in its root`);
  assert.equal(count(rendered.html + rendered.styles, LIGHT), 3, `${label}: three copies in all: two roots and the page`);
  return shell;
};

test('a light class in two shadow roots and in the page: one block in each root, and one in the page styles', TODO, async () => {
  const rendered = await renderToString(fixture);
  check(rendered, 'one render');
  assert.equal(count(rendered.styles, LIGHT), 1, 'the page copy is in the page styles');
});

test('a light class that renders only inside a shadow root puts no CSS in the page', TODO, async () => {
  const rendered = await renderToString(fixture);
  assert.equal(count(rendered.styles, ONLY), 0, `nothing in the page styles: ${rendered.styles}`);
});

test('two renders sharing `seen`: the in-root copies are served both times (seen governs the page styles only)', TODO, async () => {
  const seen = new Set();
  const first = await renderToString(fixture, { seen });
  const second = await renderToString(fixture, { seen });
  check(first, 'first render');
  const [shell] = rootsOf(second.html, 'ssr-root-shell');
  const [shell2] = rootsOf(second.html, 'ssr-root-shell2');
  assert.equal(count(shell ?? '', LIGHT) + count(shell2 ?? '', LIGHT), 2, `second render: both roots still carry the block: ${second.html}`);
  assert.equal(count(second.styles, LIGHT), 0, 'and the page styles skip what this page already has (seen)');
});
