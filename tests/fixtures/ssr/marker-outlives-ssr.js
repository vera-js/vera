/**
 * Five nodes components keep past the render that marked them, the way a memo or module cache keeps one: a deep clone
 * of a child taken after the child was appended (the append marks it), a child appended and then removed, never
 * rendered, a deep clone of rendered markup holding a child a template handed a property (the serializer marks that
 * one), and a light component that rendered such a child into itself, kept as a deep clone and as itself. A later
 * render reads all five and writes what it read: their attribute names, their `outerHTML` and `innerHTML`, a textarea
 * holding that markup, the enumerating reads of a kid parsed out of the kept light clone, and the nodes themselves.
 * Built for `tests/ssr-instance-marker-outlives.test.mjs`.
 */
import { init, html, inserts } from '@verajs/core';
import { serializeTemplate } from '@verajs/ssr';

const kept = (globalThis.__markerOutlives ??= {});

customElements.define('outlives-kid-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<i>${this.rows?.join(',') ?? 'none'}</i>`);
  }
});

customElements.define('outlives-keeper-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>kept</p>`);
    const kid = document.createElement('outlives-kid-ssr');
    kid.rows = ['a', 'b'];
    this.shadowRoot.appendChild(kid);
    kept.clone = kid.cloneNode(true);
    const gone = document.createElement('outlives-kid-ssr');
    gone.rows = ['c'];
    this.shadowRoot.appendChild(gone);
    /** CONTROL, read off the shim's own record (no DOM read shows it): the append marked the removed child. */
    kept.marked = [...gone._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    this.shadowRoot.removeChild(gone);
    kept.gone = gone;
  }
});

customElements.define('outlives-bound-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<div class="w"><outlives-kid-ssr .rows=${['d']}></outlives-kid-ssr></div>`);
    /** CONTROL, read off the shim's own record: the template's property binding marked the child it built. */
    kept.boundMarked = [...this.shadowRoot.querySelector('outlives-kid-ssr')._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    kept.bound = this.shadowRoot.querySelector('.w').cloneNode(true);
  }
});

/**
 * A light component rendering a property-bound child into itself: its children are the serializer's marked markup,
 * held as a string until something parses them, so neither a node strip nor a copy's attribute skip reaches them. A deep
 * clone of the host and the host itself are kept.
 */
customElements.define('outlives-light-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this }, () => () => html`<span><outlives-kid-ssr .rows=${['e']}></outlives-kid-ssr></span>`);
    /**
     * CONTROL, read off the shim's own record: how the host holds its children. The production build keeps them as the
     * serializer's text, marker included (the form that outlived its render); the development build as nodes.
     */
    kept.lightForm = this._entries.some((entry) => typeof entry === 'string' && entry.includes('vera-ssr-')) ? 'text' : this._entries.every((entry) => typeof entry !== 'string') ? 'node' : 'other';
    kept.lightClone = this.cloneNode(true);
    kept.light = this;
  }
});

/**
 * The second claimant: a plain wrapper holding a prepared child is deep-cloned and the copy placed first. Appending the
 * wrapper marks nothing (it is not a component), so only the copy's own attributes decide: a copy carrying the child's
 * marker would be picked up as the prepared instance in the copy's place, and the original rebuilt from its tag.
 */
customElements.define('outlives-twin-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>twin</p>`);
    const original = document.createElement('div');
    original.className = 'original';
    const kid = document.createElement('outlives-kid-ssr');
    kid.rows = ['t'];
    original.appendChild(kid);
    /** CONTROL, read off the shim's own record: the append marked the child the copy is taken from. */
    kept.twinMarked = [...kid._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    const copy = original.cloneNode(true);
    copy.className = 'copy';
    this.shadowRoot.appendChild(copy);
    this.shadowRoot.appendChild(original);
  }
});

/**
 * The cross-request one: one render prepares a child with its request's data in a wrapper it never places and keeps
 * the wrapper; a later render places it. The prepared instance must not serve the earlier request's data there.
 */
