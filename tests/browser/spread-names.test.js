/**
 * What a spread key may be called, in engines that decide it.
 *
 * `setAttribute` is the arbiter and jsdom is not a good stand-in for it: measured across Chromium,
 * Firefox and WebKit, all three refuse only whitespace, `>`, `=` and `/`, while jsdom enforces the
 * strict XML Name production and refuses `a|b`, `a*b`, `a?b` and the rest. So the node suite covers
 * the keys `@verajs/renderer/spread` refuses for itself, and this covers the ones it must not.
 */
import { expect } from '@esm-bundle/chai';
import { render } from '../../packages/renderer/dist/development/vera-renderer.js';
import { spread } from '../../packages/renderer/dist/development/vera-renderer-spread.js';
import { html } from '../../packages/core/dist/development/vera.js';

const into = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
};

/**
 * The server replaces a static of the same name by compiling the name into a pattern, so a legal
 * name that is also a regular-expression metacharacter has to survive that intact — `a|title`
 * became an alternation and removed an attribute it never named. These bind normally on both sides.
 */
it('binds a legal name that is a regex metacharacter, and leaves its neighbour alone', () => {
  for (const key of ['a|b', 'a.b', 'a*b', 'a+b', 'a(b)', 'a[b]', 'a{b}', 'a?b', 'a$b', 'a^b']) {
    const container = into();
    render(html`<b title="keep" ${spread({ [key]: '1' })}>x</b>`, container);
    const element = container.querySelector('b');
    expect(element.getAttribute('title'), `${key}: the static beside it`).to.equal('keep');
    expect(element.getAttribute(key), `${key}: its own value`).to.equal('1');
    container.remove();
  }
});

/**
 * The engines' own rule, recorded rather than assumed — it is what decides how strict the shared
 * predicate has to be, and it is the one place this framework cannot pick its own answer.
 */
it('agrees with the engine about which names are impossible', () => {
  const element = document.createElement('div');
  const rejected = [];
  for (const name of ['a b', 'a>b', 'a=b', 'a/b', 'a|b', 'a?b', 'a"b', "a'b", 'a<b', 'a`b']) {
    try {
      element.setAttribute(name, '1');
    } catch {
      rejected.push(name);
    }
  }
  expect(rejected, 'the engine refuses exactly these').to.deep.equal(['a b', 'a>b', 'a=b', 'a/b']);
});

/**
 * `"`, `'` and `<` are the interesting ones: every engine **accepts** them, and markup cannot carry
 * them — a name with a quote closes the attribute. So spread refuses them anyway, because a key
 * that works in the browser and vanishes server-side is worse than one that works nowhere.
 */
it('refuses a name the engine allows but markup cannot carry', () => {
  for (const key of ['a"b', "a'b", 'a<b', 'a`b']) {
    const container = into();
    render(html`<b title="keep" ${spread({ [key]: '1' })}>x</b>`, container);
    const element = container.querySelector('b');
    expect(element.attributes.length, `${key}: only the static survived`).to.equal(1);
    expect(element.getAttribute('title')).to.equal('keep');
    container.remove();
  }
});
