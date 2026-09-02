/**
 * The **whole** kitchen sink rendered many times, concurrently, with every output compared.
 *
 * `tests/ssr-request-isolation.test.mjs` covers this on small fixtures. This is the same question
 * asked of a page that uses everything at once — reactive collections, keyed lists, `static styles`
 * in both DOMs, a form-associated element, a router, spreads, refs, SVG and MathML — because
 * per-render state that leaks shows up where the most state exists.
 *
 * A server answering one request with another's markup is the worst defect this package can have,
 * and it is invisible under a single render.
 */
import { renderToString } from '@verajs/ssr';
import assert from 'node:assert/strict';

const entry = new URL('../examples/kitchen-sink/entry-ssr.js', import.meta.url);

/** Warmed first, so the comparison is of steady state rather than of first-import effects. */
const reference = await renderToString(entry);

/* ── the same request, many times, sequentially ─────────────────────────────────────────────── */
for (let i = 0; i < 20; i++) {
  const { html, styles } = await renderToString(entry);
  assert.equal(html, reference.html, `render ${i} differs from the first`);
  assert.equal(styles, reference.styles, `render ${i} returned different styles`);
}

/* ── and concurrently ───────────────────────────────────────────────────────────────────────── */
const concurrent = await Promise.all(Array.from({ length: 25 }, () => renderToString(entry)));
for (const [i, result] of concurrent.entries()) {
  assert.equal(result.html, reference.html, `concurrent render ${i} differs`);
  assert.equal(result.styles, reference.styles, `concurrent render ${i} returned different styles`);
}

/* ── interleaved with a different component, which is where bookkeeping leaks ───────────────── */
const other = new URL('../examples/kitchen-sink/components/sink-scoped.js', import.meta.url);
for (let i = 0; i < 10; i++) {
  await renderToString(other, { tag: 'sink-scoped' });
  const { html } = await renderToString(entry);
  assert.equal(html, reference.html, `render ${i} was affected by the one before it`);
}

/* ── a shared `seen` set must not change the markup, only the styles ────────────────────────── */
{
  const seen = new Set();
  const first = await renderToString(entry, { seen });
  const second = await renderToString(entry, { seen });
  assert.equal(first.html, reference.html, 'a `seen` set changed the markup');
  assert.equal(second.html, reference.html, 'a `seen` set changed the markup on the second pass');
  assert.equal(second.styles, '', 'the second render should ship no styles the first already did');
}

/* ── scale: a component holding a large keyed list ──────────────────────────────────────────── */
{
  const started = performance.now();
  const big = await renderToString(new URL('../tests/fixtures/ssr/rows-ssr.js', import.meta.url));
  const elapsed = performance.now() - started;
  assert.ok(big.html.length > 1000, 'the large fixture rendered nothing');
  assert.ok(elapsed < 2000, `a 100-row component took ${elapsed.toFixed(0)} ms, which is not a render`);
}

console.log(
  `kitchen ssr isolation: 56 renders of a ${reference.html.length} B page, all byte-identical`
);
