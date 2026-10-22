import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Nothing external: the module imports nothing from core. It is a CONNECTOR — `wire` hands it core's registry, and core's
 * teardown (`$td`) and the `'init'` insert come off that — so a page with two copies of core still wires it into the
 * one it is wired with. The fields it reads are sigiled (`_$raw$`, `_$v$`), so no mangling regex renames them.
 */
export default defaultRollupConfig(pkg.filename, [], /^_[a-z]/);
