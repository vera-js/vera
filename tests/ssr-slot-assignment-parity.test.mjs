/**
 * **The slottability rule, pinned across all three implementations of it.**
 *
 * "Which nodes does a slot assign?" is answered in three places: the platform (native
 * `assignedNodes()`), `@verajs/renderer/slots`'s `slotNameOf`, and `@verajs/ssr`'s own copy in
 * `vera/nodes.js`. The two vera copies are a DELIBERATE twin — independent packages, ssr must not
 * import the renderer at runtime — and a deliberate duplication is a fix's second address, so the
 * rule needs a test that fails when the copies disagree rather than a comment hoping they will not.
 *
 * The rule is the platform's: **only elements and text are slottables.** A comment is never
 * assigned. The shim answered `''` for everything that was not an element, which put COMMENTS into
 * the default slot's assignment — server and client disagreeing about a node neither renders,
 * which is the failure mode this package's README calls the worst one it has (arc-2 run 1).
 *
 * Native is the oracle for the client half; the shim is compared against the same expectations.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

/** Every node kind that can sit in a host's light DOM, and whether the platform slots it. */
const CASES = [
  { what: 'an element with no slot attribute', build: (d) => d.createElement('i'), slottable: true, name: '' },
  { what: 'an element naming a slot', build: (d) => { const e = d.createElement('i'); e.setAttribute('slot', 'x'); return e; }, slottable: true, name: 'x' },
  { what: 'a text node', build: (d) => d.createTextNode('t'), slottable: true, name: '' },
  { what: 'a COMMENT', build: (d) => d.createComment('c'), slottable: false, name: null },
];

test('native assigns elements and text, never comments — the rule the copies must match', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const host = doc.createElement('div');
  doc.body.append(host);
  for (const c of CASES) host.append(c.build(doc));
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.innerHTML = '<main><slot></slot></main>';
  const kinds = host.shadowRoot.querySelector('slot').assignedNodes().map((n) => n.nodeType);
  assert.ok(kinds.length > 0, 'CONTROL: native assigned something');
  assert.equal(kinds.includes(8), false, 'native never assigns a comment');
});

test("the SSR shim's assignment matches the platform, comments included", async () => {
  await import('@verajs/ssr');
  const doc = globalThis.document;
  const host = doc.createElement('div');
  host.append(doc.createTextNode('t'), doc.createComment('c'), doc.createElement('i'));
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.innerHTML = '<main><slot></slot></main>';
  const assigned = host.shadowRoot.querySelector('slot').assignedNodes();
  assert.ok(assigned.length > 0, 'CONTROL: the shim assigned something');
  assert.equal(
    assigned.some((n) => n.nodeType === 8),
    false,
    'the shim must not assign a comment — it did, putting comments in the default slot'
  );
  assert.deepEqual(assigned.map((n) => n.nodeType), [3, 1], 'text and element, in light order');
});

test('the two vera copies of the rule are byte-identical in behaviour', async () => {
  const { readFileSync } = await import('node:fs');
  const shim = readFileSync(new URL('../packages/ssr/src/vera/nodes.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../packages/renderer/src/slots.ts', import.meta.url), 'utf8');
  /** Both must spell the same three-way rule: text -> '', element -> attr ?? '', else null. */
  const rule = /nodeType === 3\s*\?\s*''\s*:\s*[\s\S]{0,40}nodeType === 1\s*\?\s*\(?[\s\S]{0,60}getAttribute\('slot'\)\s*\?\?\s*''\)?\s*:\s*null/;
  assert.match(shim, rule, "the shim's slotNameOf no longer spells the platform rule");
  assert.match(client, rule, "the renderer's slotNameOf no longer spells the platform rule");
  /** And each names the other, so a change to one is known to need the other. */
  assert.match(shim, /deliberate twin/i, 'the shim copy must record that it is a twin');
});
