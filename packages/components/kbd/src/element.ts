/**
 * **<vera-kbd>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * `keys="Mod+Shift+K"` renders as nested `<kbd>` (HTML's markup for a combination): one inner `<kbd>` per key, joined by
 * `+` except in Apple's spelling (⇧⌘K). A symbol key shows its symbol as `aria-hidden` text and speaks its word from
 * CSS alt text on empty generated content, so copying the shortcut copies exactly what is shown (measured on Chromium
 * and Firefox: "⇧⌘K"; A markup with a visually hidden word copied "⇧Shift⌘CommandK"). That rule is adopted by the
 * element itself, never through `@verajs/styles`, so the words are there whether or not the app wired styles.
 *
 * The server never renders the Apple spelling: it cannot know the reader's platform, and its markup would need the
 * rule before any script ran. It renders words (`platform="windows"` spells Meta as Win), and the client re-spells once.
 */
import { effect, html, isServer, signal } from '@verajs/core';
import { adoptOwnSheet, diagnostic, quoted } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { platformOf, spellKeys, type Platform } from './kbd/spell.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-kbd', attributes: ['keys', 'platform'] } as const;

/** What `define` hands the setup: the element, with its two declared attributes as props. */
interface KbdHost extends HTMLElement {
  keys: string | null;
  platform: string | null;
}

/** The root's key for kbd's one sheet, its words and its look (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
const SHEET = '_$veraKbdWords$';

/**
 * A symbol key's word, spoken from the alt text of empty generated content (`content: "" / …`): never shown, never
 * copied. The trailing space keeps the words apart ("Shift Command K", not "ShiftCommandK", measured). Zero specificity,
 * so a page's own rule wins. Keyed on our own attributes, never the tag: under `defineAs('my-kbd')` a tag selector
 * matched nothing and every symbol was silent (a browser row). And on `data-vera-kbd`, the mark every key this element
 * writes carries: part names are one vocabulary shared by every component, so a rule on the name alone would speak a
 * word on another component's `key` part (a browser row).
 */
const WORDS = ':where([data-vera-part="key"][data-vera-kbd][data-vera-word])::before{content:"" / attr(data-vera-word) " "}';

/** One of kbd's own parts, unless it or anything around it opted out of the look (the words rule never opts out). */
const own = (name: string): string =>
  `:where([data-vera-part="${name}"][data-vera-kbd]:not([data-vera-look="none"],[data-vera-look="none"] *))`;

/**
 * **The look**, in the same sheet as the words, so one root adopts one sheet. Every length is in `em`, so a key follows
 * the text around it at any size (a browser row: a 20px parent's key is 1.25 times a 16px one's). The combo takes the
 * page's font: an engine's own `kbd` rule is `monospace`, which also shrinks the text under the generic-monospace size
 * quirk. A key is a keycap: a hairline border, a heavier one below, the shared `--vera-border` and `--vera-radius`
 * tokens, and colors mixed from `currentColor` without them, so a dark page needs no extra rule; forced colors replace
 * all of it with the system's. Zero specificity, so a page's own rule wins (one rule gives mono keycaps back).
 *
 * The borders alone have a floor, 1px and 2px: an engine rounds a border to whole device pixels, so at body size
 * .0625em and .125em both drew 1px and the keycap lost its depth (a browser row). Longhands, not the `border`
 * shorthand: a shorthand holding `var()` leaves its longhands unreadable until substitution, so the parsed rule could
 * not be checked.
 *
 * A key is an INLINE box, never an inline-block: an inline box's padding and border take no part in the height of the
 * line it sits in, so a key in running text never pushes its line apart, whatever the paragraph's line height (a browser
 * row: a paragraph holding a key is as tall as one holding plain text). The price is `min-inline-size`, which an inline
 * box ignores; the inline padding keeps a one-character key from looking pinched. The other price, accepted: the
 * border and block padding still PAINT past the line box. Measured at a 16px body on Chromium, Firefox and WebKit: the
 * keycap paints 19.3px against an 18px `line-height: normal` line, 1.7 to 2.2px into the line below; at
 * `line-height: 1`, 2.7 to 3.2px; at a paragraph's usual 1.5, none (a 24px line). Going back to inline-block
 * trades that paint for a taller line, which is worse in running text. The combo is `nowrap`, so a shortcut moves to the
 * next line whole and no keycap is sliced across two (a browser row).
 */
