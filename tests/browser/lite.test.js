import { expect } from '@esm-bundle/chai';
import * as liteDev from '../../packages/lite/dist/development/vera-lite.js';
import * as liteMin from '../../packages/lite/dist/vera-lite.min.js';
import * as core from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { failedLoad } from './until.js';

core.wire([renderer]);

/**
 * **The lite tier in real engines**, in both builds: what jsdom cannot settle. Focus and the caret across a re-render
 * (lite patches in place, so both survive), SVG markup in a template (a case-sensitive attribute name, parsed by the
 * engine), a server's declarative shadow root rendered into, and the engine's own reading of a script URL. And TABLES,
 * which jsdom fosters to the wrong side (BROWSER-LEDGER): lite and core insert a nested template's nodes as written, which
 * is pinned here, where the parser is a real one.
 */

const TIERS = { 'lite dev': liteDev, 'lite min': liteMin };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

for (const [name, { define, html, mathml, signal, svg }] of Object.entries(TIERS)) {
  const tag = (what) => `tier-${name.replace(' ', '-')}-${what}-${seq++}`;

  it(`${name}: focus and the caret survive a re-render in a shadow root`, async () => {
    const t = tag('focus');
    define({ tag: t, shadow: 'open', props: { n: 0 } }, (host) => () => html`<input value="hello world"><p>${host.n}</p>`);
    const el = document.body.appendChild(document.createElement(t));
    const input = el.shadowRoot.querySelector('input');
    input.focus();
    input.setSelectionRange(5, 5);
    expect(el.shadowRoot.activeElement === input, 'CONTROL: focused').to.equal(true);
    el.n = 1;
    await settle();
    expect(el.shadowRoot.querySelector('p').textContent).to.equal('1');
    const now = el.shadowRoot.querySelector('input');
    expect(now === input).to.equal(true);
    expect(el.shadowRoot.activeElement === now).to.equal(true);
    expect(now.selectionStart).to.equal(5);
    el.remove();
  });

  it(`${name}: SVG in a template keeps its case-sensitive attribute and updates`, async () => {
    const t = tag('svg');
    define({ tag: t, props: { r: 4 } }, (host) => () => html`<svg viewBox="0 0 ${host.r * 4} 10"><circle r=${host.r}></circle></svg>`);
    const el = document.body.appendChild(document.createElement(t));
    const svg = el.querySelector('svg');
    expect(svg.namespaceURI).to.equal('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).to.equal('0 0 16 10');
    expect(el.querySelector('circle').getAttribute('r')).to.equal('4');
    el.r = 5;
    await settle();
    expect(el.querySelector('svg').getAttribute('viewBox')).to.equal('0 0 20 10');
    expect(el.querySelector('circle').namespaceURI).to.equal('http://www.w3.org/2000/svg');
    el.remove();
  });

  it(`${name}: a server's declarative shadow root is the one rendered into`, async () => {
    const t = tag('dsd');
    const host = document.createElement('div');
    host.setHTMLUnsafe(`<${t}><template shadowrootmode="open"><p>served</p></template></${t}>`);
    const served = host.firstElementChild;
    const root = served.shadowRoot;
    expect(root?.textContent, 'CONTROL: the engine attached the declarative root').to.equal('served');
    document.body.append(host);
    define({ tag: t, shadow: 'open' }, () => () => html`<p>client</p>`);
    expect(served.shadowRoot === root).to.equal(true);
    expect(root.textContent).to.equal('client');
    host.remove();
  });

  it(`${name}: the engine's script URLs are refused, a safe one written`, () => {
    const t = tag('url');
    define(t, () => () => html`<a href=${'\u0001 java\tscript:alert(1)'}>x</a><a href=${'JAVASCRIPT:alert(1)'}>y</a><a href=${'/ok'}>z</a>`);
    const el = document.body.appendChild(document.createElement(t));
    const [a, b, ok] = el.querySelectorAll('a');
    expect(ok.getAttribute('href'), 'CONTROL').to.equal('/ok');
    expect(a.hasAttribute('href')).to.equal(false);
    expect(b.hasAttribute('href')).to.equal(false);
    el.remove();
  });

  it(`${name}: title, textarea, style and a JSON data block take a value as TEXT; it never becomes markup or runs`, async () => {
    const t = tag('text');
    window.zqRan = 0;
    const attack = (end) => `a</${end}><img src=x onerror="window.zqRan++">b`;
    define(t, () => () => html`<title>${attack('title')}</title><textarea>${attack('textarea')}</textarea><style>:host{--x:${attack('style')}}</style><script type="application/json">${attack('script')}</script>`);
    const el = document.body.appendChild(document.createElement(t));
    expect(el.querySelector('textarea').value, 'CONTROL: rendered').to.equal(attack('textarea'));
    expect(el.querySelector('title').textContent).to.equal(attack('title'));
    /** An HTML style's and JSON block's text is written closed (`closedRawText`), so a saved page keeps it text. */
    expect(el.querySelector('style').textContent).to.equal(`:host{--x:${attack('style').replace('</', '<\\/')}}`);
    expect(el.querySelector('script').textContent).to.equal(attack('script').replace(/</g, '\\u003c'));
    expect(el.querySelectorAll('img').length).to.equal(0);
    await failedLoad();
    expect(window.zqRan).to.equal(0);
    el.remove();
  });

  /**
   * **svg and mathml templates, in the engine's parser** (2026-11-18): the URL refusals hold in both namespaces — SVG's
   * `href` and `xlink:href`, an animation's `to` and its `values` list item by item, MathML's `href` — and a value is text
   * in SVG's `<title>` and `<style>`, never markup.
   */
  it(`${name}: svg and mathml templates refuse script URLs as html's do, and keep title and style as text`, async () => {
    const t = tag('svgurl');
    const js = 'javascript:alert(1)';
    window.zqRan = 0;
    const attack = (end) => `a</${end}><img src=x onerror="window.zqRan++">b`;
    define(t, () => () => html`<svg>${[
      svg`<a href=${js}><text>a</text></a><a xlink:href=${js}><text>b</text></a><a href=${'/ok'}><text>c</text></a>`,
      svg`<set attributeName="href" to=${js}></set><animate attributeName="href" values=${`#a;${js}`}></animate><animate attributeName="href" values=${'#a;#b'}></animate>`,
      svg`<title>${attack('title')}</title><style>.a{--x:${attack('style')}}</style>`,
    ]}</svg><math>${mathml`<mi href=${js}>x</mi><mi href=${'/ok'}>y</mi>`}</math>`);
    const el = document.body.appendChild(document.createElement(t));
    const SVG = 'http://www.w3.org/2000/svg';
    const links = el.querySelectorAll('svg a');
    expect(links.length, 'CONTROL: three svg links').to.equal(3);
    expect([...links].every((a) => a.namespaceURI === SVG), 'built as SVG').to.equal(true);
    expect(links[2].getAttribute('href'), 'CONTROL: a safe href written').to.equal('/ok');
    expect(links[0].hasAttribute('href')).to.equal(false);
    expect(links[1].hasAttribute('xlink:href')).to.equal(false);
    expect(el.querySelector('set').hasAttribute('to')).to.equal(false);
    const [animate, safe] = el.querySelectorAll('animate');
    expect(safe.getAttribute('values'), 'CONTROL: a safe values list written').to.equal('#a;#b');
    expect(animate.hasAttribute('values')).to.equal(false);
    const [mi, ok] = el.querySelectorAll('mi');
    expect(mi.namespaceURI).to.equal('http://www.w3.org/1998/Math/MathML');
    expect(ok.getAttribute('href'), 'CONTROL: a safe MathML href written').to.equal('/ok');
    expect(mi.hasAttribute('href')).to.equal(false);
    const title = el.querySelector('svg title');
    expect(title.namespaceURI === SVG && title.textContent === attack('title')).to.equal(true);
    expect(el.querySelector('svg style').textContent).to.equal(`.a{--x:${attack('style')}}`);
    expect(el.querySelectorAll('img').length).to.equal(0);
    await failedLoad();
    expect(window.zqRan).to.equal(0);
    el.remove();
  });

  /**
   * **What an svg template refuses, in the engine's parser**: a hole in an SVG `<script>`, in an `<iframe>` under
   * `<foreignObject>`, or in CDATA (text in SVG content; a bogus comment inside `<title>`, an HTML integration point) is
   * never filled — the template is refused, coded, where core's renderer garbles CDATA into text. CDATA in SVG's `<style>`
   * is its text, filled as text. CDATA in SVG's `<title>` is the ENGINE's call (BROWSER-LEDGER, 2026-11-18): a comment in
   * Chromium, so refused; a CDATA section in Firefox and WebKit, so filled as text — read from this engine's own parse,
   * and either way never markup. Each case renders a harmless template first, then calls `connectedCallback` itself: a
   * direct call, so the refusal reaches this caller instead of the page's error event.
   */
  it(`${name}: an svg template's script, foreignObject iframe and CDATA holes are refused; CDATA in style is text`, async () => {
    /** This engine's reading of CDATA in an integration point: a text section, or a bogus comment. */
    const probe = document.createElement('template');
    probe.innerHTML = '<svg><title><![CDATA[x]]></title></svg>';
    const titleCdataIsText = probe.content.firstChild.firstChild.firstChild.nodeType === 3;
    const REFUSED = {
      script: () => svg`<script>${'alert(1)'}</script>`,
      iframe: () => svg`<foreignObject><iframe>${'x'}</iframe></foreignObject>`,
      cdata: () => svg`<g><![CDATA[a ${'<b>x</b>'} b]]></g>`,
    };
    const titleCdata = () => svg`<title><![CDATA[${'<b>x</b>'}]]></title>`;
    if (!titleCdataIsText) REFUSED['cdata in title'] = titleCdata;
    for (const [what, draw] of Object.entries(REFUSED)) {
      const t = tag('svgrefuse');
      let bad = false;
      define(t, () => () => html`<svg>${bad ? draw() : svg`<g></g>`}</svg>`);
      const el = document.body.appendChild(document.createElement(t));
      expect(el.querySelector('svg g') !== null, `CONTROL: ${what}: the harmless render`).to.equal(true);
      bad = true;
      let message = '';
      try {
        el.connectedCallback();
      } catch (error) {
        message = String(error?.message);
      }
      expect(/tier-hole-position\)?$/.test(message), `${what}: refused, coded (${message.slice(-40)})`).to.equal(true);
      el.remove();
    }
    const t = tag('svgcdata');
    define(t, () => () => html`<svg>${svg`<style><![CDATA[.a{--x:${'</style><b>x</b>'}}]]></style>`}${titleCdataIsText ? titleCdata() : null}</svg>`);
    const el = document.body.appendChild(document.createElement(t));
    expect(el.querySelector('svg style').textContent).to.equal('.a{--x:</style><b>x</b>}');
    if (titleCdataIsText) expect(el.querySelector('svg title').textContent, 'this engine: CDATA in <title> is text, filled as text').to.equal('<b>x</b>');
    expect(el.querySelector('b') === null).to.equal(true);
    el.remove();
  });

  /** The breakout, in the engine's parser: an HTML element written in svg content leaves it, and lite keeps it. */
  it(`${name}: an html element in svg content breaks out and is kept; svg and mathml namespaces are the engine's`, async () => {
    const t = tag('svgbreak');
    define({ tag: t, props: { v: 'a' } }, (host) => () => html`<svg>${svg`<g><circle r=${host.v}/></g>`}</svg><section>${svg`<g></g><div>${host.v}</div>`}</section><math>${mathml`<mi>${host.v}</mi>`}</math>`);
    const el = document.body.appendChild(document.createElement(t));
    expect(el.querySelector('circle').namespaceURI).to.equal('http://www.w3.org/2000/svg');
    expect(el.querySelector('circle').getAttribute('r'), 'no slash taken').to.equal('a');
    expect(el.querySelector('section > div')?.namespaceURI).to.equal('http://www.w3.org/1999/xhtml');
    expect(el.querySelector('mi').namespaceURI).to.equal('http://www.w3.org/1998/Math/MathML');
    const [circle, div] = [el.querySelector('circle'), el.querySelector('section > div')];
    el.v = 'b';
    await settle();
    expect(circle === el.querySelector('circle') && div === el.querySelector('section > div'), 'updated in place').to.equal(true);
    expect(circle.getAttribute('r') + div.textContent + el.querySelector('mi').textContent).to.equal('bbb');
    el.remove();
  });

  it(`${name}: a module signal redraws two readers once each`, async () => {
    const t = tag('sig');
    const shared = signal(1);
    let renders = 0;
    define(t, () => () => {
      renders++;
      return html`<b>${shared.value}</b>`;
    });
    const a = document.body.appendChild(document.createElement(t));
    const b = document.body.appendChild(document.createElement(t));
    expect(renders, 'CONTROL').to.equal(2);
    shared.value = 2;
    shared.value = 3;
    await settle();
    expect(renders).to.equal(4);
    expect(a.textContent + b.textContent).to.equal('33');
    a.remove();
    b.remove();
  });
}

