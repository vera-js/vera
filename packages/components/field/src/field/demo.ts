import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-field>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface). The hint, error and count parts are the author's own
 * markup, which the field wires; the check reads the rendered DOM, so they count.
 */
export const fieldDemo = {
  ask: "Label, hint and errors around your own control. An error appears only after you've tried (submit, or leave the field), never on first sight. Try leaving the email empty, then typing a bad address.",
  states: [
    {
      title: 'Required email, with a hint and its errors',
      markup:
        '<form novalidate><vera-field><label>Work email</label><input type="email" required autocomplete="email"><small data-vera-part="hint">We\'ll send the invite here.</small><small data-vera-part="error" data-when="valueMissing">Enter your email.</small><small data-vera-part="error" data-when="typeMismatch">That isn\'t an email address.</small></vera-field><button type="submit">Send invite</button></form>',
    },
    {
      title: 'A character count, in your words',
      note: 'Spoken from 80% of the limit and at it: {left} in the plural form of the field\'s language',
      markup:
        '<vera-field count-message="{left} characters left" count-message-zero="No characters left" count-message-one="{left} character left" count-message-two="{left} characters left" count-message-few="{left} characters left" count-message-many="{left} characters left" count-message-other="{left} characters left" limit-message="That\'s the limit"><label>Bio</label><textarea maxlength="80"></textarea><small data-vera-part="count"></small></vera-field>',
    },
    {
      title: 'The control named, not first',
      note: 'data-vera-part="control" picks the control when it is not the first labelable element',
      markup: '<vera-field><label>Search</label><button type="button">Clear</button><input data-vera-part="control" type="search"></vera-field>',
    },
    {
      title: "The browser's own messages",
      note: "native-messages keeps the browser's own bubble on a failed submit; an empty error part shows the browser's message",
      markup: '<form novalidate><vera-field native-messages><label>Age</label><input type="number" min="18" required><small data-vera-part="error"></small></vera-field></form>',
    },
  ],
} as const satisfies ComponentDemo;
