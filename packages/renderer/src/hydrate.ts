/**
 * @verajs/renderer/hydrate — markerless adoption of server-rendered DOM.
 *
 * This entry is the renderer with one difference: its first render into a container that already has children
 * ADOPTS them as the server's output of the same template, instead of rendering fresh. Every later render is the
 * ordinary one. It re-exports the public API, so a CDN importmap can point `@verajs/renderer` at this bundle and
 * nothing else changes; an app that never server-renders never loads a byte of it.
 *
 * `@verajs/ssr` writes the SAME statics the renderer parses, and at adoption time the values are known — so the walk
 * pairs the template's canonical content with the live DOM node for node: statics must match exactly (text byte for
 * byte, elements by name), and at each value the live text is split to exactly that value's text and the renderer's
 * own anchors are put in. Server HTML carries no framework comments; the client puts in what it needs. Attributes are
 * READ and written only on a difference (see `commit`), so a right one costs nothing and a wrong one is repaired.
 * Anything else that disagrees discards that ONE container's markup (keeping `<style data-vm-sheet>`) and renders it
 * fresh — the page never depends on the server having been right.
 */
import {
  adoptAs,
  ChildPart,
  commitAdopting,
  comment,
  expectContainer,
  sayShape,
  getTemplate,
  hold,
  hookUp,
  resolved,
  needRemovalWork,
  Instance,
  isTemplateResult,
  registry,
  renderInto as baseRender,
  renderer as baseRenderer,
  renderRoot,
  rootParts,
  Slot,
  toText,
  ADOPT,
  EVENT,
  IGNORED,
  LIST,
  NODE,
  SOLE,
  TEMPLATE,
  TEXT,
  UNSET,
  UPGRADED,
  PROPERTY,
  LIVE,
} from './renderer.js';
import { CONTENT_PROPERTY } from '@verajs/shared-utils';
import type { Item, KeyedResult, Template } from './renderer.js';
import type { TemplateResult } from './types.js';

export { hold };
export type { TemplateResult } from './types.js';

/** Why adoption stops: thrown, caught in `renderInto`, never escapes. */
const MISMATCH = {};

/** The first place the two renders disagreed — development only, for the fallback's message. */
let why = '';
const mismatch = (reason: () => string): never => {
  if (__DEV__) why = reason();
  throw MISMATCH;
};

/** A live node as a person would name it. */
const describe = (node: Node | null) =>
  node === null
    ? 'nothing'
    : node.nodeType === 1
      ? `<${(node as Element).localName}>`
      : node.nodeType === 3
        ? `the text ${JSON.stringify((node as Text).data.slice(0, 30))}`
        : node.nodeType === 8
          ? 'a comment'
          : `a ${node.nodeName} node`;

/**
 * **Which bindings each canonical node carries**, built once per template the first time one is adopted: every
 * binding's node located through its path on the pristine canonical content, exactly as `instantiate` locates it on
 * a clone. A CHILD binding's node is its anchor — an empty text node the canonical content keeps and the server
 * never writes; a SOLE binding's node is its element.
 */
const plans = new WeakMap<Template, Map<Node, number[]>>();
const planOf = (template: Template) => {
  let plan = plans.get(template);
  if (plan === undefined) {
    plans.set(template, (plan = new Map()));
    const kinds = template.$K;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === IGNORED) continue;
      let node = template.$R;
      for (const step of template.$P[i]) {
        node = node.firstChild!;
        for (let hops = step; hops > 0; hops--) node = node.nextSibling!;
      }
      const owned = plan.get(node);
      if (owned === undefined) plan.set(node, [i]);
      else owned.push(i);
    }
  }
  return plan;
};

/**
 * Where the walk stands among a live parent's children: a node, and an offset into it when it is text — server text
 * runs arrive MERGED (`a${x}b` is one text node), so a static and a value can share a node until they are split.
 */
type Cursor = { parent: Node; node: Node | null; offset: number };

/**
 * **A comment carries no content, so adoption neither matches nor requires one**, in either direction: the live
 * markup may hold a comment the template does not, and the template may hold one the markup does not. Skipped only
 * at a node boundary — never mid-text.
 */
