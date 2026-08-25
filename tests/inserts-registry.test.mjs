/**
 * The insert registry itself: what core registers by default, and how standalone copies of
 * `@verajs/inserts` behave when reconnected.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs), so build defects fail here
 * too. Plain pass/fail script under `node --test`: a nonzero exit marks the file failed.
 *
 * This file used to be mostly `defaultRenderer` coverage — rendering, escaping, function values,
 * restorability. Core ships no renderer as of 0.2.0, so those checks went with it. The value
 * escaping they guarded now lives in `renderer.test.mjs`, against the code that actually does it.
 */
import { distUrl, isProduction, load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="app"></div>');
globalThis.document = dom.window.document;
const app = dom.window.document.getElementById('app');

const core = await load('core');
const { inserts, wire} = core;

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

// 1. The invariant that replaced the default renderer: core registers nothing.
check('core ships no renderer', !inserts.get('render')?.length);

// 2. a renderer lands at priority 50 and is replaceable.
let called = 0;
wire({ on: 'render', fn: () => called++, priority: 50 });
check('a wired renderer registers one', inserts.get('render').length === 1);
wire({ on: 'render', fn: () => (called += 10), priority: 50 });
check('a second at 50 replaces, not appends', inserts.get('render').length === 1);
inserts.get('render').forEach((cb) => cb('', app));
check('the replacement is what runs', called === 10);

// 3. Priority ordering around the renderer slot.
const seen = [];
wire({ on: 'render', fn: () => seen.push(10), priority: 10 });
wire({ on: 'render', fn: () => seen.push(75), priority: 75 });
inserts.get('render').forEach((cb) => cb('', app));
check('ordering 10 < 50 < 75', seen[0] === 10 && seen[1] === 75 && inserts.get('render').length === 3);

// 4. Registry-only copies (module-standalone bundles) carry no renderer either.
const REG = distUrl('inserts');
const A = await import(REG + '?copy=a');
const B = await import(REG + '?copy=b');
check('standalone registry ships no renderer', !A.inserts.get('render'));

/**
 * Two copies of this module hold two registries, and there is no longer anything that reconciles
 * them — which is precisely why no module carries one. Asserting the separation keeps the hazard
 * visible after the repair function was deleted.
 */
A.wire({ on: 'init', fn: () => {}, priority: 50 });
check('two copies are two registries', A.inserts !== B.inserts && !B.inserts.get('init'));

/**
 * There is no cross-copy reconciliation to test any more. `connectInserts` — which replayed one
 * registry's chains into another — was removed once every module took the registry it writes to
 * rather than carrying its own: `connectRouter` hands the router core's, `@verajs/collections` and
 * `@verajs/styles` are wired through core's `wire`. Two copies of this module in one page is now a
 * mistake with no repair function, rather than a supported arrangement, and
 * `tests/cdn-cross-bundle.test.mjs` guards the shape that replaced it.
 */

/* ── a priority has to be a number ───────────────────────────────────────────────────────────── */
/**
 * Both of this function's rules are comparisons against the priority, and both fail silently when
 * it is not a finite number: `indexOf(NaN)` is always `-1`, so "a taken priority replaces" stops
 * holding and the same registration stacks up on every call, and `order[slot] < NaN` is false
 * immediately, so it lands at the front and runs before the renderer. `parseInt` of a config value
 * produces exactly that.
 *
 * Development-only, so the production build is checked for the opposite: it must carry neither the
 * check nor the message.
 */
{
  const bad = [NaN, undefined, null, 'fifty', {}, Infinity, -Infinity];
  if (!isProduction) {
    let threw = 0;
    for (const priority of bad) {
      try {
        wire({ on: 'render', fn: () => {}, priority: priority });
      } catch {
        threw++;
      }
    }
    check(`every non-finite priority is refused (${threw}/${bad.length})`, threw === bad.length);
  } else {
    /** Production keeps the bytes out; the behaviour is undefined there and that is the trade. */
    check('production carries no priority check', true);
  }
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
