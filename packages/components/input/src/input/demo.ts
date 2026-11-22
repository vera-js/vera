import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-input>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface). The prefix and suffix are the author's own markup; the
 * check reads the rendered DOM, so they count.
 */
export const inputDemo = {
  ask: "Unthemed on purpose: only the glyphs and the loading ring are ours; the input's own border is the browser's, and theming is by tokens. Try clearing (and undoing with Ctrl/Cmd+Z), revealing the password, and Escape on the search.",
  states: [
    { title: 'Search, clearable', note: 'Escape clears a search input', markup: '<label>Search <vera-input clearable clear-label="Clear search"><input type="search" name="q" value="vera"></vera-input></label>' },
    {
      title: 'With a prefix and a suffix',
      markup: '<label>Amount <vera-input><span data-vera-part="prefix">$</span><input name="amount" inputmode="decimal" value="12"><span data-vera-part="suffix">.00</span></vera-input></label>',
    },
    {
      title: 'Password, with reveal and a caps-lock hint',
      markup: '<label>Password <vera-input reveal reveal-label="Show password" caps-lock-hint caps-lock-message="Caps Lock is on"><input type="password" name="p" value="s3cret"></vera-input></label>',
    },
    { title: 'Loading', note: 'aria-busy on the input; nothing announced', markup: '<label>Email <vera-input loading><input type="email" name="e" value="a@b.c"></vera-input></label>' },
    {
      title: 'The default input',
      note: 'No input written: the element renders one from name, type, value, placeholder and autocomplete, read once',
      markup: '<label>Default input <vera-input name="d" type="email" value="hello@example.com" placeholder="rendered by the element" autocomplete="email" clearable></vera-input></label>',
    },
    {
      title: 'Sizes',
      note: 'scale: sm, md or lg; not yet styled',
      markup: '<label>Small <vera-input scale="sm"><input name="s"></vera-input></label> <label>Large <vera-input scale="lg"><input name="l"></vera-input></label>',
    },
    {
      title: 'Disabled by its fieldset',
      markup: '<fieldset disabled><legend>Off</legend><label>Disabled <vera-input clearable><input value="can\'t clear"></vera-input></label></fieldset>',
    },
  ],
} as const satisfies ComponentDemo;