const passComments = (cursor: Cursor) => {
  while (cursor.offset === 0 && cursor.node !== null && cursor.node.nodeType === 8) cursor.node = cursor.node.nextSibling;
};

/** Puts the cursor on a node boundary (splitting the text it stands in) and returns the node there. */
const boundary = (cursor: Cursor) => {
  if (cursor.offset > 0) {
    cursor.node = (cursor.node as Text).splitText(cursor.offset);
    cursor.offset = 0;
  }
  return cursor.node;
};

/** Inserts at the cursor. */
const insertHere = (cursor: Cursor, node: Node) => cursor.parent.insertBefore(node, boundary(cursor));

/** Consumes exactly `text`, a static; anything else is a mismatch. */
const expectText = (cursor: Cursor, text: string) => {
  while (text !== '') {
    passComments(cursor);
    const node = cursor.node;
    if (node === null || node.nodeType !== 3) return mismatch(() => `expected the text ${JSON.stringify(text)} and found ${describe(node)}`);
    const data = (node as Text).data;
    const take = Math.min(data.length - cursor.offset, text.length);
    if (data.slice(cursor.offset, cursor.offset + take) !== text.slice(0, take))
      return mismatch(() => `expected the text ${JSON.stringify(text)} and found ${JSON.stringify(data.slice(cursor.offset, cursor.offset + 30))}`);
    text = text.slice(take);
    cursor.offset += take;
    if (cursor.offset === data.length) {
      cursor.node = node.nextSibling;
      cursor.offset = 0;
    }
  }
};

/**
 * Claims a text node holding exactly `text`, a value — split out of the run it arrived in. `''` has no server
 * counterpart, so a fresh empty node is put in as its anchor.
 */
const claimText = (cursor: Cursor, text: string): Text => {
  if (text === '') {
    const anchor = cursor.parent.ownerDocument!.createTextNode('');
    insertHere(cursor, anchor);
    return anchor;
  }
  passComments(cursor);
  const node = boundary(cursor);
  if (node === null || node.nodeType !== 3)
    return mismatch(() => `expected a text node holding an interpolated value and found ${describe(node)}`);
  const data = (node as Text).data;
  if (!data.startsWith(text))
    return mismatch(
      () =>
        `an interpolated value reads ${JSON.stringify(text)} here and the markup says ${JSON.stringify(data.slice(0, text.length))} ` +
        `— a value that stringifies differently on the server (a Date? locale formatting?) disagrees here`
    );
  if (data.length > text.length) (node as Text).splitText(text.length);
  cursor.node = node.nextSibling;
  return node as Text;
};

/** Claims the element named `name` at the cursor. */
const claimElement = (cursor: Cursor, name: string): Element => {
  passComments(cursor);
  const node = cursor.offset > 0 ? null : cursor.node;
  if (node === null || node.nodeType !== 1 || (node as Element).localName !== name)
    return mismatch(() => `expected <${name}> and found ${cursor.offset > 0 ? describe(cursor.node) : describe(node)}`);
  cursor.node = node.nextSibling;
  return node as Element;
};

/** The walk has consumed everything the template describes here: whatever is left is a mismatch. */
const finish = (cursor: Cursor, top = false) => {
  passComments(cursor);
  if (cursor.offset > 0 || cursor.node !== null)
    mismatch(() =>
      !top && cursor.parent.nodeType === 1
        ? `<${(cursor.parent as Element).localName}> contains ${describe(cursor.node)}, which the template does not describe`
        : `${describe(cursor.node)} follows everything the template describes`
    );
};

/** One instance being adopted. */
type Adoption = { template: Template; bindings: unknown[]; values: unknown[]; plan: Map<Node, number[]> };

/** Adopts the canonical siblings from `canonical` on, against the live cursor. */
const walk = (canonical: Node | null, cursor: Cursor, into: Adoption) => {
  for (let node = canonical; node !== null; node = node.nextSibling) {
    const type = node.nodeType;
    if (type === 8) continue;
    const owned = into.plan.get(node);
    if (type === 3) {
      if (owned !== undefined) adoptChild(into, owned[0], cursor);
      else expectText(cursor, (node as Text).data);
    } else adoptElement(node as Element, claimElement(cursor, (node as Element).localName), into, owned);
  }
};

