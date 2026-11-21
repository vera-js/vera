/**
 * LIGHT components rendered inside SHADOW components, on the server: a light block belongs in each root it renders in
 * (one root's CSS never reaches another, and the page's sheets stop at every boundary). `ssr-root-light` renders in two
 * shadow shells and in the page; `ssr-root-only` renders inside a shadow shell only, so the page needs none of its CSS.
 * The first shell has styles of its own, so its hydration writes its root's list after the light children adopted.
 */
import { define, html } from '@verajs/core';

define({ tag: 'ssr-root-light', styles: '.mark { color: rgb(200, 0, 0); }' }, () => () => html`<b class="mark">x</b>`);
define({ tag: 'ssr-root-only', styles: '.only { color: rgb(0, 150, 0); }' }, () => () => html`<i class="only">o</i>`);
define({ tag: 'ssr-root-shell', shadow: 'open', styles: 'section { margin: 0px; }' }, () => () => html`<section><ssr-root-light></ssr-root-light><ssr-root-only></ssr-root-only></section>`);
define({ tag: 'ssr-root-shell2', shadow: 'open' }, () => () => html`<aside><ssr-root-light></ssr-root-light></aside>`);
export default define('ssr-root-page', () => () => html`<ssr-root-shell></ssr-root-shell><ssr-root-shell2></ssr-root-shell2><ssr-root-light></ssr-root-light>`);