const LOOK =
  `${own('combo')}{font-family:inherit;font-size:1em;white-space:nowrap}` +
  `${own('key')}{display:inline;padding:.05em .4em;` +
  'font-family:inherit;font-size:.85em;color:inherit;' +
  'border-style:solid;border-width:max(.0625em,1px);border-block-end-width:max(.125em,2px);' +
  'border-color:var(--vera-border,color-mix(in srgb,currentColor 30%,transparent));' +
  'border-radius:var(--vera-radius,.25em);background:color-mix(in srgb,currentColor 6%,transparent)}' +
  `${own('combo')} ${own('key')}{margin-inline:.1em}`;

const PLATFORMS: readonly string[] = ['apple', 'windows', 'other'];

/** What a server renders, which never needs the words rule: Win where `platform="windows"` asks for it, else words. */
const serverSpelling = (given: string | null): Platform => (given === 'windows' ? 'windows' : 'other');

/**
 * The spelling to render: the server's while serving or hydrating, else the `platform` attribute when it names one,
 * else the reader's (read per render, no cache).
 */
const chosen = (host: KbdHost, hydrating: boolean): Platform => {
  const given = host.platform;
  if (hydrating || isServer()) return serverSpelling(given);
  return given !== null && PLATFORMS.includes(given) ? (given as Platform) : platformOf(host.ownerDocument.defaultView?.navigator ?? {});
};

/**
 * The setup: adopts the words rule into the element's root and renders the keys.
 *
 * - The adoption is a layout effect, not a setup statement: a component moved into another document keeps its setup
 *   and re-runs its effects (core's move rule), and one returning to the page runs every hook once, so the rule
 *   follows the element into each root it renders in, before that render paints.
 * - **Over server markup** (children present at setup), the first render spells as the server did, so hydration
 *   matches with no DOM change and no mismatch warning; a layout effect then switches to the reader's spelling, one
 *   re-render. Rendering the reader's spelling first measured a hydration mismatch and a discarded server render.
 * - **The combo is `dir="ltr"`**: a shortcut is keycaps in a fixed order, read left to right on the web whatever the
 *   page's direction. Apple's modifier symbols are bidi neutrals, so in a right-to-left sentence they took the
 *   sentence's direction and ⇧⌘K showed reversed (a browser row). An element with `dir` is also a bidi isolate in
 *   every engine's own stylesheet, so the sentence around it keeps flowing right to left, and this holds with no look,
 *   on the server, and before script.
 */
export const setup = (host: KbdHost) => {
  const hydrating = signal(!isServer() && host.firstChild !== null);
  effect(() => adoptOwnSheet(host, SHEET, WORDS + LOOK), { timing: 'layout' });
  if (hydrating.value) effect(() => void (hydrating.value = false), { timing: 'layout' });
  return () => {
    const keys = host.keys ?? '';
    if (__DEV__) {
      if (keys.trim() === '') console.warn(diagnostic('kbd', '<vera-kbd>', 'kbd-no-keys', __DEV__ && PROSE['kbd-no-keys']()));
      const given = host.platform;
      if (given !== null && !PLATFORMS.includes(given))
        console.warn(diagnostic('kbd', '<vera-kbd>', 'kbd-unknown-platform', __DEV__ && PROSE['kbd-unknown-platform'](quoted(given))));
    }
    const platform = chosen(host, hydrating.value);
    const spelled = spellKeys(keys, platform);
    const joined = platform !== 'apple';
    return html`<kbd data-vera-part="combo" data-vera-kbd dir="ltr">${spelled.map((key, index) => [
      joined && index > 0 ? '+' : '',
      key.word === null
        ? html`<kbd data-vera-part="key" data-vera-kbd>${key.text}</kbd>`
        : html`<kbd data-vera-part="key" data-vera-kbd data-vera-word=${key.word}><span aria-hidden="true">${key.text}</span></kbd>`,
    ])}</kbd>`;
  };
};
