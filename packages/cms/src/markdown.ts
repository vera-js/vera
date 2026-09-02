/**
 * The markdown subset parser: source text in, an AST out. Nothing here touches the DOM, the
 * network, or vera — this file is the framework-agnostic core of `@verajs/cms`,
 * and the serializers over its output are deliberately elsewhere: `serialize.ts` renders the
 * AST to an HTML string for the static build, and the DOM builder for vera's runtime path arrives
 * with that path.
 *
 * The node shapes live in `./types.ts`, named in mdast's vocabulary — the reasoning is with them.
 *
 * **The subset is a decision, not a limitation**: headings (ATX only), paragraphs,
 * emphasis/strong, links, images, lists, inline and fenced code, blockquotes, thematic breaks, and
 * raw HTML passed through untouched. Deliberately excluded — each with the workaround being plain
 * HTML in the content, which the passthrough below makes first-class:
 *
 *   - tables, footnotes, reference-style links (cost bytes, rare, HTML covers them)
 *   - setext headings (`===` underlines; ATX `#` is the one shape writing tools emit)
 *   - indented code blocks (four leading spaces silently becoming code is CommonMark's most
 *     surprising rule; fences are explicit, and explicit is the shape generated files use)
 *   - hard line breaks (two trailing spaces are invisible in a diff, which this repo treats as
 *     disqualifying; `<br>` is visible and passes through)
 *
 * **HTML passes through raw, and no sanitizer will ever be added here.** The content is the
 * author's own repository — their site, their markup, their components (`<vera-gallery>` in a post
 * is the feature, not an attack) — so scrubbing it would break the passthrough to defend against the author
 * attacking themselves. The raw value is carried on `html` nodes; what happens at the boundary is
 * each serializer's documented responsibility. Markdown inside an HTML *block* stays literal
 * (`**bold**` inside a `<div>` renders as asterisks) — CommonMark's rule, kept, because half-parsed
 * HTML is worse than either extreme.
 *
 * Divergences from CommonMark inside the supported subset, each deliberate and none silent:
 *
 *   - **Emphasis pairing is first-match, not delimiter-run resolution.** CommonMark's algorithm is
 *     hundreds of lines resolving pathological nestings (`*a **b* c**`); this parser pairs each
 *     opener with the nearest valid closer (`***both***` handled as its own case). Ordinary
 *     emphasis is identical; adversarial nestings resolve differently, and are not worth the bytes.
 *   - **`_` only opens emphasis at a word boundary**, so `snake_case_names` in prose survive
 *     unmangled; neither marker applies the full left/right-flanking analysis.
 *   - **No lazy continuation**: `> a` then an unprefixed `b` is a quote and a paragraph, not one
 *     quoted paragraph — every continuation line says what it belongs to.
 *   - **A marker change (`- a` then `* b`) continues one list** where CommonMark starts a second;
 *     lists are all tight (no loose-list `<p>` wrapping).
 *
 * One measured superlinearity CLASS, accepted: inline text dense in unclosed openers — stray `*`
 * attached to words, runs of `[` or of backticks — pairs quadratically, because each failed opener
 * rescans the tail for a closer that is not there (~12 ms per thousand stray `*`; ~1.7 s for a
 * single 40 KB line of `[`). Ordinary prose never has the shape, the input is the author's own
 * file, worst case is slow-not-crashed, and the memo that would fix it costs more complexity than
 * the case earns. The crashes and the quadratic FENCE regex, by contrast, were fixed — see DEPTH
 * and the fence pattern.
 */

import { Block, Inline, ListItem, Root } from './types.js';

/** Linear on purpose — the old `(\S*)[^\`]*$` tail was quadratic on long lines (audit pass 7). */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** Closing hashes need a space before them — `# a#` keeps its hash, `# a #` sheds them. */
const HEADING = /^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])( *\1){2,} *$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const BLOCKQUOTE = /^ {0,3}> ?(.*)$/;
/** A line that *begins* HTML: a tag, a closing tag, a comment, or a doctype-ish `<!`. */
const HTML_BLOCK = /^ {0,3}<(?:[a-zA-Z][a-zA-Z0-9-]*[\s/>]|[a-zA-Z][a-zA-Z0-9-]*$|\/[a-zA-Z]|!)/;

