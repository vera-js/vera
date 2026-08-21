# Changesets

Independent versioning per package (the decision of record — `CLAUDE.md`). Day to day:

1. `npx changeset` — describe what changed and pick bumps.
2. Merge to master — the release workflow opens/updates a "Version Packages" PR.
3. Merge that PR — packages publish to npm automatically, authenticated by npm Trusted
   Publishing (OIDC). There is no `NPM_TOKEN`; nothing to rotate, leak or expire.

First-time publish can also be done locally: `npm run build && npx changeset publish` after
`npm login` (publishes every public package whose version is not yet on npm).
