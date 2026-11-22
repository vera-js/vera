import type { ComponentDemo } from '@verajs/shared-types';

/**
 * **<vera-menu>'s states, as the preview page shows them** (`ComponentDemo`: the page is generated from this, and
 * `tests/component-demos.test.mjs` holds it to the surface, so an attribute or part added to the element is shown here
 * in the same change).
 */
export const menuDemo = {
  ask: 'Judge the menu open under its trigger: spacing, the focused item, a shown shortcut, a checked item, a separator, a disabled item. Try the keys (arrows, typing, Escape, Tab) and a right click in the context area.',
  states: [
    {
      title: 'Action menu',
      note: 'A shortcut, a link, a separator, a checkbox item, a radio group and an aria-disabled item.',
      markup:
        '<vera-menu><button slot="trigger">Actions</button><div slot="menu"><button value="rename">Rename <kbd>F2</kbd></button><button value="copy">Copy <kbd>Ctrl+C</kbd></button><a href="#export">Export…</a><hr>' +
        '<button role="menuitemcheckbox" aria-checked="true" value="wrap">Word wrap</button>' +
        '<div role="group" aria-label="Sort"><button role="menuitemradio" aria-checked="true" value="name">Sort by name</button><button role="menuitemradio" aria-checked="false" value="date">Sort by date</button></div><hr>' +
        '<button value="delete" aria-disabled="true">Delete</button></div></vera-menu>',
    },
    {
      title: 'Context menu',
      note: 'Right click the area, or focus it and press Shift+F10.',
      markup:
        '<vera-menu opener="context"><div slot="target" tabindex="0" style="padding:24px;border:1px dashed currentColor">Right click here</div><div slot="menu" aria-label="Area actions"><button value="cut">Cut</button><button value="copy">Copy</button><button value="paste">Paste</button></div></vera-menu>',
    },
    {
      title: 'Unstyled',
      note: 'data-vera-look="none": the placement stays, the look goes.',
      markup: '<vera-menu data-vera-look="none"><button slot="trigger">Plain</button><div slot="menu"><button>One</button><button>Two</button></div></vera-menu>',
    },
  ],
} as const satisfies ComponentDemo;
