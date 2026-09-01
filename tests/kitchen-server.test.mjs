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

/**
 * Waits for a condition in the page, up to a generous budget, and answers whether it happened rather
 * than throwing — the surrounding `check` is what reports, and a timeout here is a failed check and
 * not a crashed suite.
 */
const waitUntil = (page, predicate, argument) =>
  page.waitForFunction(predicate, argument, { timeout: 10000, polling: 25 }).then(
    () => true,
    () => false
  );

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
    /**
     * **Polled, not slept.** This was `waitForTimeout(300)`, which is a flake generator in a real
     * browser: a click has to reach a store write, a scheduled render and the DOM, and 300 ms is
     * ample on an idle machine and not always ample when the rest of the suite is running beside it.
     * It failed the gate twice in a row and passed standalone every time, which is the signature.
     *
     * A poll is strictly better in both directions — it returns the moment the counter moves rather
     * than always waiting the full budget, and it survives a loaded machine. The assertion is
     * unchanged: the counter still has to move.
     */
    /** The predicate runs in the page, so it closes over nothing here — `before` is passed in. */
    const bumped = await waitUntil(
      page,
      (previous) =>
        document
          .querySelector('sink-shell')
          ?.shadowRoot?.querySelector('sink-effects')
          ?.shadowRoot?.querySelector('#n')?.textContent !== previous,
      before
    );
    check(`${mode}: clicking a button re-renders`, bumped, `stayed at ${before}`);

    await page.evaluate(() =>
      document.querySelector('sink-shell').shadowRoot.querySelector('#nav a[href="/user/7"]').click()
    );
    await waitUntil(
      page,
      () => document.querySelector('sink-shell')?.shadowRoot?.querySelector('[view="main"]')?.textContent?.includes('user 7')
    );
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
