/**
 * **`npm` and `npx` as a command a script can spawn, on every platform.**
 *
 *   const [command, args] = npmCommand('npx', ['tsc', '-p', dir]);
 *   spawnSync(command, args, options);
 *
 * On macOS and Linux they are executables on the PATH, and this returns them unchanged. On Windows they are `npm.cmd`
 * and `npx.cmd`, which `spawn` cannot start without a shell (ENOENT for the bare name, EINVAL for the `.cmd` since
 * Node's 2024 batch-file fix), and a shell would re-parse every argument. So on Windows it runs npm's own JavaScript
 * entry with this Node, from the npm installed beside it, which is what the `.cmd` does. Found 2026-11-20 on the
 * Windows machine: `npm run typecheck`, `scripts/clean-build.mjs` and the gate's npm steps all failed at spawn.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `bin` is `'npm'` or `'npx'`; returns `[command, args]` for `spawnSync` / `execFileSync`. */
export const npmCommand = (bin, args = [], platform = process.platform) => {
  if (platform !== 'win32') return [bin, args];
  const entry = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', `${bin}-cli.js`);
  if (!existsSync(entry)) throw new Error(`npmCommand: no ${bin} beside ${process.execPath} (looked for ${entry})`);
  return [process.execPath, [entry, ...args]];
};
