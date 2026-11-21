/**
 * **A file URL as a path the file system accepts on every OS, with forward slashes.**
 *
 * `new URL(…, import.meta.url).pathname` is a path only on macOS and Linux. On Windows it is `/c:/projects/…`, which no
 * file API accepts (`c:\c:\projects\…`, ENOENT), so forty suites failed at load on the Windows workstation (2026-11-20).
 * `fileURLToPath` is the platform's conversion. The result keeps forward slashes and a trailing slash exactly where the
 * URL had them, so string joins (`${root}packages`) and comparisons written against `.pathname` read the same; on macOS
 * and Linux it is byte-identical to `.pathname` for every path without percent-encoded characters (and correct for the
 * ones with them, which `.pathname` leaves encoded). `tests/fs-path.test.mjs` holds both claims.
 */
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A platform path with forward slashes: the one conversion every script and suite uses. It splits on the PLATFORM's
 * separator, so on macOS and Linux it changes nothing; splitting on a backslash there would cut a file name, since a
 * backslash is an ordinary character in one (`tests/fs-path.test.mjs` holds both).
 *
 * @param {string} path
 * @returns {string}
 */
export const posix = (path) => path.split(sep).join('/');

/**
 * The path of a `file:` URL, with forward slashes. A `%5C` in a file URL is a backslash in the file's name on macOS and
 * Linux, kept as one.
 *
 * @param {URL | string} url
 * @returns {string}
 */
export const fsPath = (url) => posix(fileURLToPath(url));

/**
 * **Moves this process into its cwd's canonical spelling**, so every child it spawns inherits it. On Windows a cwd's
 * drive letter keeps the case of whatever launched the shell (VS Code starts one in `c:…`, Git Bash's `/c/…` gives
 * `C:…`), while a realpath, which every resolver takes through a workspace link, always answers the file system's
 * own `C:…`. A tool that compares the two by case breaks only for some launchers: the browser step lost 65 Chromium
 * rows to it from a lowercase cwd. A no-op on macOS and Linux, and wherever the spelling is already canonical. The
 * gate and test-batch, which every check runs under, call it first.
 */
export const canonicalCwd = () => {
  const canonical = realpathSync.native(process.cwd());
  if (canonical !== process.cwd()) process.chdir(canonical);
};
