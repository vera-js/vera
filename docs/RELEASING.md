# Releasing

How a change becomes a published `@verajs/*` version. Read this before touching
`.github/workflows/release.yml`, `.changeset/`, or any `package.json` version field.

## Contributors

You do **not** need npm access, and you should not bump a version by hand. Add a changeset
describing your change and open a PR:

```sh
npx changeset
```

That writes a file in `.changeset/`. Commit it with your work. Versions and CHANGELOGs are
generated from it at release time.

## Maintainers — cutting a release

```sh
npx changeset version            # bump versions, write CHANGELOGs, consume changesets
git diff                         # review — this is the release gate
node scripts/tag-release.mjs     # annotated tag per publishable package
git add -A && git commit -m "release: 0.x.y"
git push --follow-tags
```

CI then builds and publishes. That's the whole loop — no PR to merge, no button to press, no
credential anywhere.

## What CI does

[`release.yml`](../.github/workflows/release.yml) runs on every push to `master` and executes
`changeset publish`, which publishes any package whose version is not yet on npm and **skips
everything already published**. A push with no version change is a green no-op.

Authentication is **npm Trusted Publishing (OIDC)**: npm verifies the workflow's identity directly.
There is no `NPM_TOKEN`, and no secret of any kind in the release path.

## Invariants — breaking any of these breaks publishing

- **`release.yml` must keep its name.** The trusted-publisher binding on each of the seven packages
  names `vera-js/vera` + `release.yml`. Renaming or moving the file makes every publish fail until
  all seven bindings are recreated with `npm trust`.
- **`repository.url` must stay `git+https://github.com/vera-js/vera.git`** in every manifest. The
  registry compares it against the provenance statement and rejects a mismatch with a 422.
- **Publishing happens from this repo, and this repo must stay public.** npm provenance requires a
  public source repository.
- **Never add an `NPM_TOKEN`.** If publishing fails, the fix is in the trust configuration
  (`npm trust list @verajs/<name>`), not a credential.
- **Never bump a version by hand.** `changeset version` also updates the internal dependency ranges
  between packages; editing a version field alone silently desynchronises them.
- **`shared-types` and `shared-utils` are `private: true`** and inlined into every build. They must
  never be published.

## Verifying a release

Every version from 0.1.1 onward carries a provenance attestation binding it to the exact commit and
workflow that built it:

```sh
npm audit signatures
```

The npm page for each package shows "Built and signed on GitHub Actions". `0.1.0` predates this — it
was published from a local machine during bootstrap and has no attestation.

## If a release doesn't appear

1. **Check the run summary.** The workflow emits a notice counting changesets that have not been
   versioned. Changesets sitting in `.changeset/` with no version bump means `changeset version`
   was never run — nothing publishes, and the run still goes green.
2. **Wait before concluding it failed.** The registry's read path is cached; a package can 404 for
   several minutes after a successful publish. Check with
   `curl -s -H 'Cache-Control: no-cache' "https://registry.npmjs.org/@verajs%2fcore?t=$RANDOM"`.
3. **Re-run the workflow.** `changeset publish` is idempotent — it skips what is already published,
   so re-running only fills gaps.
