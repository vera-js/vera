import { expect } from '@esm-bundle/chai';

/**
 * **What `@verajs/ssr` serves, parsed by the engine a user has.** Random templates over the parse-mode alphabet (see
 * `workers/ssr-fuzz.worker.js`) each end in one hole whose value tries to close every raw-text element and open a live
 * `<img id=pwn>`. The worker serves them; this page parses each served string twice, in a real engine:
 *
 *   - **scripting on**, as a page with JavaScript parses it: a fragment in a `<body>` context, inside an iframe whose
 *     content security policy loads and runs nothing, so a case's `<img>` costs no request;
 *   - **scripting off** (`DOMParser`), as a browser with JavaScript disabled does, where `<noscript>` holds markup.
 *
 * A case is an injection when either parse holds an HTML `<img id=pwn>`. jsdom cannot stand in: run against the three
 * engines, this search found, in one night, three injections jsdom parsed as harmless (Chromium's newer `<select>`
 * parser, the scripting-off `<noscript>`, and the engines' own tokenizers at a foreign-content integration point).
 *
 * Seeds come from the node suites' contract (`tests/fuzz-seeds.mjs`, through the test runner's `/fuzz-seeds` route):
 * these standing seeds locally, rotated extras in CI, `VERA_FUZZ_SEEDS` to replay a find. **CI runs this on Chromium
 * only** (the runner's default; `VERA_BROWSERS` selects more): Firefox and WebKit get it in the release gate's three
 * engines, so a class only they parse is caught there and not by CI's rotation.
 *
 * It can fail: a plant (a served string that IS an injection) every 500 cases must be seen in both parses, with an
 * exact count; the cases served must stay above a floor, with refusals counted per code, so a generator that stops
 * reaching the serializer shows; and no static of the alphabet holds the detector's id, so only a hole's value can.
 */

const BASE = [777, 4242, 90001, 1020563245, 1504043507];
const COUNT = 5000;
const PLANT_EVERY = 500;
const PLANT = '<div id="host"><img id=pwn src=x></div>';
/** At least this share of cases is served rather than refused (each standing seed reads about 89%; a floor, not a pin). */
const SERVED_FLOOR = 0.5;
const HTML_NS = 'http://www.w3.org/1999/xhtml';

const seeds = await (await fetch(`/fuzz-seeds?base=${BASE.join(',')}`)).json();

const serve = (seed) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/ssr-fuzz.worker.js', import.meta.url), { type: 'module' });
    const done = (fn) => (value) => {
      worker.terminate();
      fn(value);
    };
    worker.onmessage = ({ data }) => (data.ok ? done(resolve)(data) : done(reject)(new Error(data.error)));
    worker.onerror = (event) => done(reject)(new Error(event.message ?? 'the worker failed to start'));
    worker.postMessage({ seed, count: COUNT });
  });

/** One iframe for every scripting-on parse: scripting stays on, and its policy blocks every load and every script. */
const frame = await new Promise((resolve) => {
  const iframe = document.createElement('iframe');
  iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><body></body>`;
  iframe.onload = () => resolve(iframe);
  document.body.append(iframe);
});
const range = frame.contentDocument.createRange();
range.selectNodeContents(frame.contentDocument.body);
const parser = new DOMParser();

const live = (root) => [...root.querySelectorAll('[id="pwn"]')].some((node) => node.namespaceURI === HTML_NS && node.localName === 'img');
const injected = (markup) => live(range.createContextualFragment(markup)) || live(parser.parseFromString(markup, 'text/html'));

it('CONTROL: the plant is an injection in both parses, and the alphabet holds no detector id', async () => {
  expect(live(range.createContextualFragment(PLANT))).to.equal(true);
  expect(live(parser.parseFromString(PLANT, 'text/html'))).to.equal(true);
  const { statics } = await serve(BASE[0]);
  expect(statics.filter((text) => text.includes('pwn'))).to.deep.equal([]);
});

for (const seed of seeds) {
  it(`seed ${seed}: no served case is an injection`, async () => {
    const { served, refused } = await serve(seed);
    let plants = 0;
    let seen = 0;
    const found = [];
    served.forEach((entry, k) => {
      if (k % PLANT_EVERY === 0) {
        plants++;
        if (injected(PLANT)) seen++;
      }
      if (injected(entry.markup)) found.push(`#${entry.i} ${entry.source}\n      ${entry.markup.slice(0, 300)}`);
    });
    const share = served.length / COUNT;
    console.log(`seed ${seed}: ${served.length}/${COUNT} served, refused ${JSON.stringify(refused)}`);
    expect(seen, 'every plant is seen').to.equal(plants);
    expect(plants, 'plants placed').to.equal(Math.ceil(served.length / PLANT_EVERY));
    expect(share, `served share (refused ${JSON.stringify(refused)})`).to.be.at.least(SERVED_FLOOR);
    expect(found, `seed ${seed}, replay with VERA_FUZZ_SEEDS=${seed}`).to.deep.equal([]);
  });
}
