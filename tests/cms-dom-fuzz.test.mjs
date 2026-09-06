/**
 * The cms twins — serializeHtml-then-parse against buildDom — on GENERATED markdown, extending
 * cms-dom's hand-picked corpus the way the renderer's differential fuzzes extend their case
 * tables: a seeded grammar of the shapes that make the two serializers most likely to disagree
 * (nesting emphasis, unclosed markers, escapes, custom tags, code spans holding markdown and raw
 * HTML, hostile link titles, non-ASCII). 400 documents per run, deterministic seed, and the
 * failure prints the source so a case replays on demand.
 *
 * Controls: every generated document must produce non-empty DOM (an all-empty run compares
 * nothing), and a deliberate corruption of one side must be caught by the same comparison.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { rotateScalar } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const k of ['document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];
const { parseMarkdown, serializeHtml, buildDom } = await load('cms/content');
const doc = dom.window.document;

let seed = rotateScalar(60606);
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];

const INLINE = ['plain', '*em*', '**strong**', '`co*de`', '[l](/u "t\\"x")', '![a](/i.png)', '***both***',
  'a*b', '_x_', '`</b>`', '<x-tag attr="v">t</x-tag>', 'a\\*not\\*', 'end**', '*unclosed', 'küßî ✓'];
const BLOCK = [
  () => `# H ${pick(INLINE)}`,
  () => `## ${pick(INLINE)} ${pick(INLINE)}`,
  () => `${pick(INLINE)} ${pick(INLINE)} ${pick(INLINE)}`,
  () => `- ${pick(INLINE)}\n- ${pick(INLINE)}\n  - ${pick(INLINE)}`,
  () => `${Math.floor(random() * 9) + 1}. ${pick(INLINE)}\n${Math.floor(random() * 9) + 1}. ${pick(INLINE)}`,
  () => `> ${pick(INLINE)}`,
  () => '```\ncode *not em* <b>raw</b>\n```',
  () => `${pick(INLINE)}  \n${pick(INLINE)}`,
  () => '---',
];

/** Identical to cms-dom's normalize — the shared definition of "the same DOM" for these twins. */
const normalize = (node) => {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      if (child.nextSibling === null || child.nextSibling.nodeType === 1)
        child.data = child.data.replace(/\s+$/, '');
      if (child.data === '') child.remove();
    } else normalize(child);
  }
};
const viaString = (root) => { const h = doc.createElement('div'); h.innerHTML = serializeHtml(root); normalize(h); return h; };
const viaBuilder = (root) => { const h = doc.createElement('div'); h.append(buildDom(root, { document: doc })); normalize(h); return h; };

test('the twins agree on 400 generated documents', () => {
  const mismatches = [];
  let nonEmpty = 0;
  for (let run = 0; run < 400; run++) {
    const source = Array.from({ length: Math.floor(random() * 4) + 1 }, () => pick(BLOCK)()).join('\n\n');
    const root = parseMarkdown(source);
    const built = viaBuilder(root);
    const parsed = viaString(root);
    if (built.innerHTML.length > 0) nonEmpty++;
    if (built.innerHTML !== parsed.innerHTML)
      mismatches.push({ source, built: built.innerHTML.slice(0, 160), string: parsed.innerHTML.slice(0, 160) });
  }
  assert.ok(nonEmpty > 350, `CONTROL: only ${nonEmpty} of 400 documents produced DOM`);
  assert.deepEqual(mismatches.slice(0, 4), [], `${mismatches.length} generated document(s) split the twins`);
});

test('CONTROL — the comparison catches a corrupted side', () => {
  const root = parseMarkdown('# x');
  const a = viaBuilder(root);
  const b = viaString(root);
  b.querySelector('h1').textContent = 'corrupted';
  assert.notEqual(a.innerHTML, b.innerHTML);
});

/**
 * The run-28 hostile set, pinned: shapes chosen to break the parser rather than exercise it —
 * raw script blocks (pass through BY DESIGN: the author's own repository, no sanitizer, stated in
 * markdown.ts/dom.ts/serialize.ts), seven hashes (not a heading — the regex stops at 6, so
 * h${depth} can never make an invalid element), an unterminated fence, CRLF endings, a 50k-char
 * line, emphasis chaos, empty input. Invariants: parse never throws, the twins still agree, and
 * the deliberate depth cap is the ONLY throw in the family.
 */
test('hostile markdown never throws, and the twins agree on it', () => {
  const HOSTILE = [
    '<script>alert(1)</script>',
    'before <script>x</script> after',
    '####### not a heading',
    '```js\nlet x = 1;',
    'line1\r\nline2\r\n\r\n# H\r\n',
    '***a**b*c***d**',
    'a'.repeat(50000),
    '',
    '   \n  \n',
    '- a\n  1. b\n    - c\n1. d\n- e',
  ];
  for (const md of HOSTILE) {
    const root = parseMarkdown(md);
    const built = viaBuilder(root);
    const parsed = viaString(root);
    assert.equal(built.innerHTML, parsed.innerHTML, `twins split on ${JSON.stringify(md.slice(0, 30))}`);
  }
  assert.ok(parseMarkdown('####### x').children[0].type !== 'heading', 'seven hashes is prose, not h7');
  assert.throws(() => parseMarkdown('> '.repeat(65) + 'x'),
    /nesting deeper/, 'CONTROL: the depth cap (64) is real and names itself');
});
