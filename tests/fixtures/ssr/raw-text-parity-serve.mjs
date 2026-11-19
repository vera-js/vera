/**
 * Child process for tests/renderer-raw-text-round-trip.test.mjs: serves every shape of `raw-text-parity-ssr.js` as a
 * core and as a lite component through `@verajs/ssr`, and prints the markup (or the refusal) per side. Its own process:
 * `@verajs/ssr` installs its DOM's globals for the process.
 */
import { renderToString } from '@verajs/ssr';
import { SHAPES } from '../raw-text-shapes.mjs';

const fixture = new URL('./raw-text-parity-ssr.js', import.meta.url);
const serve = async (tag) => {
  try {
    return { html: (await renderToString(fixture, { tag })).html };
  } catch (error) {
    return { refused: String(error?.cause?.message ?? error?.message) };
  }
};
const out = [];
for (let i = 0; i < SHAPES.length; i++) out.push({ core: await serve(`rtp-core-${i}`), lite: await serve(`rtp-lite-${i}`) });
process.stdout.write(JSON.stringify(out));
