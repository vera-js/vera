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
import { fileURLToPath } from 'node:url';

/**
 * The path of a `file:` URL, with forward slashes.
 *
 * @param {URL | string} url
 * @returns {string}
 */
export const fsPath = (url) => fileURLToPath(url).replaceAll('\\', '/');
