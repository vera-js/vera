/**
 * Vera-native SSR. Node resolves the module graph (`import()`), execution registers component classes
 * (through `customElements.define`, which the shim owns), templates flatten through the sigil-aware
 * serializer, and nested components are found by scanning the markup just written for tags the registry
 * knows (`scan.js`) — never by parsing HTML. Client takeover is `@verajs/renderer/hydrate`, which adopts
 * this markup in place.
 *
 * Import THIS module first — before anything that imports `@verajs/renderer`, which needs the shims at
 * import time.
 */
import { installShims, registry, flushFrames } from './shim.js';
import { serializeTemplate, serializeValue } from './serializer.js';
import { decode as decodeEntities } from './parse.js';
import { ATTRIBUTE, renderComponentTags } from './scan.js';

installShims();
const { wire } = await import('@verajs/core');
const { styles } = await import('@verajs/styles');
wire([styles]);

/** The server renderer: a template in, its markup into the (shadow) container. */
const serverRenderer = (template, container) => {
  container.innerHTML = template?.strings ? serializeTemplate(template) : serializeValue(template);
};
wire({ on: 'render', fn: serverRenderer, priority: 50 });

/** Builds a registered component's element, with the attributes its tag carried in the markup. */
const buildInstance = (tag, attrString) => {
  const element = new (registry.get(tag))();
  element.localName = tag;
  if (attrString)
    for (const [, name, quoted, single, bare] of attrString.matchAll(ATTRIBUTE))
      element.setAttribute(name, decodeEntities(quoted ?? single ?? bare ?? ''));
  return element;
};

/** One component tag found by the scan: its open tag and contents — the scanner writes the close. */
const emit = (tag, attrString, depth, children) => {
  const { open, inner } = renderInstance(buildInstance(tag, attrString), depth, children);
  return open + inner;
};

/** Runs an element's lifecycle, then serializes it — declarative shadow DOM, or its light DOM. */
const renderInstance = (element, depth, children) => {
  if (children) element.innerHTML = children;
  element.upgrade();
  element.connectedCallback?.();
  flushFrames();
  const open = element.openTag();
  const shadowRoot = element._shadowRoot;
  if (shadowRoot)
    return {
      open,
      inner: `<template${shadowRoot.templateAttributes()}>${shadowRoot.styleTags()}${renderComponentTags(shadowRoot.innerHTML, depth, emit)}</template>`,
    };
  return { open, inner: renderComponentTags(element.innerHTML, depth, emit) };
};

/**
 * Renders a component module to markup.
 *
 * @param {string | URL} url Module URL — the component's file
 * @param {object} [options]
 * @param {string} [options.tag] Picks the element when the module defines several
 * @param {string} [options.children] Markup placed inside the entry tag
 * @return {Promise<{ html: string, styles: string, title: string }>}
 */
export const renderToString = async (url, { tag, children = '' } = {}) => {
  const module = await import(url instanceof URL ? url.href : url);
  if (!tag)
    for (const exported of [module.default, ...Object.values(module)])
      for (const [name, Class] of registry) if (Class === exported) tag = name;
  if (!tag || !registry.has(tag)) throw new Error(`ssr: no custom element definition found for ${url}`);
  const { open, inner } = renderInstance(buildInstance(tag, ''), 0, children);
  return { html: `${open}${inner}</${tag}>`, styles: '', title: '' };
};

export { registry, serializeTemplate };
