/** Core's typed view of the registry's `$` seams (`CoreSeams`, types.ts): the one cast, so no site writes its own. */
import { inserts } from '@verajs/inserts';
import type { CoreSeams } from '../types.js';

export const seams = inserts as unknown as CoreSeams;
