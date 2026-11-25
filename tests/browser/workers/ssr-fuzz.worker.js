/**
 * Generates and serves the engine fuzz's cases through `@verajs/ssr` inside a Web Worker, for `../ssr-engine-fuzz.test.js`.
 *
 * Each case is a random template over the parse-mode alphabet below (foreign content and its integration points, raw
 * and escapable raw text, tables, selects, `noscript`, `template`, CDATA), ending in one hole whose value tries to
 * close every raw-text element and open a live `<img>`. The serializer is the code under test; the page parses what it
 * served, in a real engine. Seeded, so a case replays from its seed and index. The alphabet weights openers of
 * text-only elements and the elements that break out of foreign content, where every injection it has found lived.
 *
 * The listener is registered before the dynamic import, as in `ssr-render.worker.js`: a message that arrives during the
 * shim's top-level `await` is dropped, not queued, when no handler is set yet.
 */
const pending = [];
let handle = (data) => pending.push(data);
self.addEventListener('message', ({ data }) => handle(data));

const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await import('@verajs/core');

const OPEN = ['<svg>', '<math>', '<foreignObject>', '<title>', '<desc>', '<mtext>', '<mi>', '<annotation-xml encoding="text/html">', '<annotation-xml>',
  '<g>', '<a>', '<mrow>', '<section>', '<font>', '<font color=x>', '<p>', '<div>', '<span>', '<table>', '<tr>', '<td>', '<select>', '<option>',
  '<noscript>', '<template>', '<object>', '<b>', '<br>', '<img>', '<math><mi>', '<svg><desc>'];
const CLOSE = ['</svg>', '</math>', '</foreignObject>', '</title>', '</desc>', '</mtext>', '</mi>', '</annotation-xml>', '</g>', '</a>', '</mrow>',
  '</section>', '</font>', '</p>', '</br>', '</div>', '</span>', '</table>', '</td>', '</select>', '</noscript>', '</template>', '</object>', '</b>'];
const TEXT = ['<title>', '<textarea>', '<xmp>', '<noembed>', '<noframes>', '<iframe>', '<style>', '<script>', '<plaintext>'];
const BREAK = ['<table>', '<p>', '<div>', '<b>', '<br>', '<ul>', '<pre>', '</p>', '</br>'];
const OTHER = ['<![CDATA[', ']]>', '<![CDATA[ x ]]>', '<!-- c -->', 'text', '<style>a{}</style>', '<textarea>t</textarea>', '<svg/>', '<math/>'];
const VALUE = '</style></textarea></title></script><img id=pwn src=x onerror=1>';
const HOLES = [['<style>', '</style>'], ['<textarea>', '</textarea>'], ['<title>', '</title>'], ['<script type="application/json">', '</script>'],
  ['<p title=', '>x</p>'], ['<p title="', '">x</p>'], ['', '']];

const generate = (seed, count) => {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff), state / 0x7fffffff);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const served = [];
  const refused = {};
  for (let i = 0; i < count; i++) {
    let before = '';
    const parts = 1 + Math.floor(random() * 7);
    for (let k = 0; k < parts; k++) {
      const r = random();
      before += r < 0.35 ? pick(OPEN) : r < 0.65 ? pick(CLOSE) : r < 0.78 ? pick(TEXT) : r < 0.9 ? pick(BREAK) : pick(OTHER);
    }
    const [open, close] = pick(HOLES);
    const strings = [before + open, close];
    const template = html(Object.assign(strings.slice(), { raw: strings.slice() }), VALUE);
    try {
      served.push({ i, source: `${before + open}\${value}${close}`, markup: serializeTemplate(html`<div id="host">${template}</div><p id="after">after</p>`) });
    } catch (error) {
      const code = /\(([a-z-]+)\)/.exec(String(error?.message))?.[1] ?? `uncoded: ${String(error?.message).slice(0, 60)}`;
      refused[code] = (refused[code] ?? 0) + 1;
    }
  }
  return { served, refused };
};

handle = (data) => {
  try {
    self.postMessage({ ok: true, statics: [OPEN, CLOSE, TEXT, BREAK, OTHER, HOLES].flat(2), ...generate(data.seed, data.count) });
  } catch (error) {
    self.postMessage({ ok: false, error: `${error?.name}: ${error?.message}` });
  }
};
for (const data of pending.splice(0)) handle(data);
