# Keyframe syntax — design and implementation plan

**Status: BUILT** — `4db01be`, 2026-08-24. Every step in §5 is done and the §6 acceptance test
passed: the demo renders identically, 15 elements x 21 scroll positions x 4 properties, zero
differing cells.

> **One thing here has since changed.** `-tablet` / `-mobile` were a fixed pair; width bands
> replaced them, so a suffix is now an alias a site registers for a range and `[a-b]` can be written
> inline. The trade-off recorded below — that per-keyframe breakpoint override was the capability
> lost — no longer holds either: an inline band overrides individual keyframes, which is exactly
> what §5 rejected as "three delimiter levels deep". Worth knowing that the rejected option was
> later built, and why: bands are a *value* prefix rather than a third delimiter.

This document is kept for the *reasoning*. §2 is the
part worth keeping: several of the options rejected there are ones a future reader would otherwise
reconsider from scratch.

Measured on the demo page: **90 attributes / 2,249 bytes → 56 / 1,594.** 38% fewer attributes, 29%
fewer bytes. (The estimate while designing was 41% fewer bytes; that was optimistic — presets and
settings, which the change does not touch, are a larger share of the page than assumed.)

Runtime cost: **6,517 → 7,191 bytes gzipped**, against a 9,216 budget.

---

## 0. One-paragraph summary

Keyframe positions move out of the attribute **name** and into the **value**. `-from`, `-at-{pct}`
and the `n` prefix are removed; a bare value stays as sugar. Positions gain standard CSS units and
plain negative numbers. Nothing about the timeline's meaning changes — `0%` and `100%` are the same
two moments they are today — so **the demo must render identically afterwards**, which is the
acceptance test.

---

## 1. The change

Keyframe positions move out of the attribute **name** and into the **value**, alongside the value
they apply to.

```html
<!-- before -->
data-vm-translate-y-at-n50="0px"
data-vm-translate-y-at-30="45px"
data-vm-translate-y-at-150="400px"

<!-- after -->
data-vm-translate-y="-50% 0px, 30% 45px, 150% 400px"
```

Measured on the demo page: **125 attributes / 3,105 bytes → 32 / 1,847. 41% smaller**, on top of the
50% the current grammar already saved over the 2022 one.

## 2. Why

The position lived in the attribute name, and a name cannot hold a signed, unit-bearing value. That
is the entire reason `-at-n50` needed an `n` prefix, and the reason a position could only ever be a
percentage. Moving it into the value removes both limits at once:

- **negatives are minus signs** — `-50%`, not `n50`
- **positions take units** — `-30vh`, `200px`, `50%`
- **one form replaces three** (`-from`, `-at-N`, bare) plus a prefix hack

## 3. Grammar

```
data-vm-<property>="<value>"                              end value (sugar)
data-vm-<property>="<pos> <value>, <pos> <value>, …"      keyframes
data-vm-<property>-<breakpoint>="…"                       tablet / mobile override
```

**A position always carries a unit; a value may or may not.** That single rule is what makes a lone
number unambiguously a value, so the sugar can coexist with the list form.

### Position units

`%` · `vh` · `vw` · `px` · `rem`

All standard CSS. **Nothing to learn.** A custom `sw` unit was designed and then dropped: it existed
only to keep `%` from being a false friend, and it turned out `%` is not one — see below.

`em` is deliberately excluded. Font-size-relative scroll distance is not a real intent.

### What `%` means, and why it is safe

`0%` is the moment the element begins entering the scroll window; `100%` is the moment it has
completely left. The window is **the element's own size plus the viewport**, so the measure is
normalised per element — which is exactly why `data-vm="fade-up"` works unchanged on a 40px badge
and a full-bleed hero.

That is the same thing CSS's own scroll vocabulary means by a percentage: in `animation-range`, a
percentage is a percentage of the named range, defaulting to `cover` — subject start-entering to
fully-left. Identical quantity.

