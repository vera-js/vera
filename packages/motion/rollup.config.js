import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Four builds, three of them the ADOPTION surface (the lean entries the embedder calculus was
 * run on) and one first-party seam:
 *
 * - `vera-motion` — `./core` (and the package root): compiler + writer, no engine, no packs.
 *   The bundle whose published size the adoption story quotes.
 * - `vera-motion-ssr` — `renderMotion` for a server document; what the CLI drives.
 * - `vera-motion-client` — the READER: delivery + drive + functions, NO compiler — the
 *   front-end cost for embedders whose server generates everything.
 * - `vera-motion-internal` — the first-party embedder surface `@verajs/directives`' motion pack
 *   wires; no stability promise beyond the two first parties.
 *
 * Everything inlines in every mode: this package deliberately shares no runtime state with any
 * other (its registries are its own), so the CDN two-bundle rule holds by construction.
 */
export default [
  defaultRollupConfig(pkg.filename, [], /^_[a-z]/, { input: 'src/core-entry.ts' }),
  defaultRollupConfig(`${pkg.filename}-ssr`, [], /^_[a-z]/, { input: 'src/ssr-entry.ts' }),
  defaultRollupConfig(`${pkg.filename}-client`, [], /^_[a-z]/, { input: 'src/client-entry.ts' }),
  defaultRollupConfig(`${pkg.filename}-internal`, [], /^_[a-z]/, { input: 'src/internal-entry.ts' }),
];
