/**
 * **Where a production bundle's bytes come from**: every byte of `dist/*.min.js`, attributed through its source map to
 * the source file and the innermost NAMED function it was written in (a function declaration, or a `const`, property or
 * method holding a function), so a cleanup can start from the biggest and say what it moved.
 *
 *   node scripts/bytes-by-source.mjs packages/core/dist/vera.min.js [--top=40] [--json=out.json]
 *
 * Two gzip figures per entry, because gzip is not additive: `gz share` (its raw share of the bundle's gzip size) and
 * `gz marginal` (the bundle's gzip size minus its gzip size with that entry's bytes deleted: what keeping it costs, given
 * everything else). Sizes are zlib's default level, as the size claims measure. A byte the map does not attribute is
 * `(unmapped)`, and the total of every row equals the bundle's size, which the script checks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';
import ts from 'typescript';

const [bundlePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TOP = Number(flag('top') ?? 40);
if (!bundlePath) throw new Error('usage: node scripts/bytes-by-source.mjs <bundle.min.js> [--top=N] [--json=path]');

const code = readFileSync(bundlePath, 'utf8');
const map = new TraceMap(readFileSync(`${bundlePath}.map`, 'utf8'));
const root = process.cwd();
const mapDir = dirname(resolve(bundlePath));

/** Each source's named function ranges, innermost found by the smallest range containing a position. */
const functionsOf = new Map();
const rangesFor = (sourceIndex) => {
  if (functionsOf.has(sourceIndex)) return functionsOf.get(sourceIndex);
  const name = map.sources[sourceIndex];
  const text = map.sourcesContent?.[sourceIndex] ?? readFileSync(resolve(mapDir, name), 'utf8');
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const ranges = [];
  const isFunction = (node) => node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
  const visit = (node) => {
    let label;
    if (ts.isFunctionDeclaration(node) && node.name) label = node.name.text;
    else if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) label = node.name.getText(file);
    else if (ts.isVariableDeclaration(node) && isFunction(node.initializer) && ts.isIdentifier(node.name)) label = node.name.text;
    else if (ts.isPropertyAssignment(node) && isFunction(node.initializer)) label = node.name.getText(file);
    if (label) ranges.push({ label, start: node.getStart(file), end: node.getEnd() });
    ts.forEachChild(node, visit);
  };
  visit(file);
  const lineStarts = file.getLineStarts();
  const entry = { ranges, offset: (line, column) => (lineStarts[line] ?? text.length) + column };
  functionsOf.set(sourceIndex, entry);
  return entry;
};
const functionAt = (sourceIndex, line, column) => {
  const { ranges, offset } = rangesFor(sourceIndex);
  const at = offset(line, column);
  let best;
  for (const r of ranges) if (r.start <= at && at < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
  return best?.label ?? '(top level)';
};

/** Generated line starts, to turn (line, column) into an offset in the bundle. */
const genLineStarts = [0];
for (let i = 0; i < code.length; i++) if (code[i] === '\n') genLineStarts.push(i + 1);
const segments = [];
eachMapping(map, (m) => segments.push(m));
segments.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);

/** Every byte's owner: `file` and `file › function`, or `(unmapped)`. */
const fileOf = new Array(code.length).fill('(unmapped)');
const fnOf = new Array(code.length).fill('(unmapped)');
for (let i = 0; i < segments.length; i++) {
  const m = segments[i];
  const lineStart = genLineStarts[m.generatedLine - 1];
  const start = lineStart + m.generatedColumn;
  const next = segments[i + 1];
  const lineEnd = m.generatedLine < genLineStarts.length ? genLineStarts[m.generatedLine] : code.length;
  const end = next && next.generatedLine === m.generatedLine ? lineStart + next.generatedColumn : lineEnd;
  if (m.source == null) continue;
  const sourceIndex = map.sources.indexOf(m.source);
  const file = relative(root, resolve(mapDir, m.source));
  const fn = `${file} › ${functionAt(sourceIndex, m.originalLine - 1, m.originalColumn)}`;
  for (let j = start; j < end; j++) {
    fileOf[j] = file;
    fnOf[j] = fn;
  }
}

const gz = (text) => gzipSync(text).length;
const total = code.length;
const totalGz = gz(code);
const table = (owners) => {
  const raw = new Map();
  for (const owner of owners) raw.set(owner, (raw.get(owner) ?? 0) + 1);
  const rows = [...raw].map(([owner, bytes]) => {
    let without = '';
    for (let i = 0; i < code.length; i++) if (owners[i] !== owner) without += code[i];
    return { owner, raw: bytes, gzShare: Math.round((bytes / total) * totalGz), gzMarginal: totalGz - gz(without) };
  });
  const sum = rows.reduce((n, r) => n + r.raw, 0);
  if (sum !== total) throw new Error(`attribution covers ${sum} of ${total} bytes`);
  return rows.sort((a, b) => b.raw - a.raw);
};
const print = (title, rows, top) => {
  console.log(`\n${title}`);
  console.log(`  ${'raw'.padStart(6)} ${'%'.padStart(6)} ${'gz share'.padStart(9)} ${'gz marg.'.padStart(9)}  owner`);
  for (const r of rows.slice(0, top))
    console.log(`  ${String(r.raw).padStart(6)} ${((r.raw / total) * 100).toFixed(1).padStart(5)}% ${String(r.gzShare).padStart(9)} ${String(r.gzMarginal).padStart(9)}  ${r.owner}`);
  if (rows.length > top) console.log(`  … ${rows.length - top} more`);
};

const files = table(fileOf);
const functions = table(fnOf);
console.log(`${bundlePath}: ${total} B raw, ${totalGz} B gzip (zlib default), ${segments.length} mappings`);
print('BY FILE', files, Infinity);
print(`BY FUNCTION (top ${TOP})`, functions, TOP);
const json = flag('json');
if (json) writeFileSync(json, JSON.stringify({ bundle: bundlePath, total, totalGz, files, functions }, null, 1));
