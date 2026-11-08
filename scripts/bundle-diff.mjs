/**
 * **Two bundles compared modulo ORDER and NAMES**: what a pure move must leave unchanged. Moving code between modules
 * reorders the bundle and can change which short name the minifier gives each binding, so `cmp` fails on a correct move;
 * this reads past exactly those two things and nothing else.
 *
 *   node scripts/bundle-diff.mjs <before.js> <after.js>
 *
 * How: each bundle's top level is cut into units (one per declarator, function, class, statement, and comma operand),
 * and each unit is canonicalized by renaming the bundle's OWN names in order of first appearance (globals, property
 * names, literals, keywords and punctuation kept). The two multisets of units must be equal; a unit on one side only
 * prints as a CHANGE. Matched pairs then map names position by position, and that map must be one-to-one across the
 * whole bundle, so a reference swapped between two bindings is still a change. Units that are structurally identical
 * (several `const x = Symbol()`) are paired the way the rest of the bundle's map agrees with. Exit 0 when the bundles
 * differ only in order and names.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Is this identifier a NAME (a property or member name), which renaming must keep? */
const isName = (id) => {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    ((ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isPropertyDeclaration(p)) && p.name === id) ||
    (ts.isExportSpecifier(p) && p.name === id && p.propertyName !== undefined) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  );
};

/**
 * The bundle parsed AND bound, as an in-memory JavaScript program with no lib: each identifier resolves to the symbol it
 * names, so a local that SHADOWS a top-level binding (the minifier reuses short names) is a different name, and a global
 * (`Map`, `Reflect`), which resolves to nothing, keeps its text.
 */
const bound = (file) => {
  const text = readFileSync(file, 'utf8');
  const name = '/bundle.js';
  const options = { allowJs: true, noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (f, language) => (f === name ? ts.createSourceFile(f, text, language, true, ts.ScriptKind.JS) : undefined);
  host.fileExists = (f) => f === name;
  host.readFile = (f) => (f === name ? text : undefined);
  const program = ts.createProgram([name], options, host);
  return { sf: program.getSourceFile(name), checker: program.getTypeChecker() };
};

/**
 * A unit's canonical key, the names it must share one-to-one with the other bundle, and its text. Two namespaces, each
 * renamed in order of first appearance: bindings, by the SYMBOL they resolve to, and property names (`#`), by text,
 * because the production build mangles properties too, in an order-dependent way. Top-level bindings and every property
 * name must then map one-to-one across the whole bundle (a property renamed in one place only is a change); a local
 * binding is renamed freely inside its unit.
 */
const canonical = (sf, checker, node, prefix, topSymbols) => {
  const local = new Map();
  const names = [];
  const binding = (id, symbol) => {
    if (!local.has(symbol)) {
      local.set(symbol, '$' + local.size);
      if (topSymbols.has(symbol)) names.push('b:' + id.text);
    }
    return local.get(symbol);
  };
  const property = (text) => {
    const key = 'p:' + text;
    if (!local.has(key)) {
      local.set(key, '#' + local.size);
      names.push(key);
    }
    return local.get(key);
  };
  const parts = [prefix];
  const walk = (n) => {
    /** A doc comment is a child node in TypeScript's tree: comments are never part of a unit. */
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (ts.isShorthandPropertyAssignment(n)) {
      /** `{x}` is `{x: x}`: the minifier writes either, depending on what x is named. */
      const value = checker.getShorthandAssignmentValueSymbol(n);
      parts.push(property(n.name.text), ':', value ? binding(n.name, value) : n.name.text);
      return;
    }
    if (ts.isIdentifier(n)) {
      if (isName(n)) parts.push(property(n.text));
      else {
        const symbol = checker.getSymbolAtLocation(n);
        parts.push(symbol ? binding(n, symbol) : n.text);
      }
      return;
    }
    if (n.getChildCount(sf) === 0) {
      parts.push(n.getText(sf));
      return;
    }
    for (const c of n.getChildren(sf)) walk(c);
  };
  walk(node);
  return { key: parts.join(' '), names, text: node.getText(sf) };
};

const units = (file) => {
  const { sf, checker } = bound(file);
  /** The symbols the top level itself binds (declarators, functions, classes, imports). */
  const topSymbols = new Set();
  const top = (nameNode) => {
    if (ts.isIdentifier(nameNode)) {
      const symbol = checker.getSymbolAtLocation(nameNode);
      if (symbol) topSymbols.add(symbol);
    } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) for (const e of nameNode.elements) if (!ts.isOmittedExpression(e)) top(e.name);
  };
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) top(d.name);
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) top(st.name);
    else if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause;
      if (c.name) top(c.name);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) top(c.namedBindings.name);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) top(e.name);
    }
  }
  const out = [];
  const add = (node, prefix = '') => out.push(canonical(sf, checker, node, prefix, topSymbols));
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const kind = st.declarationList.flags & ts.NodeFlags.Const ? 'const' : st.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
      for (const d of st.declarationList.declarations) add(d, kind + ' ');
    } else if (ts.isExpressionStatement(st)) {
      const operands = [];
      const flatten = (e) => (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken ? (flatten(e.left), flatten(e.right)) : operands.push(e));
      flatten(st.expression);
      for (const e of operands) add(e, 'expr ');
    } else add(st);
  }
  return out;
};

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: node scripts/bundle-diff.mjs <before.js> <after.js>');
const ua = units(a);
const ub = units(b);
const group = (list) => {
  const m = new Map();
  for (const u of list) (m.get(u.key) ?? m.set(u.key, []).get(u.key)).push(u);
  return m;
};
const ga = group(ua);
const gb = group(ub);

