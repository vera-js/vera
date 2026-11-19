# @verajs/static

VeraJS's static tier: `define` and the `html`, `svg` and `mathml` tags, rendering a component ONCE into markup. No
reactivity, nothing to wire, and no value ever becomes code.

| Package | gzipped | A render | For |
| --- | ---: | --- | --- |
| `@verajs/static` | <!--size:static.gzip-->1.50 KB<!--/size:static.gzip--> | once, at the first connect | static sites, markup enhanced by `@verajs/directives` |
| `@verajs/lite` | <!--size:lite.gzip-->4.10 KB<!--/size:lite.gzip--> | patches the values that changed, in place | small dynamic sites |

<!-- recipe -->
```js
import { define, html } from '@verajs/static';

define({ tag: 'team-card', props: { name: 'Ada', skills: ['math', 'engines'] }, attributes: ['data-role'] }, (host) => () =>
  html`<h3 title=${host.name}>${host.name}</h3>
    <p class="role">${host.dataRole ?? 'member'}</p>
    <ul>${host.skills.map((skill) => html`<li>${skill}</li>`)}</ul>`);

const card = document.createElement('team-card');
card.setAttribute('data-role', 'lead');
document.body.append(card);
```

<!-- recipe -->
```js
import { define, html, svg } from '@verajs/static';

const dot = (x, color) => svg`<circle cx=${x} cy="5" r="4" fill=${color}/>`;

define({ tag: 'dot-row', props: { colors: ['tomato', 'teal', 'gold'] } }, (host) => () =>
  html`<svg viewBox="0 0 30 10" width="90">${host.colors.map((color, i) => dot(5 + i * 10, color))}</svg>`);

document.body.append(document.createElement('dot-row'));
```

**It renders once.** At its first connect a component reads its props (each default copied per element; a value set
before the tag was defined is kept) and its observed attributes (once, as camel-cased props), runs its setup, and writes
the result. A later write changes nothing, and a component moved after it rendered keeps its markup. `methods` go on the
prototype, and `shadow: 'open'` renders into a shadow root — the one a server's declarative shadow root attached, when
there is one. The setup returns a render function or the template itself. The call shape is `@verajs/core`'s and
`@verajs/lite`'s, so the same component source runs on either (change the import) when it needs to update.

**No value ever becomes code.** Every value is written as inert text, the HTML parser reads the result once, and where
each value landed is judged from what the parser built — never guessed from the markup:

- In text and attribute values a value is text. A list in an attribute value is joined, and an object is its text, as
  `@verajs/core` writes them.
- A `javascript:` URL in a URL-bearing attribute (`href`, `src`, `action`, `formaction`, `xlink:href`, `data`, and an
  animation's `to`, `from`, `by`, `values`) is removed. **Every one of them is checked item by item** — as
  `@verajs/core` checks an animation's `values` — so `href="a;javascript:…"` is removed here where core keeps it.
- In a `<style>` or a JSON data block (`<script type="application/json">`, any type ending in `json`) a value is TEXT,
  written so that it can never end the element, even if the page's markup is later saved and parsed again.
- An event-handler attribute (`onclick="…"`) or `srcdoc` holding a value is not written, as `@verajs/core` leaves it
  out, and development says so in core's words (`handler-attribute`, `srcdoc-attribute`).
- **Refused**, coded `static-hole`, in every build: a value in a tag or attribute NAME, or inside any other `<script>` (an
  SVG one too), `<iframe>`, `<noscript>`, `<template>` or the obsolete raw-text elements. Data shaped like a template
  (JSON) is text, never markup.

**Behavior comes from `@verajs/directives`** (or from moving the component to `@verajs/lite` or `@verajs/core`, which
bind events and properties). A static page with the directives engine (`@verajs/directives/standalone`, for a page
running no other vera) is enhanced as it renders: the engine watches the document, so it sees markup a static
component writes after load. A component's SHADOW root is not the engine's until the page activates it
(`activate(element.shadowRoot)`). A function value renders nothing; development names what it needs
(`static-needs-renderer`).

**HTML documents only:** in an XHTML (XML) document a static component's render is refused (it throws, and writes
nothing). **Server rendering** (`@verajs/ssr`) renders static components; on the client a component renders again at its first
connect. **SVG and MathML:** markup inside an `<svg>` or `<math>` element is SVG or MathML already; a fragment rendered
into one from its own template is tagged `svg` or `mathml`. A component whose WHOLE render is an `svg` fragment is
parsed as HTML (it has no `<svg>` around it): put the `<svg>` in the template.