So an agent or a developer who assumes CSS semantics for `%` **gets the correct behaviour**. This was
the deciding argument: a token that behaves as expected needs no defending, and a custom unit would
have had to be learned to achieve the same result.

Values outside `0–100` extrapolate. Negative starts before the element enters; over 100 continues
after it has left, which is how an animation can be traversed only partly — the element exits
mid-flight without reaching its final value.

### Value units

Unchanged — the existing per-property allowlist. `translate-*` takes lengths, `rotate`/`skew` take
`deg` only, `scale`/`opacity`/`brightness` are unitless. `rotate="4rem"` is still rejected.

Position and value units are **independent**:

```html
data-vm-translate-y="-30vh 4rem, 50% 0"
data-vm-rotate="-200px 0deg, 100% 720deg"
data-vm-opacity="-10vh 0, 25% 1"
```

### The one readability trap

```html
data-vm-translate-y="50% 50%"
                       ↑    └── value → 50% of the element's own height (CSS)
                       └─────── position → 50% through the scroll window
```

Never ambiguous to the parser — position is always first — and both readings are *correct* for their
slot. It is a documentation problem, not a correctness one, and CSS has the same overlap between
`animation-range: cover 50%` and `translateY(50%)`.

## 4. What is removed

- `-from`, `-at-{pct}`, and the bare-property form as *separate grammar* — the bare form survives
  only as value sugar
- the `n` prefix
- `MIN_PERCENT` / `MAX_PERCENT` as a name-parsing concern

### What is kept

- **Bare-value sugar.** `data-vm-opacity="0"` still means "animate to 0". It is the 90% case and
  what keeps presets terse.
- **A single keyframe still fills its missing end** from the property's resting value, in both
  directions.
- **Breakpoints stay on the attribute name.** `-tablet` / `-mobile` now override a whole property
  rather than one keyframe. Per-keyframe breakpoint override is the one capability lost; expressing
  it inline was considered and rejected as three delimiter levels deep.
- **Presets are unaffected** — they expand to keyframes, so only their internal representation
  changes.

### Design constraints that shape the implementation

**Curves move from parse time to runtime.** A `vh` position resolves against current geometry, so
curves are built when the element is constructed and rebuilt on resize, instead of being immutable
parse output. `parse` returns keyframes; `runtime` builds curves.

Two things keep that cheap:

- **Only geometry-dependent curves rebuild.** A position in `%` is already normalised and does not
  depend on the viewport at all. Flag at parse time whether any position uses a viewport or absolute
  unit; on the usual page nothing rebuilds. Building 200 curves measures 0.2 ms even when it does.
- **Rebuild in place.** The keyframe count never changes, so recompute into the existing
  `Float64Array`s rather than allocating new ones.

**The IntersectionObserver is recreated on resize.** Its root margin is derived from how far outside
`0–1` any keyframe reaches, which with viewport-unit positions changes when the viewport does. A
stale margin would let an element leave the active set slightly early — it would settle at its end
value rather than freeze, so not a correctness bug, but visible as an animation finishing a touch
early. Resize already triggers a full re-measure; disconnecting and re-observing alongside it is
cheap.

**A malformed entry drops itself, not the property.** `"0% 0, garbage, 100% 1"` keeps two keyframes
and records the bad one in `rejected`.

## 5. Implementation plan

Ordered so the suite stays meaningful as long as possible. Commit after each step — if you are
interrupted, `git log` tells you where you are.

### Step 1 — `schema.ts`: the value parser

**Add** `parseKeyframeList(raw, property, context)` → `{ keyframes: RawKeyframe[], rejected: string[] }`.

```ts
interface RawKeyframe {
  position: number;        // in the unit below, NOT yet normalised
  positionUnit: '%' | 'vh' | 'vw' | 'px' | 'rem';
  value: number;
  unit: Unit;              // the value's unit, from the property allowlist
}
```

