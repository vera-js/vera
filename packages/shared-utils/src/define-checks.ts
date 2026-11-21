/**
 * **What a misused `define` is told, in every package that defines components — DEVELOPMENT ONLY** (`@verajs/core`'s `define`
 * and `@verajs/lite`'s both call it behind `__DEV__`, so production carries none of it; `area` is the caller's label). One module, so both tiers check a definition
 * identically and say so in the same words. It reads no registry: `swapping` (a development swap module is wired, so a
 * redefine is a swap) is the caller's to say — core reads its registry, a small tier has none.
 */
import { diagnostic, misuse } from './diagnostic.js';
import * as SHARED from './diagnostics.js';
import { camel } from './utils.js';

/**
 * Development: the declared attributes, said by code. Not an array of names → refused, by code (production throws the
 * platform's own error further on, so both builds refuse). A shared prop whose default is not a string or `null` FLIPS
 * type when the attribute arrives (the platform hands strings); a camel name the platform's element already has
 * (`hidden`, `title`, `ariaLabel`) replaces that REFLECTING property — `el.hidden = true` no longer hides it.
 */
const checkAttributes = (area: string, tag: string, attributes: unknown, props: Record<string, unknown> | undefined) => {
  if (!Array.isArray(attributes) || attributes.some((name) => typeof name !== 'string'))
    throw new TypeError(misuse('define', 'define-attributes', __DEV__ && SHARED.defineAttributes(String(attributes))));
  for (const name of attributes as string[]) {
    const prop = camel(name);
    const subject = `define('${tag}') attributes '${name}'`;
    const shared = props && Object.hasOwn(props, prop) ? props[prop] : null;
    if (shared !== null && typeof shared !== 'string')
      console.warn(diagnostic(area, subject, 'define-attribute-type', __DEV__ && SHARED.defineAttributeType(prop, typeof shared)));
    if (prop in HTMLElement.prototype) console.warn(diagnostic(area, subject, 'define-attribute-reflected', __DEV__ && SHARED.defineAttributeReflected(prop)));
  }
};

/**
 * Development: an own `__proto__` key of `props` or `methods` (`JSON.parse` makes one; an object literal never does),
 * which both builds skip, said by code. True when `name` is that key, so the caller moves on to the next.
 */
const protoKey = (area: string, subject: string, name: string, kind: 'prop' | 'method') => {
  if (name !== '__proto__') return false;
  console.error(diagnostic(area, subject, 'define-proto-key', __DEV__ && SHARED.defineProtoKey(kind)));
  return true;
};

/**
 * Development: the declared props, said by code — installed identically in both builds. A name a method also has (the
 * prop wins), a platform member's name, an object default that cannot be copied per element (a `Set`, a `Map`, a class
 * instance: SHARED by every instance — set it in the setup, or pass it in).
 */
const checkProps = (area: string, tag: string, props: unknown, methods: object | undefined) => {
  if (props === null || typeof props !== 'object') {
    console.warn(diagnostic(area, `define('${tag}') props`, 'define-props-not-object', __DEV__ && SHARED.definePropsNotObject(String(props))));
    return;
  }
  for (const name of Object.keys(props)) {
    const subject = `define('${tag}') props.${name}`;
    if (protoKey(area, subject, name, 'prop')) continue;
    const value = (props as Record<string, unknown>)[name];
    if (methods && Object.hasOwn(methods, name)) console.warn(diagnostic(area, subject, 'define-prop-method', __DEV__ && SHARED.definePropMethod(name)));
    else if (name in HTMLElement.prototype) console.warn(diagnostic(area, subject, 'define-shadows', __DEV__ && SHARED.defineShadows(name)));
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && (value as object).constructor !== Object)
      console.warn(diagnostic(area, subject, 'define-prop-shared-default', __DEV__ && SHARED.definePropSharedDefault()));
  }
};

/**
 * Development: each key of `methods`, said by code — never refused, so both builds INSTALL the same thing (Brian's rule:
 * one behavior, the words in development only). Read by descriptor, so a getter is reported, not run.
 */
const checkMethods = (area: string, tag: string, methods: object, attributes: readonly string[] | undefined) => {
  for (const name of Object.keys(methods)) {
    const subject = `define('${tag}') methods.${name}`;
    if (protoKey(area, subject, name, 'method')) continue;
    const value = Object.getOwnPropertyDescriptor(methods, name)?.value as unknown;
    /** The two names core re-asserts. A comparison, not a module-level `Set`: a top-level `new Set` SURVIVES production
     *  (terser cannot prove the call free of effects — it cost +33 B gz here, 2026-10-21). */
    if (name === 'constructor' || name === 'connectedCallback' || (name === 'attributeChangedCallback' && attributes?.length)) console.warn(diagnostic(area, subject, 'define-method-ignored', __DEV__ && SHARED.defineMethodIgnored(name)));
    else if (typeof value !== 'function') console.warn(diagnostic(area, subject, 'define-method-not-function', __DEV__ && SHARED.defineMethodNotFunction()));
    else if (name === 'adoptedCallback') console.warn(diagnostic(area, subject, 'define-method-adopted', __DEV__ && SHARED.defineMethodAdopted()));
    else if (name === 'attributeChangedCallback')
      console.warn(diagnostic(area, subject, 'define-method-unobserved', __DEV__ && SHARED.defineMethodUnobserved()));
    else if (name in HTMLElement.prototype) console.warn(diagnostic(area, subject, 'define-shadows', __DEV__ && SHARED.defineShadows(name)));
  }
};

/** Development: what a misused `define` received, by code, before the platform's own refusal (which throws in both builds). */
const checkDefine = (area: string, tag: unknown, setup: unknown, swapping: boolean) => {
  if (typeof tag !== 'string' || tag.indexOf('-') < 1)
    throw new TypeError(misuse('define', 'define-tag', __DEV__ && SHARED.defineTag(typeof tag === 'string' ? `'${tag}'` : String(tag))));
  if (typeof setup !== 'function') throw new TypeError(misuse('define', 'define-setup', __DEV__ && SHARED.defineSetup(String(setup))));
  /** Silent while `@verajs/hot` is wired (`swapping`: it sets `$hot` on core's registry): a redefine is then a swap. */
  if (customElements.get(tag) !== undefined && !swapping) console.warn(diagnostic(area, `define('${tag}')`, 'tag-defined-again', __DEV__ && SHARED.tagDefinedAgain(tag)));
};

/** Development: every check of one `define` call, in order — the tag and setup first, as the platform would throw next. */
export const checkDefinition = (
  area: string,
  tag: unknown,
  setup: unknown,
  methods: object | undefined,
  props: Record<string, unknown> | object | undefined,
  attributes: readonly string[] | undefined,
  swapping: boolean
) => {
  checkDefine(area, tag, setup, swapping);
  if (methods) checkMethods(area, tag as string, methods, attributes);
  if (props !== undefined) checkProps(area, tag as string, props, methods);
  if (attributes !== undefined) checkAttributes(area, tag as string, attributes, props as Record<string, unknown> | undefined);
};
