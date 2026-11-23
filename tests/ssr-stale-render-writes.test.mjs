/**
 * **Work a timed-out render left running cannot write the next render's document** (2026-11-23). A render past its
 * `timeout` is served and abandoned, not stopped: what it awaited still resolves later, inside whatever render is
 * current then. A component that awaited past the budget and then set `document.title` gave the NEXT request's page the
 * first request's title, and a frame it requested ran in that render. Each render now runs in its own async context,
 * stale once the render settles, and the shared document refuses a title write or a frame request from stale work.
 * The control: a component writing its title within its own render still sets it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { renderToStringAsync } from '@verajs/ssr';

const MODULE = new URL('./fixtures/ssr/stale-render-ssr.js', import.meta.url);
const { RAN } = await import(MODULE);
const quiet = async (work) => {
  const { warn } = console;
  console.warn = () => {};
  try {
    return await work();
  } finally {
    console.warn = warn;
  }
};

test("a timed-out render's late title write and frame request never reach the next render", async () => {
  RAN.length = 0;
  const first = await quiet(() => renderToStringAsync(MODULE, { tag: 'stale-writer', location: '/account/a', timeout: 20 }));
  assert.ok(first.html.includes('<p>stale</p>'), 'CONTROL: the first request was served at its budget');
  const next = await renderToStringAsync(MODULE, { tag: 'slow-page', location: '/public/b' });
  assert.equal(next.title, '', `the next page's title (${next.title})`);
  assert.deepEqual(RAN, [], 'the late frame never ran');
  const own = await renderToStringAsync(MODULE, { tag: 'titled-page', location: '/public/c' });
  assert.equal(own.title, 'own /public/c', 'CONTROL: a write within its own render sets the title');
  assert.deepEqual(RAN, ['own /public/c'], 'CONTROL: a frame within its own render runs');
});

/** Live writes are never taken for stale ones: two requests started together each keep their own title and frame. */
test('two renders started together each keep their own title and frame', async () => {
  RAN.length = 0;
  const [one, two] = await Promise.all([
    renderToStringAsync(MODULE, { tag: 'titled-page', location: '/p/1' }),
    renderToStringAsync(MODULE, { tag: 'titled-page', location: '/p/2' }),
  ]);
  assert.equal(one.title, 'own /p/1');
  assert.equal(two.title, 'own /p/2');
  assert.deepEqual(RAN.sort(), ['own /p/1', 'own /p/2']);
});

/**
 * **Where the runtime has no `AsyncLocalStorage`, rendering still works and the guard is simply off** — a browser Web
 * Worker, or a Node without `process.getBuiltinModule`. Run in a child process with that function removed before the
 * package loads; the control is that the same child, with it present, drops the late write.
 */
/** The child resolves the package as this process does: the development condition when this run has it. */
const CONDITIONS = process.execArgv.join(' ').includes('development') ? ['--conditions=development'] : [];

test('with no AsyncLocalStorage the package still loads and renders, and the late write is not guarded', () => {
  const child = (remove) =>
    execFileSync(process.execPath, [...CONDITIONS, '--input-type=module', '-e', `
      ${remove ? 'delete process.getBuiltinModule;' : ''}
      const { renderToStringAsync } = await import('@verajs/ssr');
      const MODULE = ${JSON.stringify(MODULE.href)};
      console.warn = () => {};
      await renderToStringAsync(MODULE, { tag: 'stale-writer', location: '/account/a', timeout: 20 });
      const next = await renderToStringAsync(MODULE, { tag: 'slow-page', location: '/public/b' });
      process.stdout.write(JSON.stringify(next.title));
    `], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.equal(child(false), '""', 'CONTROL: with the store, the late write is dropped');
  assert.equal(child(true), '"from /account/a"', 'without it the render works and the write lands, as before the guard');
});
