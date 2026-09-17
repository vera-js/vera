# @verajs/ssr

## 0.2.0

### Minor Changes

- aefb023: The `./vera` subpath is removed — import from `@verajs/ssr`
  
  `@verajs/ssr/vera` was a fossil of the multi-strategy era (wcc fork, Astro adapter), when the
  suffix said *which* SSR you were getting. The vera-native implementation has been the only one
  for some time, and both specifiers pointed at the same module — a package named vera, scoped
  vera, sub-pathed vera. The plain specifier is the import now; the subpath is gone from the
  `exports` map and `tests/docs-removed-apis.test.mjs` keeps the old spelling out of the docs.
  
  Breaking under the 0.x rule (a resolvable specifier stops resolving), hence minor.
- e44124c: Four defects that only appear on a server — a thing that handles more than one request.
  
  **Concurrent renders could serve each other's content.** The entry tag was found by snapshotting the
  registry, awaiting the import, and diffing. Two renders overlapping — the normal condition for a
  server — both saw both modules' new registrations and both took the last, so a request for one
  component was answered with another's markup. Verified: concurrent renders of two modules both
  returned the second. The tag is now found by matching the module's **exports** against the registry,
  which depends on nothing outside the module being asked about.
  
  *Breaking:* a module that defines an element and exports nothing can no longer be guessed at —
  export the class or pass `{ tag }`. Guessing across an await is what caused the bug.
  
  **Every response shipped the CSS of every component the process had ever rendered.** `hoistedStyles`
  was a flat array no render scoped, so response two carried response one's styles. Bounded by
  component count rather than unbounded, but every page shipped the whole design system and disclosed
  which components live on pages the visitor never asked for. Styles are now keyed by the component
  that hoisted them, and a response carries only the tags it rendered.
  
  **Nested components double-escaped their attributes.** They are found by scanning markup this module
  just wrote, so their values arrive escaped; handing that to `setAttribute` gave a child
  `Tom &#38; Jerry` where the parent passed `Tom & Jerry`, and re-escaping produced `&#38;#38;` —
  entity codes visible on the page, and a mismatch against whatever the client computes on hydration.
  
  **Only double-quoted attributes parsed.** `<x-y a='one' b=two c>` gave the child three empty
  attributes and invented two more, because the value text fell through and matched as a name. All
  four forms — quoted, single-quoted, unquoted, valueless — are read now.
  
  **A slot is classified by where it is, not by what precedes it.** The attribute and sigil tests ran
  on any static ending the right way, wherever it sat, so `html\`<p>total=${n}</p>\`` was written as an
  unquoted attribute: the server produced `<p>total="5"</p>` against the client's `<p>total=5</p>`.
  Sigils in text were worse — `.value=${x}` in a sentence was dropped entirely. The compiler now
  tracks whether it is inside a tag, which is the question the client gets for free from the platform's
  parser.
  
  **A scan for components no longer reads stylesheets.** The shadow serializer concatenated its
  `<style>` tags with the content and handed the whole string to the nested-component scan, which read
  CSS as markup — a `content: "<some-comp>"` was enough to have that component **rendered inside the
  stylesheet**. Styles are prepended after the scan now, never passed through it.
  
  **An `async connectedCallback` is refused rather than silently emptied.** Rendering recurses inside
  `String.replace`, which cannot await, so everything after a component's first `await` happened long
  after its markup was serialized: an empty element, and nothing said so. It now throws, naming the
  component and pointing at the fix — load data before `renderToString` and pass it in.
  
  **`attributes` accepts an object, whose values are escaped.** It was a raw string spliced into the
  markup, so a value taken from a request could close the tag and open a `<script>`. The string form
  stays for a caller who genuinely needs to write markup an object cannot describe.
  
  **`children` places markup inside the entry tag** — what a `<slot>` renders. A component built
  around a slot could previously only be server-rendered empty.
  
  **The server element behaves like an element.** The shim was built as "the smallest DOM surface
  core's server path touches", which is the wrong bar — the code that runs here is *user* code, and a
  component that emits an event or adds a class in `connectedCallback` is doing nothing unusual. Seven
  members threw a `TypeError` that took the whole render down: `dispatchEvent`, `ownerDocument`,
  `tagName`, `children`, `classList`, `closest` and `getRootNode`. They answer now, the way a detached
  childless element would.
  
  **What a component does to itself in `connectedCallback` reaches the markup.** The opening tag was
  copied from the source text, so a `setAttribute('role', …)`, an `aria-*` or a class added during the
  lifecycle was thrown away — present on the client after hydration, absent on the server, so the two
  disagreed on every one. Tags are written from the element's attributes now.
  
  **The nested-component scan reads markup rather than guessing at it.** A single regex could not tell
  markup from text, and got three things wrong: a `>` inside an attribute value — which is legal
  unescaped — cut the tag in half, so `<x-y title="a > b">` rendered with a mangled value and left the
  remainder as loose text beside it; a component named inside an HTML comment was rendered into the
  comment; and one named inside a `<textarea>` was rendered into its value. The walk now tracks quote
  state and skips comments and the raw-text elements (`script`, `style`, `textarea`, `title`). No cost:
  the 100-row table measures the same as it did with the regex.
  
  **Single-quoted bindings work.** Only the double-quoted and unquoted forms were recognised, while
  the client supports all three because it hands markup to the platform's parser. So
  `<input .value='${v}' />` set a property in the browser and emitted a literal attribute named
  `.value` on the server, `?hidden='${true}'` hid the element on one side and printed `?hidden='true'`
  on the other, and `@click='${fn}'` left `@click=''` behind. A visible difference on a static page and
  a guaranteed mismatch on a hydrated one, for `.prop`, `?bool`, `@event` and `onClick` alike.
  
  **`props` carries structured data to a component.** Attributes hold strings and nothing else, so a
  component taking rows or a config object could not be server-rendered with real data — it had to be
  handed JSON and parse it back. `props` assigns before `connectedCallback`, which is where a client
  parent would have put them.
  
  **Escaping got a fast path.** Most values have nothing to escape, and asking first is cheaper than
  running a global replace: 200 escapes of ordinary text measured 9.60 µs going straight to `replace`
  against 3.03 µs testing first, and text that does need escaping came out slightly ahead too. A
  100-row table went from 40.3 µs to 35.7 µs for the serializer and 52.0 µs to 47.4 µs for the whole
  component pipeline.
  
  **`seen` makes a page of several islands work.** Each render returns the styles of what *it*
  rendered, so two islands sharing a component each carried that component's CSS and the assembled
  page shipped it twice. A `Set` carried across the calls emits each component's styles once; a single
  render behaves exactly as before.
  
  **The package is type-checked.** It was the only one with no `tsconfig.json`, so `npm run typecheck`
  skipped all 441 lines of it. `checkJs` closes that without a build step or a `.ts` rewrite — the
  sources still ship as the plain ESM they are. It found the options object had drifted out of its own
  signature, and it forces the shim's deliberate lies about being a DOM to be marked as deliberate.
  
  **`base` bounds the module URL.** `renderToString` executes the module it is given, and `new URL`
  applies `../` before the call is made — so a server mapping a route to a component file has already
  traversed by the time anything could check. Pass `base` whenever part of the URL came from a request
  and anything resolving outside it is refused, with the same containment and the same wording
  `@verajs/autoloader` uses for the URLs it derives. Opt-in, because most calls name a constant and a
  check that is always trivially satisfied stops being read.
  
  **A nullish attribute value removes the attribute**, as it does on the client and in lit.
  `title=${null}` emitted `title=""` server-side against no attribute at all client-side. The
  attribute name now comes off the static and is re-attached only when there is a value — a nullish
  one takes the whole attribute with it, exactly as the sigil bindings already did.

### Patch Changes

