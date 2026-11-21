/**
 * **What the small tiers skip of core's suites, each row with its reason** (2026-11-19; run by `scripts/tier-suites.mjs`).
 * Generated from the tier runs once, then kept by hand: a row on this list that no longer exists fails the run (an
 * allowance that outlived its row is not one), and a row that fails and is NOT on it fails the run (a finding). A suite
 * marked `allRefused` ran no row the tier passes: it is listed so its rows are skipped by name and counted, not
 * silently left out.
 */
export const TIERS = {
  "lite": {
    "suites": {
      "attribute-driven": {
        "skip": {
          "an attribute in the markup reaches the first render": "built with core's `init`/`createStore`",
          "and changing it afterwards re-renders": "built with core's `init`/`createStore`"
        }
      },
      "attribute-name-holes": {
        "skip": {
          "the client and the server refuse exactly the same templates": "[development] core's wording and core's development-only check; lite refuses every name hole, in every build, as `tier-hole-position`",
          "a refused template is refused on its second render too — nothing half-built is cached": "[development] refused by lite's documented rule (`tier-hole-position`)",
          "hydration refuses it cleanly: the error escapes, and no bounds are left in the container": "[development] refused by lite's documented rule (`tier-hole-position`)",
          "production renders every row without throwing — the check is development-only": "[production] refused by lite's documented rule (`tier-hole-position`)"
        }
      },
      "attribute-value-sinks": {
        "skip": {
          "the three attribute sinks agree, shape for shape": "compares against `spread` (core's)",
          "a symbol is refused by every sink — the drift that started this": "compares against `spread` (core's)"
        }
      },
      "core-define": {
        "skip": {
          "define(tag, setup) renders, and the class it returns is the registered one": "core-only: core",
          "removed then re-added: setup EXACTLY twice, teardown EXACTLY once per removal (the wrapper is the one teardown)": "core-only: core",
          "a one-operation move keeps it: setup once, no teardown, still live": "core-only: core",
          "options reach core (shadow) and every init insert — as init receives them, without the tag or the setup; the string form passes none, the object form at least {}": "core-only: core",
          "the shared options copy is frozen in development: a module writing to it throws": "[development] core-only: core",
          "two cores on one page: a define tag from each, each set up once and torn down EXACTLY once (both wrappers chained)": "core-only: core",
          "methods: callable on the element, `this` is the element, one function shared by every instance, never in the options": "core-only: core",
          "methods cannot replace the generated connectedCallback or the constructor — in EITHER build; constructor non-enumerable, the generated connectedCallback enumerable (decided)": "core-only: core",
          "the same behavior in both builds, the words in development: a getter, a platform name, adoptedCallback, an unobserved attributeChangedCallback": "core-only: core",
          "props: a plain-JS write AFTER connect repaints (an undeclared prop does not), and a default applies when nothing is bound": "core-only: core",
          "props: an effect follows a prop that arrives late": "core-only: core",
          "props: a value set BEFORE the tag was defined wins over the default (handed over through the setter, then reactive)": "core-only: core",
          "props: array and plain-object defaults are per element; a prop named like an Object.prototype member keeps its default (hasOwn, not in)": "core-only: core",
          "props: a parent binding a declared prop is NOT re-rendered by the child reading it, and binding the default's value renders the child once": "core-only: core",
          "props: development says a method-name collision, a platform name and a shared object default — installed the same in both builds": "core-only: core",
          "props: a parent binding `!name` compares against the RAW record — the child writing it never re-renders the parent": "core-only: core",
          "attributes: each arrives as a string|null prop under its camel name — set, changed, removed (null, not the default) — and repaints": "core-only: core",
          "attributes: present before upgrade arrive before the setup; a PROPERTY set before upgrade beats the attribute; no reflection back": "core-only: core",
          "attributes: one that SHARES a declared prop keeps its default until the attribute appears; removal writes null": "core-only: core",
          "attributes: development says a type flip, a reflected platform name and an ignored method; refuses a non-array — the same installs in both builds": "core-only: core",
          "release at removal: a define component removed then re-added keeps its prop values and stays reactive": "core-only: core",
          "release at removal: a component MIXING declared and adopted props — both reactive after a remove and re-add": "core-only: core",
          "release at removal: a CLASS component with adopted props, removed then re-added, still hears its parent": "core-only: core",
          "release at removal: after a re-add, a parent’s live `!name` compare reads the NEW record (a captured old store would read a stale copy)": "core-only: core",
          "release at removal: a MIXED component (an adopted key arrives FIRST) has its declared defaults before and after a remove/re-add": "core-only: core",
          "register: false builds the class and registers nothing; the caller registers it under its own tag, and it works": "core-only: define's register and formAssociated options; lite and static do not take them yet",
          "formAssociated: true sets the static on that class only, and stays out of the init options": "core-only: define's register and formAssociated options; lite and static do not take them yet"
        }
      },
      "core-define-proto": {
        "skip": {
          "an own `__proto__` in props and in methods is skipped; the other keys work; development says it once each": "core-only: core"
        },
        "allRefused": true
      },
      "core-scheduler": {
        "skip": {
          "the flushSync recipe in llms.txt renders synchronously": "core-only: core",
          "and leaves the previous scheduler in place afterwards": "core-only: core",
          "the exported microtask scheduler renders": "core-only: core",
          "the effects contract survives the microtask scheduler": "core-only: core",
          "a scheduler that throws does not freeze the component permanently": "core-only: core",
          "a scheduler that keeps throwing is reported on every write": "core-only: core",
          "a scheduler that silently drops the pass does not freeze the component once it is replaced": "core-only: core",
          "re-queueing does not fire twice while one scheduler stays installed": "core's scheduler API",
          "an element in a window without requestAnimationFrame still re-runs on a write — after a microtask, as every window": "core-only: core"
        }
      },
      "core-signal": {
        "skip": {
          "a signal is shallow: replacing .value notifies, mutating inside it does not": "observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs",
          "{ deep: true } tracks the contents too — the same mutation notifies": "observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs",
          "`in`, keys and for-in on a signal subscribe to nothing (no traps): only reading `.value` does": "observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs",
          "a write notifies when the new value is not Object.is the held one: -0 over 0 is a change, NaN over NaN is not": "observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs",
          "what a signal holds comes back as written, and mutating inside it notifies nothing": "observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs",
          "a signal written into a store comes back as itself, and a read through the store still subscribes": "core-only: core",
          "a non-boolean deep is the DEFAULT in both builds; development names it once per call": "[development] observes through core's hook primitive (`inserts.$s`); lite's signal: tests/lite-semantics.test.mjs"
        }
      },
      "event-binding-fuzz": {},
      "event-name-typo": {
        "skip": {
          "@clik and @keydwon are named, with the event meant": "[development] core's wording (`renderer:`); lite says event-name-typo as `lite:` (tests/tier-parity-fixes.test.mjs)"
        }
      },
      "lifecycle-balance-fuzz": {
        "skip": {
          "every effect run is balanced by exactly one cleanup, through any lifecycle sequence": "drives core's store and effects"
        },
        "allRefused": true
      },
      "lit-parity": {},
      "render-differential-fuzz": {},
      "render-exotic-values-parity": {},
      "render-parity": {},
      "render-poisoned-values-fuzz": {},
      "render-update-fuzz": {
        "skip": {
          "a sequence of updates ends where a fresh render of the last value starts": "a known difference (lite README, Brian 2026-11-19): a sole hole that went list → text → null holds no empty text node where a fresh render does (it holds only its position marker, a comment, where a fresh render holds an empty text node) — the same text"
        },
        "allRefused": true
      },
      "render-update-parity": {},
      "renderer": {
        "skip": {
          "binding inside a comment is ignored but keeps later values aligned": "refused by lite's documented rule (`tier-hole-position`)",
          "element-position: refs fire, junk is ignored, alignment holds": "refused by lite's documented rule (`tier-hole-position`)",
          "a ref runs once per distinct value, not once per render": "refused by lite's documented rule (`tier-hole-position`)",
          "one position can switch between a keyed and an unkeyed list, both ways, without a rebuild going wrong": "core-only: renderer/keyed",
          "a removed keyed row is gone from the list for good — re-adding its key renders it again": "core-only: renderer/keyed",
          "keyed swap moves nodes instead of rewriting them": "core-only: renderer/keyed",
          "keyed reverse preserves node identity": "core-only: renderer/keyed",
          "keyed remove from the middle": "core-only: renderer/keyed",
          "keyed insert into the middle": "core-only: renderer/keyed",
          "keyed update in place": "core-only: renderer/keyed",
          "keyed clear and refill": "core-only: renderer/keyed",
          "keyed arbitrary shuffle": "core-only: renderer/keyed",
          "list next to static siblings stays inside its range": "core-only: renderer/keyed",
          "list switching to a template and back": "core-only: renderer/keyed",
          "keyed item that changes template shape under the same key (element-mode demote)": "core-only: renderer/keyed",
          "multi-root keyed items reconcile and move correctly (markered path)": "core-only: renderer/keyed",
          "mixed single-root and multi-root keyed items": "core-only: renderer/keyed",
          "hold() preserves DOM and element state across a toggle": "core-only: renderer",
          "hold() parks and restores a MULTI-ROOT template — its own nodes come back": "core-only: renderer",
          "hold() updates values in place when the template does not change": "core-only: renderer",
          "hold() evicts nothing — fifty shapes through one call site all re-adopt their own nodes": "core-only: renderer",
          "markup in a keyed list item is text too": "core-only: renderer/keyed",
          "clearing a whole-parent list leaves the parent empty and reusable": "core-only: renderer/keyed",
          "clearing one part never destroys a sibling sharing the parent": "core-only: renderer/keyed",
          "a list with static siblings in the parent clears only itself": "core-only: renderer/keyed",
          "a DOM node renders as itself": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule",
          "a document fragment renders its children": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule",
          "one node replaces another": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule",
          "re-rendering the same node does not duplicate it": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule",
          "a node position moves to text and back": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule",
          "nodes render inside arrays and keyed lists": "refs, keyed and DOM-node values are core's; a hole in a comment is refused by lite's rule"
        }
      },
      "renderer-audit-regressions": {
        "skip": {
          "a string in tag position is refused, not silently mangled": "[development] refused by lite's documented rule (`tier-hole-position`)",
          "a tag in tag position still works, and updates in place": "core-only: renderer/tag",
          "the base renderer names the tag entry for an expression in tag position": "[development] refused by lite's documented rule (`tier-hole-position`)",
          "an applier that changes identity every render is named": "[development] core's applier/tag machinery, or core's wording for a refusal lite makes in its own (`tier-hole-position`)",
          "a hoisted applier keeps its previous return and stays quiet": "[development] core's applier/tag machinery, or core's wording for a refusal lite makes in its own (`tier-hole-position`)",
          "a function ref is called with null when its element is torn down": "core's applier/tag machinery, or core's wording for a refusal lite makes in its own (`tier-hole-position`)",
          "an object ref has its value cleared": "core's applier/tag machinery, or core's wording for a refusal lite makes in its own (`tier-hole-position`)",
          "a spread object is not released": "core-only: renderer/spread",
          "an expression in attribute-name position is refused in development, as the server refuses it": "[development] core's applier/tag machinery, or core's wording for a refusal lite makes in its own (`tier-hole-position`)",
          "development shows the spread that does what a name expression meant": "[development] refused by lite's documented rule (`tier-hole-position`)"
        }
      },
      "renderer-child-protocol": {
        "skip": {
          "a late commit runs as a render of its container — a <select> it renders shows its value": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "a directive renders, keeps its place across renders, and updates asynchronously": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "two directives at one part do not share state": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "a directive keeps its state across its own commits, and loses it when the part is cleared": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "ordinary child values are unaffected": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "an unchanged <select> value is not written again; replaced options still get it": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's",
          "a selection binding on a <select multiple> is named in development — template and spread": "[development] core-only: renderer/spread",
          "a select gets its selection whatever spells it and wherever its options come from": "core-only: renderer/spread",
          "a select binding is re-asserted when its options move under it — every spelling": "core-only: renderer/spread",
          "a render nested inside a pass does not commit its caller's select early": "core's child protocol: directives and appliers (`_$child$`, `_$apply$`) are core's"
        }
      },
      "renderer-coded-warnings": {
        "skip": {
          "boolean-child: false renders as the word and is named; the same value again is quiet; a flip speaks again": "[development] core's wording (`renderer:`); lite says the same code as `lite:` (tests/tier-parity-fixes.test.mjs)",
          "spread-unsafe-name: a key that cannot be written into markup is skipped and named": "core-only: renderer/spread",
          "keyed-duplicate-key: once per (list, key) — the same duplicate again is quiet, a new one speaks": "core-only: renderer/keyed"
        }
      },
      "renderer-event-bindings": {
        "skip": {
          "renderer + hydration (adopted): an object with handleEvent listens, as it does on the platform": "hydration rows and `keyed` are core's",
          "renderer + hydration (adopted): swapping the handler leaves exactly one listener": "hydration rows and `keyed` are core's",
          "renderer + hydration (adopted): a handler removed and restored is not registered twice": "hydration rows and `keyed` are core's",
          "renderer + hydration (adopted): a nulled handler stops firing": "hydration rows and `keyed` are core's",
          "renderer + hydration (adopted): the handler receives the element as `this`": "hydration rows and `keyed` are core's",
          "renderer + hydration (adopted): a value that cannot listen is inert rather than throwing on every dispatch": "hydration rows and `keyed` are core's",
          "a handler survives a keyed move and fires once": "core-only: renderer/keyed"
        }
      },
      "renderer-foreign-nodes": {
        "skip": {
          "'drop' (the default): a shadow root empty at its first render carries no marker comments": "core-only: core",
          "'drop': the template's OWN nodes are never called foreign — a render-only template change says nothing": "core-only: core",
          "a re-added 'drop' component keeps what its RE-INIT put in the root (styles' fallback in a second window) — only the released content is cleared": "core-only: core",
          "'drop': a foreign node survives an ordinary re-render and goes on a template change — development says so once, production silently": "core-only: core",
          "'preserve' on the component: the markered root — a foreign node beside the template survives a template change, in place": "core-only: core",
          "renderer({ foreignNodes: 'preserve' }) is the app default, and a component's own 'drop' beats it": "core-only: renderer",
          "the app default is COMPONENT-scoped: a container handed to renderInto keeps its markers and its foreign nodes, whatever the default says": "core-only: renderer",
          "a shadow root NOT empty at its first render stays markered (a declarative root, a styles text fallback)": "core-only: core",
          "light component roots stay markered": "core-only: core",
          "a removed and re-added 'drop' component renders once, fresh, with no markers and no second copy": "core-only: core",
          "an invalid foreignNodes is named in development — own and default — and the template owns the root": "core-only: core"
        },
        "allRefused": true
      },
      "renderer-listener-churn": {
        "skip": {
          "a keyed list costs one listener per row, and a reverse costs none": "core-only: renderer/keyed",
          "dropping rows costs nothing, and re-adding costs one each": "core-only: renderer/keyed"
        }
      },
      "renderer-namespace-security": {
        "skip": {
          "CONTROL: an html template committed into <svg> is parsed as SVG": "core's namespaces module (an `html` template placed into <svg>); lite writes svg``/mathml``",
          "a bound javascript: href on an svg <a> is refused there": "core's namespaces module (an `html` template placed into <svg>); lite writes svg``/mathml``",
          "a bound inline handler is refused there": "core's namespaces module (an `html` template placed into <svg>); lite writes svg``/mathml``",
          "a <foreignObject> returns to HTML, and HTML's rules apply to its bindings": "core's namespaces module (an `html` template placed into <svg>); lite writes svg``/mathml``",
          "wiring a template module after the renderer built templates is named in development": "[development] core's namespaces module (an `html` template placed into <svg>); lite writes svg``/mathml``"
        },
        "allRefused": true
      },
      "renderer-namespaces-positions": {
        "skip": {
          "list items in <svg> are SVG — unkeyed and keyed": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``",
          "a position at a fragment-rooted template's top level resolves through the template being built": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``",
          "MathML too": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``",
          "a claim inside svg content is asked on the SVG variant, not the html original": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``",
          "the namespace probe runs once per kind of parent, not once per parent element": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``",
          "annotation-xml with an HTML encoding takes HTML children; without one, MathML": "core's namespaces module (an `html` template placed into <svg> re-derived as SVG); lite writes svg``/mathml``"
        },
        "allRefused": true
      },
      "renderer-props": {
        "skip": {
          "props() delivers non-string values as properties, intact and by identity": "core-only: renderer/spread",
          "the update path re-binds through one draw()": "core-only: renderer/spread",
          "spread() is idempotent on its own brand — the JSX compilation shape": "core-only: renderer/spread",
          "props() coexists with ordinary attributes and other bindings on the same element": "core-only: renderer/spread",
          "a null-prototype bag is a legal bag": "core-only: renderer/spread"
        },
        "allRefused": true
      },
      "renderer-raw-text-round-trip": {
        "skip": {
          "hydration ADOPTS a served style or JSON text equal to the client's (the same text node, nothing said), and rewrites one that differs": "hydration is core's; core's DEVELOPMENT refusal of `</style${x}` (lite renders it, documented); a template in <textarea>/<title> is lite's refusal (`template-in-text`)",
          "core's client, every placement of up to three holes inside a style closer, every spelling: whole live and after a round trip, its text exact": "[development] hydration is core's; core's DEVELOPMENT refusal of `</style${x}` (lite renders it, documented); a template in <textarea>/<title> is lite's refusal (`template-in-text`)",
          "a template in a <textarea> or <title> renders its elements, and development says so once (template-in-text); production says nothing": "refused by lite's documented rule (`template-in-text`)"
        }
      },
      "renderer-reconciliation": {},
      "renderer-release": {
        "skip": {
          "a re-added component renders exactly once — handlers work, writes repaint": "core-only: core",
          "a removed element keeps its DOM, and its handler no longer runs": "core-only: core",
          "an event on a released element is harmless — nothing throws, nothing reaches the error chain": "built with core's `createStore` and its error chain",
          "with hydration wired, a re-added component is rendered, never adopted as server markup": "core-only: core",
          "a keep-alive move is not a removal — nothing is released": "core-only: core"
        },
        "allRefused": true
      },
      "renderer-release-gc": {
        "skip": {
          "a removed component's applier state is freed by the release — the elements and a kept part themselves alive": "core's appliers; lite's retention: tests/lite-semantics.test.mjs",
          "a removed component's root part is collected with its root — light and shadow — nothing holding it but the element": "core's appliers; lite's retention: tests/lite-semantics.test.mjs"
        },
        "allRefused": true
      },
      "renderer-sibling-parts": {},
      "renderer-teardown": {
        "skip": {
          "a directive is told when the part holding it is replaced": "directives and refs are core's",
          "and when it is nested inside the subtree being replaced": "directives and refs are core's",
          "and when its keyed row is dropped": "core-only: renderer/keyed",
          "and when an unkeyed list shrinks": "directives and refs are core's",
          "and when the whole list is emptied": "directives and refs are core's",
          "a ref and a directive in one subtree are both handled": "directives and refs are core's"
        }
      },
      "renderer-template-mark": {
        "skip": {
          "with elements wired, only a template something CLAIMED is marked": "core's elements and namespaces modules",
          "with namespaces wired, an html template (its resolver) and an svg variant (only its namespace) are both marked": "core's elements and namespaces modules"
        },
        "allRefused": true
      },
      "tag-name-holes": {
        "skip": {
          "the client refuses exactly the same rows in development, with the same message": "[development] refused by lite's documented rule (`tier-hole-position`)",
          "in production the client renders every row without throwing — the check is development-only": "[production] refused by lite's documented rule (`tier-hole-position`)"
        }
      },
      "template-forgery": {
        "skip": {
          "the client renders no forgery as markup, and throws for none": "refused by lite's documented rule (`tier-hole-position`)",
          "the control: a real template still renders, through the same doors": "a `{ strings, values }` wrapper around a real literal's strings is a template to core and the text [object Object] to lite (a recorded difference, Brian 2026-11-19; tests/tier-parity-fixes.test.mjs)"
        }
      },
      "throw-recovery": {
        "skip": {
          "a render function that throws does not stop the next render": "core-only: core",
          "an effect that throws stops neither its sibling nor the next run": "core-only: core",
          "and neither does a sync effect that throws": "core-only: core",
          "a cleanup that throws stops neither its siblings nor the next element": "drives core's store and effects; lite's: tests/lite-semantics.test.mjs",
          "and a brand-new component still mounts after all of that": "drives core's store and effects; lite's: tests/lite-semantics.test.mjs"
        },
        "allRefused": true
      },
      "url-sinks": {
        "skip": {
          "a javascript: URL bound where a browser navigates is refused by the client AND the server, in every spelling and position": "core-only: renderer/spread",
          "development names the refusal where it happens": "[development] core's wording (`renderer:`) for a refusal lite says as `lite:`, or `spread` (core's)",
          "a value whose toString changes its answer is checked and written as ONE string — client": "core-only: renderer/spread",
          "a non-string value that converts to a javascript: URL is refused on every path": "core-only: renderer/spread",
          "a custom element receives an object at a URL-named property untouched; a javascript: string is still refused": "core-only: renderer/spread"
        }
      }
    }
  },
  "static": {
    "suites": {
      "attribute-driven": {
        "skip": {
          "an attribute in the markup reaches the first render": "built with core's `init`/`createStore`",
          "and changing it afterwards re-renders": "built with core's `init`/`createStore`"
        }
      },
      "attribute-name-holes": {
        "skip": {
          "the client and the server refuse exactly the same templates": "[development] core's wording and core's development-only check; static refuses name holes in every build (`static-hole`)",
          "a refused template is refused on its second render too — nothing half-built is cached": "[development] refused by static's documented rule (`static-hole`)",
          "hydration refuses it cleanly: the error escapes, and no bounds are left in the container": "[development] refused by static's documented rule (`static-hole`)",
          "production renders every row without throwing — the check is development-only": "[production] refused by static's documented rule (`static-hole`)"
        }
      },
      "attribute-value-sinks": {
        "skip": {
          "the three attribute sinks agree, shape for shape": "core-only: renderer/spread",
          "a symbol is refused by every sink — the drift that started this": "core-only: renderer/spread",
          "the accepted set is CLOSED: primitives and the blessed list pass, everything else is named": "[development] a function in an attribute is named `static-needs-renderer`, never `attribute-value`: static writes no function's source (decision 8, Brian 2026-11-19), so it says the binding that does",
          "each complaint names what the value would BECOME, and what to write instead": "[development] a function in an attribute is named `static-needs-renderer`, never `attribute-value`: static writes no function's source (decision 8, Brian 2026-11-19), so it says the binding that does"
        }
      },
      "core-define": {
        "skip": {
          "define(tag, setup) renders, and the class it returns is the registered one": "core-only: core",
          "removed then re-added: setup EXACTLY twice, teardown EXACTLY once per removal (the wrapper is the one teardown)": "core-only: core",
          "a one-operation move keeps it: setup once, no teardown, still live": "core-only: core",
          "options reach core (shadow) and every init insert — as init receives them, without the tag or the setup; the string form passes none, the object form at least {}": "core-only: core",
          "the shared options copy is frozen in development: a module writing to it throws": "[development] core-only: core",
          "two cores on one page: a define tag from each, each set up once and torn down EXACTLY once (both wrappers chained)": "core-only: core",
          "methods: callable on the element, `this` is the element, one function shared by every instance, never in the options": "core-only: core",
          "methods cannot replace the generated connectedCallback or the constructor — in EITHER build; constructor non-enumerable, the generated connectedCallback enumerable (decided)": "core-only: core",
          "the same behavior in both builds, the words in development: a getter, a platform name, adoptedCallback, an unobserved attributeChangedCallback": "core-only: core",
          "props: a plain-JS write AFTER connect repaints (an undeclared prop does not), and a default applies when nothing is bound": "core-only: core",
          "props: an effect follows a prop that arrives late": "core-only: core",
          "props: a value set BEFORE the tag was defined wins over the default (handed over through the setter, then reactive)": "core-only: core",
          "props: array and plain-object defaults are per element; a prop named like an Object.prototype member keeps its default (hasOwn, not in)": "core-only: core",
          "props: a parent binding a declared prop is NOT re-rendered by the child reading it, and binding the default's value renders the child once": "core-only: core",
          "props: development says a method-name collision, a platform name and a shared object default — installed the same in both builds": "core-only: core",
          "props: a parent binding `!name` compares against the RAW record — the child writing it never re-renders the parent": "core-only: core",
          "attributes: each arrives as a string|null prop under its camel name — set, changed, removed (null, not the default) — and repaints": "drives core's `flush`/`createStore`; static reads attributes once at connect (no observedAttributes, by design)",
          "attributes: present before upgrade arrive before the setup; a PROPERTY set before upgrade beats the attribute; no reflection back": "core-only: core",
          "attributes: one that SHARES a declared prop keeps its default until the attribute appears; removal writes null": "core-only: core",
          "attributes: development says a type flip, a reflected platform name and an ignored method; refuses a non-array — the same installs in both builds": "core-only: core",
          "release at removal: a define component removed then re-added keeps its prop values and stays reactive": "core-only: core",
          "release at removal: a component MIXING declared and adopted props — both reactive after a remove and re-add": "core-only: core",
          "release at removal: a CLASS component with adopted props, removed then re-added, still hears its parent": "core-only: core",
          "release at removal: after a re-add, a parent’s live `!name` compare reads the NEW record (a captured old store would read a stale copy)": "core-only: core",
          "release at removal: a MIXED component (an adopted key arrives FIRST) has its declared defaults before and after a remove/re-add": "core-only: core",
          "register: false builds the class and registers nothing; the caller registers it under its own tag, and it works": "core-only: define's register and formAssociated options; lite and static do not take them yet",
          "formAssociated: true sets the static on that class only, and stays out of the init options": "core-only: define's register and formAssociated options; lite and static do not take them yet"
        }
      },
      "core-define-proto": {
        "skip": {
          "an own `__proto__` in props and in methods is skipped; the other keys work; development says it once each": "core-only: core"
        },
        "allRefused": true
      },
      "core-scheduler": {
        "skip": {
          "the flushSync recipe in llms.txt renders synchronously": "core-only: core",
          "and leaves the previous scheduler in place afterwards": "core-only: core",
          "the exported microtask scheduler renders": "core-only: core",
          "the effects contract survives the microtask scheduler": "core-only: core",
          "a scheduler that throws does not freeze the component permanently": "core-only: core",
          "a scheduler that keeps throwing is reported on every write": "core-only: core",
          "a scheduler that silently drops the pass does not freeze the component once it is replaced": "core-only: core",
          "re-queueing does not fire twice while one scheduler stays installed": "static has no scheduler",
          "a render that throws leaves nothing queued for the next one": "static has no scheduler",
          "an element in a window without requestAnimationFrame still re-runs on a write — after a microtask, as every window": "core-only: core"
        },
        "allRefused": true
      },
      "core-signal": {
        "skip": {
          "a signal is shallow: replacing .value notifies, mutating inside it does not": "core-only: core",
          "{ deep: true } tracks the contents too — the same mutation notifies": "core-only: core",
          "an empty signal holds undefined, and is an element ref by shape": "core-only: core",
          "a signal's value lives on its shared prototype: JSON writes the value, keys and a spread see nothing, `in` sees it": "core-only: core",
          "`in`, keys and for-in on a signal subscribe to nothing (no traps): only reading `.value` does": "core-only: core",
          "a write notifies when the new value is not Object.is the held one: -0 over 0 is a change, NaN over NaN is not": "core-only: core",
          "what a signal holds comes back as written, and mutating inside it notifies nothing": "core-only: core",
          "a signal written into a store comes back as itself, and a read through the store still subscribes": "core-only: core",
          "a non-boolean deep is the DEFAULT in both builds; development names it once per call": "core-only: core"
        },
        "allRefused": true
      },
      "event-binding-fuzz": {
        "skip": {
          "a click runs the last-bound handler exactly once, through any swap sequence": "static binds no events (behavior comes from directives)",
          "toggling a handler off and back on leaves exactly one live listener": "static binds no events (behavior comes from directives)"
        },
        "allRefused": true
      },
      "event-name-typo": {
        "skip": {
          "@clik and @keydwon are named, with the event meant": "[development] static binds no events",
          "real events, custom events and far-off names are left alone": "[development] static binds no events"
        }
      },
      "lifecycle-balance-fuzz": {
        "skip": {
          "every effect run is balanced by exactly one cleanup, through any lifecycle sequence": "drives core's store and effects"
        },
        "allRefused": true
      },
      "lit-parity": {},
      "render-differential-fuzz": {},
      "render-exotic-values-parity": {
        "skip": {
          "a function at a text position is the documented divergence, and only that": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "a function in an attribute is its source on both sides — the text-position rule is not this one": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "input.value: server and client agree on true": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "input.value: server and client agree on false": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "input.value: server and client agree on undefined": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "input.value: server and client agree on zero": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "input.value: server and client agree on an array": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "textarea.value: server and client agree on true": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "textarea.value: server and client agree on false": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "textarea.value: server and client agree on undefined": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "textarea.value: server and client agree on zero": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "textarea.value: server and client agree on an array": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on true": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on false": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on null": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on undefined": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on zero": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on the empty string": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "option.value: server and client agree on an array": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented",
          "a boolean form property still takes truthiness, which is a different rule again": "static has no `?`/`.` bindings it writes (S1: `?name` honored, `.value` not written) and renders a function as nothing — documented"
        }
      },
      "render-parity": {
        "cases": {
          "form property .value": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "form property .value, single-quoted": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "form property .checked": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "form property .value on a textarea": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "form property .value on a textarea, with whitespace": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a ref after a single-quoted form property": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "hostile: a form property": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "hostile: a textarea value closing its own tag": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a boolean and a property on one element": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a form property given a number": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a form property given an object": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a form property given an array": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a form property given a Date": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a checked property given a string": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a checked property given an empty array": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a value property given zero": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a value property given false": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a value property given true": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a written .value on a textarea with content": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a live property, true": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a live value property": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a live property beside a static": "S1: static writes no `.prop` or `!live` binding (Brian 2026-11-19; static-needs-renderer in development)",
          "a function in an attribute": "decision 8 (Brian 2026-11-19): static writes no function's source into markup; core does",
          "duplicate attribute, last wins": "S4 (for Brian): the parser keeps a duplicated attribute's FIRST occurrence and drops the second, with the value static wrote there; core keeps the last, lite refuses duplicates",
          "duplicate boolean, last wins": "S4 (for Brian): the parser keeps a duplicated attribute's FIRST occurrence and drops the second, with the value static wrote there; core keeps the last, lite refuses duplicates",
          "duplicate form property, last wins": "S4 (for Brian): the parser keeps a duplicated attribute's FIRST occurrence and drops the second, with the value static wrote there; core keeps the last, lite refuses duplicates"
        }
      },
      "render-poisoned-values-fuzz": {},
      "render-update-fuzz": {},
      "render-update-parity": {},
      "renderer": {
        "skip": {
          "property binding sets and preserves case": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "event binding fires, swaps, and removes": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "svg renders in the SVG namespace": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "element-position: refs fire, junk is ignored, alignment holds": "refused by static's documented rule (`static-hole`)",
          "a ref runs once per distinct value, not once per render": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "one position can switch between a keyed and an unkeyed list, both ways, without a rebuild going wrong": "core-only: renderer/keyed",
          "a removed keyed row is gone from the list for good — re-adding its key renders it again": "core-only: renderer/keyed",
          "keyed swap moves nodes instead of rewriting them": "core-only: renderer/keyed",
          "keyed reverse preserves node identity": "core-only: renderer/keyed",
          "keyed remove from the middle": "core-only: renderer/keyed",
          "keyed insert into the middle": "core-only: renderer/keyed",
          "keyed update in place": "core-only: renderer/keyed",
          "keyed clear and refill": "core-only: renderer/keyed",
          "keyed arbitrary shuffle": "core-only: renderer/keyed",
          "list next to static siblings stays inside its range": "core-only: renderer/keyed",
          "list switching to a template and back": "core-only: renderer/keyed",
          "keyed item that changes template shape under the same key (element-mode demote)": "core-only: renderer/keyed",
          "multi-root keyed items reconcile and move correctly (markered path)": "core-only: renderer/keyed",
          "mixed single-root and multi-root keyed items": "core-only: renderer/keyed",
          "hold() preserves DOM and element state across a toggle": "core-only: renderer",
          "hold() parks and restores a MULTI-ROOT template — its own nodes come back": "core-only: renderer",
          "hold() updates values in place when the template does not change": "core-only: renderer",
          "hold() evicts nothing — fifty shapes through one call site all re-adopt their own nodes": "core-only: renderer",
          "onClick-style bindings attach listeners; a BOUND onclick is refused, a static one stays": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "markup in a keyed list item is text too": "core-only: renderer/keyed",
          "clearing a whole-parent list leaves the parent empty and reusable": "core-only: renderer/keyed",
          "clearing one part never destroys a sibling sharing the parent": "core-only: renderer/keyed",
          "a list with static siblings in the parent clears only itself": "core-only: renderer/keyed",
          "a DOM node renders as itself": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "a document fragment renders its children": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "one node replaces another": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "re-rendering the same node does not duplicate it": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "a node position moves to text and back": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "nodes render inside arrays and keyed lists": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "a live property reasserts after a sibling changed the DOM": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "a live selected option reasserts the same way": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's",
          "but a live value property does not": "static renders once (no updates or identity across renders), binds no properties or events, and keyed/hold/refs/DOM nodes are core's"
        }
      },
      "renderer-audit-regressions": {
        "skip": {
          "a string in tag position is refused, not silently mangled": "[development] core's applier/tag machinery and core's wording",
          "a tag in tag position still works, and updates in place": "core-only: renderer/tag",
          "the base renderer names the tag entry for an expression in tag position": "[development] core's applier/tag machinery and core's wording",
          "an applier that changes identity every render is named": "[development] core's applier/tag machinery and core's wording",
          "a hoisted applier keeps its previous return and stays quiet": "[development] core's applier/tag machinery and core's wording",
          "a function ref is called with null when its element is torn down": "core's applier/tag machinery and core's wording",
          "an object ref has its value cleared": "core-only: core",
          "a spread object is not released": "core-only: renderer/spread",
          "an expression in attribute-name position is refused in development, as the server refuses it": "[development] core's applier/tag machinery and core's wording",
          "development shows the spread that does what a name expression meant": "[development] refused by static's documented rule (`static-hole`)"
        }
      },
      "renderer-child-protocol": {
        "skip": {
          "a late commit runs as a render of its container — a <select> it renders shows its value": "core's child protocol (directives, appliers)",
          "a directive renders, keeps its place across renders, and updates asynchronously": "core's child protocol (directives, appliers)",
          "two directives at one part do not share state": "core's child protocol (directives, appliers)",
          "a directive keeps its state across its own commits, and loses it when the part is cleared": "core's child protocol (directives, appliers)",
          "ordinary child values are unaffected": "core's child protocol (directives, appliers)",
          "an unchanged <select> value is not written again; replaced options still get it": "core's child protocol (directives, appliers)",
          "a selection binding on a <select multiple> is named in development — template and spread": "[development] core-only: renderer/spread",
          "a select gets its selection whatever spells it and wherever its options come from": "core-only: renderer/spread",
          "a select binding is re-asserted when its options move under it — every spelling": "core-only: renderer/spread",
          "a render nested inside a pass does not commit its caller's select early": "core's child protocol (directives, appliers)"
        }
      },
      "renderer-coded-warnings": {
        "skip": {
          "boolean-child: false renders as the word and is named; the same value again is quiet; a flip speaks again": "[development] core's wording (`renderer:`); static says the same code as `static:` (tests/tier-parity-fixes.test.mjs)",
          "spread-unsafe-name: a key that cannot be written into markup is skipped and named": "core-only: renderer/spread",
          "keyed-duplicate-key: once per (list, key) — the same duplicate again is quiet, a new one speaks": "core-only: renderer/keyed"
        }
      },
      "renderer-event-bindings": {
        "skip": {
          "renderer: an object with handleEvent listens, as it does on the platform": "static binds no events (behavior comes from directives)",
          "renderer: swapping the handler leaves exactly one listener": "static binds no events (behavior comes from directives)",
          "renderer: a handler removed and restored is not registered twice": "static binds no events (behavior comes from directives)",
          "renderer: the handler receives the element as `this`": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): an object with handleEvent listens, as it does on the platform": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): swapping the handler leaves exactly one listener": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): a handler removed and restored is not registered twice": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): a nulled handler stops firing": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): the handler receives the element as `this`": "static binds no events (behavior comes from directives)",
          "renderer + hydration (adopted): a value that cannot listen is inert rather than throwing on every dispatch": "static binds no events (behavior comes from directives)",
          "a value that cannot listen is named where it is written": "[development] static binds no events (behavior comes from directives)",
          "a handler survives a keyed move and fires once": "core-only: renderer/keyed"
        }
      },
      "renderer-foreign-nodes": {
        "skip": {
          "'drop' (the default): a shadow root empty at its first render carries no marker comments": "core-only: core",
          "'drop': the template's OWN nodes are never called foreign — a render-only template change says nothing": "core-only: core",
          "a re-added 'drop' component keeps what its RE-INIT put in the root (styles' fallback in a second window) — only the released content is cleared": "core-only: core",
          "'drop': a foreign node survives an ordinary re-render and goes on a template change — development says so once, production silently": "core-only: core",
          "'preserve' on the component: the markered root — a foreign node beside the template survives a template change, in place": "core-only: core",
          "renderer({ foreignNodes: 'preserve' }) is the app default, and a component's own 'drop' beats it": "core-only: renderer",
          "the app default is COMPONENT-scoped: a container handed to renderInto keeps its markers and its foreign nodes, whatever the default says": "core-only: renderer",
          "a shadow root NOT empty at its first render stays markered (a declarative root, a styles text fallback)": "core-only: core",
          "light component roots stay markered": "core-only: core",
          "a removed and re-added 'drop' component renders once, fresh, with no markers and no second copy": "core-only: core",
          "an invalid foreignNodes is named in development — own and default — and the template owns the root": "core-only: core"
        },
        "allRefused": true
      },
      "renderer-listener-churn": {
        "skip": {
          "re-rendering a binding attaches nothing after the first pass": "static binds no events",
          "and the handler that fires is the latest one": "static binds no events",
          "a handler cycled off and on still fires exactly once": "static binds no events",
          "a keyed list costs one listener per row, and a reverse costs none": "core-only: renderer/keyed",
          "dropping rows costs nothing, and re-adding costs one each": "core-only: renderer/keyed"
        },
        "allRefused": true
      },
      "renderer-namespace-security": {
        "skip": {
          "wiring a template module after the renderer built templates is named in development": "[development] core's namespaces module; static writes svg``/mathml``"
        }
      },
      "renderer-namespaces-positions": {
        "skip": {
          "list items in <svg> are SVG — unkeyed and keyed": "core-only: renderer/keyed",
          "a claim inside svg content is asked on the SVG variant, not the html original": "core's namespaces module; static writes svg``/mathml``"
        }
      },
      "renderer-props": {
        "skip": {
          "props() delivers non-string values as properties, intact and by identity": "core-only: renderer/spread",
          "the update path re-binds through one draw()": "core-only: renderer/spread",
          "spread() is idempotent on its own brand — the JSX compilation shape": "core-only: renderer/spread",
          "props() coexists with ordinary attributes and other bindings on the same element": "core-only: renderer/spread",
          "a null-prototype bag is a legal bag": "core-only: renderer/spread"
        },
        "allRefused": true
      },
      "renderer-raw-text-round-trip": {
        "skip": {
          "hydration ADOPTS a served style or JSON text equal to the client's (the same text node, nothing said), and rewrites one that differs": "static renders once (no update rows); hydration is core's; core's development refusal of `</style${x}` (documented)",
          "core's client, every placement of up to three holes inside a style closer, every spelling: whole live and after a round trip, its text exact": "[development] static renders once (no update rows); hydration is core's; core's development refusal of `</style${x}` (documented)",
          "an update rewrites the text only when the composed text changed": "static renders once (no update rows); hydration is core's; core's development refusal of `</style${x}` (documented)",
          "a lone value (`<style>${css}</style>`) unchanged is not written again; a changed one is, closed": "refused by static's documented rule (`template-in-text`)",
          "a template in a <textarea> or <title> renders its elements, and development says so once (template-in-text); production says nothing": "refused by static's documented rule (`template-in-text`)"
        }
      },
      "renderer-reconciliation": {},
      "renderer-release": {
        "skip": {
          "a re-added component renders exactly once — handlers work, writes repaint": "core-only: core",
          "a removed element keeps its DOM, and its handler no longer runs": "core-only: core",
          "an event on a released element is harmless — nothing throws, nothing reaches the error chain": "built with core's `createStore`",
          "with hydration wired, a re-added component is rendered, never adopted as server markup": "core-only: core",
          "a keep-alive move is not a removal — nothing is released": "core-only: core"
        },
        "allRefused": true
      },
      "renderer-release-gc": {
        "skip": {
          "a removed component's applier state is freed by the release — the elements and a kept part themselves alive": "core's appliers",
          "a removed component's root part is collected with its root — light and shadow — nothing holding it but the element": "core's appliers"
        },
        "allRefused": true
      },
      "renderer-sibling-parts": {},
      "renderer-teardown": {
        "skip": {
          "a directive is told when the part holding it is replaced": "directives and refs are core's",
          "and when it is nested inside the subtree being replaced": "directives and refs are core's",
          "and when its keyed row is dropped": "core-only: renderer/keyed",
          "and when an unkeyed list shrinks": "directives and refs are core's",
          "and when the whole list is emptied": "directives and refs are core's",
          "a ref and a directive in one subtree are both handled": "directives and refs are core's"
        }
      },
      "renderer-template-mark": {
        "skip": {
          "with elements wired, only a template something CLAIMED is marked": "core's elements and namespaces modules",
          "with namespaces wired, an html template (its resolver) and an svg variant (only its namespace) are both marked": "core's elements and namespaces modules"
        },
        "allRefused": true
      },
      "tag-name-holes": {
        "skip": {
          "the client refuses exactly the same rows in development, with the same message": "[development] refused by static's documented rule (`static-hole`)",
          "in production the client renders every row without throwing — the check is development-only": "[production] refused by static's documented rule (`static-hole`)"
        }
      },
      "template-forgery": {
        "skip": {
          "the client renders no forgery as markup, and throws for none": "refused by static's documented rule (`static-hole`)",
          "the control: a real template still renders, through the same doors": "a `{ strings, values }` wrapper around a real literal's strings is a template to core and the text [object Object] to static (a recorded difference, Brian 2026-11-19; tests/tier-parity-fixes.test.mjs)"
        }
      },
      "throw-recovery": {
        "skip": {
          "a render function that throws does not stop the next render": "core-only: core",
          "an effect that throws stops neither its sibling nor the next run": "core-only: core",
          "and neither does a sync effect that throws": "core-only: core",
          "a cleanup that throws stops neither its siblings nor the next element": "drives core's store and effects",
          "and a brand-new component still mounts after all of that": "drives core's store and effects"
        },
        "allRefused": true
      },
      "url-sinks": {
        "skip": {
          "a javascript: URL bound where a browser navigates is refused by the client AND the server, in every spelling and position": "core-only: renderer/spread",
          "`.srcdoc` stays the deliberate spelling for trusted markup — refusing the attribute leaves the property": "`spread` and property bindings (`.href`, `.srcdoc`) are core's/lite's; an svg`` template into an <svg> container is the adapter's limit",
          "development names the refusal where it happens": "[development] `spread` and property bindings (`.href`, `.srcdoc`) are core's/lite's; an svg`` template into an <svg> container is the adapter's limit",
          "a value whose toString changes its answer is checked and written as ONE string — client": "core-only: renderer/spread",
          "a non-string value that converts to a javascript: URL is refused on every path": "core-only: renderer/spread",
          "a custom element receives an object at a URL-named property untouched; a javascript: string is still refused": "core-only: renderer/spread",
          "an animation value bound through an svg`` template is refused, client and server": "`spread` and property bindings (`.href`, `.srcdoc`) are core's/lite's; an svg`` template into an <svg> container is the adapter's limit"
        }
      }
    }
  }
};
