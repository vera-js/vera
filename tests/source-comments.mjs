/**
 * **Every comment in a source file, from a full PARSE** (2026-11-12): each token's leading and trailing comment ranges,
 * once each, in order. A bare scanner cannot tell a regex from a division or resume a template after `${…}`, so after
 * one it misplaces comments; the guards that read comments (doc-comments-attached, no-private-pointers) share this one
 * reader, and each plants its control after a regex and a template, where a weaker reader fails.
 *
 * `withoutComments` is the one way a suite reads CODE with its comments removed. A regex stripper
 * (`/\/\*[\s\S]*?\*\//`) takes a `/*` inside a string, a template or a regex for an opener and deletes the code up to the
 * next comment's close, so whatever a check looks for there is invisible; tests/source-comments.test.mjs refuses one.
 */
import ts from 'typescript';

/** The script kind a file's name implies: JSX parses only as JSX, and a `.ts` cast only as TypeScript. */
const kindOf = (name) =>
  /\.tsx$/.test(name) ? ts.ScriptKind.TSX : /\.jsx$/.test(name) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/**
 * Every comment in `text`, in order.
 *
 * @param {string} text
 * @param {string} [name] the file's name, for its script kind (TypeScript when omitted)
 */
export const comments = (text, name = 'x.ts') => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kindOf(name));
  const seen = new Map();
  const add = (ranges) => {
    for (const r of ranges ?? []) if (!seen.has(r.pos)) seen.set(r.pos, { pos: r.pos, end: r.end, text: text.slice(r.pos, r.end) });
  };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
};

/**
 * `text` with every comment blanked: each character of a comment becomes a space and its newlines stay, so offsets and
 * line numbers are the source's, and two tokens a comment separated stay separate.
 *
 * @param {string} text
 * @param {string} [name] the file's name, for its script kind (TypeScript when omitted)
 */
export const withoutComments = (text, name) => {
  let code = '';
  let at = 0;
  for (const { pos, end } of comments(text, name)) {
    code += text.slice(at, pos) + text.slice(pos, end).replace(/[^\n]/g, ' ');
    at = end;
  }
  return code + text.slice(at);
};
