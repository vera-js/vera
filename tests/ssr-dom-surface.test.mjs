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
import { readFileSync } from 'node:fs';
import { SURFACES, OUT_OF_SCOPE, GLOBALS } from './dom-surface.mjs';

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
  /**
   * **These answer now.** Each used to return nothing whatever it was asked, which passed a check
   * written as `=== null`; a detached `<div>` genuinely matches `div` and genuinely has no
   * descendants, so the contract is stated rather than the old placeholder.
   */
  ['closest', (el) => el.closest('div') === el],
  ['matches', (el) => el.matches('div') === true && el.matches('span') === false],
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
  ['classList.replace', (el) => (el.classList.add('a'), el.classList.replace('a', 'b') === true && el.className === 'b')],
  ['classList.replace, token absent', (el) => (el.classList.add('a'), el.classList.replace('z', 'b') === false && el.className === 'a')],
  ['classList.item', (el) => (el.classList.add('a', 'b'), el.classList.item(1) === 'b' && el.classList.item(9) === null)],
  ['classList indexed', (el) => (el.classList.add('a', 'b'), el.classList[0] === 'a')],
  ['classList.forEach', (el) => (el.classList.add('a', 'b'), el.classList.length === 2 && [...el.classList.values()].join() === 'a,b')],
  ['classList.entries / keys', (el) => (el.classList.add('a'), [...el.classList.entries()][0][1] === 'a' && [...el.classList.keys()][0] === 0)],
  ['classList.toString', (el) => (el.classList.add('a', 'b'), String(el.classList) === 'a b')],
  ['classList.value, written', (el) => ((el.classList.value = 'a b'), el.getAttribute('class') === 'a b')],
  /**
   * A browser empties the attribute rather than removing it, and creates nothing when it was never
   * there. The server writing one and not the other is a markup difference the client will not
   * reproduce.
   */
  ['classList emptied leaves class=""', (el) => (el.classList.add('a'), el.classList.remove('a'), el.getAttribute('class') === '')],
  ['classList.remove on a bare element writes nothing', (el) => (el.classList.remove('a'), el.getAttribute('class') === null)],
  ['classList rejects an empty token', (el) => { try { el.classList.add(''); return 'accepted an empty token'; } catch (error) { return error.name === 'SyntaxError'; } }],
  ['classList rejects a token with a space', (el) => { try { el.classList.add('a b'); return 'accepted a token with a space'; } catch (error) { return error.name === 'InvalidCharacterError'; } }],
  ['classList.supports throws, as it does for class', (el) => { try { el.classList.supports('a'); return 'did not throw'; } catch (error) { return error instanceof TypeError; } }],

  ['style.getPropertyValue', (el) => ((el.style.color = 'red'), el.style.getPropertyValue('color') === 'red')],
  ['style.getPropertyPriority', (el) => (el.style.setProperty('color', 'red', 'important'), el.style.getPropertyPriority('color') === 'important' && el.getAttribute('style') === 'color: red !important;')],
  ['style.length / item', (el) => ((el.style.color = 'red'), el.style.length === 1 && el.style.item(0) === 'color')],
  ['style custom property', (el) => (el.style.setProperty('--v', '1'), el.getAttribute('style') === '--v: 1;' && el.style.getPropertyValue('--v') === '1')],
  ['style.removeProperty returns the old value', (el) => ((el.style.color = 'red'), el.style.removeProperty('color') === 'red')],
  ['style emptied leaves style=""', (el) => ((el.style.color = 'red'), el.style.removeProperty('color'), el.getAttribute('style') === '')],
  ['style.cssText normalises on write', (el) => ((el.style.cssText = 'color: red'), el.getAttribute('style') === 'color: red;')],
  /**
   * **A semicolon inside a value does not end the declaration**, and the common case is not exotic:
   * `url("data:image/svg+xml;base64,…")` is how an inline SVG is written. Splitting the attribute on
   * every `;` emitted `background: url("data:x; color: red;` — an unterminated `url(` with the rest
   * of the declaration eaten — into the markup.
   */
  ['style: a semicolon inside url()', (el) => ((el.style.background = 'url("data:x;y")'), el.getAttribute('style') === 'background: url("data:x;y");')],
  ['style: and the declaration after it survives', (el) => { el.style.background = 'url("data:x;y")'; el.style.color = 'red'; return el.getAttribute('style') === 'background: url("data:x;y"); color: red;' && el.style.color === 'red'; }],
  ['style: a semicolon inside quotes', (el) => ((el.style.content = '";"'), el.style.content === '";"')],
  ['style: read back from a written attribute', (el) => { el.setAttribute('style', 'background: url("data:x;y"); color: red'); return el.style.color === 'red' && el.style.background === 'url("data:x;y")'; }],
  ['style: nested parentheses', (el) => ((el.style.background = 'image-set(url("a;b") 1x)'), el.style.background === 'image-set(url("a;b") 1x)')],

  /** `mode: 'closed'` is the one thing that distinguishes the two modes, and it has to hold here. */
  ['attachShadow open is reachable', (el) => el.attachShadow({ mode: 'open' }) === el.shadowRoot],
  ['attachShadow closed is not', (el) => (el.attachShadow({ mode: 'closed' }), el.shadowRoot === null)],
  /** Both refusals are the platform's, and core's own "call this once" guard exists because of them. */
  ['attachShadow needs a mode', (el) => { try { el.attachShadow({}); return 'accepted a missing mode'; } catch (error) { return error instanceof TypeError; } }],
  ['attachShadow refuses a second root', (el) => { el.attachShadow({ mode: 'open' }); try { el.attachShadow({ mode: 'open' }); return 'replaced the first root'; } catch (error) { return error.name === 'NotSupportedError'; } }],

  /** Everything this DOM builds is in the document — `isConnected` already says so. */
  ['document.contains an element', (el) => globalThis.document.contains(el) === true],
  ['document.contains(document.body)', () => globalThis.document.contains(globalThis.document.body) === true],
  ['document.contains(null)', () => globalThis.document.contains(null) === false],

  /** `tabIndex` answers the question "is this focusable", so its default is per-element, not zero. */
  ['tabIndex defaults to -1 on a div', (el) => el.tabIndex === -1],
  ['tabIndex defaults to 0 on a button', () => make('button').tabIndex === 0],
  ['tabIndex follows href on an anchor', () => { const a = make('a'); if (a.tabIndex !== -1) return 'a bare anchor is not focusable'; a.setAttribute('href', '#'); return a.tabIndex === 0; }],
  ['tabIndex written wins', (el) => ((el.tabIndex = 3), el.getAttribute('tabindex') === '3' && el.tabIndex === 3)],

  ['window.self is the global', () => globalThis.self === globalThis.window],

  /**
   * **A name the browser refuses is refused here**, or the server renders markup the client can
   * never upgrade: `define('nodash', …)` throws `SyntaxError` in every engine, and this accepted it,
   * so the component rendered, shipped, and the client threw on the line meant to bring it to life.
   */
  ['customElements refuses a name with no hyphen', () => { try { globalThis.customElements.define('nodash', class extends globalThis.HTMLElement {}); return 'accepted'; } catch (error) { return error.name === 'SyntaxError'; } }],
  ['customElements refuses an upper-case name', () => { try { globalThis.customElements.define('My-El', class extends globalThis.HTMLElement {}); return 'accepted'; } catch (error) { return error.name === 'SyntaxError'; } }],
  ['customElements refuses a reserved name', () => { try { globalThis.customElements.define('font-face', class extends globalThis.HTMLElement {}); return 'accepted'; } catch (error) { return error.name === 'SyntaxError'; } }],
  ['customElements refuses a second definition', () => { globalThis.customElements.define('surface-dupe', class extends globalThis.HTMLElement {}); try { globalThis.customElements.define('surface-dupe', class extends globalThis.HTMLElement {}); return 'accepted'; } catch (error) { return error.name === 'NotSupportedError'; } }],
  ['customElements accepts an ordinary name', () => { globalThis.customElements.define('surface-ok', class extends globalThis.HTMLElement {}); return globalThis.customElements.get('surface-ok') !== undefined; }],

  /**
   * `textContent` is a nullable `DOMString` with `[LegacyNullToEmptyString]`, and WebIDL turns
   * `undefined` into `null` for a nullable type — so both erase the content in every engine. This
   * wrote the word `null`, which put it on the page server-side and nothing client-side.
   */
  ['textContent = null is empty', (el) => ((el.textContent = null), el.textContent === '')],
  ['textContent = undefined is empty', (el) => ((el.textContent = undefined), el.textContent === '')],
  ['textContent = 0 is "0"', (el) => ((el.textContent = 0), el.textContent === '0')],

  /**
   * **Where the platform throws, this throws.** A server that is lenient about an error does not
   * make anything work — it moves the failure to the client and strips the context that would have
   * explained it, and in every one of these it also wrote markup no browser would have produced.
   *
   * The refused set is **the engines' and not jsdom's**: `tests/browser/spread-names.test.js`
   * records that they refuse exactly `a b`, `a>b`, `a=b` and `a/b` while accepting `a"b`, `a'b`,
   * `a<b` and about fifty other shapes jsdom rejects. `CLAUDE.md` records the false finding that
   * came of trusting jsdom here, which is why the rule is written down rather than probed for.
   */
  ['setAttribute refuses a name with a space', (el) => { try { el.setAttribute('a b', '1'); return 'accepted'; } catch (error) { return error.name === 'InvalidCharacterError'; } }],
  ['setAttribute refuses an empty name', (el) => { try { el.setAttribute('', '1'); return 'accepted'; } catch (error) { return error.name === 'InvalidCharacterError'; } }],
  ['setAttribute refuses "=" and "/"', (el) => ['a=b', 'a/b'].every((name) => { try { el.setAttribute(name, '1'); return false; } catch (error) { return error.name === 'InvalidCharacterError'; } })],
  ['setAttribute still accepts what engines accept', (el) => { for (const name of ['a"b', "a'b", 'a<b', 'a|b', 'a?b', 'a(b)']) el.setAttribute(name, '1'); return el.getAttributeNames().length === 6; }],
  ['toggleAttribute refuses the same set', (el) => { try { el.toggleAttribute('a b'); return 'accepted'; } catch (error) { return error.name === 'InvalidCharacterError'; } }],
  ['createElement refuses an unwritable tag', () => ['', 'a b', '<p>', 'a>b'].every((tag) => { try { globalThis.document.createElement(tag); return false; } catch (error) { return error.name === 'InvalidCharacterError'; } })],
  ['appendChild refuses a non-node', (el) => ['', null, undefined, 5].every((value) => { try { el.appendChild(value); return false; } catch (error) { return error instanceof TypeError; } })],
  /**
   * `attachInternals` belongs to a **defined** element. Every engine raises `NotSupportedError` for a
   * plain one, because `ElementInternals` is how a defined element joins a form and there is nothing
   * for a `<div>` to attach. The surface list is checked against an ordinary element, so the subject
   * here is a registered tag.
   */
  ['attachInternals refuses a plain element', (el) => { try { el.attachInternals(); return 'accepted'; } catch (error) { return error.name === 'NotSupportedError'; } }],
  ['attachInternals works on a defined element, once', () => {
    globalThis.customElements.define('surface-internals', class extends globalThis.HTMLElement {});
    const custom = globalThis.document.createElement('surface-internals');
    const first = custom.attachInternals();
    if (!first) return 'no internals returned';
    try {
      custom.attachInternals();
      return 'a second call was accepted';
    } catch (error) {
      return error.name === 'NotSupportedError';
    }
  }],
  /**
   * `root.adoptedStyleSheets = sheet` — the single missing `[…]` — is the likeliest way to get this
   * wrong, and it was accepted here and threw in the browser after the server had already rendered.
   */
  ['adoptedStyleSheets takes an array of sheets', (el) => { const root = el.attachShadow({ mode: 'open' }); root.adoptedStyleSheets = [new globalThis.CSSStyleSheet()]; return root.adoptedStyleSheets.length === 1; }],
  ['adoptedStyleSheets refuses a bare sheet', (el) => { const root = el.attachShadow({ mode: 'open' }); try { root.adoptedStyleSheets = new globalThis.CSSStyleSheet(); return 'accepted'; } catch (error) { return error instanceof TypeError; } }],
  ['adoptedStyleSheets refuses a non-sheet entry', (el) => { const root = el.attachShadow({ mode: 'open' }); try { root.adoptedStyleSheets = ['nope']; return 'accepted'; } catch (error) { return error instanceof TypeError; } }],
  ['requestAnimationFrame refuses a non-function', () => { try { globalThis.requestAnimationFrame('nope'); return 'accepted'; } catch (error) { return error instanceof TypeError; } }],

  /** These are views over an attribute: an assignment that does not reach the markup is lost. */
  ['dataset writes through', (el) => (el.dataset.userId = '7', el.getAttribute('data-user-id') === '7')],
  ['dataset reads back', (el) => ((el.dataset.x = 'y'), el.dataset.x === 'y')],
  ['dataset delete', (el) => ((el.dataset.x = 'y'), delete el.dataset.x, !el.hasAttribute('data-x'))],
  /** Trailing semicolon included, which is what a browser writes — see `styleView` in the shim. */
  ['style writes through', (el) => ((el.style.color = 'red'), el.getAttribute('style') === 'color: red;')],
  [
    'style writes two properties',
    (el) => ((el.style.color = 'red'), (el.style.top = '0'), el.getAttribute('style') === 'color: red; top: 0;'),
  ],
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
  /** These containers have a child by now — the checks above this one put it there. */
  ['querySelector', (c) => (c.replaceChildren(make('u')), c.querySelector('u')?.localName === 'u')],
  ['querySelectorAll', (c) => (c.replaceChildren(make('u')), c.querySelectorAll('*').length === 1)],
  ['getElementById', (c) => c.getElementById('x') === null],
  ['children', (c) => Array.isArray(c.children)],
  /**
   * **Asserted against a known child, not against `null`.** This used to check that the answer was
   * `null`, which was true only because the member was hardcoded — and these checks run in order
   * against the *same* `document.body`, which `replaceChildren` two lines up has just given a child.
   * Now that children are retained the member has a real contract, so this states it.
   */
  ['firstElementChild', (c) => (c.replaceChildren(make('u')), c.firstElementChild?.localName === 'u')],
];

