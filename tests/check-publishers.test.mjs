/**
 * **`scripts/check-publishers.mjs` is red for every package a release cannot publish from CI, and for a registry it
 * cannot read.** The rule is held here against registry records shaped as the registry answers (trimmed to the fields
 * it reads), so no row needs the network; the script's own live reads are the release gate's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRecord, TRIES, verdict } from '../scripts/publisher-verdict.mjs';

/** As the registry records a version published through Trusted Publishing, and one published by hand. */
const TRUSTED = { name: 'GitHub Actions', email: 'npm-oidc-no-reply@github.com', trustedPublisher: { id: 'github', oidcConfigId: 'x' } };
const BY_HAND = { name: 'someone', email: 'someone@example.com' };
const record = (latest, user, more = {}) => ({ 'dist-tags': { latest }, versions: { [latest]: { _npmUser: user }, ...more } });

test('a version the registry already holds is not published by this release', () => {
  assert.equal(verdict('@verajs/core', '0.5.0', record('0.5.0', TRUSTED)).verdict, 'skip');
  assert.equal(verdict('@verajs/core', '0.5.0', record('0.5.0', BY_HAND)).verdict, 'skip', 'a published version is not this release\'s to publish');
});

test('a new version is green only when the latest one came from the trusted publisher', () => {
  assert.equal(verdict('@verajs/core', '0.5.1', record('0.5.0', TRUSTED)).verdict, 'ok');
  const red = verdict('@verajs/lite', '0.1.1', record('0.1.0', BY_HAND));
  assert.equal(red.verdict, 'red');
  assert.match(red.why, /published by someone, not the trusted publisher/);
});

test('a package never published is red: its first publish is made by hand', () => {
  const red = verdict('@verajs/new', '0.1.0', null);
  assert.equal(red.verdict, 'red');
  assert.match(red.why, /never published/);
});

test('a record without a latest, or a latest with no publisher, is red, never a pass', () => {
  assert.equal(verdict('@verajs/x', '1.0.0', { versions: {} }).verdict, 'red');
  assert.equal(verdict('@verajs/x', '1.0.1', { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }).verdict, 'red');
});

test('a registry it cannot reach makes the check red', () => {
  const script = fileURLToPath(new URL('../scripts/check-publishers.mjs', import.meta.url));
  /** Port 9 (discard) on the loopback: refused at once, so the row takes no network and no time. */
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, VERA_NPM_REGISTRY: 'http://127.0.0.1:9' }, cwd: fileURLToPath(new URL('..', import.meta.url)) });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /could not check the publishers/);
});

/**
 * A fake registry: its first `failures` requests fail as a dropped request does (`fetch failed`), then it answers
 * `body`. It counts the requests and records the waits between them, so a row can hold the exact retry schedule.
 */
const flaky = (failures, body) => {
  const seen = { requests: 0, waits: /** @type {number[]} */ ([]) };
  const fetch = async () => {
    seen.requests++;
    if (seen.requests <= failures) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const wait = async (/** @type {number} */ ms) => void seen.waits.push(ms);
  return { seen, options: { registry: 'https://registry.invalid', fetch, wait } };
};

test('a registry read that fails twice and then answers reads that answer: one dropped request is not a verdict', async () => {
  const answer = record('0.5.0', TRUSTED);
  const { seen, options } = flaky(2, answer);
  assert.deepEqual(await readRecord('@verajs/core', options), answer);
  assert.equal(seen.requests, 3);
  assert.deepEqual(seen.waits, [500, 1000]);
});

test('a registry read that fails three times is red with the last failure, and is not tried a fourth time', async () => {
  const { seen, options } = flaky(3, record('0.5.0', TRUSTED));
  await assert.rejects(readRecord('@verajs/core', options), { message: `fetch failed (${TRIES} tries)` });
  assert.equal(seen.requests, 3);
  assert.equal(TRIES, 3);
});

test("a version is read as the record's own key, never through the prototype", () => {
  assert.equal(verdict('@verajs/x', 'constructor', record('1.0.0', TRUSTED)).verdict, 'ok', 'not taken as already published');
});

