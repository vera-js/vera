# cms-site — a flat-file content site

The site's entire content is the `content/` folder: markdown files with frontmatter, one folder
per collection, validated by `content/schema.json`. The `_manifests/` beside it are **generated**
by the `vera-cms` CLI and committed — `tests/cms-example.test.mjs` fails if they drift from the
content.

```sh
npm run build                                  # produce the bundles the importmap points at
node examples/cms-site/serve.js                # http://localhost:5176/examples/cms-site/
```

After editing anything under `content/`:

```sh
node packages/cms/dist/development/vera-cms-cli.js \
  --content=examples/cms-site/content --out=examples/cms-site/_manifests
```

What the page exercises, deliberately both ways: the **listing** renders from one fetch of the
generated index (no markdown parsed), and an **article** fetches its own `.md` and parses it in
the browser — the buildless path, using the renderer's documented `.innerHTML` escape hatch on
markup that is the site's own repository.
