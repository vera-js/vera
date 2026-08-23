import { findRoots } from './parser.js';

/**
 * JSX/TSX -> Vera tagged templates. Compile-time only, ZERO dependencies: the scanner/parser in
 * `parser.js` bounds JSX regions and expression containers lexically, and every JS/TS expression
 * passes through as a raw source slice (TS type syntax survives for the downstream stripper).
 * Every JSX root becomes one `html\`...\`` call site (nested markup is INLINE STATICS of the same
 * template, exactly like hand-written templates — so template identity and every renderer fast
 * path hold), and the runtime is the unchanged @verajs/renderer engine. React DX on web
 * standards, never "React compatibility": components stay platform classes; JSX styles the
 * templates.
 *
 * Attribute mapping:
 *   onClick={f}                    -> @click=${f}
 *   className / htmlFor           -> class / for
 *   value / checked               -> .value / .checked   (controlled-input semantics)
 *   defaultValue / defaultChecked -> value="…" / ?checked=${…}
 *   disabled / hidden / …         -> ?bool=${…} when bound; bare shorthand stays an attribute
 *   dangerouslySetInnerHTML={{__html: x}} -> .innerHTML=${x}
 *   ref={r}                       -> element-position ${r}
 *   key={k} (on a JSX root)       -> keyed(k, html`…`)
 *   style                         -> a STRING (object styles are a compile error)
 *   {...spread} on an element     -> `${spread(props)}` via @verajs/spread
 */

const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);

const NAME_MAP = { className: 'class', htmlFor: 'for' };

class JsxError extends Error {
  constructor(message, code, fileName, offset) {
    const upTo = code.slice(0, offset);
    const line = upTo.split('\n').length;
    const character = offset - (upTo.lastIndexOf('\n') + 1) + 1;
    super(`${fileName}:${line}:${character} — ${message}`);
  }
}

/** Escapes static text for placement inside a template literal. */
const escapeStatic = (text) => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** React-ish JSX text: whitespace runs containing a newline collapse away at edges, to one space inside. */
const collapseText = (raw) => {
  const text = raw.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '').replace(/\s*\n\s*/g, ' ');
  return /\n/.test(raw) && text.trim() === '' ? '' : text;
};

/**
 * Transforms JSX/TSX source to plain JS/TS using Vera tagged templates. Returns the code
 * unchanged when it contains no JSX.
 */
