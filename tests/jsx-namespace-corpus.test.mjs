/**
 * Every sibling group a component can be handed, compiled, RENDERED, and compared with what the
 * platform's own parser builds from the same markup written inline.
 *
 * **The oracle is the parser, not a list.** The namespace of content handed to a component is decided
 * by the position it is committed into — the renderer parses a template in the namespace of its
 * part, exactly as the fragment parser takes a context element. So the only correct answer for
 * `<Frame><text>L</text></Frame>` is whatever `<svg><text>L</text></svg>` parses to, and the test
 * asks exactly that: for every group and every wrapper, the rendered element tree (local name and
 * namespace, in document order) must equal the parsed one. Nothing here restates a rule the code
 * also states, so there is nothing to drift.
 *
 * jsdom's parser is parse5, which implements foreign content to the letter; the three-engine half of
 * the claim is `tests/browser/svg-namespace.test.js`.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'SVGElement'])
  globalThis[key] = dom.window[key];
const { transformJsx } = await load('jsx');
const { renderInto, renderer } = await load('renderer');
const { wire } = await load('core');
/** Wired as an app wires it: the namespace module plugs in through core's registry, which the
 *  renderer only reads once it has been handed it. */
wire([renderer]);

/** SVG names — self-proving, shared with HTML, camelCase — plus HTML and a custom element. */
const NAMES = ['path', 'circle', 'g', 'use', 'text', 'tspan', 'title', 'desc', 'a', 'style', 'image',
  'filter', 'symbol', 'clipPath', 'linearGradient', 'foreignObject', 'textPath', 'b', 'div', 'my-badge'];
/** Where a component puts its children, and the inline markup that is the same thing written directly. */
const WRAPPERS = {
  Frame: ['const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;', (m) => `<svg viewBox="0 0 24 24">${m}</svg>`],
  Box: ['const Box = ({ children }) => <div class="box">{children}</div>;', (m) => `<div class="box">${m}</div>`],
  MathBox: ['const MathBox = ({ children }) => <math>{children}</math>;', (m) => `<math>${m}</math>`],
  Island: ['const Island = ({ children }) => <svg><foreignObject>{children}</foreignObject></svg>;', (m) => `<svg><foreignObject>${m}</foreignObject></svg>`],
  Label: ['const Label = ({ children }) => <svg><title>{children}</title></svg>;', (m) => `<svg><title>${m}</title></svg>`],
};
const PRELUDE = Object.values(WRAPPERS).map(([source]) => source).join('\n');

/**
 * Whether the parser BREAKS OUT of foreign content at this name — `<svg><b>` closes the `<svg>` and
 * everything after it lands outside as HTML. Asked of the parser, like everything else here. Such a
 * group is broken markup in both spellings (HTML inside SVG draws nothing either way), so the two
 * cannot be expected to agree: the separate templates of a component's children do not cascade the
 * breakout onto the siblings after it. What IS owed there is the development warning naming it.
 */
const breaksOut = (name) => {
  const probe = dom.window.document.createElement('div');
  probe.innerHTML = `<svg><${name}></${name}><g></g></svg>`;
  return probe.querySelector('svg > g') === null;
};

/** An element's tree as `name:namespace`, in document order — the thing both sides must agree on. */
const shape = (root) => [...root.querySelectorAll('*')].map((e) => `${e.localName}:${e.namespaceURI.split('/').pop()}`).join(' ');

test('every group renders exactly what the parser builds from the same markup written inline', async () => {
  const silence = console.warn;
  /** The whole run's warnings: the diagnostic is deduplicated for the life of the module, so a name
   *  an earlier group already spent is silent in every later one — ask the run, never one render. */
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.ns-corpus-'));
  let n = 0;
  let compared = 0;
  const bad = [];
  let brokeOut = 0;
  const check = async (label, wrapper, jsx, markup, breakout = null) => {
    const [, inline] = WRAPPERS[wrapper];
    const f = join(dir, `m${n++}.mjs`);
    writeFileSync(f, transformJsx(`${PRELUDE}\nexport const view = () => <${wrapper}>${jsx}</${wrapper}>;`, 'ns.jsx', { inject: true }));
    const { view } = await import(pathToFileURL(f).href);
    const rendered = dom.window.document.createElement('div');
    renderInto(view(), rendered);
    if (breakout !== null) {
      brokeOut++;
      const host = wrapper === 'Frame' ? '<svg>' : '<math>';
      if (!warnings.some((w) => w.includes(`<${breakout}>`) && w.includes(host)))
        bad.push(`${label} in ${wrapper}: the parser breaks out at <${breakout}>, and nothing named it`);
      return;
    }
    const parsed = dom.window.document.createElement('div');
    parsed.innerHTML = inline(markup);
    compared++;
    if (shape(rendered) !== shape(parsed)) bad.push(`${label} in ${wrapper}\n      rendered ${shape(rendered)}\n      parsed   ${shape(parsed)}`);
  };
  /** Closing tags written out, because `<path/>` self-closes only in foreign content — the inline
   *  markup must mean the same thing in every wrapper, or the oracle is comparing two sources. */
  const el = (name, inner = 'x') => [`<${name}>${inner}</${name}>`, `<${name}>${inner}</${name}>`];
  for (const wrapper of Object.keys(WRAPPERS)) {
    for (const a of NAMES) {
      const [ja, ma] = el(a);
      await check(`<${a}> alone`, wrapper, ja, ma);
      await check(`<${a}> in a fragment`, wrapper, `<>${ja}</>`, ma);
      await check(`<${a}> mapped`, wrapper, `{[1, 2].map(() => ${ja})}`, ma + ma);
      const foreign = wrapper === 'Frame' || wrapper === 'MathBox';
      for (const b of ['path', 'text', 'div', 'clipPath']) {
        const [jb, mb] = el(b);
        await check(`<${a}> + <${b}>`, wrapper, ja + jb, ma + mb, foreign && breaksOut(a) ? a : null);
        await check(`<${a}> holding <${b}>`, wrapper, `<${a}>${jb}</${a}>`, `<${a}>${mb}</${a}>`);
      }
    }
  }
  console.warn = silence;
  /** The controls: the corpus measured something in every wrapper, and reached the breakout case. */
  assert.ok(brokeOut > 0, 'no group reached a breakout name, so the warning half measured nothing');
  assert.ok(compared + brokeOut >= Object.keys(WRAPPERS).length * NAMES.length * 11, `only ${compared + brokeOut} groups reached`);
  assert.deepEqual(bad, [], `${bad.length} of ${compared} groups diverged from the parser:\n  ${bad.slice(0, 25).join('\n  ')}`);
  console.log(`namespace corpus: ${compared} groups identical to the parser's own build, ${brokeOut} breakouts named`);
});
