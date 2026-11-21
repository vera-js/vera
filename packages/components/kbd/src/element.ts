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

/** The root's key for kbd's one rule (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
const SHEET = '_$veraKbdWords$';

/**
 * A symbol key's word, spoken from the alt text of empty generated content (`content: "" / …`): never shown, never
 * copied. The trailing space keeps the words apart ("Shift Command K", not "ShiftCommandK", measured). Zero specificity,
 * so a page's own rule wins.
 */
const WORDS = ':where(vera-kbd [data-vera-word])::before{content:"" / attr(data-vera-word) " "}';

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
 */
export const setup = (host: KbdHost) => {
  const hydrating = signal(!isServer() && host.firstChild !== null);
  effect(() => adoptOwnSheet(host, SHEET, WORDS), { timing: 'layout' });
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
    return html`<kbd data-vera-part="combo">${spelled.map((key, index) => [
      joined && index > 0 ? '+' : '',
      key.word === null
        ? html`<kbd data-vera-part="key">${key.text}</kbd>`
        : html`<kbd data-vera-part="key" data-vera-word=${key.word}><span aria-hidden="true">${key.text}</span></kbd>`,
    ])}</kbd>`;
  };
};
