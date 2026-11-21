# Static builds

## The claim

**A static site renders with `@verajs/ssr` in a fraction of the time `astro build` takes.** For the same site, the
whole build is about 7× faster at 100 pages and about 3× faster at 1000. Most of that gap is the fixed cost of
starting Astro's Vite pipeline. Per page, Vera is about 1.3× faster.

## The evidence

The site: N pages. Each page has a layout with a 10-link nav and 20 cards, and each card has a title, a 16-word
text and three tags. There is no client JavaScript. Astro builds it from `src/pages/[id].astro` with
`getStaticPaths`, a Layout and a Card component, as static output. Vera builds it with a 14-line script that calls
`renderToString` once per page with two light-DOM components and writes `dist/<id>/index.html`, as Astro does.

Each run starts a fresh process and stops when the last file is on disk. Astro's caches and `dist` are deleted
before every run. Medians of 5 cold runs per arm, in a seeded shuffle. A byte-identical copy of the Vera arm is the
A/A control:

| Pages | `astro build` | Vera | Vera A/A | Astro ÷ Vera |
| --- | --- | --- | --- | --- |
| 100 | 591 ms | 82 ms | −0.5% | **7.2×** |
| 1000 | 919 ms | 336 ms | −4.1% | **2.7×** |

The extra 900 pages cost Astro 328 ms and Vera 254 ms. Both builds write N pages, and the bench checks that sampled
pages (the first, the eighth and the last) hold the same text in both.

Taken on 2026-11-20: Apple M1 with 16 GB, macOS, Node 24.18.0, Astro 7.2.9. `@verajs/ssr` and `@verajs/core` are the
production builds from `main`.

## Regenerate

```sh
npm run build && (cd bench && npm install) && node bench/ssg.mjs    # PAGES=100,1000 RUNS=5 by default
```

The fixture lives in `bench/fixtures/ssg/`. The bench copies it to a temporary directory, so neither build writes into
the repository. It is caffeinated, paused and thermal-gated like every timing tool here. It prints a ratio only when
the two Vera copies agree within 5%.

## The honest caveats

- **This is a whole-build time, and Astro's fixed start-up dominates small sites.** Astro spends about 0.5 s
  before it writes a page. As the site grows, the gap closes toward the per-page ratio (about 1.3× here).
- **The Vera arm ships no client JavaScript and runs no bundler.** If a Vera site hydrates components, its build adds
  a bundler step that this table does not count. Astro's number already includes Vite.
- **Astro does more for you.** It gives you routing from the file tree, asset handling, image optimisation and
  integrations. The Vera script does one thing: render pages and write them. Compare them as a renderer plus a loop
  against a site framework, not feature for feature.
- **Two site sizes, one page shape, one machine.** Pages with heavier layouts, Markdown or many images were not
  measured.
