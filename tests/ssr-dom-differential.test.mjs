/**
 * The SSR shim, against a real DOM, operation by operation.
 *
 * `CLAUDE.md` names exactly one instrument for this file: *"audit it by differential test, never by
 * reading it. Run the same operation against the shim and against jsdom and compare the answers."*
 * The reason is that the shim's code is individually reasonable and only **collectively** wrong, and
 * the bug class it produces is the worst this package has -- the server and the client disagree about
 * something neither of them renders, so nothing fails until a hydration mismatch appears somewhere
 * else entirely.
 *
 * `ssr-dom-surface` asks whether a member exists and writes through. That is a different question
 * from whether it gives the **same answer** a browser gives, and being the lenient one server-side
 * only moves the failure to the client with the context stripped off.
 *
 * ## Why this exists as a standing test rather than a probe
 *
 * `packages/ssr/src/vera/nodes.js` was modified 29 times during the 2026-08-26 audit, more than any
 * other file in the repository. Each change was verified on its own; nothing checked what they did
 * together. A matrix is the cheap way to keep asking.
 *
 * ## jsdom's standing here
 *
 * `CLAUDE.md` warns that jsdom is the regression net and never the oracle for *"anything the platform
 * decides"* -- notably `setAttribute` name validation, which this deliberately does not test, since
 * `tests/browser/spread-names.test.js` records the engines' real rule. What is compared here is
 * ordinary reflection and mutation, where jsdom and the engines agree and a divergence means the shim
 * is wrong. A difference the README lists as out of scope would need excluding; none of these are, and
 * there is no allowlist, which is the point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals, which is the whole reason for the order here. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shim = globalThis.document;

const OPS = [
  ['setAttribute/getAttribute', "el.setAttribute('data-a','1'); return el.getAttribute('data-a');"],
  ['getAttribute missing', "return el.getAttribute('nope');"],
  ['hasAttribute', "el.setAttribute('x','');  return [el.hasAttribute('x'), el.hasAttribute('y')].join(',');"],
  ['removeAttribute', "el.setAttribute('x','1'); el.removeAttribute('x'); return String(el.getAttribute('x'));"],
  ['toggleAttribute on', "return String(el.toggleAttribute('hidden')) + ':' + el.getAttribute('hidden');"],
  ['toggleAttribute off', "el.toggleAttribute('hidden'); return String(el.toggleAttribute('hidden')) + ':' + String(el.getAttribute('hidden'));"],
  ['toggleAttribute force', "return String(el.toggleAttribute('hidden', false)) + ':' + String(el.hasAttribute('hidden'));"],
  ['attribute case', "el.setAttribute('DaTa-B','1'); return el.getAttribute('data-b') + '|' + el.getAttribute('DaTa-B');"],
  ['numeric value', "el.setAttribute('x', 5); return JSON.stringify(el.getAttribute('x'));"],
  ['null value', "el.setAttribute('x', null); return JSON.stringify(el.getAttribute('x'));"],
  ['undefined value', "el.setAttribute('x', undefined); return JSON.stringify(el.getAttribute('x'));"],
  ['attributes length', "el.setAttribute('a','1'); el.setAttribute('b','2'); return String(el.attributes.length);"],
  ['attributes item', "el.setAttribute('a','1'); return el.attributes[0].name + '=' + el.attributes[0].value;"],
  ['getAttributeNames', "el.setAttribute('b','1'); el.setAttribute('a','2'); return el.getAttributeNames().join(',');"],
  ['className get', "el.setAttribute('class','a b'); return el.className;"],
  ['className set', "el.className = 'x y'; return el.getAttribute('class');"],
  ['classList add', "el.classList.add('a','b'); return el.getAttribute('class');"],
  ['classList add dup', "el.classList.add('a'); el.classList.add('a'); return el.getAttribute('class');"],
  ['classList remove', "el.className='a b c'; el.classList.remove('b'); return el.getAttribute('class');"],
  ['classList toggle', "el.className='a'; return String(el.classList.toggle('a')) + ':' + el.getAttribute('class');"],
  ['classList contains', "el.className='a b'; return String(el.classList.contains('b'));"],
  ['classList length', "el.className='  a   b  '; return String(el.classList.length);"],
  ['classList value', "el.className='  a   b  '; return el.classList.value;"],
  ['id reflect', "el.id = 'q'; return el.getAttribute('id') + '|' + el.id;"],
  ['id from attribute', "el.setAttribute('id','r'); return el.id;"],
  ['localName/tagName', "return el.localName + '|' + el.tagName;"],
  ['dataset set', "el.dataset.fooBar = '1'; return el.getAttribute('data-foo-bar');"],
  ['dataset get', "el.setAttribute('data-foo-bar','2'); return String(el.dataset.fooBar);"],
  ['dataset delete', "el.dataset.x='1'; delete el.dataset.x; return String(el.getAttribute('data-x'));"],
  ['textContent', "el.textContent = 'a<b>&'; return el.textContent;"],
  ['children count', "el.innerHTML = '<p>1</p>text<p>2</p>'; return String(el.children.length) + ':' + String(el.childNodes.length);"],
  ['firstElementChild', "el.innerHTML = 'x<p>1</p>'; return String(el.firstElementChild && el.firstElementChild.localName);"],
  ['matches', "el.className='a'; return String(el.matches('.a')) + ':' + String(el.matches('.b'));"],
  ['hidden property', "el.hidden = true; return String(el.getAttribute('hidden')) + '|' + String(el.hidden);"],
  ['title property', "el.title = 'T'; return el.getAttribute('title') + '|' + el.title;"],
  ['tabIndex', "el.setAttribute('tabindex','3'); return String(el.tabIndex);"],
  ['removeAttribute missing', "el.removeAttribute('nope'); return 'ok';"],
  ['empty class', "el.className=''; return JSON.stringify(el.getAttribute('class'));"],
  /** `importNode` must COPY — the shim returned the node itself for a while, and a caller mutating
   *  the "copy" corrupted the original (for the renderer, a template's canonical content). */
  ['importNode is a copy', "const c = el.ownerDocument.importNode(el, false); return String(c !== el) + ':' + c.localName;"],
  ['importNode deep carries children', "el.innerHTML = '<p>x</p>'; const c = el.ownerDocument.importNode(el, true); return String(c.childNodes.length) + ':' + String(c.firstElementChild !== el.firstElementChild);"],
  ['importNode shallow drops children', "el.innerHTML = '<p>x</p>'; return String(el.ownerDocument.importNode(el, false).childNodes.length);"],
  ['importNode copy is detached from the original', "el.setAttribute('a','1'); const c = el.ownerDocument.importNode(el, false); c.setAttribute('a','2'); return el.getAttribute('a') + ':' + c.getAttribute('a');"],
  /** The run-2 extension: traversal, insertion and events — the members the grid never asked
   *  about. insertAdjacentHTML('afterend') on a NESTED element is the one that was refused with a
   *  stale "no parent" claim and took real component code down server-side. */
  ['childNodes walk', "el.innerHTML='a<p>1</p>b<i>2</i>'; return [...el.childNodes].map(n=>n.nodeType).join(',');"],
  ['sibling chains both ways', "el.innerHTML='a<p>1</p>b'; let n=el.firstChild, out=[]; while(n){out.push(n.nodeType); n=n.nextSibling;} let m=el.lastChild; const back=[]; while(m){back.push(m.nodeType); m=m.previousSibling;} return out.join(',')+':'+back.join(',');"],
  ['element siblings', "el.innerHTML='<p>1</p>x<i>2</i>'; return el.firstElementChild.nextElementSibling.localName + ':' + el.lastElementChild.previousElementSibling.localName;"],
  ['parentNode and contains', "el.innerHTML='<p><i>2</i></p>'; const i=el.querySelector('i'); return i.parentNode.localName + ':' + String(el.contains(i)) + ':' + String(i.contains(el));"],
  ['insertBefore middle and null ref', "el.innerHTML='<p>1</p><i>2</i>'; const b=el.ownerDocument.createElement('b'); el.insertBefore(b, el.lastElementChild); const u=el.ownerDocument.createElement('u'); el.insertBefore(u, null); return [...el.children].map(n=>n.localName).join(',');"],
  ['insertBefore foreign ref refuses', "const b=el.ownerDocument.createElement('b'); try { el.insertBefore(b, el.ownerDocument.createElement('u')); return 'accepted'; } catch(e){ return 'THREW ' + e.name; }"],
  ['removeChild foreign refuses', "try { el.removeChild(el.ownerDocument.createElement('u')); return 'accepted'; } catch(e){ return 'THREW ' + e.name; }"],
  ['replaceChild', "el.innerHTML='<p>1</p>'; const b=el.ownerDocument.createElement('b'); b.textContent='n'; el.replaceChild(b, el.firstElementChild); return el.innerHTML;"],
  ['moving a node reparents it', "el.innerHTML='<p><b>x</b></p><i></i>'; el.querySelector('i').appendChild(el.querySelector('b')); return el.innerHTML;"],
  ['replaceChildren', "el.innerHTML='<p>1</p><i>2</i>'; el.replaceChildren(el.ownerDocument.createElement('b')); return el.innerHTML;"],
  ['insertAdjacentHTML inside positions', "el.innerHTML='<p>1</p>'; el.insertAdjacentHTML('afterbegin','<b>0</b>'); el.insertAdjacentHTML('beforeend','<b>2</b>'); return el.innerHTML;"],
  ['insertAdjacentHTML beside a NESTED element', "el.innerHTML='<p>1</p>'; el.firstElementChild.insertAdjacentHTML('afterend','<b>2</b>'); el.firstElementChild.insertAdjacentHTML('beforebegin','<b>0</b>'); return el.innerHTML;"],
  /** Plain text, deliberately: with a `<` in it this compares entity SPELLING (`&#60;` vs `&lt;`,
   *  numeric vs named — same parse, different strings), which ssr-escaping owns; here the question
   *  is placement. */
  ['insertAdjacentText beside a nested element', "el.innerHTML='<p>1</p>'; el.firstElementChild.insertAdjacentText('beforebegin','t1'); return el.innerHTML;"],
  ['insertAdjacentHTML orphan refuses as the platform does', "try { el.insertAdjacentHTML('afterend','<b>x</b>'); return 'accepted'; } catch(e){ return 'THREW ' + e.name; }"],
  /** The run-3 virgin-seed find: prepending an element ALREADY a child of the same parent is a
   *  move-to-front, and the shim's entry swap hid the child from append's detach — [a,b,c]
   *  answered [b,a,b,c]. Same-parent moves through every other op were already right. */
  ['prepend an existing child moves it', "el.innerHTML='<p>a</p><i>b</i><u>c</u>'; el.prepend(el.children[1]); return [...el.children].map(n=>n.localName).join(',');"],
  ['dispatch, bubbling and non-bubbling', "el.innerHTML='<p>1</p>'; let hits=0; el.addEventListener('x',()=>hits++); const E = el.ownerDocument.defaultView?.Event ?? globalThis.Event; el.firstElementChild.dispatchEvent(new E('x',{bubbles:true})); el.firstElementChild.dispatchEvent(new E('x')); return String(hits);"],
  ['remove/once/dedupe listeners', "let hits=0; const f=()=>hits++; const E = el.ownerDocument.defaultView?.Event ?? globalThis.Event; el.addEventListener('x',f); el.addEventListener('x',f); el.dispatchEvent(new E('x')); el.removeEventListener('x',f); el.addEventListener('y',()=>hits+=10,{once:true}); el.dispatchEvent(new E('y')); el.dispatchEvent(new E('y')); return String(hits);"]
];;