- 7908b35: Server and client agree on how a value inside an attribute becomes a string
  
  Two divergences, found by enumerating coercion across every position rather than picking cases. Both
  are the class `CLAUDE.md` calls the worst in this package: the two sides disagree about something
  neither of them renders, so nothing fails until a hydration mismatch turns up somewhere else.
  
  **A value interpolated inside a quoted attribute took the child-position rule.** `<p title="a ${x} b">`
  reaches the compiler as TEXT — there is no sigil and no `name=` tail to match — and was emitted into
  the stream with the rule that *renders* a value: an array iterated to `a 12 b` where the browser,
  which builds the string and calls `setAttribute`, produces `a 1,2 b`; a `Set` to `a 12 b` against
  `a [object Set] b`; a function vanished where the client writes its source; a template result served
  its markup into an attribute value. Every one of those is the list already written in
  `serializeValue`'s own comment — they were corrected for `title=${x}` and the branch with static text
  beside it kept them. One rule, two branches, and only one was fixed.
  
  **A symbol was special-cased into markup no client could reproduce.** `String(value)` and
  `` `${value}` `` are the same operation for every input except a symbol, which `String` alone turns
  into its description instead of throwing. So the server served `Symbol(s)` while every DOM conversion
  on the client throws — and the client disagreed with *itself*: `title=${symbol}` threw while
  `title="a ${symbol} b"` quietly rendered `a Symbol(s) b`, the same sigil on the same attribute,
  behaving differently depending on whether static text sat beside it. Both sides now refuse it, which
  is what the platform does.
  
  The function-at-a-text-position difference is untouched and still deliberate — it is in the SSR
  README's list, and `tests/render-exotic-values-parity.test.mjs` now fails if that sentence
  disappears, so a documented divergence cannot quietly stop being documented.
  
  2 B gzipped on `@verajs/renderer`; `@verajs/ssr` ships no bundle.
  
  ## If you render server-side without hydrating
  
  Every change above makes the server agree with the client, so a **hydrating** app sees the same page
  it always saw — the difference was the mismatch, and the mismatch is what went away. A **static** SSR
  consumer has no client to agree with, and for them these are visible output changes:
  
  | written | before | now |
  | --- | --- | --- |
  | `<input .value=${undefined}>` | `<input>` | `<input value="undefined">` |
  | `<textarea .value=${true}>` | empty | `true` |
  | `<p title="a ${[1, 2]} b">` | `a 12 b` | `a 1,2 b` |
  | `${Symbol('s')}` at any position | `Symbol(s)` | **throws** |
  
  Each new answer is the one a browser gives, which is why it changed — but `undefined` becoming the
  visible text `"undefined"` is a surprise worth knowing about rather than discovering. It was always
  what the client showed after hydration; only the server was hiding it.
- 1e89906: `<style>` and `<script>` content is written raw, not escaped
  
  A browser does not decode a character reference inside either element, so escaping their content
  protected nothing and corrupted it. `<style>${'.a > .b'}</style>` served `.a &#62; .b` — a selector
  that matches nothing — while the client, which sets text through the DOM and never re-parses,
  rendered it correctly. **Every interpolated stylesheet was broken server-side and right in the
  browser**, which is a hydration divergence as well as a visible styling bug. A `<script>` got the
  same treatment, which breaks the source outright.
  
  Not escaping means the element's own end tag has to come out of the value instead, so the serializer
  now tracks which RAWTEXT element a binding sits inside and neutralises the closer (`<\/style`,
  `<\/script` — valid CSS and JavaScript, invisible to the tokenizer).
  
  `<title>` and `<textarea>` are RCDATA, not RAWTEXT — references *are* decoded there — so they keep
  ordinary escaping, which is also what the client produces for them.
- 59d2d22: Collections answer `item()` and `namedItem()`, and the node constants are on `Node` itself.
  
  `childNodes`, `children`, `querySelectorAll` and the `getElementsBy*` family answer with plain arrays
  rather than live collections. That is deliberate — there is nothing to be live over while a render is
  a single pass — but `item()` and `namedItem()` went with it, and those were never part of the
  reasoning. `list.item(0)` threw `TypeError` from ordinary code, and from any library written against
  the DOM rather than against arrays. Both are provided now, matching a real collection: out of range is
  `null` rather than `undefined`, and `namedItem` matches in document order.
  
  `Node.TEXT_NODE` and the rest were `undefined`. WebIDL puts a constant on both the prototype and the
  interface object, and `node.nodeType === Node.TEXT_NODE` is the ordinary spelling — the constants
  reached instances and not the constructor, so that comparison read against `undefined` and was quietly
  false for every node.
  
  The array difference is also written into the README, which a source comment claimed it already was.
- f67c232: `before`, `after`, `replaceWith`, a fragment that empties, and an `outerHTML` setter
  
  - **`before`, `after` and `replaceWith`** were out of scope for needing "the parent it has none of",
    which stopped being true when child nodes started being retained. All three work on elements, text
    and comments, and a plain string becomes a text node as the spec says.
  - **A document fragment hands over its children and is left empty**, which is what a browser does and
    the entire point of the type. Its markup was inlined instead, so the fragment still reported the
    children it had supposedly given away.
  - **`outerHTML` can be assigned.** It was a getter only, so `element.outerHTML = '<p>x</p>'` — an
    ordinary way to swap a node out — was a `TypeError` on the server and worked in the browser. With
    no parent it returns silently, which is what the spec says and what Chromium, Firefox and WebKit
    all do; the obvious guess of `NoModificationAllowedError` is wrong, as the spec raises that only
    when the parent is a *Document*.
- 2ab03e3: The collection queries, `isEqualNode`, `normalize` and composed `getRootNode`
  
  Four more members that answered a constant because there was nothing to look at, and became wrong
  the moment a tree existed:
  
  - `getElementsByTagName`, `getElementsByTagNameNS` and `getElementsByClassName` returned `[]`
    whatever the tree held. They answer from it now — plain arrays rather than live `HTMLCollection`s,
    which is already a recorded difference: there is nothing to be live *over* in a single render pass.
  - `document.querySelector`, `getElementById`, `getElementsBy*` and `getElementsByName` searched
    nothing at all, so `document.getElementById('x')` was `null` for an element appended to `body`
    moments earlier. Each walks `documentElement` then `body`.
  - `isEqualNode` compared **identity**, which is what `isSameNode` is for — two elements built
    identically reported themselves different. It compares type, name, attributes as a set, and
    children pairwise now.
  - `normalize()` was a no-op because there were no text nodes to merge. Appending two of them left
    two children where a browser leaves one.
  - `getRootNode({composed: true})` ignored `composed` and stopped at the shadow root instead of
    continuing out through the host.
  
  Each is compared against jsdom performing the same operation in `tests/ssr-tree-operations.test.mjs`.
- 400cf42: A binding wins over a static attribute of the same name, on both sides.
  
  An HTML parser keeps the **first** of a duplicate pair while `setAttribute` overwrites, so
  `<b title="a" title=${x}>` showed `a` on a server-rendered page and `b` in the browser — the same
  disagreement `foldSpread` was written to fix for spreads, now applied to anything that writes a name
  into a tag.
  
  The client had the other half of it. `?bool` and nullish attribute bindings skipped their DOM call on
  the first commit, on the reasoning that a fresh clone carries no such attribute — true unless the
  template statically carries one, which is exactly the case in question. `<b hidden ?hidden=${false}>`
  stayed hidden in the browser and was not hidden on the server. Both are unconditional now, which
  costs one DOM call per nullish binding on first render and makes the renderer 12 B smaller.
- 069f878: The server DOM now has the properties that exist only on *some* elements — `input.disabled`,
  `a.href`, `td.colSpan`, `option.selected` — 273 of them across 44 tags.
  
  It had one element type for every tag, carrying only the members every element shares. Anything
  element-specific became a plain JavaScript property: `button.disabled = true` read back `true`,
  wrote no attribute, and **served a button that was not disabled** until the bundle landed and the
  client set it for real. `input.value`, `input.checked` and `option.selected` were lost the same way,
  and reading any of them before writing gave `undefined` where a browser gives `''` or `false`, so
  `input.value.trim()` threw on the server and worked in the client. Nothing failed, which is why it
  lasted: the assignment looked like it had worked from every angle except the markup.
  
  The table is measured from Chromium, Firefox and WebKit rather than written from memory, and a
  property is only in it when all three agree on every measured cell *and* reading the attribute back
  gives what was written — which excludes the ones resolved against a document URL, read out of layout
  or clamped. Each tag gets a prototype carrying exactly its own interface, so `'disabled' in
  paragraph` stays `false`. `tests/browser/element-reflections.test.js` re-measures in a real engine
  and fails if the table and the browser ever drift apart.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- 9f3eff5: Answer enumerated reflections with a state, and accept an assignment to `part` and `classList`
  
  An enumerated reflection does not hand back the attribute's text. `inputmode="bogus"` reads as `''`
  in every engine, and an absent attribute frequently has a different answer again —
  `autocapitalize` is `''` when missing and `'sentences'` when invalid. The shim returned the raw text
  for all of them, so a component reading `element.inputMode` on the server got `'bogus'` where the
  browser gives `''`.
  
  `contentEditable` now validates what is assigned to it: the three states are accepted and
  lowercased, `'inherit'` removes the attribute, and anything else throws a `SyntaxError` as every
  engine does. `part` and `classList` are declared `[PutForwards=value]`, so `element.part = 'a b'` is
  a legal operation — it was a getter with no setter here, which made a `TypeError` out of something
  the browser performs.
  
  `spellcheck` and `autocorrect` are deliberately unchanged: the engines genuinely disagree about
  both, so there is no single answer to match.
  
  Markup is unaffected — the attribute was already stored verbatim, which is what the engines do too.
  Every rule was measured on Chromium, Firefox and WebKit before it was implemented, and both
  `tests/browser/reflected-enumerations.test.js` and `tests/ssr-reflected-enumerations.test.mjs`
  record it.
