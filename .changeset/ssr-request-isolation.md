---
'@verajs/ssr': minor
---

Four defects that only appear on a server — a thing that handles more than one request.

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
