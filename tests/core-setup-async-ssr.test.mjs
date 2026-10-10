/**
 * **A server waits for an async setup** (found 2026-10-10: both entry points served `<as-card></as-card>` empty while
 * the browser shows the resolved render — Brian's interchangeability rule broken). `renderToStringAsync` must serve the
 * RESOLVED render, for every hand-written shape (the fixture's header); `renderToString` cannot wait, so it must REFUSE
 * by name, as it already does for an async `connectedCallback` — never serve an empty element silently.
 * Each row runs in a child process, so this process never becomes a server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';

const serve = (entry, tag, options = {}) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e', `
  const said = [];
  for (const level of ['warn', 'error']) console[level] = (...a) => said.push(a.join(' '));
  const ssr = await import('@verajs/ssr');
  const url = new URL('./tests/fixtures/ssr/async-setup-ssr.js', 'file://' + process.cwd() + '/');
  let html = null, threw = null;
  try { html = (await ssr[${JSON.stringify(entry)}](url, { tag: ${JSON.stringify(tag)}, ...${JSON.stringify(options)} })).html; } catch (error) { threw = error.message; }
  process.stdout.write(JSON.stringify({ html, threw, said }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

for (const [tag, text] of [['as-card', 'card'], ['as-own', 'own'], ['as-value', 'value']]) {
  test(`renderToStringAsync serves <${tag}>'s RESOLVED render`, () => {
    const out = serve('renderToStringAsync', tag);
    assert.equal(out.threw, null, out.threw);
    assert.ok(out.html.includes(`<p>${text}</p>`), `resolved: ${out.html}`);
  });
  test(`renderToString refuses <${tag}> by name rather than serving it empty`, () => {
    const out = serve('renderToString', tag);
    assert.match(String(out.threw), /ssr-async-connected/, `refused: ${out.threw ?? out.html}`);
  });
}

test('nested async setups both resolve in the served markup', () => {
  const out = serve('renderToStringAsync', 'as-parent');
  assert.ok(out.html.includes('<section><as-card><p>card</p></as-card></section>'), out.html);
});

test('a setup slower than `timeout` is served as it stands, with the over-budget line', () => {
  const out = serve('renderToStringAsync', 'as-slow', { timeout: 50 });
  assert.equal(out.threw, null, out.threw);
  assert.ok(!out.html.includes('<p>slow</p>'), `not waited past the budget: ${out.html}`);
  assert.ok(out.said.some((line) => line.includes('ssr-timeout')), `said: ${out.said.join(' | ')}`);
});