/**
 * An element's own bindings commit when the walk reaches it — before its content, in document pre-order, as a client
 * render commits them — then its content is adopted: as one SOLE value, or as canonical children.
 */
const adoptElement = (canonical: Element, live: Element, into: Adoption, owned: number[] | undefined) => {
  let sole = -1;
  /** A content property (`.innerHTML`, `.textContent`…) writes this element's children itself — see below. */
  let content = false;
  if (owned !== undefined)
    for (const i of owned) {
      const kind = into.template.$K[i];
      if (kind === SOLE) sole = i;
      else {
        if ((kind === PROPERTY || kind === LIVE) && CONTENT_PROPERTY.test(into.template.$N[i])) content = true;
        into.bindings[i * 2] = kind >= EVENT && kind <= ADOPT ? new Slot(live) : live;
        into.bindings[i * 2 + 1] = UNSET;
        commitAdopting(into.template, into.bindings, i, kind, into.values);
      }
    }
  const inner: Cursor = { parent: live, node: live.firstChild, offset: 0 };
  if (sole >= 0) adoptSole(into, sole, live, inner);
  /**
   * Content the template does not describe that is not the template's to describe: a `<textarea>`'s server content is
   * its default value (a `.value` binding serializes into it), and a custom element's children — when the template
   * writes none — are that component's OWN render, which it adopts itself. The same rule as SOLE ownership: a
   * component's children belong to the component. A content property's element is the same case: the binding
   * committed above has just written its children — the client's own assignment, replacing what the server served —
   * so they are that binding's, never the template's. Walking them read every non-empty `.innerHTML` as a mismatch
   * and threw the whole container away.
   */ else if (
    canonical.firstChild === null &&
    (content || live.localName === 'textarea' || live.localName.includes('-') || live.hasAttribute('is'))
  )
    return;
  else walk(canonical.firstChild, inner, into);
  finish(inner);
};

/** A value is TEXT at a child position when `commit` would write it as text. */
const isText = (value: unknown) => value != null && typeof value !== 'object';

/** A CHILD binding: text split to the value, or a part between two markers put in around what it adopts. */
const adoptChild = (into: Adoption, i: number, cursor: Cursor) => {
  const value = into.values[i];
  if (isText(value)) {
    into.bindings[i * 2] = claimText(cursor, toText(value));
    into.bindings[i * 2 + 1] = value;
    return;
  }
  const part = new ChildPart(comment(), comment());
  insertHere(cursor, part.$s!);
  adoptValue(part, value, cursor);
  if (part.$e!.parentNode === null) insertHere(cursor, part.$e!);
  into.bindings[i * 2] = part;
  into.bindings[i * 2 + 1] = UPGRADED;
};

/** A SOLE binding: its element's one text node, or a part that owns the element (no markers). */
const adoptSole = (into: Adoption, i: number, live: Element, inner: Cursor) => {
  const value = into.values[i];
  if (isText(value)) {
    into.bindings[i * 2] = claimText(inner, toText(value));
    into.bindings[i * 2 + 1] = value;
    return;
  }
  const part = new ChildPart(null, null);
  part.$w = live;
  adoptValue(part, value, inner);
  into.bindings[i * 2] = part;
  into.bindings[i * 2 + 1] = UPGRADED;
};

