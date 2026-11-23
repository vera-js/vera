/** Serves every shape through `@verajs/ssr` and writes the markup as JSON: run by `hydrate-roundtrip.test.mjs` in its own process. */
import { load } from '../../dist.mjs';
import { ALL } from './shapes.mjs';

const { html } = await load('core');
const { serializeTemplate } = await import('@verajs/ssr');
process.stdout.write(JSON.stringify(ALL.map(([, strings, values]) => serializeTemplate(html(Object.assign([...strings], { raw: [...strings] }), ...values)))));
