/**
 * Frontmatter: the `---`-fenced YAML-shaped block that opens a content file, parsed by a deliberate
 * subset — not a YAML implementation.
 *
 * **Why a subset is safe here when it would be reckless anywhere else:** content files are written
 * by tooling that emits exactly these shapes, a schema layer above this validates what the fields
 * *mean*, and a hand-written file using YAML this subset does not speak
 * fails loudly with a line number instead of parsing to something almost right. A full YAML parser
 * is ~10× this file and carries YAML's own foot-guns (`no` parsing as `false`, sexagesimal
 * numbers, anchors) that no content file wants.
 *
 * The subset: string / number / boolean / null scalars, quoted strings, inline arrays of scalars
 * (`tags: [a, b]`), dashed lists of scalars or of maps (a navigation menu is a list of maps), and
 * nested maps by two-space indentation. Excluded, loudly: multiline block scalars (`|`/`>`),
 * anchors and aliases, tabs, flow maps (`{a: 1}`), and type tags.
 *
 * **Dates stay strings.** `date: 2026-09-02` parses to the string `'2026-09-02'`, never a `Date` —
 * a `Date` bakes the machine's timezone into the value (this repo has been bitten: a fixture
 * carrying `new Date(0)` stringified in Pacific time went red in a UTC CI), and the schema layer is
 * where "this string is a date" lives. This is also exactly the boundary where `z.toJSONSchema()`
 * throws on a `date` — a known hazard, dodged by never producing one.
 *
 * An entry's identity UUID is just a field in here — this parser carries no opinion
 * about which fields exist. That is the schema's job.
 */
import { parseMarkdown } from './markdown.js';
import { ContentFile, FrontmatterMap, Root, Scalar } from './types.js';

const FENCE = /^---\s*$/;
/**
 * A mapping needs its colon followed by a space or the end of the line — YAML's own indicator
 * rule, and the difference between `- https://example.com` being the scalar it is and the
 * `{"https": "//example.com"}` it silently became when the space was optional (found by the
 * final fresh-eyes review). `key:` alone still opens a nested block via the end-of-line branch.
 */
const KEY = /^([A-Za-z0-9_-]+):(?: (.*))?$/;

/** One error shape for every refusal, so a bad file names its line instead of its symptom. */
const refuse = (line: number, reason: string): never => {
  throw new Error(`parseFrontmatter: line ${line + 1}: ${reason}`);
};

/**
 * Splits a content file into its frontmatter fields and its body.
 *
 * @param source The complete file text
 * @return The parsed fields and the untouched body — parse the body with `parseMarkdown`, or use
 * `parseContent` for both in one call
 */
export const parseFrontmatter = (source: string): ContentFile => {
  const lines = source.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return { data: {}, body: source };
  let close = 1;
  while (close < lines.length && !FENCE.test(lines[close])) close++;
  if (close === lines.length) refuse(0, 'the opening --- has no closing ---');
  return {
    data: parseMap(lines.slice(1, close), 0, 1),
    body: lines.slice(close + 1).join('\n'),
  };
};

/**
 * The whole file in one call — the shape every reader actually wants.
 *
 * @param source The complete file text
 * @return The frontmatter fields, the raw body, and the body's parsed tree
 */
export const parseContent = (source: string): ContentFile & { root: Root } => {
  const file = parseFrontmatter(source);
  return { ...file, root: parseMarkdown(file.body) };
};

const parseScalar = (raw: string, line: number): Scalar => {
  if (raw === '' || raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw[0] === '"' || raw[0] === "'") {
    const quote = raw[0];
    if (raw.length < 2 || raw[raw.length - 1] !== quote)
      refuse(line, `the ${quote}…${quote} string never closes`);
    const inner = raw.slice(1, -1);
    /** Double quotes unescape the two sequences generators emit; single quotes are literal. */
    return quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner;
  }
  if (raw[0] === '|' || raw[0] === '>') refuse(line, `block scalars (${raw[0]}) are not supported — quote the string instead`);
  if (raw[0] === '&' || raw[0] === '*') refuse(line, 'YAML anchors and aliases are not supported');
  if (raw[0] === '{') refuse(line, 'flow maps ({…}) are not supported — use indented keys');
  return raw;
};