customElements.define('outlives-request-one-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>one</p>`);
    const holder = document.createElement('div');
    const kid = document.createElement('outlives-kid-ssr');
    kid.rows = ['request-one-secret'];
    holder.appendChild(kid);
    /** CONTROL, read off the shim's own record: the append marked the child the wrapper keeps. */
    kept.holderMarked = [...kid._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    kept.holder = holder;
  }
});

customElements.define('outlives-request-two-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>two</p>`);
    this.shadowRoot.appendChild(kept.holder);
  }
});

/**
 * Two moves of what a light host made from its stamped markup, inside the render that stamped it: a kid parsed out of
 * it and detached, and the host's children moved into a box no render ever places. Both kept.
 */
customElements.define('outlives-mover-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this }, () => () => html`<span><outlives-kid-ssr .rows=${['m']}></outlives-kid-ssr></span><b><outlives-kid-ssr .rows=${['n']}></outlives-kid-ssr></b>`);
    const kid = this.querySelector('span outlives-kid-ssr');
    /** CONTROL, read off the shim's own record: in production the parsed kid carries the marker as it is detached. */
    kept.detachedMarked = [...kid._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    kid.remove();
    kept.detached = kid;
    kept.box = document.createElement('div');
    kept.box.append(...this.childNodes);
  }
});

/**
 * The same render, after the pickup: a light host renders a property-bound child into itself (the scan picks the child
 * up, so nothing is pending), and a sibling after it reads that host's markup and the kid parsed out of it, which in
 * the production build still carries the marker in its record until the render ends.
 */
customElements.define('outlives-peeked-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this }, () => () => html`<span><outlives-kid-ssr .rows=${['p']}></outlives-kid-ssr></span>`);
    kept.peeked = this;
  }
});

customElements.define('outlives-peek-ssr', class extends HTMLElement {
  connectedCallback() {
    const host = kept.peeked;
    const kid = host.querySelector('outlives-kid-ssr');
    /** CONTROL, read off the shim's own record: whether the kid carries the marker while it is read. */
    kept.peekMarked = [...kid._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    const reads = [kid.getAttributeNames().join(' '), [...kid.attributes].map((attribute) => attribute.name).join(' '), kid.hasAttributes(), kid.isEqualNode(document.createElement('outlives-kid-ssr')), host.innerHTML, kid.outerHTML].join('|');
    init({ host: this, shadow: 'open' }, () => () => html`<p class="peek">${reads}</p>`);
  }
});

customElements.define('outlives-same-render-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<outlives-peeked-ssr></outlives-peeked-ssr><outlives-peek-ssr></outlives-peek-ssr>`);
  }
});

/** A component moving its own shadow root's content, the serializer's stamped markup included, into a box it keeps. */
customElements.define('outlives-shadow-mover-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p><outlives-kid-ssr .rows=${['s']}></outlives-kid-ssr></p>`);
    kept.shadowBox = document.createElement('div');
    kept.shadowBox.appendChild(this.shadowRoot);
    /** CONTROL, read off the shim's own record: what moved holds the marker (as text in production). */
    kept.shadowMovedMarked = kept.shadowBox._entries.some((entry) => typeof entry === 'string' && entry.includes('vera-ssr-'));
  }
});

/** The public flattener called by a component inside a render: its output is the tag, unstamped. */
customElements.define('outlives-flatten-ssr', class extends HTMLElement {
  connectedCallback() {
    kept.flat = serializeTemplate(html`<outlives-kid-ssr .rows=${['f']}></outlives-kid-ssr>`);
    init({ host: this, shadow: 'open' }, () => () => html`<p class="flat">${kept.flat}</p>`);
  }
});

/**
 * Markup the serializer stamped, rendered into a `<template>` through the public render insert, the way the router
 * renders into a `<template view>` outlet: the template's raw text holds the marker. Kept: the template, a deep clone
 * taken before its content was read (a copy of that raw text), its content, and a deep clone of the content.
 */