/**
 * `window` is a container for events only — it has no markup — so it gets the same event checks
 * through the same list rather than a second one.
 */
/**
 * Everything a component can dispatch on, which is a wider set than the containers: `window` has no
 * markup at all and still has to deliver an event.
 */
const EVENT_TARGETS = [...CONTAINERS, ['element', () => make()], ['window', () => globalThis.window]];
const EVENT_SURFACE = [
  ['addEventListener', (c) => (c.addEventListener('x', () => {}), true)],
  ['dispatchEvent', (c) => c.dispatchEvent(new globalThis.CustomEvent('x')) === true],
  /** A listener that does nothing is not the same as one that never ran. */
  ['a listener fires', (c) => { let ran = false; c.addEventListener('x', () => (ran = true)); c.dispatchEvent(new globalThis.CustomEvent('x')); return ran; }],
  ['removeEventListener stops it', (c) => { let n = 0; const f = () => n++; c.addEventListener('x', f); c.dispatchEvent(new globalThis.CustomEvent('x')); c.removeEventListener('x', f); c.dispatchEvent(new globalThis.CustomEvent('x')); return n === 1; }],
  ['once fires once', (c) => { let n = 0; c.addEventListener('x', () => n++, { once: true }); c.dispatchEvent(new globalThis.CustomEvent('x')); c.dispatchEvent(new globalThis.CustomEvent('x')); return n === 1; }],
  ['a handleEvent object is a listener', (c) => { let ran = false; c.addEventListener('x', { handleEvent: () => (ran = true) }); c.dispatchEvent(new globalThis.CustomEvent('x')); return ran; }],
  ['the listener sees the target', (c) => { let target; c.addEventListener('x', (e) => (target = e.target)); c.dispatchEvent(new globalThis.CustomEvent('x')); return target === c; }],
  ['the listener sees the detail', (c) => { let detail; c.addEventListener('x', (e) => (detail = e.detail)); c.dispatchEvent(new globalThis.CustomEvent('x', { detail: 7 })); return detail === 7; }],
  ['preventDefault reaches the dispatcher', (c) => { c.addEventListener('x', (e) => e.preventDefault()); return c.dispatchEvent(new globalThis.CustomEvent('x', { cancelable: true })) === false; }],
  ['an uncancelable event cannot be prevented', (c) => { c.addEventListener('x', (e) => e.preventDefault()); return c.dispatchEvent(new globalThis.CustomEvent('x')) === true; }],
  ['stopImmediatePropagation stops the next listener', (c) => { let n = 0; c.addEventListener('x', (e) => { n++; e.stopImmediatePropagation(); }); c.addEventListener('x', () => n++); c.dispatchEvent(new globalThis.CustomEvent('x')); return n === 1; }],
];