/**
 * What ends a paragraph early, checked once per line rather than re-derived per matcher. An
 * ordered marker interrupts only as `1.`/`1)` — CommonMark's rule, for exactly the input it
 * protects: a sentence wrapping onto `1984. It was a cold year.` is prose, not a list starting
 * at item 1984 (audit pass 8).
 */
const interrupts = (line: string): boolean => {
  if (fenceAt(line) !== null || HEADING.test(line) || THEMATIC_BREAK.test(line) || BLOCKQUOTE.test(line) || HTML_BLOCK.test(line))
    return true;
  const item = LIST_ITEM.exec(line);
  return item !== null && (item[2].length === 1 || item[2] === '1.' || item[2] === '1)');
};

/**
 * Parses markdown source into an AST.
 *
 * @param source The markdown text — a content file's body, after frontmatter has been removed
 * @return The document tree; serializers over it live separately (`serializeHtml`, and later the DOM builder)
 */
export const parseMarkdown = (source: string): Root => ({
  type: 'root',
  children: parseBlocks(source.split('\n')),
});

/**
 * Nesting is capped because recursion is real memory: a 10 KB line of `- - - -…` nested five
 * thousand list levels and crashed the process with a RangeError (audit pass 7). Sixty-four
 * levels is beyond any document a human or a generator writes, and the refusal names itself
 * instead of the stack overflowing somewhere unrelated.
 */
const DEPTH = 64;

/** One judgment for both callers: a fence line whose backtick info holds a backtick is prose (CommonMark). */
const fenceAt = (line: string): RegExpExecArray | null => {
  const fence = FENCE.exec(line);
  return fence !== null && !(fence[1][0] === '`' && fence[2].includes('`')) ? fence : null;
};

