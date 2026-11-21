/**
 * A light component whose async setup settles AFTER its sibling's, inside a shadow root: its `@scope` block still goes
 * into that root (the root is read where the instance sits, never from what the scan was rendering last). Rendered by
 * `renderToStringAsync` only: a synchronous render refuses an async setup (`ssr-async-connected`).
 */
import { define, html } from '@verajs/core';

define({ tag: 'ssr-case-late', styles: '.late { color: rgb(3, 0, 0); }' }, async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return () => html`<b class="late">l</b>`;
});
define({ tag: 'ssr-case-quick', styles: '.quick { color: rgb(4, 0, 0); }' }, () => () => html`<b class="quick">q</b>`);
/** A shadow host whose light children settle at different times. */
define({ tag: 'ssr-case-latehost', shadow: 'open' }, () => () => html`<ul><ssr-case-late></ssr-case-late><ssr-case-quick></ssr-case-quick></ul>`);

export default define('ssr-case-latepage', () => () => html`<ssr-case-latehost></ssr-case-latehost>`);