Rules, in order:
1. Split on `,`. Trim each entry. Empty entries are rejected, not skipped silently.
2. Split each entry on whitespace. **One token = a bare value** (the sugar). **Two tokens =
   position then value.** Three or more is rejected.
3. A position **must** carry a unit — that is what disambiguates it from the sugar. `50` alone in a
   two-token entry is rejected; `50%` is fine.
4. Position units: `%` `vh` `vw` `px` `rem`. Anything else, including `em`, is rejected.
5. Values go through the existing `parseValue` / `parseUnit` unchanged.
6. Bounds: positions in `%` clamp to the current `MIN_PERCENT`/`MAX_PERCENT` equivalents
   (−300 … 300). Absolute units get a sane cap so a typo cannot ask for a kilometre of scroll.

**Remove** `parseAttributeName`'s `-from` / `-at-` handling and `parsePercentToken` entirely.
`parseAttributeName` still exists but only resolves `<property>` and `<breakpoint>`.

**Keep** `MIN_PERCENT`/`MAX_PERCENT` — they move from name-parsing to value-parsing.

- [x] `parseKeyframeList` written
- [x] `parseAttributeName` reduced to property + breakpoint
- [x] `parsePercentToken` deleted
- [x] tests in `test/schema.test.js` (~32 references to update)

### Step 2 — `parse.ts`: keyframes out, curves no longer built here

`buildAnimation` currently calls `buildCurve` and returns a `curve`. It should now return **raw
keyframes plus a flag**:

```ts
interface ElementMotion {
  property: PropertyDef;
  unit: Unit;
  keyframes: readonly RawKeyframe[];
  /** true if any position uses vh/vw/px/rem — only these rebuild on resize */
  geometryDependent: boolean;
  curve: NumericCurve;      // filled by runtime, not parse
}
```

`lowestStart` / `highestEnd` currently come from `curveStart`/`curveEnd` at parse time
(`parse.ts:263-264`). They must move to runtime for the same reason curves do.

The single-keyframe end-filling (`parse.ts:200-204`) stays, and still works in both directions.

- [x] `buildAnimation` returns keyframes, not a curve
- [x] `geometryDependent` flag set
- [x] `lowestStart`/`highestEnd` removed from `ParsedElement`
- [x] tests in `test/parse.test.js` (~19 references)

### Step 3 — `runtime.ts`: build and rebuild curves

Add `normalisePosition(kf, element, win)`:

```
%    →  position / 100                       (already normalised; geometry-free)
vh   →  (position * win.height / 100) / scrollWindow
vw   →  (position * win.width  / 100) / scrollWindow
px   →  position / scrollWindow
rem  →  (position * rootFontSize) / scrollWindow
                                where scrollWindow = element.size + win.size
```

- Build curves in `createRuntimeElement`.
- Rebuild in `resetElement` **only if** `geometryDependent`, and **in place** — the keyframe count
  never changes, so overwrite the existing `Float64Array`s.
- Recompute `lowestStart`/`highestEnd` on the element whenever curves are built.

- [x] `normalisePosition` written
- [x] curves built in `createRuntimeElement`
- [x] in-place rebuild in `resetElement`, gated on the flag
- [x] `lowestStart`/`highestEnd` live on `RuntimeElement`
- [x] tests in `test/runtime.test.js` (~7 references)

### Step 4 — `motion.ts`: recreate the observer on resize

`createVisibilityTracker` is built once in `init()` from the initial element list. Move that into a
function and call it from the resize path too, after `measure()`.

- [x] tracker creation extracted
- [x] recreated on resize, after re-measure
- [x] old tracker disconnected first (no listener leak)

### Step 5 — presets

`PRESETS` is `Record<name, Record<property, [percent, value][]>>` (`schema.ts:451`). Percentages
become position strings so they go through the same parser as authored markup:

```ts
'fade-up': { opacity: [['0%', '0'], ['100%', '1']], 'translate-y': [['0%', '40px'], ['100%', '0px']] }
```

The invariant test that every preset value passes authored-value validation must keep working — it
is what stops the catalogue drifting from the schema.

