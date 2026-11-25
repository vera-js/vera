# @vera-components/icon

`<vera-icon>`: an icon that is decorative unless you name it. Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/icon';

wire([renderer]);
document.body.innerHTML = `
  <vera-icon><svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg></vera-icon>
  <vera-icon src="#check" label="Saved"></vera-icon>`;
```

## Two sources

- **Your own `<svg>` as a child.** It is kept exactly as you wrote it, and shows before JavaScript loads.
- **`src`, a sprite reference** (`/icons.svg#check`, or `#check` for a sprite already in the page), rendered as
  `<svg><use href>`. Nothing is fetched or parsed: `<use>` references the sprite.

If both are given, the child wins, and development says so. The child is looked for when the icon renders, which is
when it connects and when `src` changes, so a child `<svg>` added later takes over at the next `src` change.

## Naming

- No `label`: decorative, so the host gets `aria-hidden="true"` and assistive technology skips it.
- `label="Saved"`: the host gets `role="img"` and `aria-label="Saved"`.
- An icon-only button is named by its icon: `<button><vera-icon src="#close" label="Close"></vera-icon></button>`.
- The icon owns `role`, `aria-label` and `aria-hidden` on its own host, so don't set them yourself.

## Which `src` is shown

Only a relative URL, or `http(s):` on the page's own origin. A relative URL resolves against the page's base URL, but
the origin it must match is the page's own: under a `<base href>` on another origin it is refused as cross-origin, since
the platform would show nothing for it. Every other scheme is refused, including `javascript:`,
`data:` and `blob:`, and development says why. Two of those limits are the platform's own: a `<use>` on another origin
renders nothing, in every engine, and `data:` is blocked everywhere. Refusing `blob:` is our rule: it is stricter than
the platform, and it may relax if someone needs it.

**Inside a shadow root**, `src="#check"` finds `#check` in that shadow root only, never in the document (measured on
Chromium, Firefox and WebKit). Put the sprite inside the same root, or use a file `src`.

## Before JavaScript, and on the server

A child `<svg>` shows before upgrade. A `src` icon shows once the element upgrades, or straight away when the page is
server-rendered with `@verajs/ssr`.

**On a page that wires light-DOM slots** (`@verajs/renderer/slots`, for another component), `<vera-icon>` keeps its children where you wrote them: they are its own, not content for a `<slot>`.
