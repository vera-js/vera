/**
 * Strategy 4 — vera-native SSR: no wcc, no lit, no acorn, no parse5. This import installs the
 * server environment and MUST come before anything that pulls in @verajs/core.
 */
import { renderToString } from '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const { html: markup } = await renderToString(new URL('./fixtures/ssr/hello-ssr.js', import.meta.url));

assert.ok(markup.startsWith('<hello-ssr>'), 'entry tag wraps output');
assert.ok(markup.includes('<template shadowrootmode="open">'), 'declarative shadow DOM');
assert.ok(markup.includes('<h1>hello from the server</h1>'), 'state rendered');
assert.ok(!/<output[^>]*hidden/.test(markup), '?bool=false stays absent');
assert.ok(/<input value="hello from the server"/.test(markup), '.value mirrored, sigil stripped');
assert.ok(!markup.includes('@') && !markup.includes('?hidden'), 'no sigil residue in markup');

// nested components, lists, escaping, events, styles
const nested = await renderToString(new URL('./fixtures/ssr/nested-ssr.js', import.meta.url));
assert.ok(nested.html.includes('<child-badge label="from-parent"><template shadowrootmode="open">'),
  'nested component rendered to declarative shadow DOM');
assert.ok(nested.html.includes('badge: from-parent'), 'attributes reach nested components');
assert.ok(nested.html.includes('<li>a &#60;b&#62;</li>'), 'interpolated values escaped');
assert.ok(nested.html.includes('<h2>nested</h2>'), '@event binding fully stripped');
assert.ok(!nested.html.includes('onClick') && !nested.html.includes('onclick'),
  'onClick-shaped bindings stripped server-side too');
assert.ok(/<template shadowrootmode="open"><style>h2 \{ color: teal \}<\/style>/.test(nested.html.replace('<nested-ssr>', '')) || nested.html.includes('<style vera-styles>h2 { color: teal }</style>'),
  'shadow static styles serialized into the shadow root');

/**
 * Child-position values agree with the client renderer: only `null` and `undefined` are empty.
 * `false` used to serialize as empty here while the browser rendered the text `false`, so
 * `${cond && 'x'}` produced different content on the two paths — invisible on a static page, and a
 * discarded hydration on a server-rendered one.
 */
{
  const { html: tag } = await import('@verajs/core');
  const serialize = (await import('@verajs/ssr/vera')).serializeTemplate;
  assert.equal(serialize(tag`<p>${false}</p>`), '<p>false</p>', 'false renders, as it does on the client');
  assert.equal(serialize(tag`<p>${0}</p>`), '<p>0</p>', '0 renders');
  assert.equal(serialize(tag`<p>${null}</p>`), '<p></p>', 'null is empty');
  assert.equal(serialize(tag`<p>${undefined}</p>`), '<p></p>', 'undefined is empty');
}

// determinism + profile vs the wcc+lit baseline (2.86 ms/render warm)
const url = new URL('./fixtures/ssr/hello-ssr.js', import.meta.url);
const again = (await renderToString(url)).html;
assert.equal(markup, again, 'renders are deterministic');
const N = 200;
const t0 = performance.now();
for (let i = 0; i < N; i++) await renderToString(url);
const ms = (performance.now() - t0) / N;
console.log(`vera-native ssr ok — ${ms.toFixed(3)} ms/render (baseline wcc+lit: 2.86 ms)`);
