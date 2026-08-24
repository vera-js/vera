/**
 * **Generalized:** the server element has to behave like an element.
 *
 * The shim was built as "the smallest DOM surface core's server path touches", and that bar has now
 * been wrong five separate times — `dispatchEvent`, `classList`, `tagName`, `ownerDocument`,
 * `closest` and `getRootNode` all threw; `appendChild` discarded the element it was handed;
 * `textContent` escaped without decoding; `toggleAttribute`, `append`, `dataset`, `style` and
 * `attributes` were simply absent. The code that runs server-side is a **component**, which is user
 * code doing ordinary DOM things.
 *
 * So this is a matrix over the surface rather than a test per method. A member that is missing, or
 * present but not writing through to the markup, fails here — including one nobody has thought of
 * yet, as soon as it is added to the list.
 *
 * What is deliberately absent, and why: `insertBefore` and `cloneNode` need a real tree, and this
 * holds a string. Faking them would put content in the wrong place silently, which is worse than a
 * method that is not there.
 */
import '@verajs/ssr/vera';
import assert from 'node:assert/strict';

const make = (tag = 'div') => globalThis.document.createElement(tag);

/** Every member a component may reach for, and what proves it works rather than merely exists. */
const SURFACE = [
  ['localName', (el) => el.localName === 'div'],
  ['tagName', (el) => el.tagName === 'DIV'],
  ['isConnected', (el) => el.isConnected === true],
  ['ownerDocument', (el) => el.ownerDocument === globalThis.document],
  ['getRootNode', (el) => el.getRootNode() === el],
  ['children', (el) => Array.isArray(el.children)],
  ['childNodes', (el) => Array.isArray(el.childNodes)],
  ['firstElementChild', (el) => el.firstElementChild === null],
  ['closest', (el) => el.closest('div') === null],
  ['matches', (el) => el.matches('div') === false],
  ['querySelector', (el) => el.querySelector('div') === null],
  ['querySelectorAll', (el) => el.querySelectorAll('div').length === 0],
  ['addEventListener', (el) => (el.addEventListener('x', () => {}), true)],
  ['removeEventListener', (el) => (el.removeEventListener('x', () => {}), true)],
  ['dispatchEvent', (el) => el.dispatchEvent(new globalThis.CustomEvent('x')) === true],
  ['remove', (el) => (el.remove(), true)],

  ['setAttribute / getAttribute', (el) => (el.setAttribute('a', 1), el.getAttribute('a') === '1')],
  ['getAttribute, absent', (el) => el.getAttribute('nope') === null],
  ['hasAttribute', (el) => (el.setAttribute('a', ''), el.hasAttribute('a'))],
  ['removeAttribute', (el) => (el.setAttribute('a', ''), el.removeAttribute('a'), !el.hasAttribute('a'))],
  ['getAttributeNames', (el) => (el.setAttribute('a', ''), el.getAttributeNames().includes('a'))],
  ['attributes, iterable', (el) => (el.setAttribute('a', 'v'), el.attributes.some((x) => x.name === 'a' && x.value === 'v'))],
  ['toggleAttribute, on', (el) => (el.toggleAttribute('h'), el.hasAttribute('h'))],
  ['toggleAttribute, off', (el) => (el.toggleAttribute('h'), el.toggleAttribute('h'), !el.hasAttribute('h'))],
  ['toggleAttribute, forced', (el) => (el.toggleAttribute('h', false), !el.hasAttribute('h'))],

  ['classList.add', (el) => (el.classList.add('a', 'b'), el.getAttribute('class') === 'a b')],
  ['classList.remove', (el) => (el.classList.add('a', 'b'), el.classList.remove('a'), el.getAttribute('class') === 'b')],
  ['classList.toggle', (el) => (el.classList.toggle('a'), el.classList.contains('a'))],
  ['classList.contains', (el) => !el.classList.contains('nope')],

  /** These are views over an attribute: an assignment that does not reach the markup is lost. */
  ['dataset writes through', (el) => (el.dataset.userId = '7', el.getAttribute('data-user-id') === '7')],
  ['dataset reads back', (el) => ((el.dataset.x = 'y'), el.dataset.x === 'y')],
  ['dataset delete', (el) => ((el.dataset.x = 'y'), delete el.dataset.x, !el.hasAttribute('data-x'))],
  ['style writes through', (el) => ((el.style.color = 'red'), el.getAttribute('style') === 'color: red')],
  ['style camelCase', (el) => ((el.style.backgroundColor = 'blue'), el.getAttribute('style').includes('background-color: blue'))],
  ['style reads back', (el) => ((el.style.color = 'red'), el.style.color === 'red')],
  ['style.cssText', (el) => ((el.style.cssText = 'color: red'), el.style.color === 'red')],
  ['style.setProperty', (el) => (el.style.setProperty('color', 'red'), el.style.color === 'red')],

  ['textContent round-trips', (el) => ((el.textContent = '<b>&</b>'), el.textContent === '<b>&</b>')],
  ['textContent escapes in markup', (el) => ((el.textContent = '<b>'), el.innerHTML.includes('&#60;b&#62;'))],
  ['appendChild keeps the element', (el) => {
    const kid = make('span');
    kid.setAttribute('class', 'c');
    kid.textContent = 'k';
    el.appendChild(kid);
    return el.innerHTML === '<span class="c">k</span>';
  }],
  ['append takes several', (el) => (el.append(make('i'), make('b')), el.innerHTML === '<i></i><b></b>')],
  ['append escapes a string', (el) => (el.append('<b>'), el.innerHTML === '&#60;b&#62;')],
  ['replaceChildren clears first', (el) => (el.append(make('i')), el.replaceChildren(make('b')), el.innerHTML === '<b></b>')],

  ['attachShadow returns the root', (el) => el.attachShadow({ mode: 'open' }).mode === 'open'],
  ['shadowRoot.host', (el) => el.attachShadow({ mode: 'open' }).host === el],
  ['shadowRoot query surface', (el) => el.attachShadow({ mode: 'open' }).querySelectorAll('*').length === 0],
  ['shadowRoot listeners', (el) => (el.attachShadow({ mode: 'open' }).addEventListener('x', () => {}), true)],
];