/** The document's own surface, beyond being a container. */
const DOCUMENT_SURFACE = [
  ['createElement', () => globalThis.document.createElement('div').localName === 'div'],
  ['createElementNS', () => globalThis.document.createElementNS('svg', 'circle').localName === 'circle'],
  ['createTextNode', () => globalThis.document.createTextNode('<b>').innerHTML === '&#60;b&#62;'],
  ['createDocumentFragment', () => typeof globalThis.document.createDocumentFragment().append === 'function'],
  /** `@verajs/renderer` builds these at import time, so a component using `keyed` needs them. */
  ['createTreeWalker walks nothing', () => globalThis.document.createTreeWalker(globalThis.document, 1).nextNode() === null],
  ['createNodeIterator walks nothing', () => globalThis.document.createNodeIterator(globalThis.document).nextNode() === null],
  /** `instanceof` has to discriminate, or every check that uses it silently answers the same way. */
  ['an element is a Node', () => make() instanceof globalThis.Node],
  ['an element is an Element', () => make() instanceof globalThis.Element],
  ['an element is an HTMLElement', () => make() instanceof globalThis.HTMLElement],
  ['an element is not a ShadowRoot', () => !(make() instanceof globalThis.ShadowRoot)],
  ['an element is not a DocumentFragment', () => !(make() instanceof globalThis.DocumentFragment)],
  ['a shadow root is a Node', () => make().attachShadow({ mode: 'open' }) instanceof globalThis.Node],
  ['a shadow root is a ShadowRoot', () => make().attachShadow({ mode: 'open' }) instanceof globalThis.ShadowRoot],
  ['a fragment is a DocumentFragment', () => globalThis.document.createDocumentFragment() instanceof globalThis.DocumentFragment],
  ['a fragment is not an Element', () => !(globalThis.document.createDocumentFragment() instanceof globalThis.Element)],
  ['new Image() is an img', () => new globalThis.Image().localName === 'img'],
  ['an observer can be constructed and disconnected', () => { const o = new globalThis.IntersectionObserver(() => {}); o.observe(make()); o.disconnect(); return o.takeRecords().length === 0; }],
  ['matchMedia matches nothing', () => globalThis.matchMedia('(min-width: 0px)').matches === false],
  ['getComputedStyle answers empty', () => globalThis.getComputedStyle(make()).getPropertyValue('color') === ''],
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

for (const [containerName, build] of EVENT_TARGETS) {
  for (const [name, check] of EVENT_SURFACE) {
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

/**
 * **The completeness check.** Every member a real element, shadow root, document or stylesheet has,
 * the shim either implements or lists as out of scope with a reason.
 *
 * The matrix above asks whether the members we thought of *behave*. This asks whether we thought of
 * them at all — which is the question this file kept failing, one `TypeError` at a time. The list
 * comes from three real engines (`tests/dom-surface.mjs`, kept honest by
 * `tests/browser/dom-surface.test.js`), so it is not a second copy of somebody's memory.
 */
{
  const subjects = {
    element: make(),
    shadowRoot: make().attachShadow({ mode: 'open' }),
    document: globalThis.document,
    sheet: new globalThis.CSSStyleSheet(),
    tokenList: make().classList,
    /**
     * The global object itself. Its members are own properties rather than prototype ones, so the
     * walk below finds them on the first pass — and `in` rather than `!== undefined` is what makes
     * `undefined` itself, a real global whose value is undefined, count as present.
     */
    window: globalThis,
  };
  for (const [kind, subject] of Object.entries(subjects)) {
    const have = new Set();
    for (let object = subject; object && object !== Object.prototype; object = Object.getPrototypeOf(object))
      for (const name of Object.getOwnPropertyNames(object)) have.add(name);

    const scoped = OUT_OF_SCOPE[kind];
    const unimplemented = SURFACES[kind].filter((name) => !have.has(name) && !scoped[name]);
    if (unimplemented.length)
      failures.push(
        `${kind}: ${unimplemented.length} member(s) the real one has and this one does not, and ` +
          `which are not listed as out of scope:\n      ${unimplemented.join(', ')}`
      );
    else pass++;

    /** And the other direction: something listed as impossible must not have quietly appeared. */
    const contradicted = Object.keys(scoped).filter((name) => have.has(name));
    if (contradicted.length) failures.push(`${kind}: implemented but listed as out of scope: ${contradicted.join(', ')}`);
    else pass++;
  }
}

/**
 * **The constructors, by rule rather than by list.**
 *
 * A browser exposes about seven hundred interfaces as globals and a server has instances of almost
 * none of them, so enumerating each with its own reason would bury the surface that matters. What
 * does matter is the other direction: **every interface this shim actually implements must be a
 * global, or `instanceof` lies about an object this DOM produced.** `node instanceof Node` is
 * ordinary defensive code, and a shim that hands back an element while leaving `Element` undefined
 * fails it in a way nothing else would explain.
 */
const INSTANCES = [];
{
  const element = make();
  const instances = [
    ['EventTarget', element],
    ['Node', element],
    ['Element', element],
    ['HTMLElement', element],
    ['ShadowRoot', make().attachShadow({ mode: 'open' })],
    ['DocumentFragment', globalThis.document.createDocumentFragment()],
    ['CSSStyleSheet', new globalThis.CSSStyleSheet()],
    ['Event', new globalThis.Event('x')],
    ['CustomEvent', new globalThis.CustomEvent('x')],
    ['Image', new globalThis.Image()],
    ['Audio', new globalThis.Audio()],
  ];
  INSTANCES.push(...instances);
  for (const [name, instance] of instances) {
    const constructor = globalThis[name];
    if (typeof constructor !== 'function') {
      failures.push(`${name} is not exposed as a global, so \`instanceof ${name}\` throws`);
      continue;
    }
    if (!(instance instanceof constructor)) failures.push(`an object this DOM produced is not \`instanceof ${name}\``);
    else pass++;
  }
}

/**
 * The globals, held to the same rule: provided, or deliberately absent for a stated reason.
 *
 * The absences carry as much weight as the presences. A server that invented a `localStorage`
 * would render a logged-out shell the client immediately replaced, and nobody would see a failure.
 */
for (const [name, expected] of Object.entries(GLOBALS)) {
  const present = globalThis[name] !== undefined;
  if (present === (expected === true)) pass++;
  else if (expected === true) failures.push(`global ${name} is missing`);
  else failures.push(`global ${name} exists, but is listed as absent because ${expected}`);
}

/**
 * **The tripwire this replaced did its job.** It asserted `insertBefore` and `cloneNode` stayed
 * *absent*, on the grounds that each needs a tree and a stub would silently misplace content — and
 * it fired the moment they appeared. They have a tree now, and what it asked for exists: each is
 * compared against jsdom doing the same operation in `ssr-tree-operations.test.mjs`, error cases
 * included. This asserts the replacement is actually there, so the guarantee cannot be dropped by
 * deleting a file.
 */
{
  const el = make();
  for (const name of ['insertBefore', 'replaceChild', 'moveBefore', 'cloneNode', 'compareDocumentPosition'])
    assert.equal(typeof el[name], 'function', `${name} is missing`);

  const differential = readFileSync(new URL('./ssr-tree-operations.test.mjs', import.meta.url), 'utf8');
  for (const name of ['insertBefore', 'replaceChild', 'cloneNode', 'compareDocumentPosition'])
    assert.ok(
      differential.includes(name),
      `${name} exists but nothing compares it against a real DOM — that is what the old tripwire ` +
        `was protecting against`
    );
}

if (failures.length) {
  console.log(`\n  ${failures.length} DOM member(s) missing or wrong:\n`);
  for (const failure of failures) console.log('    ' + failure);
}
const total =
  SURFACE.length +
  RAW_TEXT.length +
  CONTAINERS.length * CONTAINER_SURFACE.length +
  EVENT_TARGETS.length * EVENT_SURFACE.length +
  DOCUMENT_SURFACE.length +
  SHEET_SURFACE.length +
  /** Two completeness checks per shim, plus every interface and every global. Derived, so adding one cannot leave it stale. */
  Object.keys(SURFACES).length * 2 +
  INSTANCES.length +
  Object.keys(GLOBALS).length;
console.log(`\nssr dom surface: ${pass}/${total} members behave`);
if (failures.length) process.exit(1);
