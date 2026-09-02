/**
 * The frontmatter subset: what it parses, and — just as deliberately — what it refuses.
 *
 * Half of these tests assert refusals with line numbers, because the subset's safety argument
 * (packages/cms/src/frontmatter.ts) is that unsupported YAML fails loudly instead of parsing to
 * something almost right. A refusal that stopped refusing would silently widen the format.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { parseFrontmatter, parseContent } = await load('cms/publish');

const parse = (yaml) => parseFrontmatter(`---\n${yaml}\n---\nbody`).data;

test('a file with no frontmatter is all body', () => {
  assert.deepEqual(parseFrontmatter('# Just markdown'), { data: {}, body: '# Just markdown' });
});

test('scalars: strings, numbers, booleans, null', () => {
  assert.deepEqual(parse('title: Hello World\ncount: 3\nrate: -1.5\ndraft: false\nlive: true\nnothing: null\ntilde: ~'), {
    title: 'Hello World',
    count: 3,
    rate: -1.5,
    draft: false,
    live: true,
    nothing: null,
    tilde: null,
  });
});

test('dates stay strings — the timezone stays out of the data', () => {
  const { date } = parse('date: 2026-09-02');
  assert.equal(date, '2026-09-02');
  assert.equal(typeof date, 'string');
});

test('quoted strings keep what quoting protects', () => {
  assert.deepEqual(parse('a: "true"\nb: "3"\nc: \'null\'\nd: "say \\"hi\\""\ne: \'no \\ escapes\''), {
    a: 'true',
    b: '3',
    c: 'null',
    d: 'say "hi"',
    e: 'no \\ escapes',
  });
});

test('inline arrays, including quoted commas', () => {
  assert.deepEqual(parse('tags: [design, css, 3, true]\ntricky: ["a, b", c]\nempty: []'), {
    tags: ['design', 'css', 3, true],
    tricky: ['a, b', 'c'],
    empty: [],
  });
});

test('dashed lists of scalars', () => {
  assert.deepEqual(parse('tags:\n  - design\n  - css'), { tags: ['design', 'css'] });
});

test('dashed lists of maps — the navigation-menu shape', () => {
  assert.deepEqual(parse('nav:\n  - label: Home\n    url: /\n  - label: About\n    url: /about'), {
    nav: [
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about' },
    ],
  });
});

test('nested maps by indentation', () => {
  assert.deepEqual(parse('seo:\n  title: Override\n  image:\n    url: /og.png\n    width: 1200'), {
    seo: { title: 'Override', image: { url: '/og.png', width: 1200 } },
  });
});

test('comments and blank lines are ignored; a bare key is null', () => {
  assert.deepEqual(parse('# a comment\n\ntitle: Yes\nempty:'), { title: 'Yes', empty: null });
});

test('the identity field is just a field — no opinion lives in the parser', () => {
  const { uuid } = parse('uuid: 018f3a2e-1111-7000-8000-abcdefabcdef');
  assert.equal(uuid, '018f3a2e-1111-7000-8000-abcdefabcdef');
});

/** Every refusal names its line — the file's line, not the recursion's slice. */
const refuses = (yaml, pattern) => {
  assert.throws(() => parse(yaml), pattern);
};

test('an unclosed fence refuses', () => {
  assert.throws(() => parseFrontmatter('---\ntitle: x\nno closing fence'), /line 1: .*no closing/);
});

test('block scalars refuse with the workaround named', () => {
  refuses('text: |', /line 2: block scalars.*quote the string/);
});

test('anchors, flow maps, and tabs refuse', () => {
  refuses('a: &anchor x', /line 2: .*anchors/);
  refuses('a: {b: 1}', /line 2: flow maps/);
  refuses('a:\n\tb: 1', /line 3: tabs/);
});

test('a non-key line refuses with its own line number, not its slice index', () => {
  refuses('title: ok\nseo:\n  good: yes\n  !!broken', /line 5: expected `key: value`/);
});

test('a dashed scalar containing a colon is a scalar — it once became a map, silently', () => {
  /** The fresh-eyes find: URL lists are everyday content, and YAML's own rule (colon needs a following space) settles it. */
  assert.deepEqual(parse('links:\n  - https://example.com\n  - https://b.org/x:y'), {
    links: ['https://example.com', 'https://b.org/x:y'],
  });
  assert.deepEqual(parse('times:\n  - 12:30'), { times: ['12:30'] });
  /** With the space it IS a map item — YAML agrees. */
  assert.deepEqual(parse('nav:\n  - label: Home'), { nav: [{ label: 'Home' }] });
  /** Value position always spoke colons; still does. */
  assert.deepEqual(parse('url: https://example.com/a:b'), { url: 'https://example.com/a:b' });
  /** And a spaceless bare line is refused loudly, not half-read. */
  refuses('https://example.com', /expected `key: value`/);
});

test('a nested inline array refuses instead of parsing as a string — audit pass 8', () => {
  refuses('k: [a, [b]]', /nested arrays are not supported/);
});

test('a duplicate key refuses instead of silently last-winning — audit pass 2', () => {
  refuses('title: One\ntitle: Two', /line 3: duplicate key `title`/);
});

test('a list mixing scalar and map items refuses', () => {
  refuses('items:\n  - plain\n  - key: value', /mixes scalar and map/);
});

test('parseContent hands back data, body, and the parsed tree in one call', () => {
  const { data, body, root } = parseContent('---\ntitle: T\n---\n# Heading');
  assert.equal(data.title, 'T');
  assert.equal(body, '# Heading');
  assert.equal(root.children[0].type, 'heading');
});
