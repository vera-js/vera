/**
 * The rule `scripts/check-publishers.mjs` applies to each package, and its registry read, kept apart from the script's
 * top level so `tests/check-publishers.test.mjs` can hold both to recorded registry records with no network.
 */
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * **One registry read is tried up to three times**, 0.5 s and then 1 s apart: a gate went red on one dropped request
 * ("fetch failed") and read green when rerun alone, so a single failed request is not a verdict. The retries cost at
 * most 1.5 s plus the timeouts. Three failures in a row stay red.
 */
export const TRIES = 3;
const BACKOFF_MS = 500;

/**
 * The registry's record of a package, `null` for one it does not know. A read that fails (refused, dropped, timed out,
 * any status but 200 or 404, a body that is not JSON) is tried again, up to `TRIES` in all, waiting `BACKOFF_MS` times
 * the retry's number before each; after the last it throws that failure, so an unread registry is red, never a pass.
 * `fetch` and `wait` are the test's seams.
 *
 * @param {string} name
 * @param {{ registry: string, fetch?: typeof globalThis.fetch, wait?: (ms: number) => Promise<unknown>, timeoutMs?: number }} options
 * @returns {Promise<any>}
 */
export const readRecord = async (name, { registry, fetch = globalThis.fetch, wait = sleep, timeoutMs = 15_000 }) => {
  let last;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    if (attempt > 1) await wait(BACKOFF_MS * (attempt - 1));
    try {
      const response = await fetch(`${registry}/${name.replace('/', '%2f')}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 404) return null;
      if (response.ok) return await response.json();
      last = new Error(`the registry answered ${response.status} for ${name}`);
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`${last instanceof Error ? last.message : String(last)} (${TRIES} tries)`);
};

/**
 * The verdict for one package, from its registry record (`null` when the registry has none) and the version the tree
 * holds: `skip` when that version is already published (this release does not publish it), else `ok` or `red`.
 *
 * @param {string} name
 * @param {string} version
 * @param {null | { 'dist-tags'?: { latest?: string }, versions?: Record<string, { _npmUser?: { name?: string, trustedPublisher?: unknown } }> }} record
 * @returns {{ verdict: 'skip' | 'ok' | 'red', why: string }}
 */
/** A version's entry, read as the record's own key only (a version is never a prototype name, but the rule is one rule: `check-publishers`' `--read` takes it from here). */
export const entry = (record, version) => (record.versions && Object.hasOwn(record.versions, version) ? record.versions[version] : undefined);

export const verdict = (name, version, record) => {
  if (record === null)
    return { verdict: 'red', why: `${name} was never published: publish ${version} by hand and configure its Trusted Publisher, then release it` };
  if (entry(record, version)) return { verdict: 'skip', why: `${name}@${version} is already published` };
  const latest = record['dist-tags']?.latest;
  const user = latest === undefined ? undefined : entry(record, latest)?._npmUser;
  if (user?.trustedPublisher) return { verdict: 'ok', why: `${name}: latest ${latest} came from the trusted publisher, so ${version} can publish from CI` };
  return {
    verdict: 'red',
    why: `${name}: latest ${latest ?? '(none)'} was published by ${user?.name ?? 'an unknown user'}, not the trusted publisher; configure ${name}'s Trusted Publisher on npm and confirm it before releasing ${version}`,
  };
};
