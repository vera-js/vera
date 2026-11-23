/**
 * **`<!x>` and `<?y>` are bogus comments, as every parser reads them** (2026-11-23). The server's DOM read
 * `a<!x>b<?y>c` as one text run holding the markup, so `textContent` answered `a<!x>b<?y>c` where a browser answers
 * `abc` with two comment nodes — component code reading a value back saw what no page has. The served bytes stay as
 * assigned. Each row is compared with jsdom's parser (parse5), which the engines agree with here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

await import('@verajs/ssr');
const real = new JSDOM('<!doctype html><body></body>').window.document;
const shim = globalThis.document;

const read = (doc, markup) => {
  const host = doc.createElement('div');
  host.innerHTML = markup;
  return { text: host.textContent, nodes: [...host.childNodes].map((n) => `${n.nodeType}:${n.data ?? n.localName}`) };
};

test('a bogus comment reads as the parser reads it, and the bytes are served as assigned', () => {
  const ROWS = [
    'a<!x>b<?y>c', '<!>z', '<?>q', '<p>1<!x y>2</p>', '<svg><!x></svg>', '<ul><li>a<?php echo ?>b</li></ul>',
    /** A single dash is not `<!--`; a NUL in any comment's data is U+FFFD; CR LF is LF. */
    '<!-x>z', '<!->z', '<!a\0b>z', '<?a\0b>z', '<!--a\0b-->z', '<!a\r\nb>z',
  ];
  for (const markup of ROWS) {
    const theirs = read(real, markup);
    assert.ok(theirs.nodes.length > 0, `CONTROL: the parser read ${markup}`);
    assert.deepEqual(read(shim, markup), theirs, markup);
    const host = shim.createElement('div');
    host.innerHTML = markup;
    assert.equal(host.innerHTML, markup, `${JSON.stringify(markup)}: served as assigned`);
  }
  assert.ok(read(real, 'a<!x>b').nodes.some((n) => n.startsWith('8:')), 'CONTROL: the parser makes a comment node');
});