- bb26f01: `eventPhase` now says which phase is running, the phase constants are on the event itself, and
  `dispatchEvent` takes an `Event` rather than anything shaped like one.
  
  `eventPhase` read `NONE` for the whole dispatch where every engine reports 1, 2 and 3, and Node puts
  `AT_TARGET` and its neighbours on `Event` alone while all three engines also put them on
  `Event.prototype`. Together those made `event.eventPhase === event.AT_TARGET` — the ordinary way to
  ask "was this mine, or a descendant's?" — compare a number against `undefined`, so the branch was
  never taken at all rather than taken wrongly, and the server quietly disagreed with the client about
  an event both of them dispatched.
  
  The dispatch guard checked `typeof event.type === 'string'`, which `{ type: 'click' }` satisfies, so
  the server accepted a call every engine refuses with a `TypeError` and the mistake reached the client
  before failing.
  
  Found by dispatching the same 23 events against this DOM and jsdom and comparing; the three
  behaviours were then confirmed on Chromium, Firefox and WebKit before being called defects.
- 2a705b5: Events propagate
  
  Bubbling was absent, and the README said why: this DOM held children as a string, so there was no
  ancestor chain to walk and an event reached its own target's listeners and stopped. Children are
  nodes now, so the chain exists and the reason has expired — a component dispatching a `CustomEvent`
  for a parent to hear worked in the browser and did nothing on the server, which is the quietest kind
  of divergence: nothing throws, a handler simply never runs.
  
  All three phases work, with `stopPropagation`, `stopImmediatePropagation`, `composedPath()`, correct
  `target`/`currentTarget`, and a shadow boundary crossed only by a `composed` event. A listener that
  throws is reported and does not take the dispatch down.
  
  The listeners moved off the platform's `EventTarget` to make this possible — it cannot be asked to
  run *only* its capturing listeners, so the phases could not be told apart. Everything it provided is
  reproduced and re-asserted: `once`, `handleEvent` objects, duplicate registration ignored, and a
  return value reflecting `preventDefault`. Each is compared against jsdom dispatching the same event
  in `tests/ssr-events.test.mjs`.
  
  The walk covers the node tree; an event does not continue into `document` or `window`, which are not
  part of it here.
- ed8dc99: `<svg>` and `<math>` no longer decline the whole fragment
  
  Foreign content switches the HTML spec into rules this parser does not implement — self-closing tags
  mean something different, names stay case-sensitive, attributes are adjusted — so it used to refuse
  the markup outright. That meant **a card with an icon in it got no node view at all**, which is a
  great deal to give up for one `<svg>`.
  
  The element is modelled and its interior is kept as one opaque chunk. The surrounding markup parses
  normally, the icon is an element you can find and read attributes from, and nothing inside it is
  claimed. `tests/ssr-parse-differential.test.mjs` compares foreign content at its boundary and
  everything around it in full.
  
  The parser now reads 61 of 67 corpus inputs with no disagreement against parse5. The six it declines
  all need the spec's error recovery or cannot be represented: an unclosed non-optional element,
  misnested formatting, `<div/>`, an implied `<tbody>`, `<template>`, and a stray end tag.
- 42bc70b: Describe the selector boundary as the list it is, rather than as one rule that is only half true.
  
  `select.js` and the SSR README both explained every refusal the same way: "a pseudo-class needs user
  state, layout or a document that a server does not have". True of `:hover`, `:checked` and `:root`.
  False of `:first-child`, `:last-child`, `:nth-child()`, `:only-child`, `:empty`, `:first-of-type` and
  `:nth-of-type()`, which are pure structure — this DOM has everything needed to answer them, and
  refuses them anyway because the matcher does not implement them. A reader following the stated rule
  would predict `:first-child` works.
  
  Refusing stays the right behaviour: it is loud, and a wrong answer would not be. Implementing the
  structural set is a feature, not a fix, and is not done here.
  
  No behaviour change. `tests/ssr-selector-grammar.test.mjs` now holds the boundary as two lists — what
  is refused because a server cannot answer it, and what is refused although a real DOM can — so a
  selector crossing it is a decision rather than a surprise.
- 0dc705f: Say when per-request CSS is dropped
  
  A tag's stylesheets are established once per class for the life of the process — whichever render
  reaches it first sets them, and every later request serves those. That rule is deliberate: it is what
  stops a per-class sheet being emitted once per instance.
  
  What was wrong is that a component whose CSS depends on the request had that variation discarded **in
  silence**, so the second visitor got the first visitor's colours with nothing anywhere to explain it.
  It now warns once per tag, names the component, and says what to do instead.
  
  Found while building the concurrency gate for the async-render work: a fixture written to make a
  style leak visible could not be, *because* this rule had already thrown the difference away.
- 8f8dbb2: `innerText` breaks lines with `<br>`, and `isContentEditable` follows the state
  
  Assigning `innerText` went through `textContent`, leaving a literal newline where every engine
  writes a `<br>`. A page lays a literal newline out as a single space, so a component that set
  `innerText` rendered its lines **run together on the server and correctly broken on the client** —
  a difference in the markup itself, not merely in what a property reads back. All three spellings of
  a break are handled, and `\r\n` is one `<br>` rather than two.
  
  `isContentEditable` compared the attribute's text to `'true'`, which answers `false` for
  `plaintext-only`, for an empty attribute and for `TRUE` — all three are editable. It now reads the
  `contentEditable` state.
  
  Both rules were measured on Chromium, Firefox and WebKit before being implemented, and
  `tests/browser/inner-text.test.js` records them.
- 1ea2ccf: Three reflected properties answered with a measurement probe value.
  
  `area.shape`, `ol.type` and `textarea.wrap` were listed in the reflections table as enumerated, with
  an invalid-value answer of `"zzz-not-a-state"` — not a string any engine produces, but the probe value
  used to discover an invalid-value default, recorded as though it were the answer. So
  `area.shape = 'anything'` answered `"zzz-not-a-state"`, and `shape = 'CIRCLE'` answered `"circle"`,
  where every engine echoes the input.
  
  An enumerated *content* attribute is not an enumerated *IDL* attribute. All three name a limited set
  of keywords that affect rendering, and all three have a plain `attribute DOMString` in their IDL, so
  the property reflects verbatim. Reclassified as plain string reflections, which is what a real DOM
  does — asserted against one rather than against expected strings, since the table's own header says
  these were measured on three engines and a measurement would have shown the echo.
- 1b197f4: Report declined markup even when the element has other children.
  
  The warning for a chunk this DOM could not parse was guarded on the element having **no** nodes at
  all. So a container holding both parsed nodes and a declined chunk answered `children` with only the
  nodes, said nothing, and still emitted the declined markup into the output — some content visible and
  some invisible, which is harder to diagnose than none visible, and it was the half with no warning.
  
  Dropping that guard is safe because a surviving string entry means exactly one thing. Measured:
  markup that parses becomes nodes, `append('text')` becomes a text node, and `append('<p>x</b>')`
  becomes a text node too, since a string argument is text rather than markup. The only entry still a
  string after parsing is a chunk the parser declined.
  
  The message also said `children`/`querySelector` "answer emptily", which is now only half true — they
  can answer with the part that did parse.
- 4591472: A numeric reflection now writes the converted number, not the value it was handed.
  
  The platform applies the WebIDL conversion for the property's type at assignment and writes the
  **converted** number to the attribute. This wrote the value verbatim, so `element.width = 3.9`
  produced `width="3.9"` on the server where the client writes `width="3"` — a hydration mismatch from
  ordinary code, since a fractional dimension is what arithmetic produces. `'probe'` and `''` now write
  `"0"` as they do in a browser, rather than being stored as-is.
  
  Measured in Chromium across all 31 numeric reflections, which share this rule exactly.
  
  **Not** included: the per-property handling of a negative value, which eleven of them clamp to 0, six
  to 1, four refuse, two allow, and `canvas` and `input.size` replace with an element default. That is
  thirty-one hand-classified rows in a table whose hand-classified rows have already produced one
  defect, and a negative width is a caller's mistake where a fractional one is not. The measured table
  is recorded for whenever that trade is worth making.
