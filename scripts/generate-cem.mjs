/**
 * **Every component's `custom-elements.json`, generated from its declared surfaces**: the ecosystem-standard Custom
 * Elements Manifest, which editors and docs tooling read. One script for every package, so a second component cannot
 * drift from the first.
 *
 *   node scripts/generate-cem.mjs                       → every package whose package.json declares `customElements`
 *   node scripts/generate-cem.mjs packages/components/x → that package only
 *   … --check                                           → refuse, naming the package, when a committed file is stale
 *
 * A package's surfaces are the objects with a string `tag` exported by its `src/**\/surface.ts` files (`as const
 * satisfies ComponentSurface`, see select's `types.ts`). A package that declares `customElements` and has no surface,
 * or a surface with an empty description, is refused rather than skipped: skipping is a manifest declared and never
 * generated. With `--check` it refuses when the committed file disagrees with the declarations, so any surface change
 * is a visible diff in review and a silent one fails the gate.
 *
 * Slots, CSS parts and CSS custom properties are first-class CEM fields; our `states` vocabulary rides along as a
 * `vera-states` extension field, because a `data-state` value is API too.
 */
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, packageDirs } from './packages.mjs';

/** `vera-select` → `VeraSelect`. */
const className = (tag) =>
  tag
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');

/** One declared surface as a CEM module. */
const moduleOf = (path, surface) => ({
  kind: 'javascript-module',
  path,
  declarations: [
    {
      kind: 'class',
      customElement: true,
      tagName: surface.tag,
      name: className(surface.tag),
      description: surface.description,
      attributes: surface.attributes.map(({ name, description }) => ({ name, description })),
      members: [
        ...surface.properties.map(({ name, type, description }) => ({ kind: 'field', name, type: { text: type }, description })),
        ...(surface.methods ?? []).map(({ name, description }) => ({ kind: 'method', name, description })),
      ],
      events: surface.events.map(({ name, detail, description }) => ({
        name,
        type: { text: `CustomEvent<${detail}>` },
        description,
      })),
      slots: surface.slots.map(({ name, description }) => ({ name, description })),
      cssParts: surface.parts.map(({ name, description }) => ({ name, description })),
      cssProperties: surface.tokens.map((name) => ({ name })),
      'vera-states': surface.states,
      'vera-custom-states': surface.customStates ?? [],
    },
  ],
});

/**
 * A package's manifest text and where it goes, from its package.json and its surface files.
 *
 * @param {string} dir The package's directory, relative to the root with `/` (`packages/components/select`)
 * @return {Promise<{ target: string, text: string, count: number }>} The manifest's path, its text, and how many
 *   components it declares
 */
const manifestOf = async (dir) => {
  const pkg = JSON.parse(readFileSync(`${ROOT}${dir}/package.json`, 'utf8'));
  /** With `/` on every platform (`globSync` answers `\` on Windows), so a message names the file the same way everywhere. */
  const files = globSync('src/**/surface.ts', { cwd: `${ROOT}${dir}` })
    .map((file) => file.split(sep).join('/'))
    .sort();
  /**
   * By identity, across every file: one surface exported under two names (`export default xSurface` beside its named
   * export) or re-exported by another surface.ts is one element, and would otherwise be two modules that generate and
   * --check agree on.
   */
  const surfaces = new Set();
  for (const file of files) {
    const exports = await import(pathToFileURL(`${ROOT}${dir}/${file}`).href);
    for (const value of Object.values(exports))
      if (value && typeof value === 'object' && typeof value.tag === 'string') {
        if (typeof value.description !== 'string' || value.description.trim() === '')
          throw new Error(`${dir}/${file}: <${value.tag}> has an empty description; write what it is before its manifest is generated`);
        surfaces.add(value);
      }
  }
  if (surfaces.size === 0)
    throw new Error(`${dir} declares customElements but exports no surface from src/**/surface.ts; declare one, or stop declaring the manifest`);
  const manifest = {
    schemaVersion: '1.0.0',
    readme: '',
    modules: [...surfaces].map((surface) => moduleOf(`dist/development/${pkg.filename}.js`, surface)),
  };
  return { target: `${dir}/${pkg.customElements}`, text: `${JSON.stringify(manifest, null, 2)}\n`, count: surfaces.size };
};

const check = process.argv.includes('--check');
const given = process.argv.slice(2).filter((arg) => arg !== '--check');
const dirs = given.length
  ? given
  : packageDirs().filter((dir) => JSON.parse(readFileSync(`${ROOT}${dir}/package.json`, 'utf8')).customElements);
/** The floor: a walk that found no component would check nothing and say so cleanly. */
if (dirs.length === 0) throw new Error('no package declares customElements: the walk is broken, not the manifests');
process.stdout.write(`custom-elements manifests for: ${dirs.join(', ')}\n`);

const stale = [];
for (const dir of dirs) {
  const { target, text, count } = await manifestOf(dir);
  if (check) {
    let current = null;
    try {
      current = readFileSync(ROOT + target, 'utf8');
    } catch {
      /* missing is drift too */
    }
    if (current !== text) stale.push(dir);
  } else {
    writeFileSync(ROOT + target, text);
    process.stdout.write(`wrote ${target} (${count} component${count === 1 ? '' : 's'}).\n`);
  }
}
if (stale.length) {
  process.stderr.write(
    `custom-elements.json is out of date with the declared surfaces in: ${stale.join(', ')}. A surface changed without ` +
      `its manifest; run \`node scripts/generate-cem.mjs ${stale.join(' ')}\` and commit the diff (which is the review ` +
      'artifact for the API change).\n'
  );
  process.exit(1);
}
if (check) process.stdout.write('every custom-elements.json matches its declared surfaces.\n');
