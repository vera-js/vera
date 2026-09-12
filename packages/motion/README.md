# @verajs/motion

The motion engine: a compiler from one attribute grammar (`data-vd-motion`) to generated CSS, a
server renderer, and a per-frame timeline driver. **Engine-independent by design** — it imports
nothing from `@verajs/directives`; the directives package wires it as its motion pack
(`@verajs/directives/motion`), and any other embedder consumes the same lean entries the same way.
The PHP twin (`verajs/motion` on Packagist, `Vera\Motion`) implements the identical spec —
`docs/motion-spec/` in this repository is the shared contract, fixtures included.

On a vera page you almost never install this package directly: wire
`@verajs/directives/motion` and the engine arrives inside the pack. This package is the
**embedder surface** — for platforms that generate motion CSS server-side, drive timelines from
their own runtime, or emit first frames at build time.

| entry | size (min+gzip) | what |
| --- | --- | --- |
| `@verajs/motion` / `./core` | <!--size:motion.gzip.bytes-->12 363 B<!--/size:motion.gzip.bytes--> | compiler + writer: parse the attribute, generate the CSS, name it deterministically |
| `./ssr` | <!--size:motion-ssr.gzip.bytes-->11 839 B<!--/size:motion-ssr.gzip.bytes--> | `renderMotion(document)` — mark every in-scope element, emit one sheet per tree |
| `./client` | <!--size:motion-client.gzip.bytes-->2 957 B<!--/size:motion-client.gzip.bytes--> | the reader: delivery, drive and registered functions, **no compiler** — the front-end cost when a server generated everything |

`./internal` also exists: the first-party seam the directives pack wires. It carries no stability
promise beyond the two first parties — a third-party embedder belongs on `./core`.

## The one number

Every animated element reduces to one number (its progress, 0→1) aimed at one of three
destinations: **generated CSS** (the default — a paused animation seeked by a custom property, so
the compositor does the work), a **custom property** the author names (`progress: '--p'`), or a
**registered JavaScript function** (`function: 'confetti'` — the escape hatch for canvas, WebGL,
text, audio; the attribute names a function and never contains one).

## First frames without JavaScript

`vera-motion-emit` (this package's bin) rewrites static HTML files so motion elements paint their
first frame from emitted CSS before any JavaScript loads — the same output `renderMotion`
produces on a live server. Any toolchain that ends in HTML files can run it as a build step.

**The buildless ladder** — first-frame options for a page with no build step at all, in order of
effort: (1) load the script at **body-end with a sync wire** — elements generate before first
paint in practice, and the residual risk is a slow-network flash; (2) opt into
**`data-vd-cloak`** on motion elements — a one-line CSS rule hides them until delivery marks
them, trading the flash for a fade-in; (3) accept the flash — a **cosmetic, by doctrine**: the
content is server-complete and readable throughout, which is what buildless-first promises. A
build step upgrades the page to `vera-motion-emit` (above) or the emit-at-build recipe, where
the first frame is in the HTML itself and the question disappears.

## Machine namespace

Everything this engine writes into a page uses the `vm` namespace — `data-vm-motion`,
`data-vm-native`, `data-vm-armed`, `data-vm-on`, `data-vm-sheet="motion"`, the `--vm-*` variables
and `vm-<hash>` keyframes names. Authors write `data-vd-*`; if a name appears in an author's
code, it is not `vm`. See `docs/ARCHITECTURE.md` § Naming namespaces.