/** A raw-text element stores what it is given: CSS and script are not markup. */
const RAW_TEXT = [
  ['style keeps > and "', () => { const el = make('style'); el.textContent = '.a > .b[x="y"] {}'; return el.textContent === '.a > .b[x="y"] {}'; }],
  ['style is not escaped in markup', () => { const el = make('style'); el.textContent = '.a > .b {}'; return !el.innerHTML.includes('&#'); }],
  ['script keeps its source', () => { const el = make('script'); el.textContent = 'a && b < c'; return el.innerHTML === 'a && b < c'; }],
];

/**
 * The same surface, on the shadow root and the document.
 *
 * They are containers too, and each was short of a *different* set of members because each was
 * written for whoever happened to use it. They share a base now; this asserts the sharing holds.
 */
const CONTAINERS = [
  ['shadowRoot', () => make().attachShadow({ mode: 'open' })],
  ['document.body', () => globalThis.document.body],
];
const CONTAINER_SURFACE = [
  ['append', (c) => (c.append(make('i')), c.innerHTML.includes('<i>'))],
  ['appendChild', (c) => (c.appendChild(make('b')), c.innerHTML.includes('<b>'))],
  ['replaceChildren', (c) => (c.append(make('i')), c.replaceChildren(make('b')), c.innerHTML === '<b></b>')],
  ['querySelector', (c) => c.querySelector('*') === null],
  ['querySelectorAll', (c) => c.querySelectorAll('*').length === 0],
  ['getElementById', (c) => c.getElementById('x') === null],
  ['children', (c) => Array.isArray(c.children)],
  ['firstElementChild', (c) => c.firstElementChild === null],
  ['addEventListener', (c) => (c.addEventListener('x', () => {}), true)],
  ['dispatchEvent', (c) => c.dispatchEvent(new globalThis.CustomEvent('x')) === true],
];

