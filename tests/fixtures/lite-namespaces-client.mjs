/**
 * The CLIENT side of `tests/lite-ssr.test.mjs`'s svg/mathml differential, run as a child process (`@verajs/ssr` installs
 * its own DOM's globals in that test's process): every source of the corpus rendered by lite in jsdom, light DOM, each
 * element's signature printed as JSON. The build follows the parent's (`VERA_DIST`, and its conditions).
 */
import { JSDOM } from 'jsdom';
import { load } from '../dist.mjs';
import { SOURCES, signature } from './lite-namespace-sources.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const lite = await load('lite');
const out = {};
for (const [i, [name, source]] of Object.entries(SOURCES).entries()) {
  lite.define({ tag: `c-ns-${i}`, props: { v: 'a' } }, source(lite));
  out[name] = signature(document.body.appendChild(document.createElement(`c-ns-${i}`)));
}
await new Promise((resolve) => setTimeout(resolve, 0));
for (const [i, name] of Object.keys(SOURCES).entries()) out[name] = signature(document.querySelector(`c-ns-${i}`));
process.stdout.write(JSON.stringify(out));
