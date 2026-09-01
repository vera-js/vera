import { expect } from '@esm-bundle/chai';
import { init, createStore, render, wire, css, html} from '../../packages/core/dist/development/vera.js';
import { renderInto as renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { adoptStyles, applyStyles } from '../../packages/styles/dist/development/vera-styles.js';

/**
 * `@verajs/styles`, in an engine that actually implements the platform it targets.
 *
 * Under jsdom this package sat at 60% branches and had **never executed its primary path**: there
 * is no `adoptedStyleSheets`, no `CSSStyleSheet.replaceSync` and no `CSSScopeRule` there, so every
 * jsdom test fell through to the `<style>` fallback. Everything below is the code that actually
 * runs for a user, tested for the first time.
 */

wire({ on: 'render', fn: renderer, priority: 50 });
wire({ on: 'init', fn: adoptStyles, priority: 50 });

let seq = 0;
const define = (body, options) => {
  const tag = `x-style-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static styles = options;
    connectedCallback() {
      init(this, body.shadow === false ? undefined : { mode: 'open' });
      const state = createStore({ n: 0 });
      render(() => body.template(state));
    }
  });
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
};

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

it('the platform features jsdom lacks are actually here', () => {
  expect('adoptedStyleSheets' in document, 'document.adoptedStyleSheets').to.be.true;
  expect(typeof CSSStyleSheet.prototype.replaceSync, 'replaceSync').to.equal('function');
});

it('a constructed stylesheet is adopted into the shadow root, not injected as <style>', async () => {
  const sheet = css`p { color: rgb(0, 128, 0); }`;
  const el = define({ template: (state) => html`<p>${state.n}</p>` }, sheet);
  await frame();

  const root = el.shadowRoot;
  expect(root.adoptedStyleSheets.length, 'a sheet was adopted').to.equal(1);
  expect(root.adoptedStyleSheets[0]).to.equal(sheet.styleSheet);
  expect(root.querySelector('style[vera-styles]'), 'no <style> fallback was used').to.equal(null);
  el.remove();
});

it('adopted styles actually apply to the rendered DOM', async () => {
  const sheet = css`p { color: rgb(0, 128, 0); }`;
  const el = define({ template: (state) => html`<p>styled ${state.n}</p>` }, sheet);
  await frame();
  const p = el.shadowRoot.querySelector('p');
  /** The point of the whole package: the rule reaches the element. jsdom cannot answer this. */
  expect(getComputedStyle(p).color).to.equal('rgb(0, 128, 0)');
  el.remove();
});

it('re-adopting does not accumulate sheets', async () => {
  const sheet = css`p { color: red; }`;
  const el = define({ template: (state) => html`<p>${state.n}</p>` }, sheet);
  await frame();
  adoptStyles(el);
  adoptStyles(el);
  expect(el.shadowRoot.adoptedStyleSheets.length).to.equal(1);
  el.remove();
});

it('light-DOM styles hoist to the document, scoped to the tag', async () => {
  const before = document.adoptedStyleSheets.length;
  const sheet = css`em { color: rgb(0, 0, 255); }`;
  const el = define({ shadow: false, template: (state) => html`<em>${state.n}</em>` }, sheet);
  await frame();

  expect(document.adoptedStyleSheets.length, 'hoisted to the document').to.equal(before + 1);
  expect(el.querySelector('style'), 'nothing injected inside the element').to.equal(null);

  const text = [...document.adoptedStyleSheets.at(-1).cssRules].map((r) => r.cssText).join('');
  if (typeof CSSScopeRule === 'function') {
    expect(text, 'wrapped in @scope so it cannot leak').to.contain('@scope');
    expect(text).to.contain(el.localName);
  }
  el.remove();
});

it('@scope actually confines light-DOM styles to the component subtree', async function () {
  if (typeof CSSScopeRule !== 'function') this.skip();
  const sheet = css`b { color: rgb(255, 0, 0); }`;
  const el = define({ shadow: false, template: (state) => html`<b>inside ${state.n}</b>` }, sheet);
  await frame();

  const outside = document.createElement('b');
  outside.textContent = 'outside';
  document.body.appendChild(outside);

  expect(getComputedStyle(el.querySelector('b')).color, 'applies inside').to.equal('rgb(255, 0, 0)');
  expect(getComputedStyle(outside).color, 'does NOT leak outside').to.not.equal('rgb(255, 0, 0)');
  el.remove();
  outside.remove();
});

/**
 * **Two components, and neither one's rules reach the other.**
 *
 * The suite above proves a class's styles stay inside *its own* subtree and out of the page. That
 * leaves the case a single component cannot show: whether the `@scope` block is keyed to the tag that
 * hoisted it, or merely to *a* tag.
 *
 * A jsdom fuzz over 30 generated classes could not answer this — there is no `@scope` there at all,
 * so the whole scoped branch falls through to the unscoped fallback and a mutation rewriting
 * `@scope (${element.localName})` to `@scope (div)` survived it completely. This is where that
 * mutation dies.
 *
 * Two colours rather than one, checked in both directions, because "A is red" and "B is not red" can
 * both hold while B's rules are missing entirely.
 */
it('one component\'s light-DOM styles do not reach another component', async function () {
  if (typeof CSSScopeRule !== 'function') this.skip();

  const red = define({ shadow: false, template: () => html`<b>red side</b>` }, css`b { color: rgb(255, 0, 0); }`);
  const blue = define({ shadow: false, template: () => html`<b>blue side</b>` }, css`b { color: rgb(0, 0, 255); }`);
  await frame();

  try {
    expect(getComputedStyle(red.querySelector('b')).color, 'the first component lost its own styles').to.equal('rgb(255, 0, 0)');
    expect(getComputedStyle(blue.querySelector('b')).color, 'the second component lost its own styles').to.equal('rgb(0, 0, 255)');

    /** The direction a shared or mis-keyed scope would break: each must reject the other's rule. */
    expect(getComputedStyle(red.querySelector('b')).color, "the first component picked up the second's colour").to.not.equal('rgb(0, 0, 255)');
    expect(getComputedStyle(blue.querySelector('b')).color, "the second component picked up the first's colour").to.not.equal('rgb(255, 0, 0)');

    /** And a plain `<b>` outside both stays untouched by either. */
    const outsider = document.createElement('b');
    document.body.appendChild(outsider);
    const outsideColour = getComputedStyle(outsider).color;
    expect(outsideColour, 'a rule escaped to the page').to.not.equal('rgb(255, 0, 0)');
    expect(outsideColour, 'a rule escaped to the page').to.not.equal('rgb(0, 0, 255)');
    outsider.remove();
  } finally {
    red.remove();
    blue.remove();
  }
});

it('applyStyles falls back to a <style> element for a plain string', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.attachShadow({ mode: 'open' });
  applyStyles('i { color: rgb(128, 0, 128); }', el);
  const style = el.shadowRoot.querySelector('style[vera-styles]');
  expect(style, 'string styles use the <style> path even in a modern browser').to.not.equal(null);
  el.shadowRoot.innerHTML += '<i>x</i>';
  expect(getComputedStyle(el.shadowRoot.querySelector('i')).color).to.equal('rgb(128, 0, 128)');
  el.remove();
});

it('escaped CSS renders identically to the unescaped original', () => {
  /**
   * `@verajs/styles` rewrites `</style` to `<\/style` before it reaches a `<style>` element, so a
   * value interpolated into `css` cannot poison the DOM's serialization. That is only acceptable if
   * the escape is invisible to the CSS parser — `\/` is a valid escape for `/`, and this asserts the
   * engine agrees rather than taking the spec's word for it.
   */
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('.a::after { content: "a<\\/style>b" }');
  const plain = new CSSStyleSheet();
  plain.replaceSync('.a::after { content: "a</style>b" }');

  const host = document.createElement('div');
  document.body.appendChild(host);
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.adoptedStyleSheets = [sheet];
  host.shadowRoot.innerHTML = '<span class="a"></span>';

  const rendered = getComputedStyle(host.shadowRoot.querySelector('.a'), '::after').content;
  expect(rendered).to.contain('a</style>b', 'the escape is transparent to the CSS parser');
  expect(sheet.cssRules[0].style.content).to.equal(plain.cssRules[0].style.content,
    'and produces the same declared value as the unescaped form');
});

/* ── an array of styles is a set, not a first-one-wins ───────────────────────────────────────── */
/**
 * `static styles` accepts an array, and the array may mix constructed sheets with plain strings —
 * `@verajs/ssr` serializes every one of those forms (`tests/ssr-style-shapes.test.mjs`), so a
 * component written that way renders correctly on the server and had to render correctly here.
 *
 * Two things went wrong on the string side, both invisible to a single-style test:
 *
 * - a `<style vera-styles>` was created only when none existed, and every later string in the same
 *   array then found the one the first had just created and was dropped;
 * - the element was removed whenever any constructed sheet was adopted, on the reasoning that it
 *   must be the server's redundant copy of that sheet — which is true only when *every* style is a
 *   sheet. In a mixed array it deleted CSS that had no other home.
 *
 * Asserted through the shadow root's own contents rather than through computed style, because what
 * is being tested is which rules reached the root at all.
 */
const styleText = (element) => element.shadowRoot.querySelector('style[vera-styles]')?.textContent ?? null;

const sheetFor = (cssText) => {
  const styleSheet = new CSSStyleSheet();
  styleSheet.replaceSync(cssText);
  return { styleSheet, cssText };
};

it('keeps every string in an array of styles', async () => {
  const element = define({ template: () => html`<p>x</p>` }, ['.a { color: red }', '.b { color: blue }']);
  await frame();
  const text = styleText(element);
  expect(text, 'the first string').to.contain('.a');
  expect(text, 'the second string, which used to be dropped').to.contain('.b');
});

it('keeps a string alongside a constructed sheet, in either order', async () => {
  for (const styles of [
    [sheetFor('.sheet { color: red }'), '.text { color: blue }'],
    ['.text { color: blue }', sheetFor('.sheet { color: red }')],
  ]) {
    const element = define({ template: () => html`<p>x</p>` }, styles);
    await frame();
    expect(element.shadowRoot.adoptedStyleSheets.length, 'the sheet is adopted').to.equal(1);
    expect(styleText(element), 'the string survives the sheet being adopted').to.contain('.text');
  }
});

it('still drops a server-rendered copy when every style is a sheet', async () => {
  const element = define({ template: () => html`<p>x</p>` }, [sheetFor('.only { color: red }')]);
  /** What the server writes: markup cannot carry a constructed sheet, so it serializes one. */
  const server = document.createElement('style');
  server.setAttribute('vera-styles', '');
  server.textContent = '.only { color: red }';
  element.shadowRoot.appendChild(server);

  applyStyles(element.constructor.styles, element);
  await frame();
  expect(element.shadowRoot.adoptedStyleSheets.length, 'adopted').to.equal(1);
  expect(styleText(element), 'the redundant server copy is gone').to.equal(null);
});

it('repairs a server-rendered copy rather than duplicating it', async () => {
  const element = define({ template: () => html`<p>x</p>` }, ['.text { color: blue }']);
  await frame();
  applyStyles(element.constructor.styles, element);
  await frame();
  expect(element.shadowRoot.querySelectorAll('style[vera-styles]').length, 'exactly one').to.equal(1);
  expect(styleText(element)).to.contain('.text');
});

/* ── the cascade agrees between the server's markup and a client render ──────────────────────── */
/**
 * The one way SSR and CSR can disagree while every comparison passes.
 *
 * `static styles = [sheet, '.probe { … }']` reaches a shadow root by two different mechanisms in a
 * browser: the sheet is adopted, the string becomes a `<style>` — and `adoptedStyleSheets` apply
 * **after** the root's own tree-order sheets, so the adopted rule wins whatever the markup order.
 * Server-side both are `<style>` elements, where the cascade is document order and the last one
 * wins. Emitting the sheet first inverted it.
 *
 * Nothing structural differs when that happens: same markup shape, same nodes, same properties. The
 * page simply changes colour as it hydrates. So the assertion is on the resolved style, and it is
 * made against the server's real emission order rather than a hand-picked one.
 */
describe('a mixed styles array cascades the same way on both sides', () => {
  const RED = 'rgb(255, 0, 0)';
  const BLUE = 'rgb(0, 0, 255)';

  /** What `@verajs/ssr` writes for `[sheet(.probe red), '.probe blue']` — string first, sheet last. */
  const SERVER = `<style vera-styles>.probe { color: ${BLUE} }</style><style vera-styles>.probe { color: ${RED} }</style><p class="probe">x</p>`;

  it('the client resolves the adopted sheet as the winner', async () => {
    const element = define({ template: () => html`<p class="probe">x</p>` }, [
      sheetFor(`.probe { color: ${RED} }`),
      `.probe { color: ${BLUE} }`,
    ]);
    await frame();
    const probe = element.shadowRoot.querySelector('.probe');
    expect(getComputedStyle(probe).color, 'an adopted sheet outranks a <style> in the same root').to.equal(RED);
  });

  it('and the server markup resolves to the same winner', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' }).innerHTML = SERVER;
    const probe = host.shadowRoot.querySelector('.probe');
    expect(getComputedStyle(probe).color, 'the page would change colour as it hydrates').to.equal(RED);
  });
});
