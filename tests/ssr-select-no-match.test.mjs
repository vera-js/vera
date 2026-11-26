/**
 * **A bound `<select>` value that matches no option is said, once per template, and its value never is** (2026-11-26).
 *
 * The client leaves such a select with nothing selected; a parsed `<select>` with no `selected` option shows its first,
 * and markup has no way to say "none" — so the served page shows a choice the client never made, and the server says
 * so as `ssr-select-no-match`. Once per process per template site (the template's `strings`): a select bound per
 * request must not warn per render. The value is request data — often a user's own input — so the line names the
 * binding and the option count, never the value.
 *
 * Each site is one `draw()` called more than once: two template literals are two templates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await load('core');

const heard = (render) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    render();
  } finally {
    console.warn = warn;
  }
  return said.filter((line) => line.includes('ssr-select-no-match'));
};

const byValue = (v) => html`<select .value=${v}><option value=a>A</option><option value=b>B</option></select>`;
const matching = (v) => html`<select .value=${v}><option>a</option><option>b</option><option>c</option></select>`;
const byIndex = (i) => html`<select .selectedIndex=${i}><option>a</option><option>b</option></select>`;
const authorSelected = (v) => html`<select .value=${v}><option value=a selected>A</option><option value=b>B</option></select>`;

test('a value matching an option says nothing; the same site with an unmatched value says it once (CONTROL)', () => {
  assert.deepEqual(heard(() => [serializeTemplate(matching('b')), serializeTemplate(matching('c'))]), []);
  const said = heard(() => serializeTemplate(matching('zzz')));
  assert.equal(said.length, 1, 'the site was live: an unmatched value on it is heard');
  assert.ok(said[0].includes('3 options'), said[0]);
});

test('an unmatched value is said once for its template, however often it renders, and never printed', () => {
  const said = heard(() => {
    for (let n = 0; n < 3; n++) serializeTemplate(byValue('secret-123'));
  });
  assert.equal(said.length, 1, `heard ${said.length} times`);
  assert.ok(said[0].startsWith('[vera] ssr:'), said[0]);
  assert.ok(said[0].includes('<select> value matched none of its 2 options'), said[0]);
  assert.ok(!said[0].includes('secret'), `the value reached the log: ${said[0]}`);
  /** The value was really unmatched: the served select has no option marked. */
  assert.ok(!serializeTemplate(byValue('secret-123')).includes('selected'));
});

test('another template says its own, once: an index out of range, and a value beside an author `selected`', () => {
  const index = heard(() => [serializeTemplate(byIndex(5)), serializeTemplate(byIndex(-1))]);
  assert.equal(index.length, 1, `heard ${index.length} times`);
  assert.ok(index[0].includes('<select> selectedIndex matched none of its 2 options'), index[0]);
  const cleared = heard(() => [serializeTemplate(authorSelected('nope')), serializeTemplate(authorSelected('nope'))]);
  assert.equal(cleared.length, 1, `heard ${cleared.length} times`);
  /** The author's `selected` loses to the binding on the client, so it is cleared here too and nothing is marked. */
  assert.ok(!serializeTemplate(authorSelected('nope')).includes('selected'));
});
