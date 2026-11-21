/**
 * **Which wins at equal specificity: an unscoped author rule, or a light component's `@scope (tag)` default?**
 * (2026-11-21), the engine fact `@verajs/styles`' sheet order rests on. The cascade compares specificity, then scope
 * proximity, then order; an unscoped declaration counts as infinitely far, so the scoped default is expected to win
 * in EITHER sheet order, in a shadow root and in the document alike. If proximity decides, the order of our sheet
 * after a root's own (the document's order: adopted sheets come after the page's) changes nothing for this case. Each
 * reading has a control that both sheets apply: a higher-specificity author rule beats the default.
 */
import { expect } from '@esm-bundle/chai';

const SCOPED = 'rgb(200, 0, 0)';
const AUTHOR = 'rgb(0, 0, 200)';
const sheet = (text) => {
  const s = new CSSStyleSheet();
  s.replaceSync(text);
  return s;
};
const scoped = () => sheet(`@scope (x-prox) { .m { color: ${SCOPED}; } }`);
const author = (selector = '.m') => sheet(`${selector} { color: ${AUTHOR}; }`);

/** The color `.m` gets inside `<x-prox>` under `root`, with `sheets` adopted there in that order. */
const read = (root, sheets, container) => {
  const before = root.adoptedStyleSheets;
  root.adoptedStyleSheets = [...before, ...sheets];
  const prox = document.createElement('x-prox');
  prox.innerHTML = '<b class="m">m</b>';
  container.append(prox);
  const color = getComputedStyle(prox.querySelector('.m')).color;
  prox.remove();
  root.adoptedStyleSheets = before;
  return color;
};

describe('scope proximity against sheet order', () => {
  it('CONTROL: the engine has @scope', () => {
    expect(typeof CSSScopeRule === 'function').to.equal(true);
  });

  for (const where of ['shadow root', 'document']) {
    const place = () => {
      if (where === 'document') return { root: document, container: document.body, done: () => {} };
      const host = document.createElement('div');
      document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      return { root, container: root, done: () => host.remove() };
    };

    it(`${where}: the scoped default wins at equal specificity, before or after the author's sheet`, () => {
      const { root, container, done } = place();
      const after = read(root, [author(), scoped()], container);
      const first = read(root, [scoped(), author()], container);
      done();
      expect({ after, first }).to.deep.equal({ after: SCOPED, first: SCOPED });
    });

    it(`${where}: CONTROL: a higher-specificity author rule beats the default in both orders`, () => {
      const { root, container, done } = place();
      const after = read(root, [author('.m.m'), scoped()], container);
      const first = read(root, [scoped(), author('.m.m')], container);
      done();
      expect({ after, first }).to.deep.equal({ after: AUTHOR, first: AUTHOR });
    });
  }
});
