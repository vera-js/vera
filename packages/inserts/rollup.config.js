import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

export default defaultRollupConfig(pkg.filename, []);
