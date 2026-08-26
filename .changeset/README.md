# Changesets

Independent versioning per package (the decision of record — `CLAUDE.md`). Day to day:

1. `npx changeset` — describe what changed and pick bumps.

> **While `0.x`, `minor` means breaking.** `^0.1.2` installs `0.1.3` and never `0.2.0`, so that is
> where npm already draws the line and where this project draws it. **A feature is a `patch`. A fix
> is a `patch`. `minor` is for a change that can break a consumer** — something removed, renamed,
> moved to another entry point, or a requirement they can now fail. `major` never applies yet.
>
> Changesets defaults to 1.0+ semantics, so **`patch` has to be chosen deliberately** — the prompt
> will suggest otherwise. Three of the pending changesets had taken that default, and one would have
> shipped a brand-new package as a breaking release.
>
> If a `minor` is right, say in the description *what it breaks*. `tests/changesets.test.mjs` checks
> the mechanical part; this half is yours.
2. `npx changeset version` — bump versions and write CHANGELOGs.
3. Review the diff. This is the release gate.
4. Commit and push to master.

CI publishes everything on master that is not yet on npm, authenticated by npm Trusted Publishing
(OIDC), and pushes a git tag per published version. There is no `NPM_TOKEN`; nothing to rotate,
leak or expire. A push with no version change is a green no-op — `changeset publish` skips anything
already published.

There is deliberately no "Version Packages" PR: the version bump is reviewed locally instead, which
keeps the release path free of both a repository-wide permission grant and a stored credential.

Full process, invariants and troubleshooting: [`docs/RELEASING.md`](../docs/RELEASING.md).