- e7e56f5: A dead-code and consistency sweep from the full-line read — no behaviour changes
  
  Every removal was verified unreachable before it went: core's `runHooks` kept an optional call on a
  value already guarded, and `runCallbacks` re-fetched through two map lookups the very set it was
  iterating; the ssr serializer's final `raw` ternary sat below the early return that makes it
  unreachable, an entity-table entry could never match its own regex branch, and the fragment parser
  carried a variable it only ever `void`ed; the JSX transform now initialises `usedSpread` beside its
  two siblings instead of relying on undefined-is-falsy.
  
  Also in `@verajs/ssr`: the Set-diff that recovered "the entry `setRenderer` registered" around the
  `wire()` call was a leftover from an API that registered a wrapper. `wire` registers the function it
  is handed, so the renderer-displacement guard now asks the chain for `serverRenderer` by identity —
  same check, two lines and one allocation fewer, and the comments above it stop teaching a removed
  API.
  
  Net −16 B gzipped on `@verajs/core`; size claims re-synced.
- 8175cf4: Five tree-mutation defects in the SSR DOM, found by fuzzing sequences against jsdom.
  
  Every member of this DOM already agreed with jsdom when called on its own. These only appear in
  sequences, and three of the five are one root cause — the file treated a node and its own argument as
  necessarily different, and every one of these operations allows them to be the same.
  
  - `insertBefore(x, x)` ignored the spec's "if referenceChild is node, set it to node's next sibling",
    so the detach that followed made the index lookup fail and `x` landed at position `n - 2`. With two
    children it went first, with five second-to-last, and **with three it was correct** — which is the
    size a hand-written case uses. Reached in practice by `x.after(y)` where `y` already follows `x`.
  - `replaceChild` was the only insertion path with no ancestor check, so a node could be made to
    contain itself.
  - `prepend` moved the existing children aside and destroyed all of them if `append` then threw.
  - `x.replaceWith(x)` deleted `x`.
  - `x.replaceChild(x, x)` moved `x` to the end and destroyed the last child.
  
  The last two are silent data loss on a server: a failed or no-op call that removes content.
- 9897b14: A binding inside `<iframe>` or `<noscript>` no longer paints the renderer's marker onto the page.
  
  The renderer marks a child slot with `<?…>`, which a parser turns into a comment — except inside an
  element whose children it reads as text, where it stays characters and never becomes a part.
  `RAW_TEXT_TAGS` listed four such elements and there are six.
  
  - `html`<iframe>${v}</iframe>`` rendered the literal marker — `<?$v8hpsho$>` — and never updated, in
    **all three engines**.
  - `html`<noscript>${v}</noscript>`` did the same **in Firefox only**. A template's contents are parsed
    with the scripting flag disabled, which is what decides whether `noscript` is raw text, and
    Chromium and WebKit parse it as markup there while Firefox parses it as text. So an app developed
    in Chrome shipped the framework's internal syntax onto the page for Firefox users.
  
  `@verajs/ssr` was missing the same two, so its DOM built a tree no browser builds:
  `<noscript><img src="x"></noscript>` parsed to an element and `querySelectorAll('noscript img')`
  answered `1` where every engine answers `0`.
  
  Both lists were measured across Chromium, Firefox and WebKit rather than read off a spec — and jsdom
  is not the oracle here: it parses with scripting disabled, so it agreed with the old list about
  `noscript` while all three real engines disagreed with both.
- 1033554: Three form-property rules where there was one, and a carriage return that cannot round-trip in RAWTEXT
  
  **`value` is not one rule, it is three, and a `== null` test collapsed them.** Measured in Chromium,
  Firefox and WebKit rather than assumed: `<input>` and `<textarea>` carry `[LegacyNullToEmptyString]`
  in their IDL, so `null` alone means the empty string while `undefined` goes through the ordinary
  ToString and is the text `"undefined"`; `<option>` has neither rule and gives `"null"`. The server
  treated `null` and `undefined` as the same value everywhere, and `<textarea>` additionally emptied
  booleans — so `.value=${true}` served an empty control where the browser shows `true`, disagreeing
  with `<input>` one branch below it.
  
  Written bindings and spread keys were both wrong, in three separate branches of the same rule.
  `tests/ssr-spread-equivalence.test.mjs` caught the third on its own, which is the check working.
  
  **A carriage return cannot survive inside `<style>` or `<script>`, and the README now says so.** The
  fix that made `&#13;` carry a CR through applies to text, attributes and RCDATA. RAWTEXT is the
  branch it cannot reach: a browser does not decode a character reference inside those two elements —
  that is what makes them RAWTEXT — while the input-stream preprocessor still collapses the raw CR.
  There is no spelling that survives, so it is listed beside NUL and the lone surrogate rather than
  claimed as fixed, and the README's "and are the only two" is now three. Reached in practice by an
  interpolated stylesheet whose source has Windows line endings, which a checkout with
  `core.autocrlf=true` produces for every template literal.
  
  All three behaviours are asserted against the engines in `tests/browser/rawtext-carriage-return.test.js`
  and `tests/browser/form-property-coercion.test.js`; jsdom is never the oracle for a parser or IDL rule.
  
  ## If you render server-side without hydrating
  
  Every change above makes the server agree with the client, so a **hydrating** app sees the same page
  it always saw — the difference was the mismatch, and the mismatch is what went away. A **static** SSR
  consumer has no client to agree with, and for them these are visible output changes:
  
  | written | before | now |
  | --- | --- | --- |
  | `<input .value=${undefined}>` | `<input>` | `<input value="undefined">` |
  | `<textarea .value=${true}>` | empty | `true` |
  | `<p title="a ${[1, 2]} b">` | `a 12 b` | `a 1,2 b` |
  | `${Symbol('s')}` at any position | `Symbol(s)` | **throws** |
  
  Each new answer is the one a browser gives, which is why it changed — but `undefined` becoming the
  visible text `"undefined"` is a surprise worth knowing about rather than discovering. It was always
  what the client showed after hydration; only the server was hiding it.
- c80dd32: `renderToStringAsync` — a render that waits for the component
  
  `renderToString` is synchronous end to end, so an `async connectedCallback` is refused: its markup
  would be empty, and saying so beats shipping it. `renderToStringAsync` waits — for the callback, and
  for promises to settle between frame rounds.
  
  Two things that were impossible now work:
  
  - **A component that loads data renders with it.** `async connectedCallback` is awaited.
  - **A routed component renders its route.** Its first navigation is scheduled on a frame and is
    asynchronous, so the markup used to be serialized while the route was still resolving and the
    outlet went out empty. The first view is now in the first response instead of only after
    hydration. `@verajs/router` returns the promise from that frame callback rather than dropping it,
    which is what gives anything a chance to wait for it.
  
  **The two chains share what decides *what* to emit** — the scanner, the serializer, the instance
  preparation, the page assembly — and differ only in when they may wait.
  `tests/ssr-async-parity.test.mjs` renders every fixture through both and compares markup, styles and
  title, because two paths that must agree forever is the failure this package has spent a week
  deleting.
  
  The scan stays synchronous in both: a component tag becomes a placeholder and its render a promise,
  and the placeholders are substituted once everything settles. Awaiting inside the scan would have
  meant a second copy of the parser, and an async recursion measures **2.45x even when nothing
  suspends** — which the synchronous path is not going to pay for a feature it never uses. A generator
  driven two ways, which is how Lit does it, measured **6.31x** and was rejected for the same reason.
  
  **Asynchronous renders take a turn each.** The per-render bookkeeping is module-level, and being
  synchronous end to end is what makes concurrent `renderToString` calls safe; a render that pauses
  does not have that protection. One at a time is the version that cannot be wrong, and it costs
  concurrency only between *asynchronous* renders. `renderToString` is untouched.
- b0586c6: DOM nodes render at a child position, and two server/client disagreements are fixed.
  
  `${someNode}` used to coerce to `[object HTMLSpanElement]`; it now renders the node itself, in
  arrays and `keyed()` lists too. That is what lets a template hold something another library owns — a
  charting canvas, a map container, an editor instance — without an element ref and a manual
  `append()`. It costs the renderer 23 B gzipped.
  
  `hydrate()` no longer throws on a value the server cannot have rendered. An opaque object at a child
  position reached a spread of a non-iterable and raised `TypeError: value is not iterable`, which
  escaped the mismatch guard and out of `render()` — where every other disagreement with the server
  degrades quietly to a clean client render. A client-only DOM node now adopts without giving up
  hydration at all: the server rendered nothing for it, so the node is inserted and the surrounding
  server DOM is still adopted in place.
  
  `@verajs/ssr` serializes `false` at a child position as the text `false`, matching the client
  renderer and lit-html. It used to emit nothing, so `${cond && 'x'}` produced different content on
  the two paths — invisible on a static page, and a discarded hydration on a server-rendered one.
