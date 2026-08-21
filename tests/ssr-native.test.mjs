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

// determinism + profile vs the wcc+lit baseline (2.86 ms/render warm)
const url = new URL('./fixtures/ssr/hello-ssr.js', import.meta.url);
const again = (await renderToString(url)).html;
assert.equal(markup, again, 'renders are deterministic');
const N = 200;
const t0 = performance.now();
for (let i = 0; i < N; i++) await renderToString(url);
const ms = (performance.now() - t0) / N;
console.log(`vera-native ssr ok — ${ms.toFixed(3)} ms/render (baseline wcc+lit: 2.86 ms)`);
