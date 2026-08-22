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
import { distUrl, load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="app"></div>');
globalThis.document = dom.window.document;
const app = dom.window.document.getElementById('app');

const core = await load('core');
const { inserts, setRenderer, insert } = core;

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

// 1. The invariant that replaced the default renderer: core registers nothing.
check('core ships no renderer', !inserts.get('render')?.length);

// 2. setRenderer lands at priority 50 and is replaceable.
let called = 0;
setRenderer(() => called++);
check('setRenderer registers one', inserts.get('render').length === 1);
setRenderer(() => (called += 10));
check('setRenderer at 50 replaces, not appends', inserts.get('render').length === 1);
inserts.get('render').forEach((cb) => cb('', app));
check('the replacement is what runs', called === 10);

// 3. Priority ordering around the renderer slot.
const seen = [];
insert('render', () => seen.push(10), 10);
insert('render', () => seen.push(75), 75);
inserts.get('render').forEach((cb) => cb('', app));
check('ordering 10 < 50 < 75', seen[0] === 10 && seen[1] === 75 && inserts.get('render').length === 3);

// 4. Registry-only copies (module-standalone bundles) carry no renderer either.
const REG = distUrl('inserts');
const A = await import(REG + '?copy=a');
const B = await import(REG + '?copy=b');
check('standalone registry ships no renderer', !A.inserts.get('render'));

// 5-6. Cross-copy behaviour after connectInserts: replacement and ordering both hold.
A.setRenderer(() => {});
B.connectInserts(A.inserts);
B.setRenderer(() => {});
check('cross-copy replace at 50', A.inserts.get('render').length === 1);
const order = [];
B.insert('render', () => order.push(75), 75);
A.insert('render', () => order.push(10), 10);
A.inserts.get('render').forEach((cb) => cb('', app));
check('cross-copy ordering 10<50<75', order[0] === 10 && order[1] === 75 && A.inserts.get('render').length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
