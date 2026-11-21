/**
 * **A light component inside a shadow root, rendered on the server, is styled at first paint** (2026-11-21). Its
 * `@scope (tag)` block goes where its root is: into EACH served declarative shadow root it renders in, and into the
 * page's styles only for an instance in the page. Before, every light block went to the page, which a shadow root's
 * content never sees, so those instances painted unstyled until hydration. The server DOM's shadow root is a root by the
 * same structural test the client uses (node type 11 with a `host`). Counts are exact.
 *
 * **How the server knows** (`@verajs/ssr` 0.3.7): it renders every component DETACHED, so each instance carries the
 * declarative root it is served in (`_enclosing`, set where the scan builds it: never module state, since the async
 * scan renders nested components concurrently), `getRootNode()` answers that root, and `document.contains` answers
 * `false` across it, as in a browser. Every node here used to be "in the document", so every light block went to the
 * page; these rows were red against that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const fixture = new URL('./fixtures/ssr/styles-light-in-shadow.js', import.meta.url);
/** The served declarative shadow roots of `tag`, in order. */
const rootsOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*><template shadowrootmode="open">([\\s\\S]*?)</template>`, 'g'))].map((m) => m[1]);
const count = (text, needle) => text.split(needle).length - 1;
const LIGHT = '@scope (ssr-root-light)';
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

test('a light class in two shadow roots and in the page: one block in each root, and one in the page styles', async () => {
  const rendered = await renderToString(fixture);
  check(rendered, 'one render');
  assert.equal(count(rendered.styles, LIGHT), 1, 'the page copy is in the page styles');
});

test('a light class that renders only inside a shadow root puts no CSS in the page', async () => {
  const rendered = await renderToString(fixture);
  assert.equal(count(rendered.styles, ONLY), 0, `nothing in the page styles: ${rendered.styles}`);
});

test('two renders sharing `seen`: the in-root copies are served both times (seen governs the page styles only)', async () => {
  const seen = new Set();
  const first = await renderToString(fixture, { seen });
  const second = await renderToString(fixture, { seen });
  check(first, 'first render');
  const [shell] = rootsOf(second.html, 'ssr-root-shell');
  const [shell2] = rootsOf(second.html, 'ssr-root-shell2');
  assert.equal(count(shell ?? '', LIGHT) + count(shell2 ?? '', LIGHT), 2, `second render: both roots still carry the block: ${second.html}`);
  assert.equal(count(second.styles, LIGHT), 0, 'and the page styles skip what this page already has (seen)');
});

/**
 * **The shapes where the root is easy to get wrong** (2026-11-21, review): the root comes from where the instance
 * SITS, never from which instance was being rendered when it was reached. A child slotted into a shadow host is in the
 * page's light DOM; light inside light inside a shadow root is in that root; and a setup that settles late, after a
 * sibling's, still writes into its own root (read when its block is written, not from a variable the scan moved past).
 */
const cases = new URL('./fixtures/ssr/styles-light-root-cases.js', import.meta.url);
const { renderToStringAsync } = await import('@verajs/ssr');

for (const [chain, render] of [['renderToString', renderToString], ['renderToStringAsync', renderToStringAsync]]) {
  test(`${chain}: a light child slotted into a shadow host is styled by the PAGE, not the host's root`, async () => {
    const rendered = await render(cases);
    const [host] = rootsOf(rendered.html, 'ssr-case-slothost');
    assert.ok(host !== undefined && rendered.html.includes('<ssr-case-slotted'), `CONTROL: the host and its slotted child rendered: ${rendered.html}`);
    assert.equal(count(host, '@scope (ssr-case-slotted)'), 0, `nothing in the host's root, which its slotted child is not in: ${host}`);
    assert.equal(count(rendered.styles, '@scope (ssr-case-slotted)'), 1, `one block in the page styles: ${rendered.styles}`);
  });

  test(`${chain}: light inside light inside a shadow root is styled in that root`, async () => {
    const rendered = await render(cases);
    const [host] = rootsOf(rendered.html, 'ssr-case-deephost');
    assert.ok(host?.includes('<ssr-case-deep'), `CONTROL: the two levels of light DOM rendered in the root: ${rendered.html}`);
    assert.equal(count(host, '@scope (ssr-case-deep)'), 1, `the inner light block in the shadow root: ${host}`);
    assert.equal(count(rendered.styles, '@scope (ssr-case-deep)'), 0, 'and none in the page');
  });
}

const late = new URL('./fixtures/ssr/styles-light-root-late.js', import.meta.url);
test('renderToStringAsync: a light setup that settles after its sibling still writes into its own root', async () => {
  const rendered = await renderToStringAsync(late);
  const [host] = rootsOf(rendered.html, 'ssr-case-latehost');
  assert.ok(host?.includes('class="late"') && host.includes('class="quick"'), `CONTROL: both settled and rendered: ${host}`);
  assert.equal(count(host, '@scope (ssr-case-late)'), 1, `the late one's block in the root: ${host}`);
  assert.equal(count(host, '@scope (ssr-case-quick)'), 1, `and the quick one's: ${host}`);
  assert.equal(count(rendered.styles, '@scope (ssr-case-late)') + count(rendered.styles, '@scope (ssr-case-quick)'), 0, 'none in the page');
});
