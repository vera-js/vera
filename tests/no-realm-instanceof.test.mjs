/**
 * **No package source asks `instanceof` of a DOM class from the global realm** (CODE-PRINCIPLES #2, "derive document and
 * window from the node"). Every window has its own `Element`, `HTMLElement`, `Event`…, so a node from an iframe, a
 * popped-out window or a portal is never an instance of THIS module's global class: the check answers false for a real
 * element, silently, and only in another realm. **Test structure instead**: `nodeType === 1`, `namespaceURI`,
 * `localName`. The class from the node's own view (`node.ownerDocument.defaultView.Element`) is NOT a fix, and this
 * guard refuses it too (2026-11-21): appending a node from another window ADOPTS it, which moves its `ownerDocument`
 * and keeps its prototype, so the view's class is this realm's again and the node is still refused. Where realm identity
 * IS the question (which realm built this host, which realm constructed this sheet), the use is allowed below by exact
 * line, with that reason.
 *
 * Read from TypeScript's AST, not a pattern over text, so a comment or a string that says `instanceof Element` (the
 * comments explaining this rule) is never a hit. A class the file imports or declares itself (the server DOM's own
 * classes) is not the global, and passes. A DOM class read off any object (`view.Element`, `window.Element`), a name
 * destructured out of one, and a variable holding one (`const Own = view?.HTMLElement`) are all hits; a class passed
 * through a call or another module is not seen.
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

/**
 * The names the file binds to a class of its OWN: imports, class and function declarations (the server DOM's classes).
 * A variable, parameter or destructured name is not one: it holds a class from somewhere, which is the realm question
 * again. File-wide, not per scope: an own class anywhere exempts every use of its name in the file. Accepted, because
 * resolving scopes needs the type checker; the cost is a possible miss in a file that declares a DOM name of its own.
 */
const ownClasses = (file) => {
  const names = new Set();
  const visit = (node) => {
    if ((ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
};

/** Variables initialized with a DOM class read off an object: `const Own = (node.ownerDocument?.defaultView as …)?.HTMLElement`. */
const classAliases = (file) => {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const member = memberName(bare(node.initializer));
      if (member !== null && DOM.test(member)) names.add(node.name.text);
    }
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

/** Each `instanceof` in `text` whose right side is a DOM class from any realm but the file's own: `{ line, text }`. */
export const realmChecks = (text, name = 'x.ts') => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const own = ownClasses(file);
  const aliases = classAliases(file);
  const hits = [];
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      const right = bare(node.right);
      const member = memberName(right);
      const realm =
        (ts.isIdentifier(right) && ((DOM.test(right.text) && !own.has(right.text)) || aliases.has(right.text))) ||
        (member !== null && DOM.test(member));
      if (realm) hits.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
};

/**
 * The known uses, each by file and the exact expression text (never a line number: an edit above it moved the line and
 * turned a gate red, 2026-11-21), with why it stands. Each is allowed once per file; a second copy is new code. An
 * allowance whose expression is gone fails too, so the list only shrinks. (Router's two view checks and motion's canvas
 * and HTML checks were defects until they read the node's type, name and namespace instead, 2026-11-21.)
 */
const ALLOWED = new Map([
  ['packages/renderer/src/renderer.ts ((root as ShadowRoot | null)?.host ?? root) instanceof (doc.defaultView as typeof globalThis).HTMLElement', "realm identity is the question: was this host built by the renderer's own realm (content then builds there; tests/browser/realm.test.js)"],
  ['packages/styles/src/styles.ts sheet instanceof view.CSSStyleSheet', "realm identity is the question: adoptedStyleSheets takes only a sheet constructed in the root's own realm"],
  ['packages/motion/src/registry.ts new CSSStyleSheet() instanceof CSSStyleSheet', 'not a realm check: a feature probe that constructs and tests in the same realm, touching no node'],
  ['packages/ssr/src/vera/events.ts event instanceof Event', "not a realm check: Node-only, one realm, mirroring the platform's own refusal of a non-Event"],
]);

test('CONTROL: the reader finds a global DOM class on the right of instanceof, and nothing else', () => {
  for (const hit of ['x instanceof Element', 'x instanceof HTMLElement', 'x instanceof HTMLInputElement', 'x instanceof SVGElement', 'e instanceof KeyboardEvent', 'x instanceof Node', 'x instanceof window.Element', 'x instanceof globalThis.HTMLElement', 'x instanceof self.Document', 'x instanceof ShadowRoot', 'x instanceof (window as any).Element', 'x instanceof (globalThis as any).HTMLElement', 'x instanceof window!.Element', "x instanceof window['Element']", 'x instanceof (Element)', 'x instanceof (e as any).view.Element', 'x instanceof (e.ownerDocument.defaultView as typeof globalThis).HTMLElement'])
    assert.equal(realmChecks(`const a = (x: any, e: any) => ${hit};`).length, 1, hit);
  for (const near of [
    '// x instanceof Element',
    '/* x instanceof Element */',
    "const s = 'x instanceof Element';",
    'const s = `x instanceof ${"Element"}`;',
    'const a = (x: any) => x instanceof Function;',
    'const a = (x: any) => x instanceof Map;',
    'class Element {}\nconst a = (x: any) => x instanceof Element;',
    "import { Element } from './dom.js';\nconst a = (x: any) => x instanceof Element;",
    'const a = (x: any) => x.nodeType === 1;',
    'const a = (x: any) => x.namespaceURI === "http://www.w3.org/1999/xhtml";',
    'const a = (x: any, view: any) => { const Own = view.Thing; return x instanceof Own; };',
  ])
    assert.deepEqual(realmChecks(near), [], near);
  /** The node's-own-view forms, which adoption defeats: read off any object, destructured, or held in a variable. */
  for (const viewForm of [
    'const a = (x: any, view: any) => x instanceof view.Element;',
    'const a = (x: any, node: any) => { const { Element } = node.ownerDocument.defaultView; return x instanceof Element; };',
    'const a = (x: any, node: any) => { const Own = (node.ownerDocument?.defaultView as any)?.HTMLElement; return x instanceof Own; };',
    'const a = (x: any, Element: any) => x instanceof Element;',
  ])
    assert.equal(realmChecks(viewForm).length, 1, viewForm);
});

test('no package source tests instanceof against a DOM class it did not declare (the global one or a view\'s), and every allowance is still needed', () => {
  const files = walkFiles(join(root, 'packages'), /\.ts$/).filter((file) => file.includes('/src/') && !file.endsWith('.d.ts'));
  assert.ok(files.length >= 200, `CONTROL: the walk read ${files.length} package sources`);
  /** Each hit by file and text, counted; its line is reported, never part of the key. */
  const found = new Map();
  for (const file of files) {
    /** walkFiles answers with `/` on every platform, so the key is the same on Windows and POSIX. */
    const rel = file.slice(root.length + 1);
    for (const { line, text } of realmChecks(readFileSync(file, 'utf8'), rel)) {
      const key = `${rel} ${text}`;
      found.set(key, [...(found.get(key) ?? []), line]);
    }
  }
  const unexpected = [...found].flatMap(([key, lines]) => (ALLOWED.has(key) ? lines.slice(1) : lines).map((line) => `${key} (line ${line})`));
  assert.deepEqual(unexpected, [], 'test structure (`nodeType === 1`, `namespaceURI`, `localName`); the class from the node\'s own view is not a fix (adoption keeps the prototype)');
  assert.deepEqual([...ALLOWED.keys()].filter((key) => !found.has(key)), [], 'an allowance whose expression is gone: remove it');
});
