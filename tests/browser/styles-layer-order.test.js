/**
 * **A light component's defaults in `@layer vera` in the document, placed by the page's own order statement**
 * (2026-11-26), read from computed style in real engines. The breaking rule: an unlayered author rule beats a default at
 * EQUAL specificity (the scoped default used to win by proximity, `scope-proximity.test.js`). The order: with
 * `@layer theme, base, vera, components, utilities;` first in the page's CSS, a default beats a `base` rule and a
 * `utilities` class beats the default; CONTROL: without it `vera` is declared last, by our adopted sheet, and the utility
 * loses. Nothing is inserted to place it, so a strict CSP refuses nothing of ours; development names a page that holds
 * layers and does not place `vera`. A shadow root is as before: the block alone, unlayered.
 *
 * The development rows each run in a page of their own (an iframe that loads the framework itself): the warning is said
 * once per page, so a row sharing another's modules could find it already spent, and a planted fault would turn a row
 * red that it never touched.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, define } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { styles, css } from '../../packages/styles/dist/development/vera-styles.js';

wire([renderer, styles]);

const DEFAULT = 'rgb(200, 0, 0)';
const AUTHOR = 'rgb(0, 0, 200)';
const BASE = 'rgb(0, 120, 0)';
const UTILITY = 'rgb(90, 0, 90)';
const ORDER = '@layer theme, base, vera, components, utilities;';
/** Tailwind v4's shape: the layer names declared, a preflight-like `base` rule and a utility, both on our part. */
const TAILWIND = `@layer theme, base, components, utilities; @layer base { b { color: ${BASE}; } } @layer utilities { .u { color: ${UTILITY}; } }`;
let classes = 0;
/** A light class of its own (a class hoists once per document), its part `<b class="mark">`. */
const lightClass = () => {
  const tag = `x-lo-${++classes}`;
  define({ tag, styles: css`.mark { color: rgb(200, 0, 0); }` }, () => () => html`<b class="mark">x</b>`);
  return tag;
};
const frame = (win = window) => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const sheet = (text, win = window) => {
  const s = new win.CSSStyleSheet();
  s.replaceSync(text);
  return s;
};
const color = (el) => el.ownerDocument.defaultView.getComputedStyle(el).color;
/** A light component of a new class in `container`, its part given `classes`; returns the part once rendered. */
const part = async (container, classes = '', tag = lightClass()) => {
  const light = (container.ownerDocument ?? container).createElement(tag);
  container.append(light);
  await frame(light.ownerDocument.defaultView);
  const b = light.querySelector('.mark');
  if (classes) b.className = `mark ${classes}`;
  return b;
};
const dist = (path) => new URL(`../../packages/${path}`, import.meta.url).href;
/**
 * An iframe whose page carries `head` and loads the framework itself, and the warnings said while a light component
 * renders in it. A module map belongs to one window, so each page has its own copy of every module and its own
 * once-per-page warning: no row's warning is spent by another row.
 */