/** Adopts a template's instance at the cursor. */
const adoptInstance = (result: TemplateResult, cursor: Cursor): Instance => {
  let template = getTemplate(result);
  /** Adoption is in place: an extension resolving the template (namespaces) is asked with the LIVE parent. */
  if (template.$X) template = resolved(template, cursor.parent);
  if (__DEV__) sayShape(template);
  const into: Adoption = {
    template,
    bindings: new Array(template.$K.length * 2 + (template.$X ? 1 : 0)),
    values: result.values,
    plan: planOf(template),
  };
  const root = template.$R;
  if (root.nodeType === 1) {
    const adopted = claimElement(cursor, (root as Element).localName);
    const instance = new Instance(template, result.strings, adopted, into.bindings);
    /** Its instance hook meets it before its bindings commit, as a client instance does — told it was adopted. */
    if (template.$X) hookUp(instance, adopted, true);
    adoptElement(root as Element, adopted, into, into.plan.get(root));
    return instance;
  }
  walk(root.firstChild, cursor, into);
  /**
   * A fragment-rooted instance's root is an empty fragment once inserted — `hold()` parks its nodes into it. (Its
   * adopted nodes are a range of live siblings with no one node to hand an instance hook, so an adopted
   * fragment-rooted instance is not hooked yet — piece 8 settles ranges for slots too.)
   */
  return new Instance(template, result.strings, cursor.parent.ownerDocument!.createDocumentFragment(), into.bindings);
};

/**
 * Adopts `value` into `part` — the same decisions, in the same order, as `ChildPart.$p`, so a position adopts as
 * exactly what a client render would have made of it.
 */
const adoptValue = (part: ChildPart, value: unknown, cursor: Cursor) => {
  if (value == null) return;
  if (typeof value !== 'object') {
    part.$l = claimText(cursor, toText(value));
    part.$v = value;
    part.$o = TEXT;
    return;
  }
  const held = (value as { $h?: TemplateResult }).$h;
  if (held !== undefined || isTemplateResult(value)) {
    part.$n = adoptInstance(held ?? (value as TemplateResult), cursor);
    part.$o = TEMPLATE;
    return;
  }
  /**
   * **What client code renders is rendered client-side**: a value a module claims (the `'value'` insert) and a
   * `_$child$` applier. The part's range is put in first; a SOLE position claims everything the server put in its
   * element as the part's content (an SSR-aware applier may have written it), and the applier is told it is adopting
   * — it adopts that content, or replaces it (which is what one that ignores the flag does). Elsewhere what the server
   * wrote for it cannot be delimited, so it is not claimed — anything left there is a mismatch at the next static.
   */
  if (part.$e !== null && part.$e.parentNode === null) insertHere(cursor, part.$e);
  const handlers = registry?.get('value') as ((part: object, value: unknown) => boolean | void)[] | undefined;
  if (handlers !== undefined) for (let i = 0; i < handlers.length; i++) if (handlers[i](part, value)) return;
  if (Array.isArray(value) || (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined)) {
    const list = Array.isArray(value) ? value : [...(value as Iterable<unknown>)];
    const items: Item[] = [];
    for (let i = 0; i < list.length; i++) items.push(adoptItem(list[i], cursor));
    part.$i = items;
    part.$o = LIST;
    return;
  }
  const applyChild = (value as { _$child$?: (part: ChildPart, previous: unknown, adopting: boolean) => unknown })._$child$;
  if (applyChild !== undefined) {
    if (part.$w !== null && cursor.node !== null) {
      part.$o = NODE;
      cursor.node = null;
      cursor.offset = 0;
    }
    part.$a = applyChild;
    part.$R = renderRoot;
    if ((applyChild as { _$detach$?: unknown })._$detach$ !== undefined) needRemovalWork();
    part.$z = applyChild.call(value, part, undefined, true);
    return;
  }
  /** A node the server could not have rendered: put in where it belongs, and adoption goes on around it. */
  if ((value as Node).nodeType !== undefined) {
    insertHere(cursor, value as Node);
    part.$v = value;
    part.$o = NODE;
    return;
  }
  adoptValue(part, String(value), cursor);
};

/** The root the template at this position will build — after an extension resolves it, as `$c` asks. */
const rootOf = (result: TemplateResult, cursor: Cursor) => {
  const template = getTemplate(result);
  return (template.$X ? resolved(template, cursor.parent) : template).$R;
};

