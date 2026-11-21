/**
 * **<vera-kbd> inside a shadow component styled by `@verajs/styles`** (wired here): when that component writes its
 * root's list again (a theme switch through `applyStyles`), it keeps only the sheets marked light by the shared string
 * key, so kbd's own words rule must carry that mark or the symbols go silent until kbd next connects.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, define, flush } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { styles, css, applyStyles } from '../../packages/styles/dist/development/vera-styles.js';
import '../../packages/components/kbd/dist/development/vera-kbd.js';

wire([renderer, styles]);

define({ tag: 'x-kbd-shell', shadow: 'open', styles: css`i { color: rgb(0, 0, 200); }` }, () => () => html`<i>s</i><vera-kbd keys="Mod+K" platform="apple"></vera-kbd>`);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const spoken = (shell) => getComputedStyle(shell.shadowRoot.querySelector('vera-kbd [data-vera-word]'), '::before').content;

describe('vera-kbd: the words rule in a styled shell', () => {
  it("survives the shell writing its own list again (a theme switch through applyStyles)", async () => {
    const shell = document.createElement('x-kbd-shell');
    document.body.append(shell);
    flush();
    await frame();
    expect(spoken(shell), 'CONTROL: spoken after the first render').to.include('Command');
    expect(getComputedStyle(shell.shadowRoot.querySelector('i')).color, "CONTROL: the shell's own sheet applies").to.equal('rgb(0, 0, 200)');
    applyStyles([css`i { color: rgb(0, 0, 200); }`, css`i { font-weight: 700; }`], shell);
    await frame();
    expect(getComputedStyle(shell.shadowRoot.querySelector('i')).fontWeight, 'CONTROL: the shell rewrote its list').to.equal('700');
    expect(spoken(shell), "kbd's rule is kept when the shell replaces its own").to.include('Command');
    shell.remove();
  });
});
