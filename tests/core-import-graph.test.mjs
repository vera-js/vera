/**
 * **Core's layering, read from the module graph esbuild actually builds** (the base / reactive split, 2026-10-27).
 *
 * Two rules, and a floor:
 * - **The component base never imports the reactive layer.** The base (`define` / `init`, the lifecycle, the render
 *   door) is shared by every profile; the reactive layer (the store, tracking, hooks, the scheduler) plugs into it once,
 *   at import, through one layer object. A base that imports the layer cannot ship without it.
 * - **Core's runtime graph has no cycle.** `types.ts` makes type cycles impossible; this holds the runtime imports.
 * - **The floor:** the graph holds core's modules and every module named below, so a rename or a broken build fails
 *   here, never reads as "nothing imports anything".
 *
 * The graph comes from esbuild's metafile (the tool that resolves the imports, so no pattern over source can miss a
 * spelling); type-only imports are erased before it, as they are in the build. `@verajs/*` stays external, so only
 * core's own modules are in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const SRC = 'packages/core/src/';
/**
 * The component base, and the reactive layer it must not reach. Every name must be in the graph (the floor). EMPTY in
 * this tree for now: its core has no base / reactive split yet; the rule is armed by naming both sides when it does.
 */
const BASE = [];
const REACTIVE = [];
/** The floor's names while the layer lists are empty: modules any working core build holds. */
const FLOOR = ['index.ts', 'services/createProxy.ts', 'modules/scheduler.ts', 'modules/createHook.ts', 'modules/init.ts', 'modules/define.ts'];

/** The graph as { module: [the modules it imports] }, for core's own modules. */
const coreGraph = () => {
  const { metafile } = buildSync({
    entryPoints: [`${SRC}index.ts`],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    external: ['@verajs/*'],
    tsconfigRaw: {},
    logLevel: 'silent',
  });
  return Object.fromEntries(Object.entries(metafile.inputs).map(([file, { imports }]) => [file, imports.filter((i) => !i.external).map((i) => i.path)]));
};

/** Every module `from` reaches, itself excluded. */
const reach = (graph, from) => {
  const seen = new Set();
  const stack = [...(graph[from] ?? [])];
  while (stack.length) {
    const m = stack.pop();
    if (seen.has(m)) continue;
    seen.add(m);
    stack.push(...(graph[m] ?? []));
  }
  return seen;
};

/** The rules as one function, so the planted graphs below and the real one go through the same code. */
export const violations = (graph, base, reactive) => {
  const found = [];
  for (const b of base) for (const m of reach(graph, b)) if (reactive.includes(m)) found.push(`the base ${b} reaches ${m}`);
  for (const m of Object.keys(graph)) if (reach(graph, m).has(m)) found.push(`a cycle through ${m}`);
  return found;
};

test('the rules fail on planted graphs: a base reaching the layer, and a cycle, each named', () => {
  assert.deepEqual(violations({ b: ['x'], x: ['r'], r: [] }, ['b'], ['r']), ['the base b reaches r'], 'a base reaching the layer through another module');
  assert.deepEqual(violations({ a: ['c'], c: ['a'] }, [], []), ['a cycle through a', 'a cycle through c'], 'a two-module cycle');
  assert.deepEqual(violations({ b: ['x'], x: [], r: [] }, ['b'], ['r']), [], 'and a clean graph passes');
});

test("core's module graph: the base never reaches the reactive layer, and nothing imports itself back", () => {
  const graph = coreGraph();
  const modules = Object.keys(graph);
  const named = [...FLOOR, ...BASE, ...REACTIVE].map((f) => SRC + f);
  /** The floor: core's modules are there, and so is every module this test names. */
  assert.ok(modules.length >= FLOOR.length, `CONTROL: the graph holds ${modules.length} modules`);
  for (const m of named) assert.ok(modules.includes(m), `CONTROL: ${m} is in the graph (renamed? update BASE / REACTIVE)`);
  assert.deepEqual(violations(graph, BASE.map((f) => SRC + f), REACTIVE.map((f) => SRC + f)), []);
});