/** Adopts one list item — the same shapes `ChildPart.$c` builds. */
const adoptItem = (value: unknown, cursor: Cursor): Item => {
  if (value !== null && typeof value === 'object' && isTemplateResult(value) && rootOf(value, cursor).nodeType === 1) {
    const instance = adoptInstance(value, cursor);
    instance.$k = (value as KeyedResult).key;
    return instance;
  }
  const part = new ChildPart(comment(), comment());
  insertHere(cursor, part.$s!);
  adoptValue(part, value, cursor);
  if (part.$e!.parentNode === null) insertHere(cursor, part.$e!);
  part.$k = (value as TemplateResult | null)?.key;
  return part;
};

/** A container's own SSR stylesheets lead its content and are not part of any template. */
const isSheet = (node: Node | null) => node !== null && node.nodeType === 1 && (node as Element).hasAttribute('data-vm-sheet');

/** Clears a container after a mismatch — every child but its SSR stylesheets. */
const clearPreservingStyles = (container: Node) => {
  for (let node = container.firstChild; node !== null; ) {
    const next: ChildNode | null = node.nextSibling;
    if (!isSheet(node)) container.removeChild(node);
    node = next;
  }
};

/**
 * The hydrating `renderInto`: the first render into a container that already has children adopts them; a mismatch
 * clears that container (keeping its SSR stylesheets) and renders it fresh. After that it IS the base render.
 */
export const renderInto = (result: unknown, container: Node) => {
  if (__DEV__) expectContainer(container);
  if (
    !rootParts.has(container) &&
    container.firstChild !== null &&
    result !== null &&
    typeof result === 'object' &&
    isTemplateResult(result as object)
  ) {
    let first: Node | null = container.firstChild;
    while (isSheet(first)) first = first!.nextSibling;
    const start = comment();
    container.insertBefore(start, first);
    /**
     * Bounded like any root, and bounded BEFORE adoption: an insert at the root during the walk (a list growing past
     * what the server rendered, a client-only node) uses the end as its reference, so it must already be in place.
     */
    const end = container.appendChild(comment());
    const part = new ChildPart(start, end);
    try {
      adoptAs(container, () => {
        const cursor: Cursor = { parent: container, node: first, offset: 0 };
        adoptValue(part, result, cursor);
        finish(cursor, true);
      });
      rootParts.set(container, part);
      return;
    } catch (error) {
      /** Whatever ended the adoption, its bounds go with it — a rethrown error leaves no half-adopted root behind. */
      start.remove();
      end.remove();
      if (error !== MISMATCH) throw error;
    }
    /**
     * **Falling back says so**, scoped to this one container: the page is correct either way, but the server's work
     * on it was just thrown away, and nothing on screen would say so. The reason names the first place the two
     * renders disagreed.
     */
    if (__DEV__) {
      const stated =
        container.nodeType === 1 &&
        ((container as Element).hasAttribute('data-vm-light') ||
          (container as Element).querySelector('[data-vm-light],[data-vm-slotted]') !== null);
      console.warn(
        `[vera] hydration fell back to a client render: ${why}. This container's server markup was ` +
          `discarded and rebuilt (its SSR <style> is kept), ` +
          (container.nodeType === 1 && !stated
            ? `and it carried none of the marks server output of a light host carries. If its ` +
              `children were CLIENT-side markup rather than this template's server output, they ` +
              `cannot be told apart from the stale markup and were discarded with it — hydrate adopts existing children ` +
              `AS server output; render client-only containers with @verajs/renderer's renderInto ` +
              `instead. `
            : `so the page is correct but the server's work on this part of it was wasted. `) +
          `Other containers on the page hydrate independently and are unaffected. The two renders ` +
          `have to agree exactly — check for markup the template does not describe, or state ` +
          `settled after the server render.`
      );
    }
    clearPreservingStyles(container);
  }
  baseRender(result, container);
};

/**
 * This entry's `renderer` descriptor, bound to the HYDRATING `renderInto` — a bare re-export of the base one wired a
 * renderer that never adopted, silently (a first render into a full container clears it and renders fresh).
 * `connect` is shared: it operates on this bundle's own copy of the renderer's state, which both functions read.
 */
export const renderer = { ...baseRenderer, fn: renderInto as never };
/** The same development marker as the base entry's: `wire(renderInto)` is named as the raw function it is. */
if (__DEV__) (renderInto as unknown as { $module?: string }).$module = 'renderer';
