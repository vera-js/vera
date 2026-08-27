/**
 * **One directory walk, resilient to a file that disappears mid-walk.**
 *
 * Ten suites walked the tree, each with its own copy of `readdirSync` → `statSync` → `readFileSync`,
 * and every one of them threw `ENOENT` if a file vanished between the listing and the read. That is
 * not hypothetical: it was **reproduced** by churning one file in the repo root while the walk ran,
 * and it is what made `tests/docs-cdn-versions.test.mjs` and `tests/kitchen-server.test.mjs` fail
 * inside a full `npm run gate` and pass in isolation, twice, for reasons nobody could see.
 *
 * An editor writing a swap file, a formatter rewriting on save, a `.DS_Store` appearing, a second
 * process building — any of those does the same thing. **A gate that fails at random is a gate people
 * learn to re-run rather than read**, which costs more than the check was ever worth.
 *
 * The window is genuinely unavoidable — there is no atomic "list and read" — so the fix is to treat
 * a vanished entry as an entry that was not there, which is the truth by the time we look.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directories no check in this repo ever wants: dependencies, build output, VCS, another repo. */
export const IGNORED = ['node_modules', 'dist', '.git', 'internal', 'coverage'];

/**
 * Every file under `root` whose name matches `pattern`, depth-first.
 *
 * @param {string} root Directory to walk
 * @param {RegExp} pattern Tested against each entry's basename
 * @param {{ ignore?: string[], skipDotDirs?: boolean }} [options]
 * @returns {string[]} Absolute paths
 */
export const walkFiles = (root, pattern, options = {}) => {
  const ignore = options.ignore ?? IGNORED;
  const skipDotDirs = options.skipDotDirs ?? false;
  const found = [];
  const walk = (dir) => {
    let entries;
    /** The directory itself can go away between the parent listing and this call. */
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.includes(entry)) continue;
      if (skipDotDirs && entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let isDirectory;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        /** Gone between the listing and the stat. It is not there now, which is all we can say. */
        continue;
      }
      if (isDirectory) walk(full);
      else if (pattern.test(entry)) found.push(full);
    }
  };
  walk(root);
  return found;
};

/**
 * The file's text, or `null` if it went away between the walk and the read.
 *
 * Returning a sentinel rather than throwing keeps the decision at the call site: every current
 * caller is scanning for a pattern, and a file that no longer exists cannot contain one.
 *
 * @param {string} file
 * @returns {string | null}
 */
export const readIfPresent = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
