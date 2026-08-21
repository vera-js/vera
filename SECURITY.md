# Security policy

## Reporting

**Do not open a public issue for a security problem.** Report it privately through GitHub's
[security advisory form](https://github.com/vera-js/vera/security/advisories/new).

You should get a first response within a few days. VeraJS is maintained by one person, so please
allow reasonable time before disclosing publicly.

## How fixes are handled

In an open repository the *patch commit is itself a disclosure* — anyone watching can diff a fix and
derive the exploit before users have upgraded. So security fixes are not developed in the open:

1. The report becomes a private security advisory.
2. The fix is developed in the private fork GitHub creates for that advisory.
3. The patched version is published to npm.
4. Only then is the advisory published, crediting the reporter unless they'd rather not be.

## Scope

`@verajs/core`, `@verajs/renderer`, `@verajs/router`, `@verajs/autoloader`, `@verajs/inserts`,
`@verajs/jsx` and `@verajs/ssr`, on their latest published versions.

Every release is published from GitHub Actions using npm Trusted Publishing, and carries a
provenance attestation. You can verify what a tarball was built from:

```sh
npm audit signatures
```
