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

/** The names a source file declares anywhere: only these are renamed. */
const declaredIn = (sf) => {
  const declared = new Set();
  const bind = (b) => {
    if (ts.isIdentifier(b)) declared.add(b.text);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) for (const e of b.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
  };
  const visit = (n) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && n.name) bind(n.name);
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name) declared.add(n.name.text);
    if ((ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n)) && n.name) declared.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return declared;
};

/** A unit's canonical key, its own names in order of first appearance, and its text. */
const canonical = (sf, node, prefix, declared) => {
  const local = new Map();
  const names = [];
  const rename = (text) => {
    if (!local.has(text)) {
      local.set(text, `$${local.size}`);
      names.push(text);
    }
    return local.get(text);
  };
  const parts = [prefix];
  const walk = (n) => {
    /** A doc comment is a child node in TypeScript's tree: comments are never part of a unit. */
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (ts.isShorthandPropertyAssignment(n)) {
      /** `{x}` is `{x: x}`: the minifier writes either, depending on what x is named. */
      parts.push(n.name.text, ':', declared.has(n.name.text) ? rename(n.name.text) : n.name.text);
      return;
    }
    if (ts.isIdentifier(n)) {
      parts.push(isName(n) || !declared.has(n.text) ? n.text : rename(n.text));
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
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declared = declaredIn(sf);
  const out = [];
  const add = (node, prefix = '') => out.push(canonical(sf, node, prefix, declared));
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const kind = st.declarationList.flags & ts.NodeFlags.Const ? 'const' : st.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
      for (const d of st.declarationList.declarations) add(d, `${kind} `);
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
