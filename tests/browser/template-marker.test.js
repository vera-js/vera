/**
 * **The renderer's template marker, as the engines parse it.**
 *
 * The renderer finds a template's holes by writing a marker into the one string it parses per template: into an
 * attribute NAME (`0<marker>`), a bogus comment (`<?<marker>0>`) and raw text (`<marker>0<marker>`). The marker is
 * U+FFFF — a noncharacter, which real text never contains, so no author static can collide with it. The HTML
 * preprocessor flags a noncharacter as a parse error and KEEPS it (only NUL and newlines are rewritten), which is
 * the rule this checks in each engine, position by position — jsdom agreeing is not evidence.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html, svg, mathml } from '../../packages/core/dist/development/vera.js';

const M = '\uFFFF';

describe('U+FFFF survives the parser in every marker position', () => {
  it('in an attribute name, a bogus comment and raw text', () => {
    const template = document.createElement('template');
    template.innerHTML = `<a 0${M}="x${M}y">t<?${M}1>u</a><style>${M}2${M}</style>`;
    const a = template.content.firstChild;
    expect(a.getAttributeNames()).to.deep.equal([`0${M}`]);
    expect(a.getAttribute(`0${M}`)).to.equal(`x${M}y`);
    const comment = [...a.childNodes].find((n) => n.nodeType === 8);
    expect(comment.data).to.equal(`?${M}1`);
    expect(template.content.lastChild.textContent).to.equal(`${M}2${M}`);
  });
});

/** Foreign content has its own tree-building rules; the TOKENIZER is the same on paper — checked, not assumed. */
describe('and inside foreign content', () => {
  for (const [root, child] of [['svg', 'g'], ['math', 'mi']]) {
    it(`inside <${root}>: an attribute name and a bogus comment`, () => {
      const template = document.createElement('template');
      template.innerHTML = `<${root}><${child} 0${M}="x${M}y">t<?${M}1>u</${child}></${root}>`;
      const el = template.content.firstChild.firstChild;
      expect(el.getAttributeNames()).to.deep.equal([`0${M}`]);
      expect(el.getAttribute(`0${M}`)).to.equal(`x${M}y`);
      expect([...el.childNodes].find((n) => n.nodeType === 8).data).to.equal(`?${M}1`);
    });
  }
  it('through the svg`` and mathml`` tags, with no marker left behind', () => {
    const s = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    renderInto(svg`<g class=${'c'} data-x="a${'b'}">${'t'}</g>`, s);
    const g = s.querySelector('g');
    expect(g.namespaceURI).to.equal('http://www.w3.org/2000/svg');
    expect(g.getAttribute('class')).to.equal('c');
    expect(g.getAttribute('data-x')).to.equal('ab');
    expect(g.textContent).to.equal('t');
    const m = document.body.appendChild(document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math'));
    renderInto(mathml`<mi class=${'c'}>${'x'}</mi>`, m);
    expect(m.querySelector('mi').getAttribute('class')).to.equal('c');
    expect(m.querySelector('mi').textContent).to.equal('x');
    expect(s.outerHTML.includes(M) || m.outerHTML.includes(M)).to.equal(false);
    s.remove();
    m.remove();
  });
});

describe('the renderer, through every binding position', () => {
  it('renders child, attribute, multi-part, raw-text and element positions with no marker left behind', () => {
    const host = document.body.appendChild(document.createElement('div'));
    let seen = null;
    renderInto(
      html`<p class=${'c'} title="a${'b'}c" ${(el) => (seen = el)}>${'text'}<i>${'sole'}</i></p><style>${'.x{}'}</style>`,
      host
    );
    const p = host.querySelector('p');
    expect(p.getAttribute('class')).to.equal('c');
    expect(p.getAttribute('title')).to.equal('abc');
    expect(p.textContent).to.equal('textsole');
    expect(host.querySelector('style').textContent).to.equal('.x{}');
    expect(seen).to.equal(p);
    expect(host.innerHTML.includes(M)).to.equal(false);
    host.remove();
  });
});
