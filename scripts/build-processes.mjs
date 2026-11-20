/**
 * **The `wireit` and `rollup` processes building in one tree** — what `scripts/clean-build.mjs` refuses to start beside.
 *
 * A killed build orphans them holding wireit's lock, and wireit's lock is per tree, so only a process working inside
 * THIS tree counts; VS Code's wireit extension server is not a build. On macOS and Linux a process's tree is its working
 * directory (`ps`, then `lsof`). Windows has neither tool and exposes no other process's working directory, so there
 * it is the tree its command line runs from: wireit and rollup run from the tree's own `node_modules`, whose path is in
 * the command line (2026-11-20, the Windows machine; `ps -Ao` failed there before any build ran).
 */
import { execFileSync, execSync } from 'node:child_process';

const SLASH = /\\/g;
const IGNORED = /\.vscode|extensions[\\/]|clean-build\.mjs|build-processes/;
const BUILD = /\b(wireit|rollup)\b/;

/** A process's working directory, or null once it has gone (macOS and Linux). */
const cwdOf = (pid) => {
  try {
    return execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: 'utf8' }).split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? null;
  } catch {
    return null;
  }
};

/** Every process as `{ pid, started, command }`, read from the platform's own table. */
const processes = () => {
  if (process.platform === 'win32') {
    const script = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.CreationDate, $_.CommandLine }";
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((row) => {
        const [pid, started, ...rest] = row.split('|');
        return { pid: Number(pid), started, command: rest.join('|') };
      });
  }
  return execSync('ps -Ao pid,lstart,command', { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((row) => {
      const [pid, ...rest] = row.trim().split(/\s+/);
      return { pid: Number(pid), started: rest.slice(0, 5).join(' '), command: rest.slice(5).join(' ') };
    });
};

/** The build processes inside `root` (a path ending in a separator), as printable rows. */
export const buildProcesses = (root) => {
  const tree = root.replace(SLASH, '/').toLowerCase();
  const inTree =
    process.platform === 'win32'
      ? ({ command }) => command.replace(SLASH, '/').toLowerCase().includes(tree)
      : ({ pid }) => {
          const dir = cwdOf(pid);
          return dir !== null && (dir + '/').startsWith(root);
        };
  return processes()
    .filter(({ pid, command }) => pid !== process.pid && BUILD.test(command) && !IGNORED.test(command))
    .filter(inTree)
    .map(({ pid, started, command }) => `${pid}  ${started}  ${command}`);
};
