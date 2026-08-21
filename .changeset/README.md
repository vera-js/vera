# Changesets

Independent versioning per package (the decision of record — `CLAUDE.md`). Day to day:

1. `npx changeset` — describe what changed and pick bumps.
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