customElements.define('outlives-template-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>t</p>`);
    const box = document.createElement('template');
    for (const renderer of inserts.get('render')) renderer(html`<b><outlives-kid-ssr .rows=${['t']}></outlives-kid-ssr></b>`, box);
    /** CONTROL, read off the shim's own record: the template's raw text holds the marker. */
    kept.templateMarked = typeof box._raw === 'string' && box._raw.includes('vera-ssr-');
    kept.rawClone = box.cloneNode(true);
    kept.template = box;
    kept.content = box.content;
    kept.contentClone = box.content.cloneNode(true);
  }
});

/**
 * A stamp made BETWEEN renders: a timer the render left behind appends a registered, unrendered kid to a kept box after
 * the render has ended, so the instance is pending with no render running. `make` is taken during the render, when
 * the server's document is reachable.
 */
customElements.define('outlives-late-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>late</p>`);
    const make = document.createElement.bind(document);
    kept.lateBox = make('div');
    setTimeout(() => {
      kept.late = make('outlives-kid-ssr');
      kept.lateBox.appendChild(kept.late);
      /** CONTROL, read off the shim's own record: the append stamped the kid. */
      kept.lateMarked = [...kept.late._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    }, 0);
  }
});

/**
 * A component whose attribute callback throws at its pickup: the render fails after the scan took the instance off the
 * pending map and before the instance was prepared. A bound kid ahead of it is stamped first, so the thrower is not the
 * node that keeps the render's records non-empty. Kept: the thrower, by its constructor, and how often its callback ran.
 */
customElements.define('outlives-thrower-ssr', class extends HTMLElement {
  static observedAttributes = ['data-x'];
  constructor() {
    super();
    kept.thrower = this;
    kept.throwerCalls = 0;
  }
  attributeChangedCallback() {
    kept.throwerCalls++;
    if (kept.armThrower) throw new Error('thrower-attribute');
  }
});

customElements.define('outlives-throw-host-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<outlives-kid-ssr .rows=${['a']}></outlives-kid-ssr><outlives-thrower-ssr data-x="1" .rows=${['t']}></outlives-thrower-ssr>`);
  }
});

customElements.define('outlives-reader-ssr', class extends HTMLElement {
  connectedCallback() {
    const read = (node) => `${node.getAttributeNames().join(' ')}|${node.outerHTML}`;
    const clone = read(kept.clone);
    const gone = read(kept.gone);
    const bound = read(kept.bound);
    const lightClone = kept.lightClone.innerHTML;
    const light = kept.light.innerHTML;
    /**
     * The kid parsed out of the kept clone's marked text: a node still carrying the marker past its render. Every
     * enumerating read answers as for a bare tag: no attributes, none listed, and equal to a fresh one.
     */
    const kid = kept.lightClone.querySelector('outlives-kid-ssr');
    kept.parsedMarked = [...kid._attributes.keys()].some((name) => name.startsWith('vera-ssr-'));
    const reads = [kid.attributes.length, [...kid.attributes].map((attribute) => attribute.name).join(' '), kid.getAttributeNames().join(' '), kid.hasAttributes(), kid.isEqualNode(document.createElement('outlives-kid-ssr'))].join('|');
    init({ host: this, shadow: 'open' }, () => () => html`<p class="clone">${clone}</p><p class="gone">${gone}</p><p class="bound">${bound}</p><p class="light-clone">${lightClone}</p><p class="light">${light}</p><p class="reads">${reads}</p>`);
    const area = document.createElement('textarea');
    area.textContent = kept.clone.outerHTML + kept.gone.outerHTML + kept.bound.outerHTML + kept.lightClone.outerHTML;
    this.shadowRoot.appendChild(area);
    this.shadowRoot.appendChild(kept.clone);
    this.shadowRoot.appendChild(kept.bound);
    this.shadowRoot.appendChild(kept.lightClone);
  }
});