const framed = async (head) => {
  const f = document.createElement('iframe');
  f.srcdoc = `<!doctype html><html><head>${head}</head><body></body></html>`;
  document.body.append(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const win = f.contentWindow;
  const warned = [];
  win.console.warn = (...args) => warned.push(args.join(' '));
  const script = f.contentDocument.createElement('script');
  /** A module that fails to load fires `error` on its script and never says ready: the row reads `ran: false`, not 0 warnings. */
  const ready = new Promise((r) => {
    win.addEventListener('lo-ready', () => r(true), { once: true });
    script.addEventListener('error', () => r(false), { once: true });
  });
  script.type = 'module';
  script.textContent = `import { html, wire, define } from '${dist('core/dist/development/vera.js')}';
import { renderer } from '${dist('renderer/dist/development/vera-renderer.js')}';
import { styles, css } from '${dist('styles/dist/development/vera-styles.js')}';
wire([renderer, styles]);
define({ tag: 'x-lo-framed', styles: css\`.mark { color: rgb(200, 0, 0); }\` }, () => () => html\`<b class="mark">x</b>\`);
document.body.append(document.createElement('x-lo-framed'));
dispatchEvent(new Event('lo-ready'));`;
  f.contentDocument.head.append(script);
  const loaded = await ready;
  if (loaded) await frame(win);
  const b = f.contentDocument.querySelector('x-lo-framed .mark');
  /** CONTROL for every quiet row: this page's own modules ran (the class is defined in its registry) and rendered the part. */
  const ran = loaded && win.customElements.get('x-lo-framed') !== undefined && b !== null;
  return { f, doc: f.contentDocument, b, ran, said: warned.filter((w) => w.includes('layer-order')) };
};

describe('styles: development names a layered page that does not place vera', () => {
  it('quiet on a page with no layered CSS, and on a strict-CSP page nothing of ours is refused', async () => {
    const { f, doc, b, ran, said } = await framed(`<meta http-equiv="Content-Security-Policy" content="style-src 'self'"><style>p { margin: 0; }</style>`);
    expect(ran, "CONTROL: the page's own modules ran and rendered").to.equal(true);
    const read = { said: said.length, ours: doc.head.querySelectorAll('[data-vm-sheet]').length, styled: color(b) };
    f.remove();
    expect(read).to.deep.equal({ said: 0, ours: 0, styled: DEFAULT });
  });

  it('quiet on a layered page that states the order first', async () => {
    const { f, b, ran, said } = await framed(`<style>${ORDER} ${TAILWIND}</style>`);
    expect(ran, "CONTROL: the page's own modules ran and rendered").to.equal(true);
    const read = { said: said.length, styled: color(b) };
    f.remove();
    expect(read).to.deep.equal({ said: 0, styled: DEFAULT });
  });

  it('a layered page without it: development says layer-order, once, with the line to add', async () => {
    const { f, b, ran, said } = await framed(`<style>${TAILWIND}</style>`);
    expect(ran, "CONTROL: the page's own modules ran and rendered").to.equal(true);
    const styled = color(b);
    f.remove();
    expect(said.length, said.join('\n')).to.equal(1);
    expect(said[0].startsWith('[vera]') && said[0].includes(ORDER), said[0]).to.equal(true);
    expect(styled, 'CONTROL: the default applies there').to.equal(DEFAULT);
  });
});

describe('styles: @layer vera in the document', () => {
  it('CONTROL: the engine has cascade layers; the block is adopted, a @layer vera block, and <head> gets nothing of ours', async () => {
    const b = await part(document.body);
    const adopted = [...document.adoptedStyleSheets].pop();
    const first = adopted.cssRules[0];
    expect(typeof CSSLayerBlockRule === 'function').to.equal(true);
    expect([first instanceof CSSLayerBlockRule, first.name, first.cssRules[0] instanceof CSSScopeRule]).to.deep.equal([true, 'vera', true]);
    expect(document.head.querySelectorAll('[data-vm-sheet]').length).to.equal(0);
    expect(color(b), 'the default applies').to.equal(DEFAULT);
    b.parentElement.remove();
  });

  it('an unlayered author rule beats the default at equal specificity (the breaking rule)', async () => {
    const author = sheet(`.mark { color: ${AUTHOR}; }`);
    document.adoptedStyleSheets = [author, ...document.adoptedStyleSheets];
    const b = await part(document.body);
    const won = color(b);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== author);
    const without = color(b);
    b.parentElement.remove();
    expect({ won, without }).to.deep.equal({ won: AUTHOR, without: DEFAULT });
  });

  it("with the order stated first, the default beats base and a utility beats the default; CONTROL: without it the utility loses", async () => {
    const page = document.createElement('style');
    page.textContent = `${ORDER} ${TAILWIND}`;
    document.head.append(page);
    const plain = await part(document.body);
    const utility = await part(document.body, 'u');
    const read = { plain: color(plain), utility: color(utility) };
    page.textContent = TAILWIND;
    const lost = color(utility);
    page.remove();
    plain.parentElement.remove();
    utility.parentElement.remove();
    expect({ ...read, lost }).to.deep.equal({ plain: DEFAULT, utility: UTILITY, lost: DEFAULT });
  });
});

describe('styles: a shadow root is as before', () => {
  it("the root's block is the block alone, unlayered: the root's own layered utility does not beat it, as before", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet(TAILWIND)];
    const b = await part(root, 'u');
    const block = [...root.adoptedStyleSheets].pop().cssRules[0];
    const read = { scope: block instanceof CSSScopeRule, count: root.adoptedStyleSheets.length, styled: color(b) };
    host.remove();
    expect(read).to.deep.equal({ scope: true, count: 2, styled: DEFAULT });
  });
});