- 3fc6e49: `document.scrollingElement` is the `documentElement`
  
  It was `null`, which is the answer a *quirks-mode* document gives — and this document declares
  `compatMode: 'CSS1Compat'` two lines above, so it was contradicting itself. A component reading
  `document.scrollingElement.scrollTop`, which every engine allows, threw a `TypeError` on the server
  and worked in the browser.
  
  Measured on Chromium, Firefox and WebKit; all three answer `documentElement`.
- 67de0d4: `<select .value>` selects the right option, on both sides
  
  A `<select>` has no `value` content attribute — assigning the property *selects an option* — and
  neither half of the framework got this right.
  
  **The server wrote ` value="b"` on the `<select>` tag**, which no parser reads, leaving a control
  showing its first option. It now marks the matching `<option selected>`, which is what React's server
  renderer does; `@lit-labs/ssr` drops the binding entirely and serves the same wrong control we did.
  Matching follows the platform — the `value` attribute verbatim, otherwise the option's text stripped
  and collapsed, first match wins, and a `selected` the author wrote is cleared because a property
  assignment overrides markup. Asserted in Chromium, Firefox and WebKit, because every one of those
  rules is the platform's.
  
  **The client selected the wrong option, or none.** `.value` commits in document order, so when the
  options come from `${items.map(…)}` — the ordinary way to write a select — they did not exist yet and
  the assignment matched nothing: measured, index 0 instead of 1, and −1 when option values were
  themselves bound. **lit-html has the identical defect**, measured the same way. The assignment is now
  applied after the pass commits, and it is queued rather than dirty-checked because the options can be
  replaced while the value stays the same, which drops the selection just as thoroughly.
  
  One case has no fix and is now in the SSR README: a value matching **no** option leaves the client at
  `selectedIndex: -1` while a parsed `<select>` takes its first, and there is no markup for "none of
  them". `tests/ssr-select-parity.test.mjs` asserts that as a divergence, so closing it fails loudly.
- 319d6b9: Refuse a symbol wherever a DOM string is expected, as every engine does
  
  The shim coerced with `String(value)`, which answers `'Symbol(s)'` for a symbol where the WebIDL
  `DOMString` conversion the platform performs throws a `TypeError`. Eleven members were affected —
  `setAttribute` (name and value), `getAttribute`, `hasAttribute`, `removeAttribute`,
  `toggleAttribute`, `setAttributeNS`, `className`, `id`, `textContent` and `createElement`.
  
  Being the lenient one server-side does not avoid the failure, it relocates it: the server wrote
  `class="Symbol(s)"` happily and the client threw on the same assignment during hydration, with
  nothing left to say where the value came from. Measured across Chromium, Firefox and WebKit
  (`tests/browser/dom-string-coercion.test.js`); all three refuse all eleven.
  
  `insertAdjacentHTML` also reported two different failures as one. A position that is not one of the
  four now throws the platform's `SyntaxError` `DOMException`; `beforebegin`/`afterend` still throw
  the explanation that a server-rendered component has no parent, which is a real constraint and a
  different problem from a typo'd position.
  
  `CSSStyleSheet.replaceSync` had the same gap and one more: it assigned the caller's value straight
  through, so `cssText` held whatever type it was handed. A number, an array or a plain object reached
  the `<style>` block by concatenation, producing wrong text a long way from the call that caused it.
  It now always holds a string, and `replace()` shares the one rule instead of having its own.
  
  **For a static SSR consumer** this turns silent nonsense into a throw. Code that passed a symbol was
  already rendering `Symbol(s)` into the page and already failing on the client; it now fails on the
  server, where the stack points at the call.
- 8f3766a: Apply `[LegacyNullToEmptyString]` to the whole class, not one member of it.
  
  A handful of IDL string attributes store `''` when assigned `null` rather than the word `"null"`. The
  SSR README already records one as found and fixed — "`textContent = null` writing the word 'null'" —
  and that fix went to the member instead of the rule, so `input.value`, `textarea.value` and
  `innerHTML` stayed wrong.
  
  It reaches a page through ordinary code: `element.value = maybeNull` in a component made the server
  write `value="null"`, so the control showed the word "null" until hydration replaced it with the
  empty string the client stores.
  
  `undefined` is deliberately not included — the platform stringifies it, and only `null` is
  special-cased. Both directions are now asserted, so over-applying the rule fails too.
- 2faf6af: A `<slot>` reports what it projects
  
  `assignedNodes`, `assignedElements` and `assignedSlot` answered nothing for every node, so a
  component inspecting what it had been handed found an empty list and rendered its fallback content —
  on the server only, where a browser would have shown the real thing.
  
  All of it is answerable here: the host, its children and their `slot` names are all present. Named
  and default slots both work, and `assignedNodes({flatten: true})` falls back to the slot's own
  content when nothing is assigned.
  
  `assignedNodes` and `assignedElements` are **only on a `<slot>`**, as they are in a browser, where
  they live on `HTMLSlotElement`. Defining them as ordinary methods put them on every element, so
  `typeof element.assignedNodes === 'function'` — the ordinary way to ask whether something is a slot
  — answered yes for a `<div>`.
- 3c58656: Declare `@verajs/core` and `@verajs/styles` as peer dependencies, which `@verajs/ssr` imports and did
  not ask for.
  
  `src/vera/index.js` does `await import('@verajs/core')` and `await import('@verajs/styles')` at module
  scope — core for `wire` and `inserts`, styles because server rendering must serialize a component's
  `static styles` and nothing on the server cares about the bytes, so SSR wires the adopter rather than
  making every caller remember to. The manifest declared neither, and no dependencies at all. Anyone
  installing `@verajs/ssr` on its own got a package that throws on import.
  
  **Peer rather than regular**, deliberately. A regular dependency lets npm nest a second copy of
  `@verajs/core` whenever the consumer's version is outside the range — and two cores means two
  `@verajs/inserts` maps, so a module registers into a registry the other core never reads. That is the
  hazard `CLAUDE.md` describes for CDN bundles, reached here by a different route. A peer dependency
  fails loudly on a version conflict instead of silently installing the second copy, and npm installs it
  automatically when there is no conflict.
  
  Ranges follow the 0.x rule this project uses: `^0.2.1` and `^0.1.0` admit patch releases and stop at
  the next minor, which is where breaking changes land while below 1.0.
- ff50625: The server element behaves like an element.
  
  `toggleAttribute`, `append`, `replaceChildren`, `attributes`, `getAttributeNames`, `dataset` and
  `style` were all absent, so ordinary component code — `this.toggleAttribute('open')`,
  `this.dataset.userId = id`, `this.style.color = c`, `this.append(node)` — either threw or silently
  did nothing. `dataset` and `style` are views over an attribute, so an assignment that does not reach
  the markup is one the server loses; both write through.
  
  `tests/ssr-dom-surface.test.mjs` pins the whole surface as a matrix — 50 members, each asserted to
  work rather than merely exist — so the next gap fails there instead of being found by probing.
  `insertBefore` and `cloneNode` stay absent on purpose: they need a real tree, and faking them would
  misplace content silently.
- 69e1637: `.value`, `.checked` and `.selected` mirror to attributes only on form elements.
  
  That mirroring exists so hydration can read form state back out of the markup, which only means
  anything on a form control. Applied to every element, `.value` on a `<b>` wrote `value="…"`
  server-side where the client sets a plain JS property and no attribute at all — a difference in the
  rendered DOM for no benefit. Anywhere but `input`, `textarea`, `select` and `option`, a `.prop` is
  client state, which is what it already was everywhere else.
  
  Applies to `@verajs/renderer/spread` on the same terms.
- 4a8be15: A component's own light DOM reaches the markup, and the registry refuses a redefinition.
  
  **Light-DOM content was discarded for every shadow component.** It is what a `<slot>` projects, so a
  component that put content there itself had it on the page in the browser and missing from the
  server's markup — the slot rendering nothing. It now follows the shadow template, where the DOM puts
  it.
  
  **`children` arrive before `connectedCallback`**, which is where a client finds them: the parser has
  already built them when the element upgrades. A component can now read or slot what it was passed,
  and one that overwrites its own light DOM wins — the same order, the same result.
  
  **`customElements.define` refuses a second definition**, as the platform does. Overwriting silently
  meant a module defining a tag twice rendered fine on the server and threw `NotSupportedError` in the
  browser. A server being lenient about an error is a server hiding it.
