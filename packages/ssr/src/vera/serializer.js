import { escapeHtml, escapeRawText } from './shim.js';

/**
 * The vera-native template serializer: flattens core's `html` template objects to markup with
 * the renderer's sigil semantics applied server-side.
 *
 *   `?bool=${x}`   -> `bool=""` when truthy, nothing when falsy
 *   `.prop=${x}`   -> mirrored to an attribute for form state (value/checked/selected), else dropped
 *   `@event=${fn}` -> dropped (behavior is the client's job)
 *   `&ref=${r}`    -> dropped
 *   `attr=${x}`    -> quoted, escaped
 *   text `${x}`    -> escaped; nested templates and arrays flatten; null/undefined/false vanish
 *
 * Like the client renderer, analysis is **per template identity**: each call site's frozen
 * `strings` array is classified once into a plan (slot kinds + pre-trimmed static parts), cached
 * in a WeakMap. Rendering a 100-row list re-uses one plan 100 times instead of re-running the
 * sigil regexes per row — the same template-identity architecture, server-side.
 *
 * `keyed()`/`hold()` wrappers are client-renderer constructs — SSR templates use plain `.map`.
 */

/** `.prop` bindings whose server-side truth belongs in an attribute. */
const FORM_ATTRIBUTES = ['value', 'checked', 'selected'];

/**
 * `checked` and `selected` are **boolean** properties; `value` is a string one.
 *
 * The element coerces on assignment, so `.checked=${0}` leaves a browser with `checked === false`
 * while `.value=${0}` leaves it with `"0"`. All three were treated as string-ish here — present
 * unless nullish or exactly `false` — so every falsy-but-not-false value (`0`, `''`, `NaN`) served
 * a **ticked** checkbox against a browser's unticked one, and hydration then had to throw the
 * server's markup away to correct it.
 */
const BOOLEAN_FORM_PROPERTIES = new Set(['checked', 'selected']);

/**
 * …and the elements where that is true.
 *
 * Mirroring `.value` to an attribute exists so hydration can read form state back out of the
 * markup, which only means anything on a form control. Applied to every element, `.value` on a
 * `<b>` wrote `value="…"` server-side where the client sets a plain JS property and no attribute at
 * all — a difference in the rendered DOM for no benefit. Anywhere else a `.prop` is client state,
 * which is what it already was.
 */
const FORM_ELEMENTS = new Set(['input', 'textarea', 'select', 'option']);

/** The name of the tag currently being built, read back out of the markup so far. */
const openTagName = (out) => {
  const start = out.lastIndexOf('<');
  return start === -1 ? '' : (/^<([a-z][\w-]*)/.exec(out.slice(start))?.[1] ?? '');
};

/**
 * A sigil binding, however the author quoted it — `"`, `'`, or not at all.
 *
 * Only the double-quoted and unquoted forms were recognised, and the client supports all three
 * because it hands the markup to the platform's parser. So `<input .value='${v}' />` set a property
 * in the browser and emitted a literal attribute named `.value` on the server; `?hidden='${true}'`
 * hid the element on one side and printed `?hidden='true'` on the other. Visible difference on a
 * static page, guaranteed mismatch on a hydrated one.
 */
/**
 * `!name` is here alongside `.name` because a **live** property is still a property: the sigil only
 * changes *when the client re-writes it*, and a server has nothing to re-write against. It is
 * serialized exactly as `.name` is, so the first paint is right and the client takes over.
 *
 * A sigil the server does not know is not inert — it falls through to the plain-attribute path and
 * emits `! checked="true"`, which is an attribute named `!` and a second one beside it. That is why
 * every sigil has to be added here in the same pass it is added to the renderer.
 */
/**
 * A sigil binding's tail, as it appears at the end of the static before the value.
 *
 * The name is **optional after `&`**, and only after `&`: `&=${ref}` is a legal element ref with no
 * name at all — the renderer's scanner back-reads the name `&`, and `AttrPart` maps that to a ref.
 * The client therefore drops it and renders nothing, while this pattern did not match it and left
 * `&=` in the tag with the value stringified after it: `<p &=[object Object]>`, which is malformed
 * markup that also prints the object.
 *
 * The name is optional for all five rather than only `&`, which costs nothing: a nameless `.=`,
 * `?=`, `@=` or `!=` has no meaning either, and dropping such a binding is a better answer than
 * writing it into the tag with its value stringified beside it.
 */
