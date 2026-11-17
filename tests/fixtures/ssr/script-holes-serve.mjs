/**
 * Child process for tests/script-data-blocks.test.mjs: renders every shape of `script-holes-ssr.js` through
 * `@verajs/ssr` and prints, per shape, what the server served or that it refused (its code). Its own process because
 * `@verajs/ssr` installs its DOM's globals for the process, and the test's client half needs jsdom's.
 */
import { renderToString } from '@verajs/ssr';

const fixture = new URL('./script-holes-ssr.js', import.meta.url);
const { SHAPES } = await import(fixture);
const out = [];
for (let i = 0; i < SHAPES.length; i++) {
  try {
    out.push({ html: (await renderToString(fixture, { tag: `sh-${i}` })).html });
  } catch (error) {
    out.push({ refused: /\(?(ssr-script-hole)\)?|\/e\/(ssr-script-hole)/.exec(String(error?.cause?.message ?? error?.message))?.slice(1).find(Boolean) ?? String(error?.message).slice(0, 120) });
  }
}
process.stdout.write(JSON.stringify(out));
