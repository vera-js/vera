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
git add -A && git commit -m "release: 0.x.y"
node scripts/tag-release.mjs     # annotated tag per publishable package — AFTER the commit
git push --follow-tags
```

**Commit before tagging.** `tag-release.mjs` tags `HEAD`, so running it first points every tag at
the commit *before* the bump — a `@verajs/core@0.2.1` tag on a tree that still says `0.2.0`. It does
not break publishing, because CI compares master's manifests against the registry and never reads a
tag, which is why the ordering was wrong here for several releases without anyone noticing. It does
make every tag a lie about what it contains.

**And do not skip the commit.** `changeset version` only edits the working tree. If the bumps are
never committed, the push carries the old versions, CI finds them already on the registry, and the
release silently publishes nothing while reporting success.

You do not have to remember either rule: `tag-release.mjs` refuses to run against a dirty working
tree, which catches both, because committing first is the only order that leaves the tree clean at
that point. `--force` overrides it if the pending changes are genuinely unrelated.

CI then builds and publishes. That's the whole loop — no PR to merge, no button to press, no
credential anywhere.

## What CI does

[`release.yml`](../.github/workflows/release.yml) runs on every push to `master` and executes
`changeset publish`, which publishes any package whose version is not yet on npm and **skips
everything already published**. A push with no version change is a green no-op.

Authentication is **npm Trusted Publishing (OIDC)**: npm verifies the workflow's identity directly.
There is no `NPM_TOKEN`, and no secret of any kind in the release path.

## What the numbers mean

**While the packages are `0.x`, the MINOR position is the breaking boundary** — not the major one.
That is not a stylistic choice; it is what every consumer's lockfile already does:

```
^0.1.2  ->  0.1.3   installs automatically
^0.1.2  ->  0.2.0   does NOT install
```

So during `0.x`:

| Change | Bump | Consequence |
| --- | --- | --- |
| Bug fix | patch | Reaches everyone on `^0.1.x` automatically |
| New, backwards-compatible API | **patch** | Reaches everyone automatically — which is the point |
| Anything that breaks existing code | **minor** | Nobody upgrades into it unwittingly |

Shipping a *feature* as a minor during `0.x` gets this backwards twice over: it withholds an
additive change from every existing consumer, and it spends the only signal that means "this will
break you" on something that will not.

**After `1.0.0`, ordinary semver applies** — major for breaking, minor for features, patch for
fixes, exactly as React, Vue, Lit, Solid and Preact all do. None of those projects are in `0.x`, so
they are the model for afterwards, not for now.

Changesets defaults to 1.0+ semantics, so a feature must be marked `patch` deliberately while we
are pre-1.0. Reaching `1.0.0` is what removes the footgun.

---

## Adding a package

A new package cannot be published by CI on its first release, because npm will not let a trusted
publisher be configured for a package that does not exist yet, and CI has no other credential by
design. The first version goes up by hand; every version after that is an ordinary release.

```sh
npx changeset version                       # bump everything that has a changeset

# First publish of the new package only. Run this in a real terminal, one package at a time:
# npm's 2FA approval prints a URL and polls for it, so it needs a TTY and cannot be scripted.
cd packages/<name> && npm publish && cd ../..

# Attach the trusted publisher, so CI owns it from here on. Needs no 2FA approval.
npm trust github @verajs/<name> --file release.yml --repo vera-js/vera --allow-publish -y
npm trust list @verajs/<name>               # confirm before pushing

node scripts/tag-release.mjs
git push --follow-tags                      # CI publishes everything else
```

Order matters only in that the manual publish must happen before the push. `changeset publish`
skips any version already on the registry, so CI sees the new package as done and publishes the
others — no conflict, no failed job.

Publish one package at a time. `changeset publish` runs them in parallel, which races several
browser approvals at once and fails; that is what made the original bootstrap awkward.

A brand-new package needs **no changeset**. Changesets describe *changes to* a released package; a
first release has nothing to describe, and adding one would bump the package past the version you
mean to publish before it has ever shipped.

## Invariants — breaking any of these breaks publishing

- **`release.yml` must keep its name.** The trusted-publisher binding on each published package
  names `vera-js/vera` + `release.yml`. Renaming or moving the file makes every publish fail until
  every binding is recreated with `npm trust`.
- **`repository.url` must stay `git+https://github.com/vera-js/vera.git`** in every manifest. The
  registry compares it against the provenance statement and rejects a mismatch with a 422.
- **Publishing happens from this repo, and this repo must stay public.** npm provenance requires a
  public source repository.
- **Never add an `NPM_TOKEN`.** If publishing fails, the fix is in the trust configuration
  (`npm trust list @verajs/<name>`), not a credential.
- **A brand-new package's first publish cannot use Trusted Publishing.** npm requires the package to
  exist on the registry before a trusted publisher can be attached to it — the constraint holds for
  both the website and `npm trust github`. So a new package's first version is published manually
  and CI takes over from the second. See *Adding a package* below.
- **Never bump a version by hand.** `changeset version` also updates the internal dependency ranges
  between packages; editing a version field alone silently desynchronises them.
- **`shared-types` and `shared-utils` are `private: true`** and inlined into every build. They must
  never be published.

## Verifying a release

**First, confirm something actually published.** A green Release run does not mean it did — if the
version bumps were never committed, CI finds every version already on the registry and does nothing,
successfully. Read the publish step, which names exactly what it did:

```
These packages will be published as they were not found in the registry:
@verajs/core@0.2.1
```

against the alternative, which is what a no-op release looks like:

```
8 packages are already published.
```

Then check the registry. Note that npm's package endpoint lags its version endpoint by minutes, so
a just-published package can 404 through `npm view` while it is genuinely live — query the version
directly before concluding anything failed:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@verajs%2fcore/0.2.1
```

Every version from 0.1.1 onward carries a provenance attestation binding it to the exact commit and
workflow that built it:

```sh
npm audit signatures
```

The npm page for each package shows "Built and signed on GitHub Actions". A package's **first**
version never has one, and never will: it is published from a local machine because npm will not
attach a trusted publisher to a package that does not exist yet, and a local publish has no OIDC
identity to attest with. That applies to `0.1.0` of the original seven and to every package added
since. Everything published by CI after that is attested.

## If a release doesn't appear

1. **Check the run summary.** The workflow emits a notice counting changesets that have not been
   versioned. Changesets sitting in `.changeset/` with no version bump means `changeset version`
   was never run — nothing publishes, and the run still goes green.
2. **Wait before concluding it failed.** The registry's read path is cached; a package can 404 for
   several minutes after a successful publish. Check with
   `curl -s -H 'Cache-Control: no-cache' "https://registry.npmjs.org/@verajs%2fcore?t=$RANDOM"`.
3. **Re-run the workflow.** `changeset publish` is idempotent — it skips what is already published,
   so re-running only fills gaps.
