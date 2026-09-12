---
'@verajs/jsx': minor
---

The conventions port: TypeScript source, the standard build, one delivery rule. The package now
ships `dist/` like every other (`development`/`default`/`types` conditions; generated
declarations replace the hand-written `types.d.ts` that could drift from the code it described).
BREAKING (the 0.x minor): the default export is gone — `import { veraJsx } from '@verajs/jsx'`;
deep `src/` paths no longer exist — the browser standalone is
`https://cdn.jsdelivr.net/npm/@verajs/jsx@<released version>/dist/vera-jsx-standalone.min.js (llms.txt pins the live version)` (llms.txt's
buildless recipe already teaches the new path, so this version must publish for that recipe's
CDN copy-paste to resolve).
