/**
 * **What the real server writes** — for a hydration row whose subject is server output. A row that hand-writes its
 * server markup cannot see the server: tests/hydrate.test.mjs row 6 never saw ssr write `[object EventTarget]` for a
 * node, and row 5 asserted a fallback the product never produces (2026-10-09). `serve` renders each template through
 * `@verajs/ssr`'s `serializeTemplate` in its OWN process (the shim installs a DOM, which must not meet the test's jsdom),
 * all in one, and hands back the markup by key. Each source is an expression over `html` — the server's own.
 *
 *   const SERVED = serve({ p: "html`<p>${'server'}</p>`" });
 *   host.innerHTML = SERVED.p;
 *
 * A row whose hand-written markup IS the point — a deliberate mismatch, hostile markup, client-made children — keeps it
 * and says so.
 */
import { execFileSync } from 'node:child_process';

export const serve = (sources) => {
  const script = `
import { serializeTemplate } from '@verajs/ssr';
const { html } = await import('@verajs/core');
process.stdout.write(JSON.stringify({ ${Object.entries(sources).map(([key, source]) => `${JSON.stringify(key)}: serializeTemplate(${source})`).join(', ')} }));
`;
  return JSON.parse(execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  }));
};