const parseBlocks = (lines: string[], depth = 0): Block[] => {
  if (depth > DEPTH) throw new Error(`parseMarkdown: nesting deeper than ${DEPTH} levels — this is not prose`);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = fenceAt(line);
    if (fence !== null) {
      /** An unclosed fence runs to the end — the author is mid-typing, not wrong. */
      const closer = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},} *$`);
      let end = i + 1;
      while (end < lines.length && !closer.test(lines[end])) end++;
      const info = fence[2].trim();
      blocks.push({ type: 'code', lang: info === '' ? null : info.split(/\s+/)[0], value: lines.slice(i + 1, end).join('\n') });
      i = end + 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        depth: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    /** Before lists: `- - -` and `* * *` are breaks, and LIST_ITEM would happily claim both. */
    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: 'thematicBreak' });
      i++;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const match = BLOCKQUOTE.exec(lines[i]);
        if (match === null) break;
        quoted.push(match[1]);
        i++;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoted, depth + 1) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      const [list, next] = parseList(lines, i, depth);
      blocks.push(list);
      i = next;
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      /**
       * Raw until the first blank line — CommonMark's "type 6" rule, applied to every HTML block
       * for predictability. The contents are NOT parsed as markdown (see the header), so a
       * component in content takes attributes and HTML children, never markdown ones.
       */
      let end = i;
      while (end < lines.length && lines[end].trim() !== '') end++;
      blocks.push({ type: 'html', value: lines.slice(i, end).join('\n') });
      i = end;
      continue;
    }

    /** Paragraph: everything until a blank line or a line another block claims. */
    const text: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !interrupts(lines[i])) {
      text.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(text.join('\n')) });
  }
  return blocks;
};

/**
 * One list, items gathered by marker indentation. A line indented past the item's own text column
 * continues the item (and may open a nested list); a lesser indent ends the list.
 *
 * Lists here are always **tight** in the mdast sense that matters downstream: an item's blocks are
 * parsed normally (so nested lists, quotes and fences all work inside items), and the serializer —
 * not the parser — decides that a lone paragraph needs no `<p>` wrapper.
 */
const parseList = (lines: string[], start: number, depth: number): [Extract<Block, { type: 'list' }>, number] => {
  const first = LIST_ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = first[2].length > 1;
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    /**
     * A blank line between SIBLING items stays inside the list — `- a`, blank, `- b` is one list
     * in every renderer people know, and splitting it doubled the margins (audit pass 8). A blank
     * followed by anything else still ends the list.
     */
    if (lines[i].trim() === '') {
      let peek = i;
      while (peek < lines.length && lines[peek].trim() === '') peek++;
      const sibling = peek < lines.length ? LIST_ITEM.exec(lines[peek]) : null;
      if (
        sibling !== null &&
        sibling[1].length === indent &&
        (sibling[2].length > 1) === ordered &&
        !THEMATIC_BREAK.test(lines[peek])
      ) {
        i = peek;
        continue;
      }
      break;
    }
    /** `- - -` inside a list is a break, not an item — the same precedence parseBlocks applies. */
    if (THEMATIC_BREAK.test(lines[i])) break;
    const item = LIST_ITEM.exec(lines[i]);
    if (item === null || item[1].length !== indent || (item[2].length > 1) !== ordered) break;
    /** The column the item's text starts at; continuation lines must reach it. */
    const column = item[1].length + item[2].length + item[3].length;
    const content: string[] = [item[4]];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') {
        /** A blank line inside an item is fine; a blank line before a lesser indent ends it. */
        const after = lines[i + 1];
        if (after === undefined || after.slice(0, column).trim() !== '') break;
        content.push('');
        i++;
        continue;
      }
      if (next.slice(0, column).trim() !== '') break;
      content.push(next.slice(column));
      i++;
    }
    items.push({ type: 'listItem', children: parseBlocks(content, depth + 1) });
  }

  return [
    {
      type: 'list',
      ordered,
      /** `start` is honored (`3.` begins at 3) because renumbering an author's list is editing it. */
      start: ordered ? parseInt(first[2], 10) : 1,
      children: items,
    },
    i,
  ];
};

// ── inline ──────────────────────────────────────────────────────────────────────────────────────

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/**
 * `<tag …>`, `</tag>`, or `<!-- … -->` starting at `at`; the end index, or -1 when it is not one.
 *
 * A character scan rather than a regex, because attribute VALUES may hold the characters that end
 * a tag — `<a title="a>b">` is one tag, and the regex form split it at the quoted `>`.
 */
const inlineHtmlEnd = (text: string, at: number): number => {
  if (text.startsWith('<!--', at)) {
    const close = text.indexOf('-->', at + 4);
    return close === -1 ? -1 : close + 3;
  }
  if (!/^<\/?[a-zA-Z]/.test(text.slice(at, at + 3))) return -1;
  let quote = '';
  for (let i = at + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      /**
       * The span still has to BE a tag. The scanner alone accepted any `<letter…>`, which made
       * `<https://a.url>` and `a<b, c>d` into html nodes that vanished from the page — a
       * regression the quoted-`>` fix introduced and the next audit pass caught. The grammar
       * check restores CommonMark's answer: not a tag, so literal text.
       */
      return TAG.test(text.slice(at, i + 1)) ? i + 1 : -1;
    } else if (ch === '<') {
      return -1; // a second tag opened before this one closed: the first was never a tag
    }
  }
  return -1;
};

/** A real tag: name, then attribute-shaped content in which quoted values may hold anything. */
const TAG = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>$/;

/**
 * Parses one run of inline markdown — the text of a heading, a paragraph, or a link label.
 *
 * @param text The inline source, with no block structure in it
 * @return The inline nodes in order
 */
export const parseInline = (text: string): Inline[] => {
  const nodes: Inline[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') nodes.push({ type: 'text', value: plain });
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    /** A backslash makes the next punctuation literal; before anything else it is itself. */
    if (ch === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      /** Code spans pair equal-length backtick runs, so `` a`b `` can contain a backtick. */
      let run = 1;
      while (text[i + run] === '`') run++;
      const closer = text.indexOf('`'.repeat(run), i + run);
      if (closer !== -1 && text[closer + run] !== '`') {
        flush();
        nodes.push({ type: 'inlineCode', value: text.slice(i + run, closer).trim() });
        i = closer + run;
        continue;
      }
      /** No closer of this length: the whole run is literal, and scanning resumes after it. */
      plain += text.slice(i, i + run);
      i += run;
      continue;
    }

    if (ch === '<') {
      const end = inlineHtmlEnd(text, i);
      if (end !== -1) {
        flush();
        nodes.push({ type: 'html', value: text.slice(i, end) });
        i = end;
        continue;
      }
    }

    if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
      const parsed = parseLink(text, i);
      if (parsed !== null) {
        flush();
        nodes.push(parsed[0]);
        i = parsed[1];
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      /** `_` needs a word boundary to open (see the header); `*` does not. */
      if (ch !== '_' || !isWordChar(text[i - 1])) {
        const parsed = parseEmphasis(text, i);
        if (parsed !== null) {
          flush();
          nodes.push(parsed[0]);
          i = parsed[1];
          continue;
        }
      }
    }

    plain += ch;
    i++;
  }
  flush();
  return nodes;
};

