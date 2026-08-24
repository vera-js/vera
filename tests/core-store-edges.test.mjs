/**
 * The store against the object shapes real data actually has.
 *
 * `createStore` is a **deep** reactive proxy, which means every one of these is a code path: nested
 * objects, arrays and their mutating methods, a value replaced by a different shape, a property
 * added after creation, a cycle, and the built-ins the docs say are deliberately *not* proxied
 * (`Date` and `RegExp` read internal slots, so a bare proxy throws).
 *
 * Each case checks the two halves that matter together: the value reads back correctly, and a
 * subscriber was notified exactly when it should have been. A store that updates without notifying
 * renders a stale page; one that notifies without changing renders constantly.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'customElements', 'CustomEvent', 'Element'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { render: domRender } = await load('renderer');
core.setRenderer(domRender);
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} — ${extra}`));

let probes = 0;
/**
 * Subscribes to whatever `read` touches and counts how often a change reaches it. `useSyncEffect`
 * rather than `useEffect`: coalescing would hide a missing notification behind a later one.
 */
const watch = async (read) => {
  const counter = { runs: 0 };
  const tag = `store-probe-${probes++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        core.init(this);
        core.useSyncEffect(() => {
          read();
          counter.runs++;
        });
        core.render();
      }
    }
  );
  dom.window.document.body.appendChild(dom.window.document.createElement(tag));
  await frame();
  return counter;
};

/* ── nested objects are tracked to any depth ────────────────────────────────────────────────── */
{
  const state = core.createStore({ a: { b: { c: { value: 1 } } } });
  const seen = await watch(() => state.a.b.c.value);
  const before = seen.runs;
  state.a.b.c.value = 2;
  await frame();
  check('a change four levels deep notifies', seen.runs > before, `${before} -> ${seen.runs}`);
  check('and reads back', state.a.b.c.value === 2, String(state.a.b.c.value));
}

/* ── a whole subtree replaced ───────────────────────────────────────────────────────────────── */
{
  const state = core.createStore({ user: { name: 'Ada' } });
  const seen = await watch(() => state.user.name);
  const before = seen.runs;
  state.user = { name: 'Grace' };
  await frame();
  check('replacing a subtree notifies its readers', seen.runs > before, `${before} -> ${seen.runs}`);
  check('and the replacement is reactive too', state.user.name === 'Grace');

  const after = seen.runs;
  state.user.name = 'Katherine';
  await frame();
  check('a change inside the replacement notifies', seen.runs > after, `${after} -> ${seen.runs}`);
}

/* ── arrays, including the mutating methods ─────────────────────────────────────────────────── */
{
  const state = core.createStore({ rows: [1, 2, 3] });
  const seen = await watch(() => state.rows.length);
  for (const [label, mutate, expected] of [
    ['push', () => state.rows.push(4), [1, 2, 3, 4]],
    ['pop', () => state.rows.pop(), [1, 2, 3]],
    ['unshift', () => state.rows.unshift(0), [0, 1, 2, 3]],
    ['shift', () => state.rows.shift(), [1, 2, 3]],
    ['splice', () => state.rows.splice(1, 1), [1, 3]],
    ['sort', () => state.rows.sort((a, b) => b - a), [3, 1]],
    ['reverse', () => state.rows.reverse(), [1, 3]],
  ]) {
    const before = seen.runs;
    mutate();
    await frame();
    check(`${label} produces the right array`, JSON.stringify([...state.rows]) === JSON.stringify(expected), JSON.stringify([...state.rows]));
    /** `sort` and `reverse` keep the length, so only the length-changing ones must notify here. */
    if (expected.length !== [...state.rows].length) continue;
    if (['push', 'pop', 'unshift', 'shift', 'splice'].includes(label))
      check(`${label} notifies a length subscriber`, seen.runs > before, `${before} -> ${seen.runs}`);
  }
}

/* ── a property added after the store was created ───────────────────────────────────────────── */
{
  const state = core.createStore({ known: 1 });
  const seen = await watch(() => state.added);
  const before = seen.runs;
  state.added = 'now here';
  await frame();
  check('a property added later notifies its reader', seen.runs > before, `${before} -> ${seen.runs}`);
  check('and reads back', state.added === 'now here');
}

/* ── deleting a property ────────────────────────────────────────────────────────────────────── */
{
  const state = core.createStore({ gone: 'here' });
  const seen = await watch(() => state.gone);
  const before = seen.runs;
  delete state.gone;
  await frame();
  check('deleting notifies', seen.runs > before, `${before} -> ${seen.runs}`);
  check('and the property is gone', state.gone === undefined);
}

/* ── a cycle must not hang ──────────────────────────────────────────────────────────────────── */
{
  const raw = { name: 'root' };
  raw.self = raw;
  const state = core.createStore({ node: raw });
  check('a self-referencing object can be stored', state.node.name === 'root');
  check('and walked through the cycle', state.node.self.self.name === 'root');
  state.node.name = 'renamed';
  check('and written through it', state.node.self.name === 'renamed', state.node.self.name);
}

/* ── Date and RegExp are deliberately not proxied ───────────────────────────────────────────── */
{
  const state = core.createStore({ when: new Date(0), pattern: /x/g });
  check('a Date keeps working', state.when.getTime() === 0, String(state.when.getTime()));
  check('a RegExp keeps working', state.pattern.test('x'));

  const seen = await watch(() => state.when);
  const before = seen.runs;
  state.when = new Date(1000);
  await frame();
  check('replacing a Date is a reactive write', seen.runs > before, `${before} -> ${seen.runs}`);
}

/* ── the same object stored twice is one identity ───────────────────────────────────────────── */
{
  const shared = { n: 1 };
  const state = core.createStore({ a: shared, b: shared });
  state.a.n = 5;
  check('two references to one object stay one object', state.b.n === 5, String(state.b.n));
}

if (failures.length) {
  console.log(`\n  ${failures.length} store failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`store edges: ${pass} checks across nesting, arrays, cycles and built-ins`);
assert.equal(failures.length, 0);