- [x] `PRESETS` shape updated
- [x] preset expansion in `parse.ts` updated
- [x] preset invariant tests pass

### Step 6 — docs, generator, migration

- [x] `scripts/generate-reference.js` — grammar section rewritten; add a **position units** table
      alongside the existing value-units column
- [x] `npm run reference` regenerated, `npm run check:reference` green
- [x] `README.md` — the "five rules" list and every example
- [x] `scripts/migrate-attributes.mjs` — extend to convert current → new. **Marked done and was not:**
      it kept emitting `-from`, `-at-n50` and a bare name for the end until 2026-08-28, so its own
      output was refused by the parser it migrates to. Fixed, and `check-examples` now runs the tool
      on a fixture and parses what it writes. It already parses the
      current grammar, so this is a re-emit, not a new parser.
- [x] `index.html` migrated by running the script
- [x] `src/lab.ts` and `src/index.ts` — the lab and demo set attributes in JS

### Step 7 — sweep

- [x] `grep -rn "at-n\|-at-\|-from" src/ test/ index.html lab.html` returns nothing
- [x] the old grammar sketch — marked superseded, linked here
- [x] size budgets still green (`npm run build`)

## 6. Verification

**The demo must render identically before and after.** Same numbers, different slot — nothing needs
recalculating, so any visible difference is a bug. That makes this refactor unusually verifiable.

Capture a baseline **before** starting:

```sh
npm run dev &
node <<'JS'
// screenshot the demo at several scroll positions, save to /tmp/before-*.png
JS
```

Then after, at the same positions, and compare. The browser measurement harnesses used during the
audits do exactly this shape of thing — walking every feature across Chromium, WebKit and Firefox
is the fastest way to confirm nothing regressed.

### Gates

```sh
npm test                  # was 463 before this work started
npm run typecheck
npm run build             # both entries within budget
npm run check:reference   # generated reference not stale
```

### Specific things to check by hand

| check | why |
|---|---|
| `data-vm-opacity="0"` still fades to 0 | the sugar is the 90% case |
| `data-vm-opacity="0% 0, 100% 1"` matches the old `-from`/bare pair | equivalence |
| `"-50% 0px, 100% 60px"` starts before the element enters | replaces `-at-n50` |
| `"0% 0px, 150% 400px"` never reaches 400px | replaces `-at-150`, exits mid-flight |
| `"-30vh 0px, 100% 60px"` behaves correctly **after a window resize** | the geometry-dependent path |
| a `vh` position element still animates correctly after resize | curve rebuild + observer recreation |
| `"0% 0, garbage, 100% 1"` keeps two keyframes | per-entry failure granularity |
| presets unchanged visually | `PRESETS` migration |

## 7. Traps specific to this codebase

Learned the hard way during the audits.

1. **A scripted edit that does not match its target fails silently.** Several bugs in this repo came
   from a `python`/`sed` replacement whose anchor had drifted. After any scripted edit, `grep` for
   the new text to confirm it landed. A passing test suite does not prove an edit applied.
2. **Assert the applied value, not the computed one.** Inertia was broken for several commits
   because every test checked `element.transition` and none checked `node.style.transition`.
3. **`resetElement` must stay a pure read.** It re-measures geometry and writes nothing. Clearing a
   style there previously wiped the transition and disabled inertia entirely.
4. **The write-skip cache must be invalidated whenever the DOM is cleared behind it**
   (`element.lastTransform` / `lastFilter` / `plan.lastProperties`), or the next write is skipped as
   a no-op and the element stays blank.
5. **Curves are evaluated per element per frame.** Nothing in `updateElement` or `animateElement` may
   allocate. Build cost belongs in `createRuntimeElement`.
6. **Do not trust a visual comparison without checking for confounds.** The inertia lab initially
   staggered its rows down the document, so they sat at different timeline positions and the
   stagger read as damping — inflating a reported figure tenfold.
