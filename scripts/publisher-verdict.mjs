/**
 * The rule `scripts/check-publishers.mjs` applies to each package, kept apart from its registry reads so
 * `tests/check-publishers.test.mjs` can hold it to recorded registry records with no network.
 */

/**
 * The verdict for one package, from its registry record (`null` when the registry has none) and the version the tree
 * holds: `skip` when that version is already published (this release does not publish it), else `ok` or `red`.
 *
 * @param {string} name
 * @param {string} version
 * @param {null | { 'dist-tags'?: { latest?: string }, versions?: Record<string, { _npmUser?: { name?: string, trustedPublisher?: unknown } }> }} record
 * @returns {{ verdict: 'skip' | 'ok' | 'red', why: string }}
 */
export const verdict = (name, version, record) => {
  if (record === null)
    return { verdict: 'red', why: `${name} was never published: publish ${version} by hand and configure its Trusted Publisher, then release it` };
  if (record.versions?.[version]) return { verdict: 'skip', why: `${name}@${version} is already published` };
  const latest = record['dist-tags']?.latest;
  const user = latest === undefined ? undefined : record.versions?.[latest]?._npmUser;
  if (user?.trustedPublisher) return { verdict: 'ok', why: `${name}: latest ${latest} came from the trusted publisher, so ${version} can publish from CI` };
  return {
    verdict: 'red',
    why: `${name}: latest ${latest ?? '(none)'} was published by ${user?.name ?? 'an unknown user'}, not the trusted publisher; configure ${name}'s Trusted Publisher on npm and confirm it before releasing ${version}`,
  };
};