const forward = new Map();
const backward = new Map();
const conflicts = [];
let matched = 0;
const fits = (x, y) => x.names.every((n, i) => (forward.get(n) ?? y.names[i]) === y.names[i] && (backward.get(y.names[i]) ?? n) === n);
const pair = (x, y) => {
  matched++;
  x.names.forEach((n, i) => {
    const m = y.names[i];
    if ((forward.has(n) && forward.get(n) !== m) || (backward.has(m) && backward.get(m) !== n)) conflicts.push(`${n} → ${m} (already ${forward.get(n) ?? '?'} ← ${backward.get(m) ?? '?'})`);
    forward.set(n, m);
    backward.set(m, n);
  });
};
/** Phase 1: a key unique on both sides pairs at once and fixes names. */
for (const [key, xs] of ga) {
  const ys = gb.get(key);
  if (xs.length === 1 && ys?.length === 1) {
    pair(xs.pop(), ys.pop());
  }
}
/** Phase 2: an ambiguous group pairs a unit with the ONE candidate the map allows, until nothing more is decided. */
for (let progress = true; progress; ) {
  progress = false;
  for (const [key, xs] of ga) {
    const ys = gb.get(key) ?? [];
    for (const x of [...xs]) {
      const fitting = ys.filter((y) => fits(x, y));
      if (fitting.length === 1) {
        pair(x, fitting[0]);
        xs.splice(xs.indexOf(x), 1);
        ys.splice(ys.indexOf(fitting[0]), 1);
        progress = true;
      }
    }
  }
}
/** Phase 3: what no name constrains pairs in order; anything left over exists on one side only. */
const onlyA = [];
for (const [key, xs] of ga) {
  const ys = gb.get(key) ?? [];
  while (xs.length && ys.length) pair(xs.shift(), ys.shift());
  onlyA.push(...xs);
}
const onlyB = [...gb.values()].flat();

console.log(`${a}: ${ua.length} units; ${b}: ${ub.length} units; ${matched} matched`);
const show = (u) => (u.text.length > 300 ? `${u.text.slice(0, 300)}…` : u.text);
for (const u of onlyA) console.log(`CHANGE, only in ${a}:\n  ${show(u)}`);
for (const u of onlyB) console.log(`CHANGE, only in ${b}:\n  ${show(u)}`);
for (const c of conflicts) console.log(`CHANGE, a name maps two ways: ${c}`);
const clean = !onlyA.length && !onlyB.length && !conflicts.length;
console.log(clean ? 'ORDER AND NAMES ONLY' : `NOT a pure move: ${onlyA.length + onlyB.length} unit(s), ${conflicts.length} name conflict(s)`);
process.exit(clean ? 0 : 1);