- 5e6e42d: A synchronous `renderToString` fired during an asynchronous one no longer destroys it.
  
  The turn queue was introduced holding only the asynchronous renders, on the stated reasoning that
  `renderToString` "is unaffected and still runs whenever it likes". That holds for two synchronous
  renders against each other — they are synchronous end to end, so neither can interleave. It does not
  hold for a synchronous render fired **inside an asynchronous one's suspension window**: it runs to
  completion on this package's module-level bookkeeping, and the async render resumes into the
  wreckage.
  
  Measured, the async component came back as `<slow-a><template shadowrootmode="open"></template>
  </slow-a>` — empty — while core reported `render() did nothing, no component is being set up`,
  because the setup it was closing had been replaced.
  
  A server that renders some routes synchronously and others asynchronously is the ordinary case, so
  "do not mix them" was never a restriction anyone could keep, and the failure is silent: the markup is
  individually plausible and only wrong relative to what that request asked for.
  
  Both entry points now take a turn from the same queue. `renderModule` is `async` and every caller
  already awaits, so this is invisible to them; with nothing in flight it costs one microtask, which is
  unmeasurable against a ~30 µs render.
- 7b8b9e2: Retain child nodes, so a mutation after `appendChild` reaches the markup
  
  `appendChild` serialised the child into the parent's `innerHTML` **string** and dropped the node, so
  children were markup rather than nodes. Serialisation now happens when the markup is *read*, and the
  node is kept:
  
  | | before | now |
  | --- | --- | --- |
  | `host.appendChild(kid); kid.textContent = 'x'` | `<b></b>` — content silently lost | `<b>x</b>` |
  | `kid.remove()` after append | silent no-op, still rendered | removed |
  | `host.removeChild(kid)` | `TypeError` — the method did not exist | removes, and `NotFoundError` for a non-child |
  | appending to a second parent | left it in both | moves it |
  | `kid.parentNode` | `null` | the parent |
  
  `children`, `childNodes`, `firstChild`/`lastChild`, `firstElementChild`/`lastElementChild`,
  `childElementCount` and `hasChildNodes` now answer from the retained children instead of being
  hardcoded empty. Appending a node into its own descendant throws `HierarchyRequestError`, as every
  engine does — reachable only now that nodes are kept.
  
  **Rendered output is byte-identical.** This changes *when* serialisation happens, not what it
  produces; both committed fixtures match unchanged and the hydration suites are green. SSR throughput
  is unchanged too — measured across three runs, within the harness's own spread.
  
  **Markup assigned as a string is still not parsed**, so a container filled by `innerHTML` or by the
  `children:` option has no node view. Asking for one now warns once instead of answering emptily in
  silence. Parsing it is a later step.
  
  The framework's own render path never calls `appendChild` — templates go through the serializer — so
  this affects imperative DOM written in a component's `connectedCallback`.
- d44b444: Markup assigned as a string gets a node view, so queries answer
  
  `querySelector`, `querySelectorAll`, `getElementById`, `matches` and `closest` returned nothing
  whatever they were asked. A component branching on `this.matches('[data-open]')` took the wrong path
  on the server with no diagnostic, and `children` was empty on an element whose children were plainly
  in the output.
  
  Markup is now parsed into nodes on first access, and the queries answer from it.
  
  **It never changes what the page renders.** Each parsed element keeps the exact source text of its
  own tags, so re-serialising reproduces the input byte for byte — quoting style, entity spelling,
  attribute order and interior whitespace included. Only an element you *mutate* falls back to
  canonical output. The result is verified at runtime: if a parse does not reproduce its input exactly
  it is discarded and the markup stays a string, so the worst case is the previous behaviour.
  
  **It declines rather than guesses.** Anything needing the HTML spec's error recovery — misnested
  formatting, an unclosed non-optional element, foreign content, a stray end tag, an implied `<tbody>`
  — returns no tree, and asking for one warns once. `tests/ssr-parse-differential.test.mjs` runs a
  corpus through both this parser and parse5 and fails on any input where the two produce **different**
  trees; declining is allowed, disagreeing is not. parse5 is the test oracle and stays a
  devDependency — nothing ships it.
  
  **A selector it cannot answer honestly throws.** The matcher covers type, `*`, class, id, every
  attribute operator, `:not()`, and the four combinators. A pseudo-class needs user state, layout or a
  document that a server does not have, so `:hover` raises rather than quietly reporting no match —
  the same rule the rest of this package follows.
- 3d009e3: A non-template return from `render()` flattens the way the client flattens it.
  
  A string was written straight into `innerHTML`, so a component returning `'<b>raw</b>'` produced real
  elements on the server and the escaped text `&lt;b&gt;raw…` in the browser. Different content on the
  two paths — and an injection the client does not have, the moment any of that string comes from data.
  A number returned nothing at all here and `42` there.
  
  Everything that is not a template now goes through the same flattening a slot's value does, which is
  where all the escaping already lived.
- 43d9dd2: A routed component can be server-rendered.
  
  `initRouter` threw `window is not defined`, so the app shell of every routed app — the exact thing
  server rendering exists for — could not be rendered at all. The shim now provides enough `window`,
  `location` and `history` for the router to initialise; listeners are accepted and never fire, because
  nothing navigates on a server.
  
  The shadow-root shim gained the surface that exposed: `querySelectorAll`, `addEventListener`,
  `dispatchEvent` and `host`. It had been built to "the smallest surface the renderer touches", which
  is the same wrong bar that left the element shim without `dispatchEvent` and `classList`.
  
  The shell renders — nav, outlet, everything the component draws. A route's own content does not,
  because the server holds markup as a string rather than a tree and the router finds its outlet by
  query. Render the route yourself and pass it as `children` if it must be in the first response.
- 08de01c: The server environment stops taking globals its host still needs
  
  `installShims()` writes ~35 globals, which is free on a server — Node defines none of them, so it
  is filling an empty room. Three of those writes were not free anywhere else, and each failed in a
  different way:
  
  - **`globalThis.self = globalThis` threw**, because `self` is a getter-only property of a
    `WorkerGlobalScope`, and the shim never finished installing. It is `??=` now, which loses nothing:
    where `self` already exists it already *is* the global, which is all the line ever wanted.
  - **`globalThis.postMessage = () => {}` severed the host's only channel back**, silently — the
    render completed and every reply vanished, which is indistinguishable from a crash. It is `??=`
    now. **`close` deliberately stays unconditional**: the same reasoning reaches the opposite answer,
    since a `close()` that is not inert would let a component end the render.
  - **`location` could not be given a per-render URL.** `renderToString`'s `location` option mutates
    the object in place, and `??=` short-circuited wherever the environment already provided an
    immutable one, so the option threw rather than routing. The shim now installs its own writable
    object as an own property, seeded from whatever URL the environment describes.
  
  Alongside them, `node:crypto` — the package's only Node import — becomes the `crypto.randomUUID()`
  that both platforms have had for years. Same function, same entropy, one import fewer.
  
  Nothing here changes what a server renders: every fix is shaped as *do not replace what the
  environment already provides* rather than as a branch on which environment this is, so on Node each
  one is inert by construction. The hydration and kitchen fixtures are byte-identical, which is the
  proof — they are real server output, regenerated and `--check`ed by the gate.
  
  `LOCATION_PARTS` now lives with the shim that installs `location`, rather than being duplicated by
  the render that walks it.
- b2fca7e: Shadow-root options reach the markup, because the client cannot put them back.
  
  Only `mode` was serialized. Declarative shadow DOM also carries `shadowrootdelegatesfocus`,
  `shadowrootclonable` and `shadowrootserializable` — and `attachShadow` **reuses a declarative root
  while ignoring the options it is handed**, measured in Chromium. So a component asking for
  `delegatesFocus: true` over server-rendered markup that omitted it kept `delegatesFocus === false`
  for the life of the page, with no way to fix it client-side. Focus delegation is accessibility
  behaviour: it does not break loudly, it just works worse.
  
  `slotAssignment` has no declarative form at all, so a component that needs it cannot be faithfully
  server-rendered. The README says so rather than pretending otherwise.