/** `[a, b, c]` — scalars only; a comma inside quotes is content, not a separator. */
const parseInlineArray = (raw: string, line: number): Scalar[] => {
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote !== '') {
      /** Inside double quotes a backslash escapes the next character — `"a\\"b, c"` is ONE item. */
      if (quote === '"' && ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((part) => {
    const trimmed = part.trim();
    /** `[a, [b]]` once parsed the inner list as the STRING "[b]" — almost right, which the subset forbids. */
    if (trimmed[0] === '[') refuse(line, 'nested arrays are not supported');
    return parseScalar(trimmed, line);
  });
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * A map from the lines at one indentation level. `offset` keeps every error message numbered
 * against the original file rather than against whichever slice recursion is holding.
 */
/** Frontmatter nests shallowly by nature; thirty-two levels is generator output gone wrong, refused by name. */
const DEPTH = 32;

const parseMap = (lines: string[], indent: number, offset: number, depth = 0): FrontmatterMap => {
  if (depth > DEPTH) refuse(offset, `nesting deeper than ${DEPTH} levels`);
  const map: FrontmatterMap = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i++;
      continue;
    }
    if (line.includes('\t')) refuse(offset + i, 'tabs are not supported — indent with two spaces');
    if (indentOf(line) !== indent) refuse(offset + i, `expected ${indent}-space indentation`);

    const entry = KEY.exec(line.trim());
    if (entry === null) refuse(offset + i, 'expected `key: value`');
    const key = entry![1];
    const raw = entry![2] ?? '';
    /**
     * The one key assignment cannot store: `map['__proto__'] = value` replaces the object's
     * prototype instead of creating the key, so the field silently vanished and its contents
     * became phantom-readable through the chain — measured before this refusal existed. Refused
     * loudly, like everything else the subset cannot hold. `constructor` and friends are ordinary
     * here: plain assignment shadows them with own keys.
     */
    if (key === '__proto__') refuse(offset + i, '`__proto__` is not a supported key');
    /** Duplicate keys silently last-won, which is the silent-data-loss family; the subset refuses. */
    if (Object.hasOwn(map, key)) refuse(offset + i, `duplicate key \`${key}\``);
    const value = raw.trim();

    if (value !== '') {
      map[key] =
        value[0] === '[' && value[value.length - 1] === ']'
          ? parseInlineArray(value, offset + i)
          : parseScalar(value, offset + i);
      i++;
      continue;
    }

    /** A bare `key:` owns every following deeper-indented line — a nested map or a dashed list. */
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > indent)) end++;
    const nested = lines.slice(i + 1, end);
    const firstNested = nested.find((l) => l.trim() !== '');
    if (firstNested === undefined) {
      map[key] = null; // `key:` with nothing under it — YAML's null, kept
    } else if (firstNested.trim().startsWith('- ') || firstNested.trim() === '-') {
      map[key] = parseListItems(nested, indentOf(firstNested), offset + i + 1, depth + 1);
    } else {
      map[key] = parseMap(nested, indentOf(firstNested), offset + i + 1, depth + 1);
    }
    i = end;
  }
  return map;
};

/** A dashed list: items are scalars, or maps whose first key shares the dash's line. */
const parseListItems = (lines: string[], indent: number, offset: number, depth: number): Scalar[] | FrontmatterMap[] => {
  const scalars: Scalar[] = [];
  const maps: FrontmatterMap[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (indentOf(line) !== indent || !/^- ?/.test(line.trim()))
      refuse(offset + i, 'expected a `- ` list item');
    const rest = line.trim().replace(/^- ?/, '');

    /** `- key: value` opens a map item that owns following deeper-indented lines. */
    if (KEY.test(rest) && !/^["']/.test(rest)) {
      let end = i + 1;
      while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > indent)) end++;
      /** The dash's own line re-joins the block, dedented to where its continuation sits. */
      const itemIndent = indent + 2;
      const block = [' '.repeat(itemIndent) + rest, ...lines.slice(i + 1, end)];
      maps.push(parseMap(block, itemIndent, offset + i, depth + 1));
      i = end;
    } else {
      scalars.push(parseScalar(rest, offset + i));
      i++;
    }
  }
  if (scalars.length > 0 && maps.length > 0)
    refuse(offset, 'a list mixes scalar and map items — use one or the other');
  return maps.length > 0 ? maps : scalars;
};
