/**
 * **Every comment in a source file, from a full PARSE** (2026-11-12): each token's leading and trailing comment ranges,
 * once each, in order. A bare scanner cannot tell a regex from a division or resume a template after `${…}`, so after
 * one it misplaces comments; the guards that read comments (doc-comments-attached, no-private-pointers) share this one
 * reader, and each plants its control after a regex and a template, where a weaker reader fails.
 */
import ts from 'typescript';

export const comments = (text) => {
  const file = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
