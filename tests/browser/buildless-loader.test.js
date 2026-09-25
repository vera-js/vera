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
const page = (block) =>
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
      <script type="importmap">${JSON.stringify({ imports: IMPORTS })}</script>
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
  expect(result.text).to.include('circular import');
  expect(result.text).to.match(/a\.jsx.*b\.jsx|b\.jsx.*a\.jsx/);
  result.frame.remove();
});

it('a missing file names itself and the file that imported it', async () => {
  const result = await page(`<script type="text/vera-jsx" src="${FIXTURES}/missing/entry.jsx"></script>`);
  expect(result.kind).to.equal('error');
  expect(result.text).to.include('not-here.jsx');
  expect(result.text).to.include('404');
  expect(result.text).to.include('missing/entry.jsx');
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
