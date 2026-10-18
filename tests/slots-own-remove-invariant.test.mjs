/**
 * **A light slot's own `remove()` / `replaceWith()` belong to the USER** (2026-10-18): a slot WITH content has stepped
 * out of the page, so slots gives each kept slot a `remove()` / `replaceWith()` that puts its content back first. So the
 * renderer and slots must never call either on a node that can BE a slot, or the override runs inside their own moves.
 * The first build did, once, in `region()`, and 55 oracle scenarios went red. Every call site in the two sources is on
 * this list with the reason its node can never be a slot; a new one fails here until it is looked at, and an internal
 * removal of a node that might be a slot is spelled `parentNode.removeChild` instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ALLOWED = {
  'packages/renderer/src/slots.ts': {
    'holding.remove();': "the holding element (an <ins>, unpark's local), never a slot",
    'light.holding?.remove();': 'the holding element (an <ins>, at release), never a slot',
    'stand.remove();': 'a stand-in comment',
    'rec.rs.remove();': "a slot region's start comment",
    'rec.re!.remove();': "a slot region's end comment",
  },
  'packages/renderer/src/renderer.ts': {
    'if (type !== 1) (content.firstChild as Element).replaceWith(...content.firstChild!.childNodes);': "template construction: an svg/mathml wrapper in the inert template, before any instance (and before any slot claim)",
    '(node as Comment).replaceWith(anchor);': 'template construction: a part comment in the inert template',
  },
};

test('no remove() / replaceWith() call in renderer or slots can reach a light slot', () => {
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    const found = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .map((line) => line.trim())
      .filter((line) => /\.remove\(\)|\.replaceWith\(/.test(line));
    assert.ok(found.length >= Object.keys(allowed).length, `${file}: the scan found ${found.length} — has it stopped matching?`);
    const unlisted = found.filter((line) => !(line in allowed));
    assert.deepEqual(unlisted, [], `${file}: a remove()/replaceWith() nobody has checked — use parentNode.removeChild if the node can be a light slot, then list it`);
    const gone = Object.keys(allowed).filter((line) => !found.includes(line));
    assert.deepEqual(gone, [], `${file}: a listed site no longer exists — update the list`);
  }
});
