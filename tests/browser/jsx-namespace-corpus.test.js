/**
 * The namespace corpus on real engines: every group a component can be handed, compiled by
 * `@verajs/jsx`, rendered through a component, and compared with what THIS engine's parser builds
 * from the same markup written inline. `tests/jsx-namespace-corpus.test.mjs` is the same claim under
 * jsdom, whose parser is parse5; this is the half where the engines are the oracle — and they are
 * not interchangeable here: Firefox and Chromium already disagree about `annotation-xml` as a
 * fragment parser's context, which is why `@verajs/jsx/namespaces` reads its `encoding` instead.
 *
 * Everything is imported by PACKAGE NAME. The namespace module wires itself through
 * `@verajs/core`, so the test must hold the same core it does — a relative import of a dist file
 * resolves to a second copy, and the module's hook lands in a registry this renderer never reads.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire } from '@verajs/core';
import { renderer, renderInto } from '@verajs/renderer';
import { transformJsx } from '@verajs/jsx';
import '@verajs/jsx/namespaces';

wire([renderer]);

const NAMES = ['path', 'circle', 'g', 'use', 'text', 'tspan', 'title', 'desc', 'a', 'style', 'image',
  'filter', 'symbol', 'clipPath', 'linearGradient', 'foreignObject', 'textPath', 'b', 'div', 'my-badge'];
const WRAPPERS = {
  Frame: ['const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;', (m) => `<svg viewBox="0 0 24 24">${m}</svg>`],
  Box: ['const Box = ({ children }) => <div class="box">{children}</div>;', (m) => `<div class="box">${m}</div>`],
  MathBox: ['const MathBox = ({ children }) => <math>{children}</math>;', (m) => `<math>${m}</math>`],
  Island: ['const Island = ({ children }) => <svg><foreignObject>{children}</foreignObject></svg>;', (m) => `<svg><foreignObject>${m}</foreignObject></svg>`],
  Label: ['const Label = ({ children }) => <svg><title>{children}</title></svg>;', (m) => `<svg><title>${m}</title></svg>`],
};
const shape = (root) => [...root.querySelectorAll('*')].map((e) => `${e.localName}:${e.namespaceURI.split('/').pop()}`).join(' ');

/** The parser decides which names break out of foreign content; those groups are broken markup in
 *  both spellings and are compared in jsdom only, where the development warning is asserted. */
const breaksOut = (name) => {
  const probe = document.createElement('div');
  probe.innerHTML = `<svg><${name}></${name}><g></g></svg>`;
  return probe.querySelector('svg > g') === null;
};

const groups = (wrapper) => {
  const out = [];
  const el = (n) => `<${n}>x</${n}>`;
  const foreign = wrapper === 'Frame' || wrapper === 'MathBox';
  for (const a of NAMES) {
    out.push([`<${a}> alone`, el(a), el(a)]);
    out.push([`<${a}> in a fragment`, `<>${el(a)}</>`, el(a)]);
    out.push([`<${a}> mapped`, `{[1, 2].map(() => ${el(a)})}`, el(a) + el(a)]);
    for (const b of ['path', 'text', 'div', 'clipPath']) {
      if (!(foreign && breaksOut(a))) out.push([`<${a}> + <${b}>`, el(a) + el(b), el(a) + el(b)]);
      out.push([`<${a}> holding <${b}>`, `<${a}>${el(b)}</${a}>`, `<${a}>${el(b)}</${a}>`]);
    }
  }
  return out;
};

it('every group renders what this engine parses from the same markup written inline', async () => {
  const bad = [];
  let compared = 0;
  for (const [wrapper, [source, inline]] of Object.entries(WRAPPERS)) {
    const rows = groups(wrapper);
    const js = transformJsx(
      `${source}\nexport const views = [${rows.map(([, jsx]) => `() => <${wrapper}>${jsx}</${wrapper}>`).join(',\n')}];`,
      `${wrapper}.jsx`,
      { inject: false }
    );
    /** The module the transform would inject is already wired above; `html` comes from the one core. */
    const url = URL.createObjectURL(new Blob([`const { html } = globalThis.__nsCorpus;\n${js}`], { type: 'text/javascript' }));
    globalThis.__nsCorpus = { html };
    const { views } = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);
    rows.forEach(([label, , markup], i) => {
      const rendered = document.createElement('div');
      renderInto(views[i](), rendered);
      const parsed = document.createElement('div');
      parsed.innerHTML = inline(markup);
      compared++;
      if (shape(rendered) !== shape(parsed)) bad.push(`${label} in ${wrapper}\n    rendered ${shape(rendered)}\n    parsed   ${shape(parsed)}`);
    });
  }
  expect(compared, 'the corpus reached every wrapper').to.be.greaterThan(1000);
  expect(bad, `${bad.length} of ${compared} diverged:\n  ${bad.slice(0, 12).join('\n  ')}`).to.deep.equal([]);
});

it('CONTROL: the namespace module is active in this page', () => {
  /** A hand-written html`` shape committed into an <svg> through the same renderer. If this came out
   *  HTML the module never reached the renderer's registry, and the corpus above would be comparing
   *  a renderer that never resolves anything — which the Box rows would still pass. */
  const host = document.createElement('div');
  renderInto(html`<svg>${html`<path d="M0"></path>`}</svg>`, host);
  expect(host.querySelector('path').namespaceURI).to.equal('http://www.w3.org/2000/svg');
});
