/**
 * SSR fixture: `@verajs/static` components on the server's DOM (`tests/static-ssr.test.mjs`), light DOM so the served
 * markup is in the document a test parses, and one shadow component (served as a declarative shadow root).
 */
import { define, html, svg } from '@verajs/static';

define({ tag: 'ssr-static-card', props: { heading: 'A "q" <b>', items: ['x', 'y'] } }, (host) => () =>
  html`<h2 title=${host.heading}>${host.heading}</h2><ul>${host.items.map((i) => html`<li class="${i}">${i}</li>`)}</ul><svg>${svg`<circle r=${'5'}/>`}</svg>`);
define('ssr-static-attack', () => () => html`<a href=${'javascript:alert(1)'}>a</a><p>${'<img src=x onerror=alert(1)>'}</p>`);
define({ tag: 'ssr-static-shadow', shadow: 'open' }, () => () => html`<b>in</b>`);
/** A JSON block with a `?type` / `.type` binding: a false `?type` removes nothing real, `.type` is not written (static, 2026-11-19). */
define('ssr-static-typeswap', () => () => html`<script type="application/json" ?type=${false} .type=${'text/javascript'}>${'{"a":1}'}</script>`);
