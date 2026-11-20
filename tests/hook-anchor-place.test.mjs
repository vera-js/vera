/**
 * **`@vera-hooks/anchor`'s placement, the pure function both paths answer to** (sheets/hook-anchor.md, principle 11).
 * Read from the TypeScript source, as `select-surface.test.mjs` reads select's surface: it is not public API, and
 * Node strips the types. Exact rows first, then a seeded fuzz of the model's invariants, each shown to fire on a planted
 * wrong placement before its silence counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendSeeds } from './fuzz-seeds.mjs';

const { place } = await import('../packages/hooks/anchor/src/place.ts');

const VIEWPORT = { left: 0, top: 0, width: 400, height: 300 };
const target = (left, top, width = 100, height = 30) => ({ left, top, width, height });
const LAYER = { width: 120, height: 80 };

test('bottom-start: under the target, left edges aligned, offset 4', () => {
  assert.deepEqual(place(target(50, 50), LAYER, VIEWPORT), { x: 50, y: 84, side: 'bottom', width: 120, height: 80 });
});

test('flips to the top only when the bottom lacks room and the top has it', () => {
  assert.equal(place(target(50, 200), LAYER, VIEWPORT).side, 'top');
  assert.equal(place(target(50, 200), LAYER, VIEWPORT, { flip: false }).side, 'bottom', 'flip: false keeps the side');
  /** Neither fits: the side with more room wins (bottom has 300-8-234 = 58, top 200-4-8 = 188). */
  assert.equal(place(target(50, 200, 100, 30), { width: 120, height: 260 }, VIEWPORT).side, 'top');
});

test('RTL: start is the right edge, and a start side sits on the right', () => {
  const placed = place(target(200, 50), LAYER, VIEWPORT, {}, true);
  assert.equal(placed.x, 200 + 100 - 120, 'bottom-start in RTL aligns the right edges');
  assert.equal(place(target(100, 100), { width: 60, height: 40 }, VIEWPORT, { placement: 'start' }, true).x, 204, 'start side in RTL: to the right');
});

test('shift keeps the layer inside the padded viewport; size match and squeeze', () => {
  assert.equal(place(target(350, 50, 40), LAYER, VIEWPORT).x, 400 - 8 - 120, 'shifted in from the right edge');
  assert.equal(place(target(50, 50, 200), LAYER, VIEWPORT, { size: 'match' }).width, 200, 'at least the target wide');
  const squeezed = place(target(50, 100), { width: 120, height: 400 }, VIEWPORT, { squeeze: true });
  assert.equal(squeezed.side, 'bottom', 'bottom has more room than top here');
  assert.equal(squeezed.max, 300 - 8 - (100 + 30 + 4), 'capped to the room below');
  assert.equal(squeezed.height, squeezed.max);
});

/** The invariants every placement holds; each returns a description of the breach, or null. */
const INVARIANTS = {
  'never overlaps the target on its main axis': (t, p, o) => {
    const gap = o.offset ?? 4;
    if (p.side === 'bottom') return p.y >= t.top + t.height + gap - 1e-9 ? null : `y ${p.y} inside the target`;
    if (p.side === 'top') return p.y + p.height <= t.top - gap + 1e-9 ? null : `bottom ${p.y + p.height} inside the target`;
    return null;
  },
  'inside the padded viewport across the axis whenever it fits': (t, p, o, v) => {
    const pad = o.padding ?? 8;
    if (p.side !== 'top' && p.side !== 'bottom') return null;
    if (p.width > v.width - 2 * pad) return null;
    return p.x >= v.left + pad - 1e-9 && p.x + p.width <= v.left + v.width - pad + 1e-9 ? null : `x ${p.x}..${p.x + p.width} outside`;
  },
  'flips only when the preferred side lacks room': (t, p, o, v, layer) => {
    const pad = o.padding ?? 8;
    const gap = o.offset ?? 4;
    const below = v.top + v.height - pad - (t.top + t.height + gap);
    return p.side === 'top' && below >= layer.height ? `flipped with ${below} px free below for ${layer.height}` : null;
  },
};

test('the invariants fire on planted wrong placements (CONTROL)', () => {
  const t = target(50, 50);
  assert.ok(INVARIANTS['never overlaps the target on its main axis'](t, { x: 50, y: 60, side: 'bottom', width: 120, height: 80 }, {}), 'an overlap is caught');
  assert.ok(INVARIANTS['inside the padded viewport across the axis whenever it fits'](t, { x: 390, y: 84, side: 'bottom', width: 120, height: 80 }, {}, VIEWPORT), 'an overflow is caught');
  assert.ok(INVARIANTS['flips only when the preferred side lacks room'](t, { x: 50, y: 0, side: 'top', width: 120, height: 80 }, {}, VIEWPORT, LAYER), 'a needless flip is caught');
});

const rng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x7fffffff);
const SEEDS = extendSeeds([3, 41, 97, 512, 2026]);

for (const seed of SEEDS)
  test(`seed ${seed}: 2000 random placements hold every invariant`, () => {
    const random = rng(seed);
    const breaches = [];
    for (let i = 0; i < 2000; i++) {
      const v = { left: 0, top: 0, width: 200 + random() * 1000, height: 200 + random() * 800 };
      const t = target(random() * v.width, random() * v.height, 10 + random() * 200, 10 + random() * 60);
      const layer = { width: 20 + random() * 300, height: 20 + random() * 400 };
      const options = { placement: random() < 0.5 ? 'bottom-start' : 'bottom-end', offset: Math.round(random() * 10), padding: Math.round(random() * 16) };
      const p = place(t, layer, v, options, random() < 0.3);
      for (const [name, check] of Object.entries(INVARIANTS)) {
        const breach = check(t, p, options, v, layer);
        if (breach) breaches.push(`#${i} ${name}: ${breach}`);
      }
    }
    assert.deepEqual(breaches.slice(0, 5), []);
  });
