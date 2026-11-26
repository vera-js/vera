/**
 * **Every package a release will publish can publish from CI**, or this is red, before the version commit is pushed.
 *
 * The release workflow publishes, through npm's Trusted Publishing (an OIDC token from GitHub Actions, no npm token),
 * each package whose version is not on the registry yet. npm accepts that token only for a package with a Trusted
 * Publisher configured, and it refuses the rest (`ENEEDAUTH`) after the packages before it have already published. One
 * release did exactly that on 2026-11-22: `@verajs/lite`'s only version had been published by hand, CI's token was
 * refused, and the packages after it were never attempted. A fresh install then held core 0.5.0 beside a renderer whose
 * peer range wanted core 0.4, and a CDN pin pointed at a renderer that did not exist.
 *
 * So for each public package whose version is not on the registry, this reads the registry's record of its latest
 * version, and is red when:
 *
 *   - it was published by anyone other than the trusted publisher (`_npmUser.trustedPublisher` absent), because then
 *     nothing shows that npm will take CI's token for it; or
 *   - the package was never published at all (a first publish is made by hand, by rule, before a release includes it).
 *
 * A registry it cannot read is red too, never a pass: "could not check" must not read as "checked".
 *
 * What it cannot see: npm binds a package's Trusted Publisher to the publishing workflow BY FILE NAME
 * (`.github/workflows/release.yml`). Renaming that file breaks every publish while each verdict here still reads ok.
 *
 *   node scripts/check-publishers.mjs                  # every public package of the working tree
 *   node scripts/check-publishers.mjs --read <name>@<version>   # one published version's publisher (exit 1 if not trusted)
 *
 * `VERA_NPM_REGISTRY` names another registry (the offline row of `tests/check-publishers.test.mjs` uses it).
 */
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { packageDirs } from './packages.mjs';
import { entry, verdict } from './publisher-verdict.mjs';

const REGISTRY = (process.env.VERA_NPM_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;

/** The registry's record of a package, `null` for one it does not know; throws when the registry cannot be read. */
const record = async (name) => {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`the registry answered ${response.status} for ${name}`);
  return response.json();
};

const read = process.argv.indexOf('--read');
try {
  if (read !== -1) {
    const spec = process.argv[read + 1] ?? '';
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (at <= 0 || version === '') throw new Error(`--read takes <name>@<version>, got ${JSON.stringify(spec)}`);
    const found = await record(name);
    const published = found ? entry(found, version) : undefined;
    const user = published?._npmUser;
    if (!published) throw new Error(`${spec} is not on the registry`);
    console.log(`${spec}: published by ${user?.name ?? 'an unknown user'}${user?.trustedPublisher ? ' (the trusted publisher)' : ''}`);
    process.exit(user?.trustedPublisher ? 0 : 1);
  }

  const packages = [];
  for (const dir of packageDirs(process.cwd() + sep)) {
    const manifest = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    if (!manifest.private) packages.push({ name: manifest.name, version: manifest.version });
  }
  if (packages.length === 0) throw new Error('found no public package: the check would pass on nothing');
  const results = await Promise.all(packages.map(async ({ name, version }) => verdict(name, version, await record(name))));
  const red = results.filter((result) => result.verdict === 'red');
  for (const result of results) if (result.verdict !== 'skip') console.log(`${result.verdict === 'ok' ? '✓' : '✗'} ${result.why}`);
  const releasing = results.filter((result) => result.verdict !== 'skip').length;
  console.log(`${packages.length} public packages read; ${releasing} to publish, ${red.length} that cannot publish from CI.`);
  process.exit(red.length ? 1 : 0);
} catch (error) {
  console.error(`✗ could not check the publishers: ${error?.message ?? error} (red: an unread registry is never a pass)`);
  process.exit(1);
}
