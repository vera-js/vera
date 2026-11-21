// The Vera arm: render every page with @verajs/ssr and write dist/<id>/index.html, as `astro build` does.
import { renderToString } from '@verajs/ssr';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pages } from '../data.mjs';
const out = new URL('./dist/', import.meta.url);
rmSync(out, { recursive: true, force: true });
const entry = new URL('./components/site-page.js', import.meta.url);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const page of pages(Number(process.env.PAGES))) {
  const { html } = await renderToString(entry, { props: { page } });
  const dir = new URL(`${page.id}/`, out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), `<!doctype html><html><head><meta charset="utf-8"><title>${esc(page.title)}</title></head><body>${html}</body></html>`);
}
