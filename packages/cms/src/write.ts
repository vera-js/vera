/**
 * The write half of the content format: fields and body out, file text in — the exact inverse of
 * `parseFrontmatter`, and held to it by a round-trip suite (`parse(serialize(x))` must equal `x`).
 * This is what makes the frontmatter *subset* honest from the other side: the parser refuses what
 * it cannot read, and this never writes anything the parser cannot read, so tooling-written files
 * are round-trippable by construction.
 *
 * Strings are quoted exactly when leaving them bare would change their meaning — they would read
 * back as a number, a boolean, null, an array, or something the parser refuses (`{`, `&`, a
 * leading quote) — and left bare otherwise, because bare is what a human expects to see in
 * frontmatter they might hand-edit next.
 */
import { FrontmatterMap, Scalar } from './types.js';

/** Would this string read back as itself, bare? If not, it travels double-quoted. */
const needsQuotes = (value: string): boolean =>
  value === '' ||
  value !== value.trim() ||
  value === 'null' ||
  value === '~' ||
  value === 'true' ||
  value === 'false' ||
  /^-?\d+(\.\d+)?$/.test(value) ||
  /^[[{&*|>'"#-]/.test(value) ||
  value.includes('\n') ||
  value.includes(': ');

/**
 * `inArray`, because quoting is contextual: a comma means nothing in value position and splits
 * items inside an inline array — `['a, b']` written bare read back as two items, which the
 * round-trip suite caught on its first run.
 */
const scalar = (value: Scalar, inArray = false): string => {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    /** Only numbers whose text reads back as the same number — `1e21` would return as a string. */
    if (!/^-?\d+(\.\d+)?$/.test(String(value)))
      throw new Error(`serializeContent: ${value} is not a writable number — it would read back as a string`);
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string')
    throw new Error(`serializeContent: a ${typeof value} is not a writable value`);
  /** Quoting has no line-break escape, so any of these would brick every later parse of the file. */
  if (/[\n\r\u2028\u2029]/.test(value))
    throw new Error('serializeContent: multiline strings are not writable — prose belongs in the body');
  /** In array position a comma splits and a mid-item quote derails the splitter — both force quotes. */
  return needsQuotes(value) || (inArray && /[,'"]/.test(value))
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : value;
};

/** The parser's own KEY shape — a key outside it would serialize into a line that reads back as DIFFERENT data. */
const KEY = /^[A-Za-z0-9_-]+$/;

const lines = (map: FrontmatterMap, indent: string): string[] => {
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    /**
     * Keys are validated, not trusted: `{'title: t\nuuid: x': …}` serialized verbatim would parse
     * back as THREE fields — frontmatter injection through whoever controls a field name
     * (audit pass 7). `__proto__` is refused for the parser's own reason.
     */
    if (!KEY.test(key) || key === '__proto__')
      throw new Error(`serializeContent: ${JSON.stringify(key)} is not a writable key — letters, digits, _ and -`);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${indent}${key}: []`);
      } else if (typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])) {
        /** A list of maps — the navigation shape — always dashes, never inline. */
        out.push(`${indent}${key}:`);
        for (const item of value as FrontmatterMap[]) {
          if (item === null || typeof item !== 'object' || Array.isArray(item))
            throw new Error(`serializeContent: "${key}" mixes map and non-map items — a list holds one or the other`);
          const inner = lines(item, `${indent}    `);
          if (inner.length === 0) throw new Error(`serializeContent: "${key}" holds an empty map item, which is not writable`);
          out.push(`${indent}  - ${inner[0].trim()}`, ...inner.slice(1));
        }
      } else {
        for (const item of value)
          if (item !== null && typeof item === 'object')
            throw new Error(`serializeContent: "${key}" nests a list or map inside an inline array, which is not writable`);
        out.push(`${indent}${key}: [${(value as Scalar[]).map((item) => scalar(item, true)).join(', ')}]`);
      }
    } else if (value !== null && typeof value === 'object') {
      const inner = lines(value, `${indent}  `);
      /** An empty map would write a bare `key:`, which reads back as null — a silent type change. */
      if (inner.length === 0) throw new Error(`serializeContent: "${key}" is an empty map, which is not writable — omit the key`);
      out.push(`${indent}${key}:`, ...inner);
    } else {
      out.push(`${indent}${key}: ${scalar(value as Scalar)}`);
    }
  }
  return out;
};

/**
 * One content file's exact text, from its parts.
 *
 * @param data The frontmatter fields; an empty object writes no fence at all
 * @param body The markdown body, written verbatim after the closing fence
 * @return The file text `parseFrontmatter` reads back to the same parts
 */
export const serializeContent = (data: FrontmatterMap, body: string): string => {
  const fields = lines(data, '');
  /** A body OPENING with --- would read back as frontmatter; an explicit empty fence keeps it body. */
  if (fields.length === 0) return /^---(\n|$)/.test(body) ? `---\n---\n${body}` : body;
  return `---\n${fields.join('\n')}\n---\n${body}`;
};
