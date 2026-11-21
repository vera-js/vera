/**
 * **The scratch directories suites make inside the repository, read from the suites themselves.**
 *
 * A suite that needs its modules to resolve `@verajs/*` from this tree makes its scratch beside itself (a `mkdtemp`
 * of `join(process.cwd(), 'tests', '.raw-')` or of `fsPath(new URL('./.styles-', import.meta.url))`) and removes it in
 * a finally. A run killed with SIGKILL skips the finally, and the directory stays: untracked, ignored
 * by git, and read by the next gate (eslint lints it). `scripts/clean-build.mjs`, which is exclusive in its tree, removes
 * them, and only them: each place and prefix is read from a `mkdtemp` call, and a leftover is that prefix followed by
 * exactly the six characters `mkdtemp` appends. A call this cannot read (its first argument built in a variable) is
 * reported rather than guessed at, so a new in-tree scratch cannot escape the sweep silently
 * (`tests/scratch-dirs.test.mjs`). A call whose first argument is the system's temporary directory is not ours to sweep.
 */
import { globSync, readdirSync, readFileSync } from 'node:fs';
import { posix } from './fs-path.mjs';
import { ROOT } from './packages.mjs';

/** Where suites and scripts live: every file that may make a scratch directory. */
const SOURCES = ['tests/**/*.mjs', 'tests/**/*.js', 'scripts/**/*.mjs'];
const CALL = /mkdtemp(?:Sync)?\(([^\n]*)/g;
const QUOTED = /'([^']*)'/g;
/** `join(process.cwd(), 'tests', '.raw-')` or `join(root, '.probe', 'hot-vite-')`: from the repository root. */
const JOINED = /^join\((?:process\.cwd\(\)|root|ROOT)\s*,\s*((?:'[^']*'\s*,\s*)*'[^']*')\s*\)/;
/** `fsPath(new URL('./.styles-', import.meta.url))`: beside the file. */
const BESIDE = /^fsPath\(new URL\('\.\/([^']*)'\s*,\s*import\.meta\.url\)\)/;
/** `fsPath(new URL('./examples/kitchen-sink/.jsx-', root))`: from the repository root. */
const FROM_ROOT = /^fsPath\(new URL\('\.\/([^']*)'\s*,\s*root\)\)/;
/** A `mkdtemp` name: the prefix, then six letters and digits. */
const SUFFIX = /^[A-Za-z0-9]{6}$/;

/**
 * **Every in-tree scratch prefix the sources make, and every call that could not be read.**
 *
 * @param {string} [root] Repository root (absolute, trailing slash); defaults to this repo's
 * @returns {{ prefixes: { dir: string, prefix: string, file: string }[], unread: string[] }} `dir` relative to the root
 *   (`tests`), `prefix` the name's start (`.raw-`); `unread` names each `file: call` neither the temporary directory nor
 *   a form above
 */
export const scratchPrefixes = (root = ROOT) => {
  const prefixes = [];
  const unread = [];
  /** This file is skipped: its own pattern and report read as calls. */
  for (const file of globSync(SOURCES, { cwd: root }).map(posix).sort().filter((file) => file !== 'scripts/scratch-dirs.mjs')) {
    const text = readFileSync(root + file, 'utf8');
    for (const [, args] of text.matchAll(CALL)) {
      if (/^\s*(?:join\()?\s*(?:os\.)?tmpdir\(\)/.test(args)) continue;
      let path;
      const joined = JOINED.exec(args);
      if (joined) path = [...joined[1].matchAll(QUOTED)].map((m) => m[1]).join('/');
      else if (BESIDE.test(args)) path = posix(file.slice(0, file.lastIndexOf('/') + 1) + BESIDE.exec(args)[1]);
      else if (FROM_ROOT.test(args)) path = FROM_ROOT.exec(args)[1];
      if (path === undefined || !path.includes('/') || path.endsWith('/')) {
        unread.push(`${file}: mkdtemp(${args.trim().slice(0, 80)}`);
        continue;
      }
      const at = path.lastIndexOf('/');
      prefixes.push({ dir: path.slice(0, at), prefix: path.slice(at + 1), file });
    }
  }
  return { prefixes, unread };
};

/**
 * **The scratch directories left in the tree**: an entry of a known place whose name is a known prefix and six
 * `mkdtemp` characters. Relative to the root, sorted.
 *
 * @param {string} [root] Repository root (absolute, trailing slash); defaults to this repo's
 * @returns {string[]}
 */
export const scratchLeftovers = (root = ROOT) => {
  const byDir = new Map();
  for (const { dir, prefix } of scratchPrefixes(root).prefixes) byDir.set(dir, [...(byDir.get(dir) ?? []), prefix]);
  const found = [];
  for (const [dir, prefixes] of byDir) {
    let names;
    try {
      names = readdirSync(root + dir);
    } catch {
      continue;
    }
    for (const name of names)
      if (prefixes.some((prefix) => name.startsWith(prefix) && SUFFIX.test(name.slice(prefix.length)))) found.push(`${dir}/${name}`);
  }
  return found.sort();
};