export const transformJsx = (code, fileName = 'module.jsx', options = {}) => {
  if (!/<[A-Za-z>]/.test(code)) return code;

  /**
   * The emitted call sites must use the SAME identifiers the injected imports bind. These were
   * previously read only where the imports are written, so `{ html: ['h', 'my-lib'] }` imported `h`
   * and then emitted `html\`…\`` — code referencing a name that was never imported. Resolving them
   * here keeps the two in step by construction.
   */
  const [htmlName, htmlFrom] = options.html ?? ['html', '@verajs/core'];
  const [keyedName, keyedFrom] = options.keyed ?? ['keyed', '@verajs/renderer'];
  const [spreadName, spreadFrom] = options.spread ?? ['spread', '@verajs/spread'];

  const state = { usedHtml: false, usedKeyed: false };

  /** An expression slice with any JSX roots inside it transformed (bottom-up, offsets stable). */
  const emitExpression = (text, roots, base) => {
    let out = text;
    for (const root of [...roots].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, root.start - base) + emitRoot(root.node) + out.slice(root.end - base);
    }
    return out;
  };

  /** One JSX root -> one `html\`…\`` (or a component call), optionally wrapped in `keyed()`. */
  const emitRoot = (node) => {
    if (!node.fragment && !/^[a-z]/.test(node.tag)) return emitComponent(node);
    const parts = [''];
    const exprs = [];
    let key = null;
    const tpl = {
      static: (s) => (parts[parts.length - 1] += s),
      expr: (e) => {
        exprs.push(e);
        parts.push('');
      },
      setKey: (k) => (key = k),
    };
    emitInto(node, tpl, true);
    state.usedHtml = true;
    let out = htmlName + '`' + parts.reduce((acc, p, i) => acc + (i ? '${' + exprs[i - 1] + '}' : '') + p, '') + '`';
    if (key !== null) {
      state.usedKeyed = true;
      out = `${keyedName}(${key}, ${out})`;
    }
    return out;
  };

  /** Emits an element/fragment INLINE into the current template context. */
  const emitInto = (node, tpl, isRoot) => {
    if (node.fragment) {
      for (const child of node.children) emitChild(child, tpl);
      return;
    }
    if (!/^[a-z]/.test(node.tag)) {
      tpl.expr(emitComponent(node));
      return;
    }
    tpl.static('<' + node.tag);
    for (const attribute of node.attrs) emitAttribute(node, attribute, tpl, isRoot);
    if (node.selfClosing) {
      tpl.static(' />');
      return;
    }
    tpl.static('>');
    for (const child of node.children) emitChild(child, tpl);
    tpl.static(`</${node.tag}>`);
  };

  const emitChild = (child, tpl) => {
    if (child.text !== undefined) {
      const text = collapseText(child.text);
      if (text !== '') tpl.static(escapeStatic(text));
    } else if (child.expr !== undefined) {
      tpl.expr(emitExpression(child.expr, child.roots, child.exprStart));
    } else {
      emitInto(child, tpl, false);
    }
  };

  const emitAttribute = (node, attribute, tpl, isRoot) => {
    if (attribute.spread) {
      /**
       * `<div {...props} />` -> `<div ${spread(props)}>`. Emitted exactly like `ref`, because it is
       * the same shape: an expression in element position. `@verajs/spread` resolves the sigils in
       * the keys at runtime, which is the point — a template cannot know the names.
       */
      state.usedSpread = true;
      tpl.static(' ');
      tpl.expr(`${spreadName}(${emitExpression(attribute.text, attribute.roots, attribute.valueStart)})`);
      return;
    }
    let name = attribute.name;
    const bound = attribute.kind === 'expr';
    const expression = bound ? emitExpression(attribute.text, attribute.roots, valueBase(attribute)) : null;
    const literal = attribute.kind === 'str' ? attribute.text : null;

    if (name === 'key') {
      if (!isRoot) throw new JsxError('key belongs on the JSX root returned from a list callback', code, fileName, attribute.start);
      tpl.setKey(bound ? expression : JSON.stringify(literal));
      return;
    }
    if (name === 'ref') {
      tpl.static(' ');
      tpl.expr(bound ? expression : JSON.stringify(literal));
      return;
    }
    if (name === 'dangerouslySetInnerHTML') {
      const match = bound ? /^\s*\{\s*__html\s*:([\s\S]*)\}\s*$/.exec(attribute.text) : null;
      if (!match) throw new JsxError('dangerouslySetInnerHTML expects {{ __html: expr }}', code, fileName, attribute.start);
      const inner = match[1].trim().replace(/,\s*$/, '');
      const innerStart = valueBase(attribute) + attribute.text.indexOf(inner);
      tpl.static(' .innerHTML=');
      tpl.expr(emitExpression(inner, attribute.roots, innerStart));
      return;
    }
    if (name === 'style' && bound && /^\s*\{/.test(attribute.text)) {
      throw new JsxError('style expects a STRING in Vera JSX (e.g. style={`color:${c}`}), not an object', code, fileName, attribute.start);
    }

    name = NAME_MAP[name] ?? name;
    if (/^on[A-Z]/.test(name)) {
      tpl.static(` @${name.slice(2).toLowerCase()}=`);
      tpl.expr(bound ? expression : JSON.stringify(literal));
      return;
    }
    if (name === 'value' || name === 'checked') {
      tpl.static(` .${name}=`);
      tpl.expr(bound ? expression : JSON.stringify(literal ?? true));
      return;
    }
    if (name === 'defaultValue') name = 'value';
    if (name === 'defaultChecked') name = 'checked';
    if (BOOLEAN_ATTRIBUTES.has(name) || name === 'checked') {
      if (attribute.kind === 'none') {
        tpl.static(` ${name}`); // bare shorthand: a static attribute
        return;
      }
      tpl.static(` ?${name}=`);
      tpl.expr(bound ? expression : JSON.stringify(literal !== 'false' && literal !== ''));
      return;
    }
    if (attribute.kind === 'none') {
      tpl.static(` ${name}`);
    } else if (literal !== null) {
      tpl.static(` ${name}="${escapeStatic(literal).replace(/"/g, '&quot;')}"`);
    } else {
      tpl.static(` ${name}=`);
      tpl.expr(expression);
    }
  };

  const valueBase = (attribute) => attribute.valueStart ?? 0;

  /** `<App a={1}>kids</App>` -> `App({ a: 1, children: [...] })`. Spread is fine here. */
  const emitComponent = (node) => {
    const props = [];
    for (const attribute of node.attrs) {
      if (attribute.spread) {
        props.push(`...${emitExpression(attribute.text, attribute.roots, valueBase(attribute))}`);
        continue;
      }
      if (attribute.kind === 'none') props.push(`${JSON.stringify(attribute.name)}: true`);
      else if (attribute.kind === 'str') props.push(`${JSON.stringify(attribute.name)}: ${JSON.stringify(attribute.text)}`);
      else props.push(`${JSON.stringify(attribute.name)}: ${emitExpression(attribute.text, attribute.roots, valueBase(attribute))}`);
    }
    if (node.children && node.children.length > 0) {
      const children = [];
      for (const child of node.children) {
        if (child.text !== undefined) {
          const text = collapseText(child.text);
          if (text !== '') children.push(JSON.stringify(text));
        } else if (child.expr !== undefined) {
          children.push(emitExpression(child.expr, child.roots, child.exprStart));
        } else {
          children.push(emitRoot(child));
        }
      }
      if (children.length) props.push(`children: [${children.join(', ')}]`);
    }
    return `${node.tag}({ ${props.join(', ')} })`;
  };

  const roots = findRoots(code);
  if (roots.length === 0) return code;

  let out = code;
  for (const root of roots.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, root.start) + emitRoot(root.node) + out.slice(root.end);
  }

  /** Auto-inject imports for what the emitted code uses (opt out with options.inject: false). */
  if (options.inject !== false) {
    const has = (name) => new RegExp(`(^|\\n)import[^;\\n]*[{,\\s]${name}[\\s,}][^;\\n]*from`).test(out);
    let inject = '';
    if (state.usedHtml && !has(htmlName)) inject += `import { ${htmlName} } from '${htmlFrom}';\n`;
    if (state.usedKeyed && !has(keyedName)) inject += `import { ${keyedName} } from '${keyedFrom}';\n`;
    if (state.usedSpread && !has(spreadName)) inject += `import { ${spreadName} } from '${spreadFrom}';\n`;
    out = inject + out;
  }
  return out;
};
