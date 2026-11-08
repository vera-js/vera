/**
 * The hash of the harness sources a bench bundle inlines (`main.js`, `impls.js`): `build.mjs` stamps it into the bundle
 * and `race.mjs` compares it with the files on disk, so a bundle built before an edit to either cannot be raced
 * (2026-11-08: a smoke ran a stale bundle and read the old harness's behavior as the new one's).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const harnessSha = () => {
  const hash = createHash('sha256');
  for (const file of ['main.js', 'impls.js']) hash.update(readFileSync(new URL(file, import.meta.url)));
  return hash.digest('hex').slice(0, 12);
};
