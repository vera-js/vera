/**
 * **No package source asks `instanceof` of a DOM class from the global realm** (CODE-PRINCIPLES #2, "derive document and
 * window from the node"). Every window has its own `Element`, `HTMLElement`, `Event`…, so a node from an iframe, a
 * popped-out window or a portal is never an instance of THIS module's global class: the check answers false for a real
 * element, silently, and only in another realm. Test structure instead (`nodeType === 1`), or take the class from the
 * node's own view (`node.ownerDocument.defaultView.Element`), which this guard allows.
 *
 * Read from TypeScript's AST, not a pattern over text, so a comment or a string that says `instanceof Element` (the
 * comments explaining this rule) is never a hit. A class the file imports or declares itself (the server DOM's own
 * classes) is not the global, and passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { walkFiles } from './walk.mjs';

const root = join(import.meta.dirname, '..');

/** A DOM interface every realm has its own copy of. */
const DOM = /^(?:Node|Element|Document|DocumentFragment|ShadowRoot|Text|Comment|CharacterData|Attr|Window|EventTarget|CSSStyleSheet|StyleSheet|CSSRule|Range|Selection|NodeList|HTMLCollection|NamedNodeMap|DOMTokenList|(?:HTML|SVG|MathML)\w*Element|\w*Event)$/;
/** A global object: `window.Element` is the module's realm as much as a bare `Element` is. */
const GLOBAL = new Set(['window', 'globalThis', 'self']);

/**
 * Every name the file binds itself: imports, classes, functions, variables, parameters, and names destructured out of an
 * object (`const { Element } = node.ownerDocument.defaultView`, the per-node form this rule recommends).
 *
 * File-wide, not per scope: a name bound ANYWHERE exempts every use of it in the file, so a parameter called `Event` in
 * one function hides a global `instanceof Event` in another. Accepted, because resolving scopes needs the type checker;
 * the cost is a possible miss in a file that reuses a DOM name for something of its own, never a false refusal.
 */
const boundNames = (file) => {
  const names = new Set();
  const visit = (node) => {
    if ((ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
};

/** The expression under any parentheses, `as`, `!` or `<T>` cast: `(window as any).Element` is `window.Element`. */
const bare = (node) => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
};

/** The member a property or element access names: `Element` in `window.Element` and in `window['Element']`. */
const memberName = (node) =>
  ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;

/** Each `instanceof` in `text` whose right side is a global DOM class: `{ line, text }`. */
export const realmChecks = (text, name = 'x.ts') => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const own = boundNames(file);
  const hits = [];
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      const right = bare(node.right);
      const member = memberName(right);
      const object = member === null ? null : bare(right.expression);
      const global =
        (ts.isIdentifier(right) && DOM.test(right.text) && !own.has(right.text)) ||
        (member !== null && ts.isIdentifier(object) && GLOBAL.has(object.text) && DOM.test(member));
      if (global) hits.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
};

/**
 * The known uses, each by exact file, line and text, with why it stands. An allowance whose line is gone fails too, so
 * the list only shrinks. The first three are defects waiting on their package's owner (router and motion are framework
 * packages); the last two are not realm checks at all.
 */
const ALLOWED = new Map([
  ['packages/router/src/services.ts:956 elementData.view instanceof HTMLElement', 'a defect, filed for router: a view element from another window reads as not an element'],
  ['packages/router/src/services.ts:979 processedView instanceof HTMLElement', "a defect, filed for router: the same, for a view function's result"],
  ['packages/motion/src/sequence.ts:97 node instanceof HTMLCanvasElement', 'a defect, filed for motion: a canvas from another window is refused as not a canvas'],
  ['packages/motion/src/registry.ts:220 new CSSStyleSheet() instanceof CSSStyleSheet', 'not a realm check: a feature probe that constructs and tests in the same realm, touching no node'],
  ['packages/ssr/src/vera/events.ts:148 event instanceof Event', "not a realm check: Node-only, one realm, mirroring the platform's own refusal of a non-Event"],
]);

test('CONTROL: the reader finds a global DOM class on the right of instanceof, and nothing else', () => {
  for (const hit of ['x instanceof Element', 'x instanceof HTMLElement', 'x instanceof HTMLInputElement', 'x instanceof SVGElement', 'e instanceof KeyboardEvent', 'x instanceof Node', 'x instanceof window.Element', 'x instanceof globalThis.HTMLElement', 'x instanceof self.Document', 'x instanceof ShadowRoot', 'x instanceof (window as any).Element', 'x instanceof (globalThis as any).HTMLElement', 'x instanceof window!.Element', "x instanceof window['Element']", 'x instanceof (Element)'])
    assert.equal(realmChecks(`const a = (x: any, e: any) => ${hit};`).length, 1, hit);
  for (const near of [
    '// x instanceof Element',
    '/* x instanceof Element */',
    "const s = 'x instanceof Element';",
    'const s = `x instanceof ${"Element"}`;',
    'const a = (x: any) => x instanceof Function;',
    'const a = (x: any) => x instanceof Map;',
    'const a = (x: any, view: any) => x instanceof view.Element;',
    'class Element {}\nconst a = (x: any) => x instanceof Element;',
    "import { Element } from './dom.js';\nconst a = (x: any) => x instanceof Element;",
    'const a = (x: any) => x.nodeType === 1;',
    'const a = (x: any, node: any) => { const { Element } = node.ownerDocument.defaultView; return x instanceof Element; };',
    'const a = (x: any, doc: any) => x instanceof (doc.defaultView as typeof globalThis).HTMLElement;',
  ])
    assert.deepEqual(realmChecks(near), [], near);
});

test('no package source tests instanceof against a DOM class from the global realm, and every allowance is still needed', () => {
  const files = walkFiles(join(root, 'packages'), /\.ts$/).filter((file) => file.includes('/src/') && !file.endsWith('.d.ts'));
  assert.ok(files.length >= 200, `CONTROL: the walk read ${files.length} package sources`);
  const found = [];
  for (const file of files) {
    /** walkFiles answers with `/` on every platform, so the key is the same on Windows and POSIX. */
    const rel = file.slice(root.length + 1);
    for (const { line, text } of realmChecks(readFileSync(file, 'utf8'), rel)) found.push(`${rel}:${line} ${text}`);
  }
  const unexpected = found.filter((key) => !ALLOWED.has(key));
  assert.deepEqual(unexpected, [], 'test structure (`nodeType === 1`) or take the class from the node\'s own view (`node.ownerDocument.defaultView.Element`)');
  assert.deepEqual([...ALLOWED.keys()].filter((key) => !found.includes(key)), [], 'an allowance whose line is gone: remove it');
});
