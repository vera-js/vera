# Zero dependencies

## The claim

**Every published `@verajs/*` package has zero third-party runtime dependencies — the whole stack,
not just the core. Nothing to audit, nothing to patch, no transitive CVE surface.**

## The evidence

Transitive `dependencies` for the packages a consumer installs to render the same working counter
measured in [size.md](size.md):

<!--size:table.deps-->
| Framework | third-party deps | what they are |
| --- | ---: | --- |
| Van.js | 0 | — |
| Preact + signals | 0 | — |
| **VeraJS + own renderer** | **0** | — |
| petite-vue | 0 | — |
| **VeraJS + lit-html** | **1** | `@types/trusted-types` |
| React | 1 | `scheduler` |
| Alpine.js | 2 | `@vue/reactivity`, `@vue/shared` |
| Solid | 3 | `csstype`, `seroval`, `seroval-plugins` |
| Lit | 5 | `@lit-labs/ssr-dom-shim`, `@lit/reactive-element`, `@types/trusted-types`, `lit-element`, +1 more |
| Vue | 22 | `@babel/helper-string-parser`, `@babel/helper-validator-identifier`, `@babel/parser`, `@babel/types`, +18 more |
<!--/size:table.deps-->

**All eleven published packages** declare no third-party dependency: `core`, `renderer`, `router`,
`autoloader`, `inserts`, `jsx`, `ssr`, `reactivity`, `styles`, `eslint-config` and `tsconfig`. The
only entries in any `dependencies` field are first-party — `@verajs/inserts` for core, and
`@verajs/core` for `reactivity` — and the production bundles inline them.

Verify by enumerating rather than by list, since a list is what went stale here: this said "seven"
from before `reactivity` and `styles` were split out of core in 0.2.0, and the command below named
the same seven, so running it confirmed the claim about a subset while reading as though it covered
everything.

```bash
node -e "const { globSync, readFileSync } = require('fs');
for (const f of globSync('packages/*/package.json')) {
  const m = JSON.parse(readFileSync(f, 'utf8'));
  if (m.private) continue;
  const third = [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.peerDependencies ?? {})]
    .filter((d) => !d.startsWith('@verajs/'));
  console.log(m.name, third.length ? third : 'zero third-party');
}"
```

`tests/zero-dependencies.test.mjs` asserts the same thing on every run.

## Why measured this way

`dependencies` only. `devDependencies` never reach a consumer, and counting them would flatter
every framework equally while describing nothing anyone installs. `peerDependencies` are counted
where declared, since a consumer must install them.

The count is transitive: a single direct dependency that drags in twenty is twenty packages in the
lockfile, twenty entries in an audit, and twenty chances for a supply-chain advisory.

## The honest framing

**Zero is not unique, and claiming it is would not survive a reader who checks.** Van.js,
petite-vue and Preact + signals all ship zero as well; React ships one. Say "zero" as a property,
never as a distinction.

**What is uncommon is holding zero across a complete stack.** The other zero-dependency options are
single-purpose micro-libraries — they have nothing to depend on because they do one thing. VeraJS
holds zero while also shipping a router, an SSR renderer and a JSX compiler. Lit, the framework
VeraJS actually competes with in design systems, ships five.

**Do not imply an audit story you have not earned.** "No dependencies" reduces supply-chain surface;
it says nothing about the security of the code that is there. One maintainer and no external audit
is the honest state — see [README.md](README.md) on what not to claim.

## Reproduce

```bash
cd bench && npm install && cd ..     # the competing frameworks, installed on demand
npm run build && node bench/size.mjs --snapshot
node scripts/sync-size-claims.mjs    # regenerates the table above
```
