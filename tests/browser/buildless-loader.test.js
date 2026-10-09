/**
 * The buildless loader on real engines, set up exactly as a self-hosted page is: an import map of
 * three entries — core, renderer, jsx — pointing at the built files, `import '@verajs/jsx'`, and an
 * app of ordinary `.jsx`/`.js` files. Nothing else is mapped: `keyed` and `namespaces`, which the
 * compiled code imports, and `slots`, which the app imports, must be found beside the renderer.
 *
 * Each case runs in its own iframe, because a blob module resolves package names only through ITS
 * page's import map, and this page — the test runner's — has none and cannot gain one once modules
 * have loaded.
 */
import { expect } from '@esm-bundle/chai';

const FIXTURES = '/tests/browser/fixtures/buildless';
const IMPORTS = {
  '@verajs/core': '/packages/core/dist/vera.min.js',
  '@verajs/renderer': '/packages/renderer/dist/vera-renderer.min.js',
  '@verajs/jsx': '/packages/jsx/dist/vera-jsx-standalone.min.js',
};

/** Runs one page and resolves with the first message it posts — the app's report, or an error. */
const page = (block, { imports = IMPORTS, maps = [] } = {}) =>
  new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const timer = setTimeout(() => reject(new Error('the page never reported — a hang, not an error')), 15000);
    addEventListener('message', function listen(event) {
      if (event.source !== frame.contentWindow) return;
      removeEventListener('message', listen);
      clearTimeout(timer);
      resolve({ ...event.data, frame });
    });
    frame.srcdoc = `<!doctype html>
      <script type="importmap">${JSON.stringify({ imports })}</script>
      ${maps.map((extra) => `<script type="importmap">${JSON.stringify({ imports: extra })}</script>`).join('')}
      <script>
        const report = console.error;
        console.error = (...args) => { parent.postMessage({ kind: 'error', text: args.map(String).join(' ') }, '*'); report(...args); };
      </script>
      <script type="module">import '@verajs/jsx';</script>
      ${block}`;
    document.body.appendChild(frame);
  });

const compilerFetched = (frame) =>
  frame.contentWindow.performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('/vera-jsx.min.js'));

it('a multi-file app loads: JSX importing JSX, a relative .js, import(), import.meta.url and SVG children', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/app/main.jsx"></script>`);
  expect(result.kind, result.text).to.equal('app');
  expect(result.items, 'the keyed rows rendered — keyed was found beside the renderer').to.equal(3);
  expect(result.svg, "a component's <path> child parsed where it landed").to.equal('http://www.w3.org/2000/svg');
  expect(result.meta, 'import.meta.url is the file, not a blob').to.match(/\/fixtures\/buildless\/app\/main\.jsx$/);
  expect(result.late).to.equal('dynamic import compiled');
  expect(result.slotted, '@verajs/renderer/slots, not in the map, was found beside the renderer and distributed').to.equal('T');
  result.frame.remove();
});

it('a repeat visit compiles nothing and never loads the compiler', async () => {
  /** A cold first visit, so the control below can fail: an earlier test has already filled the cache. */
  localStorage.clear();
  const first = await page(`<script type="text/vera-jsx" src="${FIXTURES}/app/main.jsx"></script>`);
  expect(first.kind, first.text).to.equal('app');
  expect(compilerFetched(first.frame), 'CONTROL: a cold visit does load the compiler').to.equal(true);
  first.frame.remove();
  const again = await page(`<script type="text/vera-jsx" src="${FIXTURES}/app/main.jsx"></script>`);
  expect(again.kind, again.text).to.equal('app');
  expect(compilerFetched(again.frame), 'every file was served from the compiled cache').to.equal(false);
  again.frame.remove();
});

it('a circular import is named with its loop — even when both sides load in parallel', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/cycle/entry.jsx"></script>`);
  expect(result.kind).to.equal('error');
  /** By code, in this (production) build: the block that failed, and the loop as the error's subject. */
  expect(result.text).to.include('/e/jsx-block-failed');
  expect(result.text).to.include('/e/jsx-circular-import');
  expect(result.text).to.match(/a\.jsx → \S*b\.jsx|b\.jsx → \S*a\.jsx/);
  result.frame.remove();
});