- 2cefc25: `renderToString(url, { static: true })` — about 3x, for a page that will not be interactive
  
  A server render is one shot: the subscriptions built while it runs are never fired afterwards, so
  tracking every property read to create them is pure cost. Measured on a component rendering twenty
  rows, the proxy behind `createStore` is the **entire** reactivity overhead of a server render — about
  40 µs against a 15 µs baseline — while effects and the scheduler cost nothing detectable. With
  `static` on, `createStore` hands back the object it was given and reads are ordinary property access.
  
  **The markup is identical**, and that is the whole safety of it. It is not asserted on an example:
  `tests/ssr-static-mode.test.mjs` renders *every* fixture in the suite both ways and compares markup,
  styles and title. A mode that cannot drift is why this is a flag rather than a second renderer.
  
  **A store written to during a static render throws**, naming the option, rather than rendering markup
  that reflects none of the writes. That guard is deliberately **not** development-only, unlike most of
  this framework's diagnostics: a server runs the production build, so folding it away would remove it
  from the only place it matters. It is free — the proxy has no `get` trap, which is where the cost of
  a reactive store actually is.
  
  `@verajs/core` gains `setStaticStores`, which is what `@verajs/ssr` calls. It is server-side only:
  leaving it on in a browser gives you a framework that does not update.
  
  **Size:** an app that uses `createStore` grows **47 gzipped bytes** (6 026 → 6 073 B), which moves it
  from 5th to 6th in the comparative table — 42 B behind Preact, where it was 5 B ahead. An app that
  does not use `createStore` is **unchanged at 5 005 B**, because the branch tree-shakes away with the
  store it belongs to.
- 1d42d77: A stylesheet keeps the characters CSS needs.
  
  `@verajs/styles` sets a `<style>` element's `textContent` to the stylesheet, and the shim's setter
  escaped it like any other text — so `>` became `&#62;` and `"` became `&#34;`. A browser does not
  decode character references inside `<style>`, so a component with a string `static styles` shipped a
  stylesheet with every child selector, attribute selector and `content: "…"` broken. The client never
  had it: there, `textContent` sets real text and a raw-text element serializes it verbatim.
  
  What a stylesheet does need — `</style` neutralised — is a different escape and was already applied.
- 9e16b35: Server and client agree about every value kind at a child position.
  
  `@verajs/ssr` returned `''` for any object that was not template-shaped, and the client has never
  agreed: a `Date` rendered its full date string there and nothing here, an object with a `toString`
  rendered its text, a `Set` or `Map` rendered its entries, a `Promise` rendered `[object Promise]`.
  Whether any of those is a sensible thing to interpolate is beside the point — the two sides
  disagreeing is a silent hydration mismatch. Iterables now render their entries and everything else
  falls through to `String(value)`, which is what the client does.
  
  `@verajs/renderer/hydrate` adopts them. A non-iterable object at a child position was a deliberate
  mismatch, because the server emitted nothing for it and the two could not be reconciled; once the
  server matched, that mismatch was the only thing left disagreeing.
  
  **A colon is legal in an attribute name.** `xml:lang=${…}` produced `<b xml: lang="en">` — the name
  pattern stopped at the colon, so the prefix was left as text and the tag came out malformed.
  `xml:`, `xlink:` and friends parse now, in templates and when attributes are read back out of
  emitted markup.
- 5201e74: Two failures that only appear when a real app's wiring meets the server.
  
  **A displaced server renderer is reported instead of rendering everything empty.** A DOM renderer
  registers on `'render'` at priority 50, and registering at a taken priority replaces — so an app
  entry doing the ordinary thing, `wire([renderer])`, displaced the server renderer the moment that
  module was imported server-side. Every component then rendered as
  `<my-el><template shadowrootmode="open"></template></my-el>`: empty, with no error and nothing in the
  output to suggest why. `renderToString` now checks its renderer is still in the chain and says what
  happened.
  
  **`autoloader` is importable in Node again.** It built its `MutationObserver` in the constructor,
  so an app entry that wires the autoloader threw `MutationObserver is not defined` under SSR and could
  not be imported server-side at all. The observer is created on first use, which is how
  `@verajs/router` has always handled its window listeners.
- c248b36: Escape `</style>` in CSS text before it reaches a `<style>` element. **Security fix.**
  
  `css` is a plain concatenation and escapes nothing, deliberately — the constructed-stylesheet path
  must receive exactly the CSS the author wrote. `@verajs/ssr` then wrapped that text in
  `<style>…</style>`, and `<style>` is a raw-text element: the HTML tokenizer scans it for one thing,
  its end tag. A value interpolated into `css` and carrying `</style>` closed the element, and
  everything after it parsed as markup. Verified against a real parser: it built an `<img>` with a
  live `onerror`. Reachable wherever an application themes from a value it does not fully control.
  
  The client was never directly exploitable — fragment parsing into a `<style>` creates no nodes,
  confirmed in Chromium, Firefox and WebKit — but it produced a DOM whose *serialization* was
  poisoned, which is one round trip away from the same result.
  
  Fixed at the sinks rather than in `css`: `@verajs/ssr` when it writes a `<style>` and when it hands
  back hoisted light-DOM styles for the caller to place, and `@verajs/styles` before assigning to a
  `<style>` element, which now uses `textContent` rather than `innerHTML` since the content is text
  and nothing there should ever be parsed. Escaping in `css` itself would corrupt the constructed
  stylesheet, which is exactly the double-escaping principle #8 warns against, and could not see a
  sequence assembled across several interpolations.
  
  `escapeHtml` is the wrong tool here and would break every stylesheet, because `>` is a child
  combinator. Only the end-tag sequence is rewritten, to `<\/style` — valid CSS that renders
  identically, asserted against `getComputedStyle` in all three engines. Selectors, media queries,
  `url()` and ordinary declarations are untouched.
  
  Costs `@verajs/styles` 29 B gzipped.
- 6d269e3: Text and comments are nodes
  
  `createTextNode` returned an object literal carrying an `innerHTML` string. It had no identity, no
  parent and no `nodeType`, and appending one inlined its markup and lost the node — so `childNodes`
  reported `1` for `text <b>bold</b> tail` where every browser says `3`, and there was no way to read
  a text node back at all. `createComment` was the same.
  
  Both are real nodes now, with `data`, `nodeValue`, `length`, `parentNode`, siblings, `cloneNode`,
  `splitText` and `appendData`. `childNodes` counts them, `children` does not, and a comment
  contributes nothing to `textContent` — each verified against jsdom performing the same operation in
  `tests/ssr-text-nodes.test.mjs`.
  
  `textContent` walks the tree instead of stripping tags out of the serialised markup with a regular
  expression. That expression only undid this package's own numeric escapes, so an element holding the
  text `a & b` answered `a &amp; b` — the entity spellings it does not itself emit came back raw.
  
  Like an element, a parsed text or comment node keeps the exact bytes it came from, so re-serialising
  still reproduces the input: `&amp;` stays `&amp;` rather than becoming `&#38;`.
- a5c7d8f: Correct the unparsed-markup warning, which described the DOM as it was before it had a parser.
  
  It said "markup assigned as a string is not parsed on the server". Measured against the parser that
  exists, that is false for nine of ten shapes — nested elements, attributes, void elements, comments,
  an unclosed tag, a table fragment and raw text all parse. What actually reaches the warning is the
  narrow case the parser *declined*: markup it cannot re-serialise byte-identically, kept as a string
  rather than turned into a tree the browser would not build.
  
  The distinction changes the advice. "Not parsed" sends the reader to rewrite working code with
  `createElement`; the message now says the markup was refused and that making it well-formed is
  usually the fix, with `createElement`/`appendChild` as the fallback it always was.
- 13addfb: The tree-dependent members answer from the tree
  
  `nextSibling`, `previousSibling`, `nextElementSibling`, `previousElementSibling`, `contains` and
  `getRootNode` all returned a hardcoded `null`/`false`/self. That was truthful while a child was
  flattened into its parent's markup — there was no sibling to find and no chain to walk — and became
  wrong the moment child nodes were retained. `element.nextSibling` reported nothing for the middle of
  three children, and `host.contains(child)` read as "this is not mine" for a child the host plainly
  held.
  
  Each answers from the real tree now.
