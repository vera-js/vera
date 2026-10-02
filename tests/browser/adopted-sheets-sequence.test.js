/**
 * **What `adoptedStyleSheets` accepts on assignment** — the platform's answer, which the SSR shim follows. Its IDL
 * type is a sequence (an observable array), and WebIDL converts ANY iterable to one; an array-like that is not
 * iterable is not a sequence. Recorded here on every engine, for the document and for a shadow root, because a shim
 * that refuses more than the platform breaks client code that works.
 */
import { expect } from '@esm-bundle/chai';

const sheet = () => new CSSStyleSheet();
const outcome = (assign) => {
  try {
    assign();
    return 'accepted';
  } catch (error) {
    return error.constructor.name;
  }
};

for (const [label, target] of [
  ['document', () => document],
  ['shadow root', () => document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' })],
]) {
  it(`${label}: an array, a Set and a generator are sequences; an array-like and a lone sheet are not`, () => {
    const t = target();
    expect(outcome(() => (t.adoptedStyleSheets = [sheet()])), 'array').to.equal('accepted');
    expect(outcome(() => (t.adoptedStyleSheets = new Set([sheet(), sheet()]))), 'Set').to.equal('accepted');
    expect(t.adoptedStyleSheets.length, 'a Set adopts every sheet').to.equal(2);
    expect(outcome(() => (t.adoptedStyleSheets = (function* () { yield sheet(); })())), 'generator').to.equal('accepted');
    expect(outcome(() => (t.adoptedStyleSheets = { length: 1, 0: sheet() })), 'array-like').to.equal('TypeError');
    expect(outcome(() => (t.adoptedStyleSheets = sheet())), 'a lone sheet').to.equal('TypeError');
    expect(outcome(() => (t.adoptedStyleSheets = [{}])), 'a non-sheet entry').to.equal('TypeError');
    t.adoptedStyleSheets = [];
  });
}