it('a missing file names itself and the file that imported it', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/missing/entry.jsx"></script>`);
  expect(result.kind).to.equal('error');
  expect(result.text).to.include('not-here.jsx');
  expect(result.text).to.include('404');
  expect(result.text).to.include('missing/entry.jsx');
  expect(result.text, 'by code — the file, status and importer are its subject').to.include('/e/jsx-fetch-status');
  result.frame.remove();
});

it('an inline block compiles and can import files', async () => {
  const result = await page(`<script type="text/vera-jsx">
    import { Frame } from '${FIXTURES}/app/frame.jsx';
    const view = <Frame><circle r="1" /></Frame>;
    parent.postMessage({ kind: 'app', inline: typeof view.strings }, '*');
  </script>`);
  expect(result.kind, result.text).to.equal('app');
  expect(result.inline).to.equal('object');
  result.frame.remove();
});

it('every import form resolves as written: a template-literal import(), options, JSON modules and import.meta.resolve', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/forms/main.jsx"></script>`);
  expect(result.kind, result.text).to.equal('app');
  expect(result.templated, 'import(`./${name}.jsx`) went through the loader').to.equal('template-literal import');
  expect(result.sameModule, 'a full URL and a call before a block reach the SAME module').to.equal(true);
  expect(result.blockRan).to.equal(true);
  expect(result.json, "a static JSON import with { type: 'json' } is the browser's").to.equal('json module');
  expect(result.dynamicJson, 'and a dynamic one, options and all').to.equal('json module');
  expect(result.resolved, 'import.meta.resolve answers against the file').to.match(/\/fixtures\/buildless\/forms\/late\.jsx$/);
  expect(result.meta).to.match(/\/fixtures\/buildless\/forms\/main\.jsx$/);
  result.frame.remove();
});

it('a plain .js file keeps only where its imports are in the cache, never its text', async () => {
  localStorage.clear();
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/app/main.jsx"></script>`);
  expect(result.kind, result.text).to.equal('app');
  const entry = (suffix) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(suffix));
    return key === undefined ? undefined : JSON.parse(localStorage.getItem(key));
  };
  expect(entry('/app/main.jsx')?.js, 'CONTROL: a JSX file keeps its compiled output').to.be.a('string');
  expect(entry('/app/lib/util.js'), 'the JS file was cached').to.not.equal(undefined);
  expect(entry('/app/lib/util.js').js, 'without its text').to.equal(undefined);
  result.frame.remove();
});

it("a renderer helper missing from beside the renderer is named, not left as a blob error", async () => {
  const result = await new Promise((resolve) => {
    const said = [];
    const frame = document.createElement('iframe');
    addEventListener('message', function listen(event) {
      if (event.source !== frame.contentWindow) return;
      said.push(event.data);
      if (said.some((m) => m.kind === 'error' && m.text.includes('/e/jsx-helper-missing'))) {
        removeEventListener('message', listen);
        resolve({ said, frame });
      }
    });
    frame.srcdoc = `<!doctype html>
      <script type="importmap">${JSON.stringify({ imports: { ...IMPORTS, '@verajs/renderer': `${FIXTURES}/nohelpers/vera-renderer.min.js` } })}</script>
      <script>
        const report = console.error;
        console.error = (...args) => { parent.postMessage({ kind: 'error', text: args.map(String).join(' ') }, '*'); report(...args); };
      </script>
      <script type="module">import '@verajs/jsx';</script>
      <script type="text/vera-jsx" src="${FIXTURES}/nohelpers/main.jsx"></script>`;
    document.body.appendChild(frame);
  });
  /** By code in this (production) build; the helper's address is the line's subject, so it is named in every build. */
  const named = result.said.find((m) => m.text.includes('/e/jsx-helper-missing'));
  expect(named.text).to.include('nohelpers/vera-renderer-namespaces.min.js');
  result.frame.remove();
});

