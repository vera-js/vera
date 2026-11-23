/**
 * **`commentEnd` and the template tokenizer are one comment rule at two addresses.** `commentEnd` (`escaping.ts`) reads
 * a whole string: the server DOM's parser asks it. The template tokenizer (`tokenizer.ts`) streams statics one at a time,
 * because a comment can span a hole, so it carries its own copy of the rule. This feeds both the same comment texts and
 * asserts they agree on whether each comment has ended: every text of up to 6 characters over `-`, `!`, `>`, `a` and a
 * space after `<!--`, in one static; and every text of up to 5 split across two statics at every point, with the hole
 * between them (dropped inside a comment, leaving one space, as the client does; a value of one space otherwise, so the
 * joined text is the same either way). A mutant that knows only `-->` must disagree, or the comparison reads nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { commentEnd } = await import('../packages/ssr/dist/vera/escaping.js');
const { serializeTemplate } = await import('../packages/ssr/dist/vera/index.js');

const ALPHABET = ['-', '!', '>', 'a', ' '];
const literal = (list) => Object.assign([...list], { raw: [...list] });
const texts = (max) => {
  const out = [''];
  for (let from = 0; out.length < 5 ** (max + 1); from++) {
    if (out[from].length === max) break;
    for (const c of ALPHABET) out.push(out[from] + c);
  }
  return out.filter((t) => t.length <= max);
};

/** The tokenizer's reading: a value after the statics is served only when the comment has ended. */
const tokenizerClosed = (statics) => {
  const strings = literal([`<p><!--${statics[0]}`, ...statics.slice(1), '</p>']);
  const values = [...statics.slice(1).map(() => ' '), 'VISIBLE'];
  return serializeTemplate({ ['_$litType$']: 1, strings, values }).includes('VISIBLE');
};
const ruleClosed = (rule, joined) => rule(`<!--${joined}`, 0) !== -1;

const rows = () => {
  const out = [];
  for (const text of texts(6)) out.push({ statics: [text], joined: text });
  for (const text of texts(5))
    for (let k = 0; k <= text.length; k++) out.push({ statics: [text.slice(0, k), text.slice(k)], joined: `${text.slice(0, k)} ${text.slice(k)}` });
  return out;
};

test('commentEnd and the template tokenizer agree on where every comment ends', () => {
  const all = rows();
  assert.equal(all.length, 19531 + 22461, 'the corpus: 19531 one-static texts and 22461 splits');
  let closed = 0;
  const disagree = [];
  for (const { statics, joined } of all) {
    const rule = ruleClosed(commentEnd, joined);
    if (rule) closed++;
    if (rule !== tokenizerClosed(statics)) disagree.push(JSON.stringify(statics));
  }
  assert.ok(closed > 1000 && all.length - closed > 1000, `CONTROL: both answers occur (${closed} closed of ${all.length})`);
  assert.deepEqual(disagree.slice(0, 10), [], `${disagree.length} disagree`);
});

test('CONTROL: a rule that knows only `-->` disagrees with the tokenizer', () => {
  const arrowOnly = (markup, open) => {
    const at = markup.indexOf('-->', open + 4);
    return at === -1 ? -1 : at + 3;
  };
  const disagree = rows().filter(({ statics, joined }) => ruleClosed(arrowOnly, joined) !== tokenizerClosed(statics));
  assert.ok(disagree.length > 0, 'the mutant was caught');
});
