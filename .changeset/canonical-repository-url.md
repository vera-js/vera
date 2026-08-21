---
'@verajs/autoloader': patch
'@verajs/core': patch
'@verajs/inserts': patch
'@verajs/jsx': patch
'@verajs/renderer': patch
'@verajs/router': patch
'@verajs/ssr': patch
---

Pin the canonical `git+https://` form of `repository.url`.

npm normalizes this field on publish, and the registry compares the normalized
value against the provenance statement's source repository — a mismatch is
rejected with a 422. Carrying the normalized form in the manifest removes the
dependency on auto-correction.

This is also the first release published from GitHub Actions via npm Trusted
Publishing, so these are the first `@verajs` tarballs to carry a provenance
attestation.
