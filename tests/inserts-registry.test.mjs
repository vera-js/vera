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
 * rather than carrying its own: `router` hands the router core's, `@verajs/reactivity/collections` and
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


/**
 * **Wiring the same module twice is not two things claiming a priority.**
 *
 * The duplicate-priority warning exists for a real failure: two *different* modules both taking the
 * default 50, where the first silently never runs. It also fired when the identical callback was
 * wired again — an app whose entry points share a wiring module does exactly that — and told the
 * author the second had replaced the first, of a function identical to the one already there.
 *
 * The advice was wrong for that case too: giving `styles` a second priority would run it twice.
 *
 * It fired in this repo's own kitchen-sink example, which is the reference application. A warning
 * the reference app trips on is one people learn to scroll past — and the real one goes past with
 * it. That is the whole cost, and it is the reason to fix a false positive in a diagnostic.
 */
{
  const said = [];
  const originalWarn = console.warn;
  const collect = (label, run) => {
    said.length = 0;
    console.warn = (...args) => said.push(args.join(' '));
    try { run(); } finally { console.warn = originalWarn; }
    return said.filter((line) => /two things were wired/.test(line)).length;
  };

  const same = () => {};
  const descriptor = { name: 'twice-test', on: 'value', fn: same, priority: 41 };

  check('wiring a module once is quiet', collect('first', () => wire(descriptor)) === 0);
  check('wiring the identical module again is quiet', collect('again', () => wire(descriptor)) === 0);
  check(
    'wiring an equivalent descriptor with the same function is quiet',
    collect('equivalent', () => wire({ name: 'twice-test', on: 'value', fn: same, priority: 41 })) === 0
  );
  /** And the failure it exists for still warns: a different function at the same priority.
   * The `wire` call is made unconditionally — putting it behind `isProduction ||` short-circuited
   * the *side effect* along with the assertion, so the replacement below never happened. */
  const warnings = collect('different', () => wire({ name: 'other-test', on: 'value', fn: () => {}, priority: 41 }));
  check('a different module at the same priority still warns', isProduction ? true : warnings === 1);
  /** The replacement itself must still have happened. */
  check('and the second one is what runs', inserts.get('value').filter((fn) => fn === same).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
