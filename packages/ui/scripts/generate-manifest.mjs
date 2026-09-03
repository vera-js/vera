/**
 * Generates `custom-elements.json` from the components' declared surfaces (`src/x/surface.ts`) —
 * the ecosystem-standard Custom Elements Manifest, which editors and docs tooling read. With
 * `--check` it refuses when the committed file disagrees with the declarations, which is what
 * turns "we remembered to update the manifest" into something the gate enforces: any surface
 * change is a visible diff in review, and a silent one fails CI.
 *
 * Slots, CSS parts and CSS custom properties are first-class CEM fields; our `states` vocabulary
 * rides along as a `vera-states` extension field, because a `data-state` value is API too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectSurface } from '../src/select/surface.ts';

const SURFACES = [selectSurface];
const TARGET = fileURLToPath(new URL('../custom-elements.json', import.meta.url));

const manifest = {
  schemaVersion: '1.0.0',
  readme: '',
  modules: SURFACES.map((surface) => ({
    kind: 'javascript-module',
    path: 'dist/development/vera-ui.js',
    declarations: [
      {
        kind: 'class',
        customElement: true,
        tagName: surface.tag,
        name: surface.tag
          .split('-')
          .map((word) => word[0].toUpperCase() + word.slice(1))
          .join(''),
        description: surface.description,
        attributes: surface.attributes.map(({ name, description }) => ({ name, description })),
        members: [
          ...surface.properties.map(({ name, type, description }) => ({
            kind: 'field',
            name,
            type: { text: type },
            description,
          })),
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
      },
    ],
  })),
};

const next = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = null;
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    /* missing is drift too */
  }
  if (current !== next) {
    process.stderr.write(
      'custom-elements.json is out of date with the declared surfaces. A surface changed without ' +
        'its manifest — run `npm run manifest -w @verajs/ui` and commit the diff (which is the ' +
        'review artifact for the API change).\n'
    );
    process.exit(1);
  }
  process.stdout.write('custom-elements.json matches the declared surfaces.\n');
} else {
  writeFileSync(TARGET, next);
  process.stdout.write(`wrote custom-elements.json (${SURFACES.length} component${SURFACES.length === 1 ? '' : 's'}).\n`);
}
