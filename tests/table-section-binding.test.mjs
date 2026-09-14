/**
 * **`<table>${rows}</table>` renders one shape and parses as another, and that is the only legal
 * template in this framework which does not survive a round trip through the platform.**
 *
 * The markup is conforming — `<tbody>` is an omissible start tag — so nothing refuses it and nothing
 * is dropped. What differs is the MECHANISM that puts the rows in:
 *
 * - A client render inserts them with DOM calls, and DOM insertion applies no parser rules, so the
 *   result is `table > tr`.
 * - The same markup PARSED — server output the browser re-parses, an `innerHTML` assignment, a
 *   static file — gets the implied section: `table > tbody > tr`.
 *
 * Two consequences, and the second is the one that bites silently. A stylesheet written
 * `table > tr` matches under one path and not the other. And hydration walks the parsed server
 * markup against the client's expectation, finds `<tbody>` where the template says `<tr>`, and
 * discards the server's work for that container — *in production, with no diagnostic at all*,
 * because the warning below is folded away there.
 *
 * **The fix is one word from the author**, and the warning exists to ask for it. The framework could
 * insert the section instead, but the parser will always insert one when it re-parses, so the only
 * shape all three paths agree on is one carrying the section already — and putting it there
 * automatically changes the DOM of every existing client-rendered table, across the renderer and
 * `@verajs/ssr`'s serializer both. That is an owner's decision, not an audit repair.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { renderer } = await load('renderer');
const core = await load('core');
core.wire([renderer]);
const { renderInto } = await load('renderer/hydrate');
/** A real tagged template already carries a frozen `raw`, so it is passed through untouched — the
 *  hand-built-array helper the sibling suite uses throws here. */
const html = (strings, ...values) => ({ strings, values, ['_$litType$']: 1 });

const rows = [{ id: 1 }, { id: 2 }];
const row = (r) => html`<tr data-id=${r.id}><td>c</td></tr>`;

const render = (result) => {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  const real = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(String(m));
  try {
    renderInto(result, host);
  } finally {
    console.warn = real;
  }
  return { host, warned: warned.filter((m) => m.includes('directly inside <table>')) };
};

/** Element skeleton, so the comparison is about SHAPE rather than text. */
const skeleton = (el) => [...el.querySelectorAll('*')].map((n) => n.localName).join('>');

test('the shapes really do differ — the premise, measured rather than asserted', () => {
  const { host } = render(html`<table>${rows.map(row)}</table>`);
  const rendered = skeleton(host);

  /** The same markup through the PARSER, which is what a server render becomes on arrival. */
  const parsedHost = dom.window.document.createElement('div');
  parsedHost.innerHTML = '<table><tr data-id="1"><td>c</td></tr><tr data-id="2"><td>c</td></tr></table>';
  const parsed = skeleton(parsedHost);

  assert.equal(rendered, 'table>tr>td>tr>td', 'a client render inserts rows with DOM calls');
  assert.equal(parsed, 'table>tbody>tr>td>tr>td', 'the parser inserts the implied section');
  assert.notEqual(rendered, parsed,
    'CONTROL: if these ever agree the divergence is gone and this whole file should be deleted');
  host.remove();
});

test('writing the section explicitly makes both paths agree', () => {
  const { host } = render(html`<table><tbody>${rows.map(row)}</tbody></table>`);
  const parsedHost = dom.window.document.createElement('div');
  parsedHost.innerHTML =
    '<table><tbody><tr data-id="1"><td>c</td></tr><tr data-id="2"><td>c</td></tr></tbody></table>';
  assert.equal(skeleton(host), skeleton(parsedHost),
    'the explicit form is the fixed point — this is what the warning asks the author for');
  host.remove();
});

test('the author is told, and told what to write',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    const { host, warned } = render(html`<table>${rows.map(row)}</table>`);
    assert.equal(warned.length, 1, 'a binding directly inside <table> must be reported');
    assert.match(warned[0], /<tbody>/, 'and the message must name the fix, not just the problem');
    host.remove();
  });

/**
 * The control that keeps the warning honest. It fires on a PARENT, not on a value, so it must stay
 * silent for every binding whose parent inserts nothing — including the ones inside a table that are
 * already correct. Without this, a warning that fired on all table markup would look identical to
 * one that is right.
 */
test('nothing else warns — the omissible END tags round-trip and must stay quiet',
  { skip: isProduction && 'diagnostics are folded away' }, () => {
    const QUIET = {
      'an explicit tbody': html`<table><tbody>${rows.map(row)}</tbody></table>`,
      'a cell': html`<table><tbody><tr><td>${'x'}</td></tr></tbody></table>`,
      'a list': html`<ul>${rows.map((r) => html`<li data-id=${r.id}>x</li>`)}</ul>`,
      'a select': html`<select>${rows.map((r) => html`<option value=${r.id}>x</option>`)}</select>`,
      'a paragraph': html`<p>${'x'}</p>`,
      'a plain div': html`<div>${'x'}</div>`,
    };
    let checked = 0;
    for (const [name, result] of Object.entries(QUIET)) {
      const { host, warned } = render(result);
      assert.deepEqual(warned, [], `${name}: this shape round-trips, so it must not be reported`);
      checked++;
      host.remove();
    }
    assert.equal(checked, Object.keys(QUIET).length,
      'NON-ZERO CONTROL: every quiet case must actually have been rendered');
  });
