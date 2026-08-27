/**
 * Compiles the two Astro fixtures once, at load, and hands back rendered thunks.
 *
 * **Everything expensive happens here and not in the timed function.** Compiling a `.astro` source,
 * importing the result and creating a container are setup, exactly as every other contender resolves
 * its modules at load — the one row that did that work inside the timer was reporting seventeen times
 * its own cost, which is the mistake this file exists not to repeat.
 *
 * The compiler still emits `createMetadata` and the runtime no longer exports it, so the emitted
 * import is pointed at a shim that re-exports the runtime and adds it back as a no-op. That is a
 * version skew inside Astro, not something this benchmark is choosing.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

const SMALL = `---
const { greeting, count } = Astro.props;
---
<section class="wrap"><h1>{greeting}</h1><output>count: {count}</output><input value={greeting} /></section>`;

const LARGE = `---
const { rows } = Astro.props;
---
<table><tbody>{rows.map((row) => <tr class={row.id % 2 ? 'odd' : 'even'}><td>{row.id}</td><td>{row.label}</td></tr>)}</tbody></table>`;

/**
 * Written **inside `bench/node_modules`**, not a temp directory: the compiled module imports
 * `astro/compiler-runtime` as a bare specifier, and that only resolves from somewhere inside this
 * package's own tree. `node_modules` is already ignored by git and by `tests/walk.mjs`.
 */
const dir = fileURLToPath(new URL('../node_modules/.vera-astro/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'runtime-shim.mjs'),
  `export * from 'astro/compiler-runtime';\nexport const createMetadata = () => ({});\n`
);
/** The shim lives beside the compiled module, so its bare specifier resolves from bench's tree. */
writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));

const compile = async (source, name) => {
  const { code } = await transform(source, { filename: `${name}.astro`, internalURL: 'astro/compiler-runtime' });
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, code.replace(/from ["']astro\/compiler-runtime["']/g, `from './runtime-shim.mjs'`));
  return (await import(pathToFileURL(file).href)).default;
};

export const buildAstro = async (rows) => {
  const [small, large] = await Promise.all([compile(SMALL, 'small'), compile(LARGE, 'large')]);
  const container = await AstroContainer.create();
  const smallProps = { greeting: 'hello from the server', count: 3 };
  return {
    small: () => container.renderToString(small, { props: smallProps }),
    large: () => container.renderToString(large, { props: { rows } }),
  };
};