/** `[text](url "title")` or `![alt](url "title")` at `at`; null when the shape is not complete. */
const parseLink = (text: string, at: number): [Inline, number] | null => {
  const isImage = text[at] === '!';
  const open = at + (isImage ? 1 : 0);
  /** The label may nest brackets (`[a [b] c]`), so it is scanned balanced, not with indexOf. */
  let depth = 1;
  let i = open + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']') depth--;
    i++;
  }
  if (depth !== 0 || text[i] !== '(') return null;
  const label = text.slice(open + 1, i - 1);

  /**
   * The destination scans with paren BALANCE, not indexOf — `[x](https://…/Foo_(bar))` is the
   * ordinary Wikipedia shape, and the indexOf form cut its URL at the inner `)`.
   */
  let close = i + 1;
  let parens = 0;
  while (close < text.length) {
    const ch = text[close];
    if (ch === '\\') close++;
    else if (ch === '(') parens++;
    else if (ch === ')') {
      if (parens === 0) break;
      parens--;
    }
    close++;
  }
  if (close >= text.length) return null;
  const inside = text.slice(i + 1, close).trim();
  /** `url "title"` — the title is optional and always double-quoted; the URL never has spaces. */
  const parts = /^(\S*)(?: +"([^"]*)")? *$/.exec(inside);
  if (parts === null) return null;
  const url = parts[1];
  const title = parts[2] ?? null;

  return [
    isImage
      ? { type: 'image', url, title, alt: label }
      : { type: 'link', url, title, children: parseInline(label) },
    close + 1,
  ];
};

/** `*em*` / `**strong**` (and `_`/`__`) at `at`; null when no valid closer exists. */
const parseEmphasis = (text: string, at: number): [Inline, number] | null => {
  const ch = text[at];
  /**
   * A run of exactly three is `***both***` — em wrapping strong, which is everyday authoring, not
   * one of the adversarial nestings the header's first-match note waves off. Handled before the
   * two-or-one split, or the strong pairing ate the third marker and emitted \`<strong>*a</strong>*\`.
   */
  if (text[at + 1] === ch && text[at + 2] === ch && text[at + 3] !== ch) {
    const triple = ch.repeat(3);
    const inner = at + 3;
    if (inner >= text.length || /\s/.test(text[inner])) return null;
    let i = text.indexOf(triple, inner + 1);
    while (i !== -1 && /\s/.test(text[i - 1])) i = text.indexOf(triple, i + 1);
    if (i === -1 || i === inner) return null;
    return [
      { type: 'emphasis', children: [{ type: 'strong', children: parseInline(text.slice(inner, i)) }] },
      i + 3,
    ];
  }
  const strong = text[at + 1] === ch;
  const marker = strong ? ch + ch : ch;
  const inner = at + marker.length;
  /** An opener is not followed by whitespace — `a * b` is arithmetic, not emphasis. */
  if (inner >= text.length || /\s/.test(text[inner])) return null;

  let i = inner;
  while (i < text.length) {
    i = text.indexOf(marker, i + 1);
    if (i === -1) return null;
    /** …and a closer is not preceded by whitespace, and for `_`, not followed by a word. */
    if (/\s/.test(text[i - 1])) continue;
    if (ch === '_' && isWordChar(text[i + marker.length])) continue;
    if (i === inner) return null; // `**` alone: an empty emphasis is no emphasis
    return [
      { type: strong ? 'strong' : 'emphasis', children: parseInline(text.slice(inner, i)) },
      i + marker.length,
    ];
  }
  return null;
};