/**
 * The same component source on each renderer: lite (dev and min) and core (development, its renderer wired). Each inserts
 * a nested template's nodes as written: no implied `<tbody>`, nothing fostered, and text in a table hole stays in the
 * table — pinned here, where the parser is a real one.
 */
const RENDERERS = { ...TIERS, core };
for (const [name, { define, html }] of Object.entries(RENDERERS)) {
  const tag = (what) => `table-${name.replace(' ', '-')}-${what}-${seq++}`;
  const mount = async (t) => {
    const el = document.body.appendChild(document.createElement(t));
    await settle();
    return el;
  };

  it(`${name}: rows in a table hole are inserted under the table, as written`, async () => {
    const t = tag('rows');
    define(t, () => () => html`<table>${[1, 2].map((n) => html` <tr><td>${n}</td></tr>`)}</table>`);
    const el = await mount(t);
    expect(el.querySelectorAll('tr').length, 'CONTROL: both rows rendered').to.equal(2);
    expect(el.querySelectorAll('table > tr').length).to.equal(2);
    expect(el.querySelectorAll('tbody').length).to.equal(0);
    el.remove();
  });

  it(`${name}: a nested <div> in a table hole stays in the table`, async () => {
    const t = tag('div');
    define(t, () => () => html`<table>${html`<div>d</div>`}</table>`);
    const el = await mount(t);
    const div = el.querySelector('div');
    expect(div?.textContent, 'CONTROL: the div rendered').to.equal('d');
    expect(div.parentElement === el.querySelector('table')).to.equal(true);
    el.remove();
  });

  it(`${name}: text in a table hole stays in the table, and a reordered hole keeps its value`, async () => {
    for (const [what, value] of Object.entries({ text: 'x', space: ' \n ' })) {
      const t = tag(`text-${what}`);
      define(t, () => () => html`<table>${value}</table>`);
      const el = await mount(t);
      expect(el.querySelector('table').textContent, what).to.equal(value);
      el.remove();
    }
    for (const [what, draw] of Object.entries({
      before: () => html`<table>${' '}<caption>${'cap'}</caption></table>`,
      after: () => html`<table><caption>${'cap'}</caption>${' '}</table>`,
    })) {
      const c = tag(`caption-${what}`);
      define(c, () => draw);
      const shown = await mount(c);
      expect(shown.querySelector('caption').textContent, what).to.equal('cap');
      shown.remove();
    }
  });
}

/**
 * **The placement fuzz's judge rests on namespaces, so the engines confirm them** (2026-11-17): it treats a foreign
 * `xmp` or `noscript` as an ordinary element (its content is text), and only `script` and `style` as code outside HTML.
 * That reading came from jsdom, whose parser was already wrong once about tables (BROWSER-LEDGER); here each engine must
 * place every element exactly where jsdom did.
 */
it('the engines place foreign xmp, style, title and noscript as jsdom does (the placement fuzz judge rests on it)', () => {
  const SVG = 'http://www.w3.org/2000/svg';
  const MATHML = 'http://www.w3.org/1998/Math/MathML';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const template = document.createElement('template');
  template.innerHTML = '<svg><xmp>a</xmp><style>b</style><title>c</title></svg><math><noscript>d</noscript><mi><title>e</title></mi></math>';
  const placed = [...template.content.querySelectorAll('*')].map((el) => `${el.localName} ${el.namespaceURI}`);
  expect(placed).to.deep.equal([
    `svg ${SVG}`, `xmp ${SVG}`, `style ${SVG}`, `title ${SVG}`,
    `math ${MATHML}`, `noscript ${MATHML}`, `mi ${MATHML}`, `title ${XHTML}`,
  ]);
});
