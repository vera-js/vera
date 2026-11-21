/**
 * **How a shortcut is spelled on a platform: pure, so the element, a `title`, a toast or a command palette's own row all
 * spell it the same way.** `keys` is `+`-separated names (`Mod+Shift+K`); the result is the keys in display order, each
 * with the text shown and, when that text is a symbol, the word assistive technology should hear instead.
 *
 * Modifiers come first in one fixed order, whatever order they were written in: Control, Option (Alt), Shift, Command
 * (Meta). That is Apple's order (⌃⌥⇧⌘, as in ⇧⌘Z) and the conventional order elsewhere (Ctrl+Alt+Shift+Win), so one
 * list serves both. Other keys keep the order written.
 */

/** Which spelling: Apple's symbols, Windows' words, or everyone else's words. */
export type Platform = 'apple' | 'windows' | 'other';

/** One key as shown: its visible text, and the word to speak when that text is a symbol (`null` when it is a word). */
export type SpelledKey = { readonly text: string; readonly word: string | null };

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

/** The display order of the modifiers, on every platform. */
const ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

/** What an author may write for each modifier, lower-cased. `mod` is resolved per platform before this is read. */
const MODIFIERS: Readonly<Record<string, Modifier>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/** Each modifier on Apple: its symbol and its word. */
const APPLE_MODIFIER: Readonly<Record<Modifier, SpelledKey>> = {
  ctrl: { text: '⌃', word: 'Control' },
  alt: { text: '⌥', word: 'Option' },
  shift: { text: '⇧', word: 'Shift' },
  meta: { text: '⌘', word: 'Command' },
};

/** Each modifier elsewhere, as a word. Meta is the Windows key on Windows; elsewhere its neutral name. */
const WORD_MODIFIER = (modifier: Modifier, platform: Platform): SpelledKey => ({
  text: modifier === 'ctrl' ? 'Ctrl' : modifier === 'alt' ? 'Alt' : modifier === 'shift' ? 'Shift' : platform === 'windows' ? 'Win' : 'Meta',
  word: null,
});

/** Named keys, lower-cased, as `[apple, elsewhere]`. A symbol carries its word; a word carries `null`. */
const NAMED: Readonly<Record<string, readonly [SpelledKey, SpelledKey]>> = {
  enter: [{ text: '↩', word: 'Return' }, { text: 'Enter', word: null }],
  return: [{ text: '↩', word: 'Return' }, { text: 'Enter', word: null }],
  escape: [{ text: 'Esc', word: null }, { text: 'Esc', word: null }],
  esc: [{ text: 'Esc', word: null }, { text: 'Esc', word: null }],
  tab: [{ text: '⇥', word: 'Tab' }, { text: 'Tab', word: null }],
  space: [{ text: 'Space', word: null }, { text: 'Space', word: null }],
  backspace: [{ text: '⌫', word: 'Delete' }, { text: 'Backspace', word: null }],
  delete: [{ text: '⌦', word: 'Forward Delete' }, { text: 'Delete', word: null }],
  arrowup: [{ text: '↑', word: 'Up Arrow' }, { text: '↑', word: 'Up Arrow' }],
  arrowdown: [{ text: '↓', word: 'Down Arrow' }, { text: '↓', word: 'Down Arrow' }],
  arrowleft: [{ text: '←', word: 'Left Arrow' }, { text: '←', word: 'Left Arrow' }],
  arrowright: [{ text: '→', word: 'Right Arrow' }, { text: '→', word: 'Right Arrow' }],
  home: [{ text: 'Home', word: null }, { text: 'Home', word: null }],
  end: [{ text: 'End', word: null }, { text: 'End', word: null }],
  pageup: [{ text: 'Page Up', word: null }, { text: 'Page Up', word: null }],
  pagedown: [{ text: 'Page Down', word: null }, { text: 'Page Down', word: null }],
  plus: [{ text: '+', word: 'Plus' }, { text: '+', word: 'Plus' }],
};

/** The function keys, one to twenty-four, printed with a capital letter whatever case was written. */
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/i;

/** A key that is none of the above: a single character shows as its capital (a keycap), anything longer as written. */
const plain = (name: string): SpelledKey => ({ text: name.length === 1 ? name.toUpperCase() : name, word: null });

/**
 * Spells `keys` for `platform`. Empty names (from `++` or a trailing `+`) are skipped, a modifier written twice (or
 * `Mod` beside the key it stands for) is shown once, and every name becomes text: nothing here is ever markup.
 *
 * @param keys `+`-separated key names, case-insensitive (`Mod+Shift+K`, `Cmd+Plus`)
 * @param platform The spelling to use
 * @returns The keys in display order
 */
export const spellKeys = (keys: string, platform: Platform): readonly SpelledKey[] => {
  const modifiers = new Set<Modifier>();
  const rest: SpelledKey[] = [];
  for (const raw of keys.split('+')) {
    const name = raw.trim();
    if (name === '') continue;
    const lower = name.toLowerCase();
    const modifier = lower === 'mod' ? (platform === 'apple' ? 'meta' : 'ctrl') : MODIFIERS[lower];
    if (modifier !== undefined) {
      modifiers.add(modifier);
      continue;
    }
    const named = NAMED[lower];
    if (named !== undefined) rest.push(named[platform === 'apple' ? 0 : 1]);
    else if (FUNCTION_KEY.test(name)) rest.push({ text: name.toUpperCase(), word: null });
    else rest.push(plain(name));
  }
  const ordered = ORDER.filter((modifier) => modifiers.has(modifier)).map((modifier) =>
    platform === 'apple' ? APPLE_MODIFIER[modifier] : WORD_MODIFIER(modifier, platform),
  );
  return [...ordered, ...rest];
};

/**
 * The reader's platform, from what the browser reports: `userAgentData.platform` where it exists (Chromium), else the
 * deprecated but universally present `navigator.platform`. iOS and iPadOS count as Apple (an iPad's keyboard has ⌘).
 *
 * @param nav The navigator to read (the element passes its window's)
 * @returns The platform whose spelling to use
 */
export const platformOf = (nav: { readonly platform?: string; readonly userAgentData?: { readonly platform?: string } }): Platform => {
  const reported = nav.userAgentData?.platform || nav.platform || '';
  if (/^(mac|iphone|ipad|ipod|ios)/i.test(reported)) return 'apple';
  if (/^win/i.test(reported)) return 'windows';
  return 'other';
};