const SIGIL_TAIL = /([.?@&!])([a-zA-Z][\w:-]*)?=(["']?)$/;

/** `onClick=${fn}` — the React-shaped event binding, quoted the same three ways. */
const EVENT_TAIL = /on[A-Z][\w:-]*=(["']?)$/;

/**
 * An **unquoted** plain attribute, which is the only one that needs quotes adding. A quoted one
 * carries its quotes in the statics either side, so the value is just escaped text between them.
 */
const PLAIN_ATTRIBUTE_TAIL = /[a-zA-Z][\w:-]*=$/;

/** Slot kinds: text, boolean, form-prop, dropped binding, plain attribute. */
const TEXT = 0;
const BOOLEAN = 1;
const FORM_PROP = 2;
const DROPPED = 3;
const ATTRIBUTE = 4;

/** strings identity -> { parts, kinds, names } — computed once per call site, ever. */
const plans = new WeakMap();

/**
 * Whether the text so far leaves us inside an open tag — the question every sigil test below
 * silently assumed the answer to.
 *
 * Without it a slot was classified by what the static happened to *end* with, wherever it sat.
 * `html\`<p>total=${n}</p>\`` is text, but ends in `total=`, so it was written as an unquoted
 * attribute and the server produced `<p>total="5"</p>` against the client's `<p>total=5</p>` — a
 * visible difference on a static page and a discarded hydration on a live one. The client never had
 * the bug because it hands the markup to the platform's parser, which knows where it is.
 *
 * A raw `<` in text (`a < b`) reads as an open tag here, as it does to a lenient HTML parser in
 * some positions; escape it, as HTML has always asked.
 */
const closesTag = (text, inTag) => {
  const open = text.lastIndexOf('<');
  const close = text.lastIndexOf('>');
  if (open > close) return true;
  if (close > open) return false;
  return inTag;
};

/**
 * Where a static leaves us: inside a tag, and if so, inside an attribute **value**.
 *
 * The two are different questions and only the second separates `<input ${ref} />` from
 * `<b class="a ${x} c">`. Both are values inside a tag; only the first is an *element position*,
 * where the renderer hands the element to a ref or a spread and there is no markup to write. The
 * second is text between two halves of an attribute the statics already carry.
 *
 * A tail test cannot answer it, because the quote that opened the value may be several statics
 * back — `class="a ` ends in a space and is still inside a value. So the state is carried, one
 * character at a time, and only at compile time: this runs once per template, ever.
 */
/**
 * The two **RAWTEXT** elements. A browser does not decode a character reference inside either, so
 * escaping their content does not protect anything and does corrupt it — `<style>` gets `.a &#62; .b`
 * for `.a > .b`, a selector that matches nothing, and a `<script>` gets broken source.
 *
 * `<title>` and `<textarea>` are **RCDATA**, not RAWTEXT: references *are* decoded there, so those
 * two keep ordinary escaping, which is also what the client produces. They are deliberately not in
 * this set.
 */
const RAWTEXT = new Set(['style', 'script']);

const scanTag = (text, state) => {
  let { inTag, inValue, quote, rawTag, tagName, naming } = state;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    /**
     * Inside `<style>` or `<script>` nothing is markup until that element's own end tag, so the
     * attribute machinery below must not run — and a binding here is **raw text**, which the render
     * pass has to know about.
     */
    if (rawTag) {
      const close = '</' + rawTag;
      if (
        character === '<' &&
        text.slice(i, i + close.length).toLowerCase() === close &&
        (i + close.length >= text.length || /[\s/>]/.test(text[i + close.length]))
      ) {
        i += close.length - 1;
        rawTag = '';
        inTag = true;
        tagName = '';
        naming = false;
      }
      continue;
    }
    if (inValue) {
      /** An unquoted value ends at whitespace or the tag's own `>`. */
      if (quote ? character === quote : /[\s>]/.test(character)) {
        inValue = false;
        if (!quote && character === '>') inTag = false;
        quote = '';
      }
      continue;
    }
    if (!inTag) {
      if (character === '<') {
        inTag = true;
        /** Collected as it is scanned, so a tag split across two statics keeps its name. */
        tagName = '';
        naming = true;
      }
      continue;
    }
    if (character === '>') {
      inTag = false;
      /** A self-closing tag has no content to be raw, and a closing tag opens nothing. */
      if (text[i - 1] !== '/' && RAWTEXT.has(tagName)) rawTag = tagName;
      tagName = '';
      naming = false;
    } else if (character === '=') {
      naming = false;
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      quote = text[next] === '"' || text[next] === "'" ? text[next] : '';
      inValue = true;
      i = quote ? next : next - 1;
    } else if (naming) {
      /** The name runs until the first character that cannot be in one; `/` means a closing tag. */
      if (/[a-zA-Z0-9-]/.test(character)) tagName += character.toLowerCase();
      else {
        naming = false;
        if (character === '/' && tagName === '') tagName = '\u0000';
      }
    }
  }
  return { inTag, inValue, quote, rawTag, tagName, naming };
};

/** Attribute names written into the statics, so a duplicate can be spotted before a render. */
/**
 * Preceded by whitespace, so a **tag name** is not counted as an attribute of itself, and allowed to
 * end the string, because the emitted static of an unfinished tag has no `>` yet — `<b hidden` is
 * how `<b hidden ?hidden=${x}>` arrives here, and its bare `hidden` is exactly the duplicate that
 * has to be seen.
 */
const STATIC_ATTRIBUTE = /\s([a-zA-Z][\w:-]*)(?==|[\s>]|$)/g;

const compile = (strings) => {
  const parts = [];
  const kinds = [];
  const names = [];
  /**
   * Whether a slot has to scan the open tag for an earlier write of its own name, and the tag it
   * sits in.
   *
   * Both are properties of the *template*, not of a render: an attribute can only be duplicated by
   * the statics around it, by an earlier binding in the same tag, or by a spread — and every one of
   * those is visible here. Computing them per render cost 0.03–0.06 µs on every attribute, boolean
   * and form-property binding, which is 18–68% of what those bindings cost in total. Almost no tag
   * writes a name twice, so almost every one of those scans found nothing.
   */
  const strip = [];
  const owners = [];
  /** Which RAWTEXT element each binding sits inside, `''` when none. See `RAWTEXT`. */
  const raws = [];
  /** Per part: this binding sits inside a quoted attribute value, so the attribute rule applies. */
  const attrValues = [];
  /**
   * Whether each slot is an **element position** — inside a tag but not inside an attribute value.
   *
   * `<b title="${x}">` is also a value inside a tag, and it is *not* an element position: the
   * statics carry `title="` and `">` around it and the value is simply written between them. The
   * difference is what the static ends with, so it is settled here rather than guessed at render.
   */
  const elementPositions = [];
  /** Names written so far in the tag being built — statics and earlier bindings alike. */
  let written = new Set();
  /** A spread's keys are runtime values, so a tag holding one can never be settled here. */
  let dynamicTag = false;
  let owner = '';

  /** The quote character a binding opened with, to be stripped off the front of the next static. */
  let openQuote = '';
  let inTag = false;
  /** Carried across statics — see `scanTag`. */
  let tagState = { inTag: false, inValue: false, quote: '', rawTag: '', tagName: '', naming: false };

  for (let i = 0; i < strings.length - 1; i++) {
    let part = strings[i];
    if (openQuote && part.startsWith(openQuote)) part = part.slice(1);
    const wasInTag = inTag;
    inTag = closesTag(part, inTag);
    /**
     * Scanned from the **author's** static, not the trimmed one.
     *
     * `part` has already had a binding's opening quote removed by the `openQuote` handling above, so
     * `?hidden='${x}'` reaches the scanner as `?hidden=` followed by `>bs</b>` — the closing quote
     * gone. The scanner then waits for a `'` that never comes and reads the whole rest of the
     * template as one attribute value, which made every element position after it invisible.
     */
    tagState = scanTag(strings[i], tagState);
    /** A new tag starts wherever the text opens one; what the previous tag held is irrelevant. */
    const opensTag = part.lastIndexOf('<') > part.lastIndexOf('>');
    if (opensTag || (!inTag && wasInTag)) {
      written = new Set();
      dynamicTag = false;
      owner = openTagName(part);
    }
    /**
     * Names in the statics are recorded from the text that is actually **emitted**, which is the
     * part with this binding's own name already trimmed off. Scanning the raw part instead counts
     * `title=` — the binding's own name — as a prior write, and in `<b title="a" title=${x}>` the
     * two collapse into one entry, so the real duplicate goes unnoticed.
     */
    const record = (staticText) => {
      if (inTag) for (const [, found] of staticText.matchAll(STATIC_ATTRIBUTE)) written.add(found.toLowerCase());
    };

    const sigil = inTag && SIGIL_TAIL.exec(part);
    if (sigil) {
      /** The space that preceded the binding goes with it, so dropped bindings leave no residue. */
      const before = part.slice(0, sigil.index).replace(/ $/, '');
      record(before);
      parts.push(before);
      openQuote = sigil[3];
      const kind = sigil[1];
      /** Absent after a bare `&=`, which is an element ref with no name. */
      const sigilName = sigil[2] ?? '';
      if (kind === '?') {
        kinds.push(BOOLEAN);
      } else if ((kind === '.' || kind === '!') && FORM_ATTRIBUTES.includes(sigilName)) {
        kinds.push(FORM_PROP);
      } else {
        kinds.push(DROPPED);
      }
      names.push(sigilName);
      strip.push(dynamicTag || written.has(sigilName.toLowerCase()));
      owners.push(owner);
      raws.push(tagState.rawTag);
      attrValues.push(false);
      elementPositions.push(false);
      if (sigilName) written.add(sigilName.toLowerCase());
      continue;
    }

    openQuote = '';

    const event = inTag && EVENT_TAIL.exec(part);
    if (event) {
      /** A client concern, dropped like `@` — and it may be quoted, so remember which. */
      const before = part.slice(0, event.index).replace(/ $/, '');
      record(before);
      parts.push(before);
      openQuote = event[1];
      kinds.push(DROPPED);
      names.push('');
      strip.push(false);
      owners.push(owner);
      raws.push(tagState.rawTag);
      attrValues.push(false);
      elementPositions.push(false);
      continue;
    }

    const attribute = inTag && PLAIN_ATTRIBUTE_TAIL.exec(part);
    if (attribute) {
      /**
       * The name comes off the static and is re-attached at render time, because a nullish value
       * has to take the whole attribute with it — `title=${null}` removes it on the client, exactly
       * as lit does, and this emitted `title=""`. Adoption still succeeded (the statics matched), so
       * the jsdom matrix passed on identity while the two sides disagreed about the attribute; the
       * browser suite adopting through real declarative shadow DOM is what saw it.
       */
      const before = part.slice(0, attribute.index).replace(/ $/, '');
      record(before);
      parts.push(before);
      kinds.push(ATTRIBUTE);
      const name = attribute[0].slice(0, -1);
      names.push(name);
      strip.push(dynamicTag || written.has(name.toLowerCase()));
      owners.push(owner);
      raws.push(tagState.rawTag);
      attrValues.push(false);
      elementPositions.push(false);
      written.add(name.toLowerCase());
      continue;
    }
    record(part);
    parts.push(part);
    kinds.push(TEXT);
    names.push('');
    strip.push(false);
    owners.push(owner);
    raws.push(tagState.rawTag);
    /**
     * `<p title="a ${x} b">` reaches here as TEXT — the name is in the static, so there is no sigil
     * and no `name=` tail to match — and it is emitted straight into the stream between the
     * statics. That made it take the **child-position** rule while `title=${x}` took the attribute
     * rule, so an array served `a 12 b` where the client, which builds the string and calls
     * `setAttribute`, produced `a 1,2 b`.
     */
    attrValues.push(tagState.inTag && tagState.inValue);
    /** Inside a tag, and not inside an attribute value: `<input ${ref} />`, `<b ${spread(…)}>`. */
    const elementPosition = tagState.inTag && !tagState.inValue;
    elementPositions.push(elementPosition);
    /** A spread's keys are unknown until it runs, so its tag can no longer be settled here. */
    if (elementPosition) dynamicTag = true;
  }

  let last = strings[strings.length - 1];
  if (openQuote && last.startsWith(openQuote)) last = last.slice(1);
  parts.push(last);

  const plan = { parts, kinds, names, strip, owners, raws, attrValues, elementPositions };
  plans.set(strings, plan);
  return plan;
};

export const serializeTemplate = (template) => {
  const { strings, values } = template;
  const { parts, kinds, names, strip, owners, raws, attrValues, elementPositions } = plans.get(strings) ?? compile(strings);
  let out = '';
  /**
   * Content that belongs *after* the tag being built rather than inside it — a `<textarea>`'s
   * value, which is text and not an attribute. Written into the next static right after the `>`
   * that closes the tag, replacing whatever the author wrote there, exactly as assigning `.value`
   * does on the client.
   */
  let pendingText = null;

  for (let i = 0; i < kinds.length; i++) {
    if (pendingText === null) out += parts[i];
    else {
      out += insertContent(parts[i], pendingText);
      pendingText = null;
    }
    const value = values[i];
    switch (kinds[i]) {
      case TEXT:
        /** A spread rewrites the open tag it sits in, so it is folded rather than appended. */
        if (value !== null && typeof value === 'object' && value._$attrs$) {
          const folded = foldSpread(out, value._$attrs$());
          out = folded.out;
          if (folded.text !== null) pendingText = folded.text;
        }
        /**
         * An **element-position** expression that is not a spread is a ref — `<input ${myRef} />`,
         * where the renderer hands the element to a function or assigns it to `.value`. It is
         * client state, like `@event`, and has no markup.
         *
         * It used to be stringified into the open tag, so `<input ${ref(null)} />` served
         * `<input [object Object]>` — which the parser then read as two attributes named
         * `[object` and `object]`. A value in this position never has markup; only a spread does.
         */
        else if (elementPositions[i]) {
          /**
           * **A dynamic attribute *name* is refused rather than dropped.**
           *
           * `<b ${name}="x">` puts the slot at an element position with an `=` immediately after it,
           * which is the one shape here that is not a ref. Dropping the value emitted `<b="x">` —
           * not an attribute, not a tag, markup no browser would produce from that template. The
           * client is no better off: it hands the template to the platform's parser and a marker is
           * not a name. Since both halves are broken, saying so is more use than serving either
           * one's version of broken.
           */
          if (/^=/.test(parts[i + 1] ?? ''))
            throw new Error(
              `ssr: an attribute name cannot be an expression — \`<b \${name}="x">\` is malformed ` +
                `markup in the browser too, because the parser sees the marker before the value ` +
                `exists. Use \`@verajs/renderer/spread\`, which is built for names that are not known ` +
                `until runtime and which this serializer understands.`
            );
          /**
           * The space that introduced the binding goes with it, exactly as a dropped sigil binding's
           * does. Leaving it served `<p >r</p>` where the client renders `<p>r</p>` — harmless to a
           * parser, and still a difference between the two halves for something neither of them
           * renders at all.
           */
          out = out.replace(/ $/, '');
          break;
        }
        /**
         * **Raw text is written raw, and its own end tag is neutralised.**
         *
         * A browser does not decode a character reference inside `<style>` or `<script>`, so
         * escaping there protects nothing and corrupts the content: `<style>${'.a > .b'}</style>`
         * served `.a &#62; .b`, a selector that matches nothing, while the client — which sets text
         * through the DOM and never re-parses — rendered `.a > .b`. Every interpolated stylesheet
         * was broken server-side and correct client-side, which is also a hydration divergence.
         *
         * Not escaping means the element's end tag has to be taken out of the value instead, or it
         * closes the element and everything after it parses as markup. `<\/style` is valid CSS and
         * `<\/script` is the canonical form in JavaScript; both render identically and neither is
         * seen by the tokenizer.
         *
         * `<title>` and `<textarea>` are RCDATA, not RAWTEXT — references *are* decoded there — so
         * they keep ordinary escaping, which is what the client produces for them too.
         */
        else if (raws[i]) out += escapeRawText(serializeValue(value, true), raws[i]);
        /**
         * **Inside a quoted attribute value, the attribute rule applies** — the same rule
         * `title=${x}` takes one case below, and for the same reason: the client builds the whole
         * value as a string and hands it to `setAttribute`, which is ToString and nothing else. The
         * child-position rule renders a value instead, so an array was iterated into `12` against
         * the browser's `1,2`, a `Set` into `12` against `[object Set]`, and a function vanished
         * where the client writes its source. The single-expression form was corrected for exactly
         * this; the form with static text beside it was reached by a different branch and kept it.
         */
        else if (attrValues[i]) out += escapeHtml(serializeValue(value, true));
        else out += serializeValue(value);
        break;
      case BOOLEAN:
        if (strip[i]) out = removeAttribute(out, names[i]);
        if (value) out += ` ${names[i]}=""`;
        break;
      case FORM_PROP:
        if (!FORM_ELEMENTS.has(owners[i])) break;
        /**
         * A `<textarea>`'s value is its **text content**. `<textarea value="x">` is ignored by
         * every parser, so writing the attribute served an empty control while the client — which
         * sets the property — showed the text. Held until the tag closes, because that is where the
         * content goes; see `pendingText` below.
         */
        if (owners[i] === 'textarea' && names[i] === 'value') {
          /**
           * `null` and `undefined` are **not** the same value here, and treating them as one is what
           * this used to do. `value` carries `[LegacyNullToEmptyString]` in its IDL, so assigning
           * `null` gives `''` while `undefined` goes through the ordinary ToString and gives the text
           * `"undefined"` — measured in Chromium, Firefox and WebKit, since that is the platform's
           * rule and not this package's to guess. A `== null` test collapses them.
           *
           * The booleans used to be emptied too, which disagreed with `<input>` **one branch below**
           * — the same property, on the same rule, serialized by a different branch: `true` served an
           * empty `<textarea>` against the browser's `true`.
           */
          pendingText = value === null ? '' : escapeHtml(value);
          break;
        }
        if (strip[i]) out = removeAttribute(out, names[i]);
        if (BOOLEAN_FORM_PROPERTIES.has(names[i])) {
          if (value) out += ` ${names[i]}=""`;
        } else if (value !== null || owners[i] === 'option') {
          /**
           * A string property: `true` is `"true"`, exactly as assigning it to the element gives.
           *
           * Three rules, not one, and they were measured rather than assumed:
           *
           * - `<input>` and `<textarea>` carry `[LegacyNullToEmptyString]`, so `null` means the empty
           *   string. Omitting the attribute is how markup says that — a parsed `<input>` with no
           *   `value` answers `''`.
           * - `<option>` does **not**. `option.value = null` is the text `"null"` in every engine, and
           *   omitting the attribute is worse than wrong there: `option.value` then falls back to the
           *   element's own text.
           * - `undefined` is never the empty string on any of them. It is `"undefined"`, which looks
           *   like a bug because it *is* one — but it is the client's bug too, and the two sides
           *   disagreeing about it is a hydration mismatch on top of it.
           */
          out += ` ${names[i]}="${escapeHtml(value)}"`;
        }
        break;
      case ATTRIBUTE:
        /** Unquoted `attr=${x}`: quoted so spacey values stay one attribute, absent when nullish. */
        if (strip[i]) out = removeAttribute(out, names[i]);
        if (value != null) out += ` ${names[i]}="${escapeHtml(serializeValue(value, true))}"`;
        break;
      /** DROPPED: '@' and '&' and a non-form '.' or '!': nothing — client concerns. */
    }
  }
  const tail = parts[kinds.length];
  return pendingText === null ? out + tail : out + insertContent(tail, pendingText);
};

/**
 * Puts `text` inside the element the static closes, replacing what the author wrote there.
 *
 * Only `<textarea>` needs this, and only for `.value` — every other form property is an attribute.
 * `<textarea .value=${x}>anything</textarea>` must serve `x`, because that is what the element
 * will hold on the client the moment the property is assigned.
 */
const insertContent = (staticText, text) => {
  const close = staticText.indexOf('>');
  if (close === -1) return staticText;
  const rest = staticText.slice(close + 1);
  const end = rest.toLowerCase().indexOf('</textarea');
  return staticText.slice(0, close + 1) + text + (end === -1 ? rest : rest.slice(end));
};

/**
 * Fold resolved spread bindings into the tag being built, mirroring what the client does.
 *
 * Appending is not enough, and the difference is a correctness bug rather than a nicety.
 * `<input type="text" ${spread({ type: 'number' })}>` appends a second `type`, and an HTML parser
 * keeps the **first** duplicate — so the server would render `type="text"` while the client, where
 * `setAttribute` overwrites, renders `type="number"`. Same template, two answers, and a hydration
 * mismatch between them.
 *
 * So a spread key removes any attribute of that name already written into the open tag before
 * adding its own — including when it adds nothing, because `?disabled: false` and `id: null` both
 * *remove* on the client and must remove here too. Kinds that never touch attributes client-side
 * (events, non-form properties) leave the tag alone.
 *
 * Splitting on the last `<` is safe: attribute values are escaped, so no raw `<` can appear inside
 * one.
 */
/**
 * Removes an attribute already written into the open tag being built, so the last write wins.
 *
 * An HTML parser keeps the **first** of a duplicate pair; `setAttribute` on the client overwrites,
 * so the **last** wins there. `<b title="a" title=${x}>` therefore showed `a` on a server-rendered
 * page and `b` in the browser — the same disagreement `foldSpread` was written to fix for spreads,
 * which is where this logic came from. It applies to anything that writes a name into the tag.
 */
/**
 * One pattern per attribute name, built once. `new RegExp` per binding was 16% of a 100-row render.
 */
const removalPatterns = new Map();
/**
 * The name is **escaped** before it becomes a pattern. A spread's keys are runtime data, and an
 * attribute name may legally contain regular-expression metacharacters — `a|b`, `a.b`, `a*` are all
 * names `setAttribute` accepts — so interpolating one raw built a pattern that matched something
 * else entirely. `a|b` compiled to an alternation and removed text nowhere near the attribute it
 * named.
 */
const escapeForPattern = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const removalPattern = (name) => {
  let pattern = removalPatterns.get(name);
  if (!pattern)
    removalPatterns.set(
      name,
      (pattern = new RegExp(`\\s${escapeForPattern(name)}(=("[^"]*"|'[^']*'|[^\\s>]*))?`, 'i'))
    );
  return pattern;
};

/**
 * A name that cannot be written into a tag safely.
 *
 * A spread's keys are the one part of a template that is runtime data — that is what the module is
 * for — and they were interpolated into the open tag with no check at all, while every *value*
 * around them was escaped. A key carrying a quote or a `>` therefore closed the attribute, or the
 * element:
 *
 *     spread({ 'x><script>alert(1)</script': '1' })
 *     -> <b x><script>alert(1)</script="1">x</b>
 *
 * The set is the HTML attribute-name restriction — control characters, whitespace, `"`, `'`, `>`,
 * `/`, `=` — plus `<` and a backtick, which the specification permits and no real name uses.
 *
 * It is deliberately **stricter than `setAttribute`**, which was measured in Chromium and accepts
 * `"`, `'` and `<` while rejecting whitespace, `>`, `=`, `/` and NUL. A name the platform accepts
 * but markup cannot carry is unusable in a framework that server-renders, so `@verajs/renderer/spread`
 * applies this same rule client-side and the two sides agree on every key rather than one of them
 * quietly serving different markup.
 *
 * The control-character range is the point of the rule, not a mistake in it: a name carrying one
 * is exactly what must never reach markup.
 */
// eslint-disable-next-line no-control-regex
export const UNSAFE_ATTRIBUTE_NAME = /^$|[\s"'>/=<`]|[\u0000-\u001f\u007f]/;

/**
 * Strips one attribute out of an open tag, and the one place that knows how.
 *
 * `foldSpread` had its own copy of this pattern, character for character — so a fix to one was a
 * fix to one. It also rebuilt the pattern on every key of every spread, which is the per-render
 * work `tests/ssr-serializer-work.test.mjs` exists to refuse.
 */
const stripAttribute = (tag, name) =>
  /**
   * Almost no tag carries the name twice, and a substring search settles that far faster than a
   * pattern match does. Case-insensitive to match the pattern it guards, which HTML requires.
   */
  tag.toLowerCase().includes(name.toLowerCase()) ? tag.replace(removalPattern(name), '') : tag;

const removeAttribute = (out, name) => {
  const tagStart = out.lastIndexOf('<');
  if (tagStart === -1) return out;
  return out.slice(0, tagStart) + stripAttribute(out.slice(tagStart), name);
};

const foldSpread = (out, entries) => {
  const tagStart = out.lastIndexOf('<');
  let tag = out.slice(tagStart);
  let added = '';
  /** A `<textarea>`'s value is its text content, so a `.value` key here is not an attribute. */
  let text = null;

  const owner = openTagName(out);
  const isFormElement = FORM_ELEMENTS.has(owner);
  for (const [kind, name, value] of entries) {
    const serializes =
      kind === 'a' || kind === 'b' || (kind === 'p' && isFormElement && FORM_ATTRIBUTES.includes(name));
    if (!serializes) continue;

    /**
     * Dropped, and dropped **before** anything is done with the name — `stripAttribute` compiles it
     * into a pattern, so an unchecked name is a second way in.
     *
     * Silent here on purpose. A key that reaches this is either a mistake, which the identical check
     * in `@verajs/renderer/spread` reports in development where the author will see it, or it is
     * hostile — and a server that logs a line per hostile key hands an attacker the log file.
     */
    if (UNSAFE_ATTRIBUTE_NAME.test(name)) continue;

    /** Quoted, single-quoted, unquoted, or valueless — whatever the template author wrote. */
    tag = stripAttribute(tag, name);

    /**
     * A `<textarea>`'s `.value` is its **content**, exactly as it is for a written binding — the
     * attribute this would otherwise write is ignored by every parser, so the control arrived empty
     * while the client, which sets the property, showed the text. The written form was fixed and
     * this one was not: a spread key means what the written binding means, always.
     */
    if (kind === 'p' && owner === 'textarea' && name === 'value') {
      text = value === null ? '' : escapeHtml(value);
      continue;
    }

    /**
     * Same coercions as a written binding, kind by kind — which is the contract, and which this had
     * only approximately.
     *
     * A **boolean** is truthiness, and so are `checked` and `selected`. A plain **attribute** takes
     * anything that is not nullish, `false` included: `String(false)` is `"false"`, which is what
     * `setAttribute` writes and what the written form already emitted. Treating `false` as removal
     * for every kind meant `${spread({ title: false })}` dropped the attribute while
     * `title=${false}` kept it — the same value, two answers, from the two spellings of one binding.
     */
    if (kind === 'b' || (kind === 'p' && BOOLEAN_FORM_PROPERTIES.has(name))) {
      if (value) added += ` ${name}=""`;
    } else if (kind === 'p') {
      /**
       * **A string form property and a plain attribute are no longer the same rule**, which is why
       * this branch split. An attribute is removed by either nullish value — the renderer's own
       * documented behaviour, matching lit, on both sides. A `value` property is not: its IDL carries
       * `[LegacyNullToEmptyString]` on `<input>` and `<textarea>`, so `null` alone means the empty
       * string, `undefined` is the text `"undefined"`, and `<option>` has neither rule and takes
       * `"null"`. Written and spread must agree about all of it —
       * `tests/ssr-spread-equivalence.test.mjs` is what caught this one, and it caught it the same
       * afternoon the written form was corrected.
       */
      if (value !== null || owner === 'option') added += ` ${name}="${escapeHtml(value)}"`;
    } else if (value != null) {
      /**
       * A plain attribute takes anything not nullish and is removed by either nullish value.
       * `false` is `"false"` and `true` is `"true"`, because that is what `setAttribute` produces.
       */
      added += ` ${name}="${escapeHtml(serializeValue(value, true))}"`;
    }
  }

  /**
   * The element-position slot already carries the separating space, so the first addition drops its
   * own. When a spread contributes nothing — every key nullish, or all of them client concerns —
   * that space is left dangling before the `>`, which the parser ignores and which is still a byte
   * in every response and untidy in a view-source.
   */
  return {
    out: out.slice(0, tagStart) + (added ? tag + added.slice(1) : tag.replace(/ $/, '')),
    /** Written into the next static, after the `>` that closes this tag — see `insertContent`. */
    text,
  };
};

/**
 * Exported so the renderer can flatten a non-template return the same way a slot does — see
 * `index.js`. Everything about what renders and how it escapes lives here and only here.
 */
export const serializeValue = (value, raw = false) => {
  /**
   * Only `null` and `undefined` are empty, exactly as on the client — `false` and `0` render.
   * `false` used to serialize as empty here, which made `${cond && 'x'}` emit nothing on the server
   * and the text `false` in the browser: a silent content difference on a static page, and a full
   * re-render on a hydrated one.
   */
  if (value == null) return '';
  /**
   * **An attribute stringifies exactly as the platform does, and nothing else.**
   *
   * A child position renders a value — a template becomes markup, an array renders every item, a
   * function is client state and disappears. An attribute does none of that: it goes through
   * `setAttribute`, which is `String(value)` and only that. The two are different rules and this
   * had one of them.
   *
   * Measured against a browser, every one of these disagreed: `[1, 2]` served `12` against `1,2`
   * (arrays have their own `toString`), a `Set` served `1,2` against `[object Set]`, a function
   * served nothing against its own source, and a **template served its markup into an attribute
   * value** against `[object Object]`. Escaped, so not an injection — and still a completely
   * different page before and after hydration.
   */
  if (raw) return `${value}`;
  if (Array.isArray(value)) return value.map((entry) => serializeValue(entry)).join('');
  if (typeof value === 'function') return '';
  if (typeof value === 'object') {
    /** Template-shaped (core's html, by shape) recurses. `keyed()` mutates one, so it arrives here. */
    if (value.strings) return serializeTemplate(value);
    /**
     * `hold(result)` is `{ $h: result }` — a client-renderer construct that keeps the DOM of a
     * toggled-away subtree alive so form values and scroll positions survive the round trip. There
     * is no previous DOM on a server, so the wrapper means nothing here and the template inside it
     * means everything.
     *
     * It used to fall through to `String(value)` and serve the text `[object Object]` into the
     * page. `keyed()` works because it mutates the template and hands the same object back; `hold`
     * wraps one, and nothing unwrapped it.
     */
    if (value.$h) return serializeValue(value.$h, raw);
    /**
     * A spread (`@verajs/renderer/spread`) at element position. It hands back resolved bindings and this
     * decides what reaches markup: attributes and truthy booleans do, form properties do because
     * hydration reads them back, and events and other properties are client state. Escaping happens
     * here and only here — principle #8 puts it at the render boundary, not at the source.
     */
    if (value._$attrs$) return '';

    /**
     * An iterable renders its entries, exactly as the client's child position does — a `Set` or a
     * `Map` reaching a template is not obviously deliberate, but the two sides have to agree about
     * it or hydration is discarded.
     */
    if (typeof value[Symbol.iterator] === 'function') {
      return [...value].map((entry) => serializeValue(entry)).join('');
    }

    /**
     * Everything else falls through to `String(value)`, which is what the client does.
     *
     * This used to return `''` for any object that was not template-shaped, and the client has
     * never agreed: a `Date` rendered its full date string there and nothing here, an object with a
     * `toString` rendered its text, a `Promise` rendered `[object Promise]`. Whether any of those is
     * a *sensible* thing to interpolate is beside the point — the two sides disagreeing is a silent
     * hydration mismatch, and matching junk is worth more than differing junk.
     *
     * A DOM node is the one exception, and it cannot occur: the server has no document to have
     * built one.
     */
  }
  return raw ? `${value}` : escapeHtml(value);
};