/** The document's own surface, beyond being a container. */
const DOCUMENT_SURFACE = [
  ['createElement', () => globalThis.document.createElement('div').localName === 'div'],
  ['createElementNS', () => globalThis.document.createElementNS('svg', 'circle').localName === 'circle'],
  ['createTextNode', () => globalThis.document.createTextNode('<b>').innerHTML === '&#60;b&#62;'],
  ['createDocumentFragment', () => typeof globalThis.document.createDocumentFragment().append === 'function'],
  ['title is writable', () => ((globalThis.document.title = 't'), globalThis.document.title === 't')],
  ['documentElement', () => globalThis.document.documentElement.localName === 'html'],
  ['head.appendChild', () => (globalThis.document.head.appendChild({ innerHTML: '' }), true)],
];

/** `CSSStyleSheet`, which `@verajs/styles` uses and a component may use differently. */
const SHEET_SURFACE = [
  ['replaceSync', () => { const s = new globalThis.CSSStyleSheet(); s.replaceSync('.a{}'); return s.cssText === '.a{}'; }],
  ['replace', async () => { const s = new globalThis.CSSStyleSheet(); await s.replace('.b{}'); return s.cssText === '.b{}'; }],
  ['insertRule', () => { const s = new globalThis.CSSStyleSheet(); s.replaceSync('.a{}'); s.insertRule('.b{}'); return s.cssText.includes('.b{}'); }],
  ['cssRules', () => Array.isArray(new globalThis.CSSStyleSheet().cssRules)],
];

let pass = 0;
const failures = [];
for (const [name, check] of SURFACE) {
  let ok;
  try {
    ok = check(make());
  } catch (error) {
    ok = `${error.constructor.name}: ${error.message}`;
  }
  if (ok === true) pass++;
  else failures.push(`${name} — ${ok === false ? 'wrong result' : ok}`);
}
for (const [name, check] of RAW_TEXT) {
  let ok;
  try {
    ok = check();
  } catch (error) {
    ok = `${error.constructor.name}: ${error.message}`;
  }
  if (ok === true) pass++;
  else failures.push(`${name} — ${ok === false ? 'wrong result' : ok}`);
}

for (const [containerName, build] of CONTAINERS) {
  for (const [name, check] of CONTAINER_SURFACE) {
    let ok;
    try {
      ok = check(build());
    } catch (error) {
      ok = `${error.constructor.name}: ${error.message}`;
    }
    if (ok === true) pass++;
    else failures.push(`${containerName}.${name} — ${ok === false ? 'wrong result' : ok}`);
  }
}
for (const [name, check] of [...DOCUMENT_SURFACE, ...SHEET_SURFACE]) {
  let ok;
  try {
    ok = await check();
  } catch (error) {
    ok = `${error.constructor.name}: ${error.message}`;
  }
  if (ok === true) pass++;
  else failures.push(`${name} — ${ok === false ? 'wrong result' : ok}`);
}

/** Absent on purpose — see the header. If one of these appears, it needs a real implementation. */
{
  const el = make();
  for (const name of ['insertBefore', 'cloneNode']) {
    assert.equal(typeof el[name], 'undefined',
      `${name} exists now — it needs a tree, so make sure it does not silently misplace content`);
  }
}

if (failures.length) {
  console.log(`\n  ${failures.length} DOM member(s) missing or wrong:\n`);
  for (const failure of failures) console.log('    ' + failure);
}
const total =
  SURFACE.length + RAW_TEXT.length + CONTAINERS.length * CONTAINER_SURFACE.length +
  DOCUMENT_SURFACE.length + SHEET_SURFACE.length;
console.log(`\nssr dom surface: ${pass}/${total} members behave`);
if (failures.length) process.exit(1);
