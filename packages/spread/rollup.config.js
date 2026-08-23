import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/** No dependencies at all — this package imports nothing, not even from the renderer. */
export default defaultRollupConfig(pkg.filename, []);