const TAGS = ['div', 'span', 'input', 'a', 'my-widget'];

const run = (doc, tag, body) => {
  try {
    const element = doc.createElement(tag);
    return String(new Function('el', body)(element));
  } catch (error) {
    return `THREW ${error.constructor.name}`;
  }
};

/** A harness that threw everywhere would report perfect agreement, so the values are pinned first.
 *  An op where BOTH sides throw is a valid agreed refusal (the foreign-ref and orphan ops exist to
 *  pin exactly that); what this control refuses is an op dead against the shim ALONE. */
test('the comparisons actually run', () => {
  const threw = OPS.filter(
    ([, body]) => run(shim, 'div', body).startsWith('THREW') && !run(real, 'div', body).startsWith('THREW')
  );
  assert.deepEqual(threw.map(([name]) => name), [], 'these did not execute against the shim');

  assert.equal(run(shim, 'div', "el.setAttribute('data-a','1'); return el.getAttribute('data-a');"), '1');
  assert.equal(run(shim, 'div', "el.className='a b c'; el.classList.remove('b'); return el.getAttribute('class');"), 'a c');
});

test('the shim answers every operation the way a real DOM answers it', () => {
  const divergences = [];
  for (const tag of TAGS)
    for (const [name, body] of OPS) {
      const fromShim = run(shim, tag, body);
      const fromReal = run(real, tag, body);
      if (fromShim !== fromReal)
        divergences.push(`<${tag}> ${name}: shim ${JSON.stringify(fromShim)}, real ${JSON.stringify(fromReal)}`);
    }

  assert.deepEqual(
    divergences, [],
    `the server and the client would disagree about these:\n  ${divergences.join('\n  ')}`
  );
});
