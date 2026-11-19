import { expect } from '@esm-bundle/chai';
import * as staticDev from '../../packages/static/dist/development/vera-static.js';
import * as staticMin from '../../packages/static/dist/vera-static.min.js';
import { activate, settled, stateOf } from '../../packages/directives/dist/vera-directives-standalone.min.js';

/**
 * **`@verajs/static` in real engines**, both builds (2026-11-18): the engine's own reading of what static writes — a
 * script URL refused, a value never markup, SVG and MathML in their namespaces, an unquoted value before `/>` keeping its
 * slash out. Then **`@verajs/directives` on a static page**: the standalone engine, watching the document, enhances
 * markup a static component writes after load; a SHADOW root is the engine's only once the page activates it (static
 * does not: the engine is a separate package), so that is pinned here rather than claimed.
 */
const TIERS = { 'static dev': staticDev, 'static min': staticMin };
let seq = 0;

for (const [name, { define, html, svg, mathml }] of Object.entries(TIERS)) {
  const tag = (what) => `st-${name.replace(' ', '-')}-${what}-${seq++}`;

  it(`${name}: the engine reads script URLs as refused, values as text, SVG and MathML in their namespaces`, async () => {
    const t = tag('engine');
    window.zqStatic = 0;
    define(t, () => () =>
      html`<a href=${'\u0001 java\tscript:alert(1)'}>a</a><a href=${'/ok'}>ok</a><p>${'<img src=x onerror="window.zqStatic++">'}</p><svg>${svg`<circle r=${'5'}/>`}</svg><math>${mathml`<mi>${'x'}</mi>`}</math>`);
    const el = document.body.appendChild(document.createElement(t));
    const [bad, ok] = el.querySelectorAll('a');
    expect(ok.getAttribute('href'), 'CONTROL: a safe URL written').to.equal('/ok');
    expect(/script/i.test(bad.getAttribute('href') ?? '')).to.equal(false);
    expect(el.querySelectorAll('img').length).to.equal(0);
    expect(el.querySelector('circle').namespaceURI).to.equal('http://www.w3.org/2000/svg');
    expect(el.querySelector('circle').getAttribute('r'), 'no slash taken').to.equal('5');
    expect(el.querySelector('mi').namespaceURI).to.equal('http://www.w3.org/1998/Math/MathML');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.zqStatic).to.equal(0);
    el.remove();
  });
}

/**
 * **Static is immune to a type swap** (2026-11-18): it judges a script AFTER its parse, on the final type, and has no
 * `?bool` / `.prop` bindings — `?type=${…}` is an ordinary attribute literally named `?type` in a real engine (jsdom
 * refuses that name; the engines accept it). So the script stays a JSON block, live and after a round trip.
 */
it('static: a JSON block with a ?type / .type "binding" stays a JSON block after a round trip (static has no such bindings)', () => {
  for (const [i, draw] of [
    (h) => h`<script type="application/json" ?type=${false}>${'alert(1)'}</script>`,
    (h) => h`<script type="application/json" .type=${'text/javascript'}>${'alert(1)'}</script>`,
  ].entries()) {
    const tag = `st-typeswap-${i}-${seq++}`;
    staticMin.define(tag, () => () => draw(staticMin.html));
    const el = document.body.appendChild(document.createElement(tag));
    const back = new DOMParser().parseFromString(`<body>${el.outerHTML}`, 'text/html').querySelector('script');
    expect(back.getAttribute('type'), `shape ${i}: still a JSON block after a round trip`).to.equal('application/json');
    el.remove();
  }
});

it('directives (standalone) enhances markup a static component writes after load; a shadow root once the page activates it', async () => {
  const light = `st-directives-light-${seq++}`;
  const shadow = `st-directives-shadow-${seq++}`;
  activate(document);
  staticDev.define(light, () => () => staticDev.html`<div data-vd-state="{ n: 1 }">x</div>`);
  staticDev.define({ tag: shadow, shadow: 'open' }, () => () => staticDev.html`<div data-vd-state="{ n: 2 }">y</div>`);
  const a = document.body.appendChild(document.createElement(light));
  const b = document.body.appendChild(document.createElement(shadow));
  await settled();
  expect(stateOf(a.querySelector('div'))?.n, 'light DOM: the engine saw the markup static wrote after load').to.equal(1);
  const inShadow = b.shadowRoot.querySelector('div');
  expect(inShadow !== null, 'CONTROL: static rendered into the shadow root').to.equal(true);
  expect(stateOf(inShadow) === null, 'a shadow root is not the engine\'s until activated').to.equal(true);
  activate(b.shadowRoot);
  await settled();
  expect(stateOf(inShadow)?.n, 'activated by the page, the shadow root is enhanced').to.equal(2);
  a.remove();
  b.remove();
});