- 38163ec: `insertBefore`, `replaceChild`, `moveBefore`, `cloneNode` and `compareDocumentPosition`
  
  All five were out of scope for one reason — *"needs a tree"* — which stopped being true when child
  nodes started being retained. Each is now implemented and compared against jsdom performing the same
  operation, error cases included, in `tests/ssr-tree-operations.test.mjs`.
  
  `cloneNode` produces a copy that shares nothing with the original — the aliasing risk that kept it
  out of scope — and carries the source text along, so a cloned subtree still reproduces the markup it
  was parsed from. It lives on the element: the platform refuses to clone a shadow root.
  
  `moveBefore` has no jsdom to compare against, so its rule was measured on Chromium and Firefox, which
  agree on all of it (WebKit does not implement it yet). A node with **no parent** is a
  `HierarchyRequestError`, while a *parented* node with a reference that is not a child here is a
  `NotFoundError` — different errors from the same call depending on which argument is wrong.
- 0df630d: A void element is serialised without an end tag
  
  `appendChild(document.createElement('br'))` served `<br></br>`. A parser reads `</br>` as *another*
  `<br>`, so the server rendered two line breaks where the client has one — and the same content
  assigned as a markup string was already correct, so the two paths disagreed with each other as well
  as with the browser. The same applied to `<img>`, `<input>`, `<hr>` and the rest.
  
  `outerHTML` and `insertAdjacentElement` inlined the same expression and had the same bug; all three
  now share one definition.
- 0e29dc3: Tree walkers, the attribute map's methods, and `:scope`
  
  - **`createTreeWalker` and `createNodeIterator` walk the tree.** Both existed and answered `null` to
    everything whatever the tree held — a stub reporting "no more nodes" from its first call, so a
    component walking its own subtree found it empty and did nothing, on the server only. `whatToShow`,
    filter functions, `acceptNode` objects and the stepping methods all work.
  - **`attributes` answers `getNamedItem`, `item`, `setNamedItem` and `removeNamedItem`.** The list is
    a plain array rather than a live `NamedNodeMap`, which is a recorded difference, but its methods
    were simply missing — so `attributes.getNamedItem('x')`, which plenty of existing code uses, was a
    `TypeError` on the server and worked in a browser.
  - **`:scope` is supported.** It means the element a query started from, which *is* knowable on a
    server, unlike the pseudo-classes beside it — and it is what makes `querySelector(':scope > b')`
    mean "a direct child", the usual reason to want a pseudo-class in a server render at all. Every
    other pseudo-class still throws rather than reporting no match.
- 6a70508: Twenty-two more tags reflect their properties, including `<template>`'s declarative shadow DOM.
  
  Three findings in a row — `option.text`, `form.action` and `table.width` answering as plain JavaScript
  properties rather than reflections — each traced to the same root: not a member somebody skipped, but
  a **tag nobody measured**. `table`, `tr`, `tbody`, `div`, `p`, `ul`, `template` and sixteen more were
  absent from the list `scripts/measure-element-reflections.mjs` walks.
  
  **51 properties added**, every one measured on Chromium, Firefox and WebKit and recorded only where
  all three agree. Mostly the legacy presentational attributes — `align`, `bgColor`, `cellPadding`,
  `vAlign`, `compact` — which are deprecated, still reflected by every engine, and therefore still reach
  markup the moment a component assigns one.
  
  `template.shadowRootMode` is the one that matters most here: this package **emits** that attribute for
  declarative shadow DOM, so a component reading it back was asking about markup this renderer wrote and
  getting `undefined`.
  
  The tag list in the measurement script is updated too, so a regeneration keeps them.
- Updated dependencies [57ab91d]
- Updated dependencies [e6d06e4]
- Updated dependencies [1e89906]
- Updated dependencies [b67cd36]
- Updated dependencies [0db2f4e]
- Updated dependencies [4ad3d73]
- Updated dependencies [2f20123]
- Updated dependencies [54412a4]
- Updated dependencies [0bbabfc]
- Updated dependencies [a5453bd]
- Updated dependencies [053fd5d]
- Updated dependencies [dd76fb8]
- Updated dependencies [afd78b6]
- Updated dependencies [391a20d]
- Updated dependencies [507fdd6]
- Updated dependencies [c926257]
- Updated dependencies [8a792b4]
- Updated dependencies [a7336b5]
- Updated dependencies [c796080]
- Updated dependencies [e7e56f5]
- Updated dependencies [7392f46]
- Updated dependencies [cc7a3f0]
- Updated dependencies [0af7dc4]
- Updated dependencies [c346153]
- Updated dependencies [98d9ce5]
- Updated dependencies [60cc173]
- Updated dependencies [845d31f]
- Updated dependencies [2cefc25]
- Updated dependencies [eb4e8e2]
- Updated dependencies [c248b36]
- Updated dependencies [e3a0a4d]
- Updated dependencies [d73b937]
- Updated dependencies [eb4fa7a]
- Updated dependencies [fe2891b]
- Updated dependencies [b7adb81]
  - @verajs/core@0.3.0
  - @verajs/styles@0.1.1

## 0.1.4

### Patch Changes

- fbfc58f: Support `<div ${spread(props)}>` — bindings whose names are not known when the template is parsed.
  
  New package `@verajs/spread`. Template renderers bake attribute names in at parse time, which is
  what makes them small and fast and why neither this renderer nor lit-html has had spread; lit's PR
  has been an open draft since 2021.
  
  `@verajs/renderer` gains a protocol rather than a feature: a value at element position carrying
  `_$apply$` applies itself, in 16 B, confined to the element position so nothing lands in the text,
  attribute or property commits the benchmarks measure. An in-renderer implementation measured 176 B.
  
  `@verajs/jsx` now compiles `{...props}` on an element to `${spread(props)}` and injects the import,
  where it used to be a compile error. `@verajs/ssr` serializes a spread: attributes, truthy booleans
  and the form properties reach markup; events and other properties are client state. The escaping
  stays entirely in `@verajs/ssr`, so a new binding source cannot introduce a second escape boundary.
  
  Removing a key restores what the element held before the binding existed, rather than guessing at a
  value that means absent — for a property there is none. On a hydrated page that means the server's
  markup; bind `null` to remove instead.
  
  Runtime is at parity with writing the bindings out.

## 0.1.3

### Patch Changes

- a6a6509: **Breaking:** `static styles` adoption has moved out of core into the new `@verajs/styles` package,
  and `adoptStyles` is no longer exported from `@verajs/core`. Wire it once at your app entry:
  
  ```js
  import { insert } from '@verajs/core';
  import { adoptStyles } from '@verajs/styles';
  insert('init', adoptStyles, 50);
  ```
  
  A component declaring `static styles` with nothing adopting them now warns once in development,
  naming the three lines to add. Production is unaffected — the warning is behind `__DEV__`.
  
  Core drops from 3 101 B to 2 801 B gzipped, and a working app (core + renderer) from 6 091 B to
  5 759 B — below Lit and Preact + signals again. Apps that use `static styles` add `@verajs/styles`
  (520 B) back; apps that do not simply stop paying for it.
  
  `@verajs/inserts` gains a fifth extension point, `'init'`, which core dispatches once per element
  after its shadow root exists and before its first render. That is the seam the extraction needed,
  and it is available to any module that wants to see every component as it comes to life.

## 0.1.2

### Patch Changes

- Fix a renderer crash, and ship the license text.
  
  **Renderer.** `ChildPart._clear()` could walk off the end of the child list and throw
  `Cannot read properties of null (reading 'nextSibling')`, aborting the render pass and leaving a
  half-updated DOM. `TextPart` upgrades to a `ChildPart` on its first non-primitive value, and it
  borrowed `this._text.nextSibling` as its exclusive end — a node owned by the *next* part, which
  that part removes when it upgrades and clears its own text. The upgrade now inserts its own end
  marker, so a part owns both anchors and `_end === null` means only "root part", which makes the
  `textContent = ''` fast path sound. The removal loop also stops at the end of the child list
  rather than throwing, so a broken invariant degrades into a missed removal.
  
  Triggered by several sibling child-expressions in one parent each toggling between a template and
  `''` — a shape any conditional-heavy template can reach. Costs 19 bytes gzipped and nothing
  measurable in the DOM benchmarks. Covered by `tests/renderer-sibling-parts.test.mjs`.
  
  **Licensing.** Every package now ships the MIT `LICENSE` text rather than only declaring `"MIT"`
  in its manifest, and `author` names a person.

## 0.1.1

### Patch Changes

- 5228f8d: Pin the canonical `git+https://` form of `repository.url`.
  
  npm normalizes this field on publish, and the registry compares the normalized
  value against the provenance statement's source repository — a mismatch is
  rejected with a 422. Carrying the normalized form in the manifest removes the
  dependency on auto-correction.
  
  This is also the first release published from GitHub Actions via npm Trusted
  Publishing, so these are the first `@verajs` tarballs to carry a provenance
  attestation.
