/**
 * Where a LIGHT component's `@scope` block goes on the server, in the shapes where "the instance being rendered when it
 * is reached" would answer wrong: a light child SLOTTED into a shadow host lives in the host's light DOM, so its root is
 * the page; a light component inside a light component inside a shadow root is in that root (two levels of light DOM,
 * neither with a root of its own). Each case uses its own light class, so each block's copies can be counted on their
 * own. The async case is `styles-light-root-late.js`: a synchronous render refuses an async setup.
 */
import { define, html } from '@verajs/core';

define({ tag: 'ssr-case-slotted', styles: '.slotted { color: rgb(1, 0, 0); }' }, () => () => html`<b class="slotted">s</b>`);
define({ tag: 'ssr-case-deep', styles: '.deep { color: rgb(2, 0, 0); }' }, () => () => html`<b class="deep">d</b>`);
define({ tag: 'ssr-case-wrap' }, () => () => html`<div><ssr-case-deep></ssr-case-deep></div>`);

/** A shadow host that projects its children: what is slotted stays in the page's light DOM. */
define({ tag: 'ssr-case-slothost', shadow: 'open' }, () => () => html`<p><slot></slot></p>`);
/** A shadow host whose own template holds a light wrapper holding a light component. */
define({ tag: 'ssr-case-deephost', shadow: 'open' }, () => () => html`<section><ssr-case-wrap></ssr-case-wrap></section>`);

export default define(
  'ssr-case-page',
  () => () => html`<ssr-case-slothost><ssr-case-slotted></ssr-case-slotted></ssr-case-slothost><ssr-case-deephost></ssr-case-deephost>`
);
