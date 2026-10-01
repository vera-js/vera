/**
 * **A registered component's URL-named property is refused on the server as on the client.** The server delivers a
 * parent's `.prop` bindings to the component it renders; a `javascript:` URL in one the browser could navigate to —
 * `.href`, and an animation-or-router name like `.to` — is never delivered, exactly as the client's renderer refuses
 * the same string on a custom element's property. A plain URL still arrives.
 */
import { renderToString } from '@verajs/ssr';
import assert from 'node:assert/strict';

const { html: markup } = await renderToString(new URL('./fixtures/ssr/url-props-ssr.js', import.meta.url));
const rows = [...markup.matchAll(/<p>\s*([^<]*?)\s*<\/p>/g)].map(([, text]) => text.replace(/\s+/g, ' '));

assert.deepEqual(rows, ['undefined · undefined', '/inbox · /settings'], 'javascript: never delivered; a plain URL is');
assert.ok(!/javascript/i.test(markup), 'and nothing of the payload reaches the page');
