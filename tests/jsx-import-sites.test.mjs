/**
 * `importSites` — where the buildless loader rewrites a module. Every dynamic `import(` and every
 * `import.meta` is found by position, whatever the argument; a METHOD named `import` is not a call;
 * a second argument is recorded so the loader writes the two-argument form only where the source did.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { importSites } = await load('jsx');
const kinds = (code) => importSites(code).map((site) => `${site.kind}${site.pair ? '+pair' : ''}:${code.slice(site.start, site.end)}`);

test('every import( call and import.meta is found, whatever the argument', () => {
  assert.deepEqual(kinds("import('./a.jsx');"), ['dynamic:import(']);
  assert.deepEqual(kinds('import(`./${name}.jsx`);'), ['dynamic:import(']);
  assert.deepEqual(kinds("import(new URL('./b.jsx', import.meta.url));"), ['dynamic:import(', 'meta:import.meta']);
  assert.deepEqual(kinds("const u = import.meta.resolve('./c.js');"), ['meta:import.meta']);
  assert.deepEqual(kinds("const s = 'import(\"./no.js\")'; // import('./no.js')"), [], 'CONTROL: strings and comments are not code');
});

test('a second argument is recorded, and only at the call\'s own depth', () => {
  assert.deepEqual(kinds("import('./d.json', { with: { type: 'json' } });"), ['dynamic+pair:import(']);
  assert.deepEqual(kinds("import(pick(a, b));"), ['dynamic:import('], 'a comma inside a nested call is not a second argument');
  assert.deepEqual(kinds("import([a, b][0]);"), ['dynamic:import(']);
});

test('a method named import is not a call — but a call followed by a block on the next line is', () => {
  assert.deepEqual(kinds('class R { import(url) { return url; } }'), [], 'a method, its { on the same line');
  assert.deepEqual(kinds('const o = { import(x) {} };'), []);
  assert.deepEqual(kinds("await import('./a.js')\n{\n  run();\n}"), ['dynamic:import('], 'a call, then a block (no semicolon)');
});

test('an Allman-style method is not a call, and neither is a member split across lines', () => {
  assert.deepEqual(kinds('class R {\n  import(url)\n  {\n    return url;\n  }\n}'), [], 'the brace on the next line, after a class body');
  assert.deepEqual(kinds("const m = loader.\n  import('./x.js');"), [], 'a member access, not the keyword');
  assert.deepEqual(kinds("await import('./a.js')\n{\n  run();\n}"), ['dynamic:import('], 'CONTROL: a call then a block is still a call');
});
