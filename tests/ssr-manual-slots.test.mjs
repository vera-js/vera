/**
 * **A root that assigns its slots by hand is served as one** (2026-11-23). `attachShadow` reuses a declarative root and
 * ignores the options it is handed, so a `slotAssignment: 'manual'` root served without its attribute arrived `named`:
 * the component's `slot.assign()` calls did nothing and every child showed in the default slot. Declarative shadow DOM
 * declares it with `shadowrootslotassignment="manual"` (Chromium, Firefox and WebKit, measured headed; BROWSER-LEDGER),
 * so the server writes that. A root that slots by name is served as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { renderToString } = await import('@verajs/ssr');
const fixture = new URL('./tests/fixtures/ssr/manual-slots-ssr.js', pathToFileURL(process.cwd() + '/'));

test("a manual root's template declares it", async () => {
  const { html } = await renderToString(fixture, { tag: 'manual-slots-ssr' });
  assert.match(html, /<template shadowrootmode="open" shadowrootslotassignment="manual">/, html);
});

test('CONTROL: a root that slots by name carries no assignment attribute', async () => {
  const { html } = await renderToString(fixture, { tag: 'named-slots-ssr' });
  assert.match(html, /<template shadowrootmode="open">/, `CONTROL: the root was served (${html})`);
  assert.doesNotMatch(html, /shadowrootslotassignment/, html);
});