it('a renderer mapped in a SECOND import map still resolves its helpers', async function () {
  /** Firefox does not allow a second map at all — the platform's refusal, not the loader's. */
  if (/Firefox/.test(navigator.userAgent)) this.skip();
  const { '@verajs/renderer': renderer, ...rest } = IMPORTS;
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/app/main.jsx"></script>`, {
    imports: rest,
    maps: [{ '@verajs/renderer': renderer }],
  });
  expect(result.kind, result.text).to.equal('app');
  expect(result.items, 'keyed, found beside a renderer the second map names').to.equal(3);
  result.frame.remove();
});

it('inline blocks are cached too, and each has its own import.meta', async () => {
  localStorage.clear();
  const block = `<script type="text/vera-jsx">
    import.meta.mark = (import.meta.mark ?? 0) + 1;
    window.__metas = [...(window.__metas ?? []), import.meta];
    const view = <b>inline</b>;
    if (window.__metas.length === 2) parent.postMessage({ kind: 'app', distinct: window.__metas[0] !== window.__metas[1], marks: window.__metas.map((m) => m.mark).join(), inline: view.strings.length }, '*');
  </script>`;
  const first = await page(block + block);
  expect(first.kind, first.text).to.equal('app');
  expect(first.distinct, 'two blocks, two import.meta objects').to.equal(true);
  expect(first.marks).to.equal('1,1');
  expect(compilerFetched(first.frame), 'CONTROL: a cold visit compiles').to.equal(true);
  first.frame.remove();
  const again = await page(block + block);
  expect(again.kind, again.text).to.equal('app');
  expect(compilerFetched(again.frame), 'a repeat visit reuses the inline blocks\' compiled output').to.equal(false);
  again.frame.remove();
});

it('a file the import map names, imported by its path or full URL, is the same module', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/mapped/main.jsx"></script>`);
  expect(result.kind, result.text).to.equal('app');
  expect(result.samePath, 'by path').to.equal(true);
  expect(result.sameUrl, 'by full URL').to.equal(true);
  result.frame.remove();
});

/**
 * **The compile-time controlled-input warning reaches a buildless page in development** — the users least likely to
 * read a changelog (vera-5a). Mapped to the DEVELOPMENT standalone (production folds the warning away), the page hooks
 * console.warn before the loader runs; a control with an input handler must stay silent and report the app instead.
 */
const DEV_IMPORTS = { ...IMPORTS, '@verajs/jsx': '/packages/jsx/dist/development/vera-jsx-standalone.js' };
const warnHook = `<script>
  const warn = console.warn;
  console.warn = (...args) => {
    if (String(args[0]).includes('[vera] jsx:')) parent.postMessage({ kind: 'warn', text: String(args[0]) }, '*');
    warn(...args);
  };
</script>`;
it('development: a controlled input with nothing keeping it in step is warned about, with its position', async () => {
  const result = await page(
    `${warnHook}<script type="text/vera-jsx">const v = 'x'; document.body.append(document.createElement('p')); const t = <input value={v} />; parent.postMessage({ kind: 'app' }, '*');</script>`,
    { imports: DEV_IMPORTS }
  );
  expect(result.kind, result.text).to.equal('warn');
  expect(result.text).to.match(/\[vera\] jsx: .*value=\{…\} makes this <input> controlled[\s\S]*\(jsx-uncontrolled\)$/);
  result.frame.remove();
});
it('development: CONTROL — with onInput nothing is said, and the app runs', async () => {
  const result = await page(
    `${warnHook}<script type="text/vera-jsx">let v = 'x'; const t = <input value={v} onInput={(e) => (v = e.target.value)} />; parent.postMessage({ kind: 'app' }, '*');</script>`,
    { imports: DEV_IMPORTS }
  );
  expect(result.kind, result.text).to.equal('app');
  result.frame.remove();
});
