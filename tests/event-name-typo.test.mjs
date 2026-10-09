/**
 * **A misspelled event name is named in development** — reported from a real app: `onClik` in TSX
 * compiles to `@clik`, a listener for an event that never fires, and neither the compiler nor the
 * renderer said anything. TypeScript cannot refuse the name beside a permissive prop surface (an
 * index signature cannot exclude names), so the renderer says it, once, where it is bound — and
 * production carries neither the check nor the text, which is what every buildless and CDN page
 * loads.
 *
 * Custom events are legitimate everywhere, so the silences matter as much as the warnings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment',
  'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const { renderInto } = await load('renderer');
const { html } = await load('renderer/tag');

const warnings = (draw) => {
  const said = [];
  const real = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    draw(document.createElement('div'));
  } finally {
    console.warn = real;
  }
  return said;
};
const handler = () => {};

test('CONTROL: the element really does expose its events to the check', () => {
  assert.ok('onclick' in document.createElement('button'));
});

test('@clik and @keydwon are named, with the event meant', { skip: isProduction && 'production carries no check' }, () => {
  const said = warnings((host) => renderInto(html`<button @clik=${handler}></button><input @keydwon=${handler}>`, host));
  assert.equal(said.length, 2, said.join('\n'));
  assert.match(said[0], /^\[vera\] renderer: <button> — @clik is not an event <button> fires — did you mean @click\?[\s\S]*\(event-name-typo\)$/);
  assert.match(said[0], /onClik compiles to @clik/);
  assert.match(said[1], /<input> — @keydwon is not an event <input> fires — did you mean @keydown\?/, 'a transposition counts as one edit');
});

test('real events, custom events and far-off names are left alone', { skip: isProduction && 'production carries no check' }, () => {
  const said = warnings((host) =>
    renderInto(
      html`<button @click=${handler} @changed=${handler} @loaded=${handler} @item-selected=${handler}
        @refresh=${handler} @keydown=${false}></button>`,
      host
    )
  );
  assert.deepEqual(said, [], 'a real event, a name extending one, a kebab custom event, and a name nowhere near one');
});

test('each typo is said once, however many times it is bound', { skip: isProduction && 'production carries no check' }, () => {
  const draw = (host) => renderInto(html`<button @clcik=${handler}></button>`, host);
  const first = warnings(draw);
  const again = warnings(draw);
  assert.equal(first.length, 1, 'CONTROL: the first binding was named');
  assert.deepEqual(again, [], 'the second was not');
});

test('production says nothing and carries no text for it', { skip: !isProduction && 'development prints it' }, () => {
  const said = warnings((host) => renderInto(html`<button @clik=${handler}></button>`, host));
  assert.deepEqual(said, []);
});
