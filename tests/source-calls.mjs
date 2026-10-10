/**
 * **Reading a call's arguments out of SOURCE text** — shared by the suites that enumerate what the source raises
 * (diagnostics-table, api-misuse-sweep). Moved here 2026-10-09 when the sweep's own regex, `misuse\([^,]+,\s*'code'`,
 * turned out to read nothing from a call whose first argument holds a comma (`quoted(target, Infinity)`): two thrown codes
 * were silently not required at all.
 */
/**
 * A BALANCED scan rather than a regex, and the difference is not pedantry: a lazy match to the
 * first comma reads `reject(el, attr, 'code', …)` as ending at `el` and finds no code at all, so
 * twelve live codes looked like orphaned prose. Arguments here routinely contain template literals
 * with commas inside them, which is exactly what a regex cannot see the end of.
 */
export const closingParen = (text, from) => {
  let depth = 1;
  let quote = null;
  let i = from;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  return i - 1;
};

export const topLevelArgs = (body) => {
  const out = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += body[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

/**
 * Every call to `callee` in `text`, as `{ at, args }` — `at` the index of the callee, `args` its top-level arguments.
 * The callee must start at a name boundary (`misuse(` is not inside `xmisuse(` or `a.misuse(`).
 */
export const calls = function* (text, callee) {
  let at = 0;
  while ((at = text.indexOf(callee, at)) !== -1) {
    const from = at;
    at += callee.length;
    if (/[a-zA-Z0-9_$.]/.test(text[from - 1] ?? ' ')) continue;
    const end = closingParen(text, at);
    yield { at: from, args: topLevelArgs(text.slice(at, end)) };
  }
};
