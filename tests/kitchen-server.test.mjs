/**
 * **The example server, driven in a real browser.** The gap this exists to close is specific.
 *
 * `web-test-runner` sets `nodeResolve: true`, which **rewrites bare specifiers before serving**. So
 * every browser suite in this repo runs the application under a resolver the example server does not
 * have — and the kitchen sink shipped for a day with no import map at all. Every component imports
 * `@verajs/core` and friends by bare specifier, as a component does in every consumption mode, so
 * the whole client module graph failed to load: the server's markup sat there looking perfect and
 * nothing was interactive. Not a button, not the router, not one line.
 *
 * It is the quietest failure available — the page cannot report it, because the code that would
 * have reported it never ran — and 151 browser checks were green the entire time.
 *
 * So this drives the **actual server**, over HTTP, in a real browser, and clicks. If chromium is not
 * installed it says so and skips rather than pretending.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 3210;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('kitchen server: playwright is not installed — skipped');
  process.exit(0);
}

const server = spawn(process.execPath, [new URL('../examples/kitchen-sink/server.mjs', import.meta.url).pathname], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

const reach = async (url) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`the server never came up:\n${serverOutput}`);
};

let browser;
const failures = [];
let pass = 0;
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} — ${extra}`));

try {
  await reach(`http://localhost:${PORT}/`);
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.log(`kitchen server: chromium could not launch (${String(error.message).split('\n')[0]}) — skipped`);
    server.kill();
    process.exit(0);
  }

  /* ── every mode boots, reacts to a click, and routes ───────────────────────────────────────── */
  for (const [mode, path] of [
    ['hydrate', '/'],
    ['csr', '/csr'],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error.message)));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });

    const booted = (await page.evaluate(() => document.documentElement.dataset.sinkMode)) === mode;
    check(
      `${mode}: the client entry ran`,
      booted,
      `the module graph did not load — check the import map. First error: ${errors[0] ?? '(none)'}`
    );
    /**
     * Everything below needs a booted page. Without this the failure is a null dereference three
     * layers into a `page.evaluate`, which describes nothing — and the message above is the whole
     * point of the file.
     */
    if (!booted) {
      await page.close();
      continue;
    }

    /** A click, not a method call: the suites drive methods, and a page needs listeners. */
    const bump = async () =>
      page.evaluate(() =>
        document
          .querySelector('sink-shell')
          .shadowRoot.querySelector('sink-effects')
          .shadowRoot.querySelector('#bumpThree')
          .click()
      );
    const counter = () =>
      page.evaluate(
        () =>
          document
            .querySelector('sink-shell')
            .shadowRoot.querySelector('sink-effects')
            .shadowRoot.querySelector('#n').textContent
      );

    const before = await counter();
    await bump();
    await page.waitForTimeout(300);
    check(`${mode}: clicking a button re-renders`, (await counter()) !== before, `stayed at ${before}`);

    await page.evaluate(() =>
      document.querySelector('sink-shell').shadowRoot.querySelector('#nav a[href="/user/7"]').click()
    );
    await page.waitForTimeout(400);
    const outlet = await page.evaluate(
      () => document.querySelector('sink-shell').shadowRoot.querySelector('[view="main"]').textContent
    );
    check(`${mode}: clicking a routed link renders the route`, outlet.includes('user 7'), `outlet is "${outlet}"`);

    check(`${mode}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ── the no-JavaScript mode is still a complete page ───────────────────────────────────────── */
  {
    const markup = await (await reach(`http://localhost:${PORT}/ssr`)).text();
    check('/ssr ships no script', !markup.includes('<script type="module"'), 'it has one');
    check('/ssr still carries the component', markup.includes('<sink-shell'), 'no component in the markup');
    check('/ssr needs no import map', !markup.includes('importmap'), 'it has one it cannot use');
  }
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s) with the example server:\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`kitchen server: ${pass} checks against the running server, in a real browser`);
assert.equal(failures.length, 0);
