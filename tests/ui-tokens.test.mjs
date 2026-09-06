/**
 * The ui README's theming claim, held mechanically: "every color, radius and focus value is a
 * semantic `--vera-*` custom property." A hard-coded `#3b82f6` added in a hurry satisfies every
 * behavioral suite and silently breaks every themed app, so the pin is a source lint in the
 * diagnostics-convention style: no raw color literal may appear in a component stylesheet —
 * hex, rgb()/hsl()/oklch()/color(), or named colors. The neutral keywords are exempt because
 * they are structure, not theme: `transparent`, `inherit`, `currentcolor`, `none`, `0`. The one
 * deliberate raw metric — the `999px` pill cap — is documented at its site and exempted by
 * shape (lengths are not colors; the claim's "radius value" is the themable token the trigger
 * takes, which var(--vera-radius) covers).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../packages/ui/src/', import.meta.url));
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
    else if (entry.name.endsWith('.ts')) files.push(`${dir}${entry.name}`);
  }
};
walk(root);

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color)\(|\b(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|cyan|magenta|silver|maroon|navy|teal|olive|aqua|fuchsia|lime)\b(?=\s*[;)\s!])/;

test('no raw color literal in any ui component stylesheet — theme values are tokens', () => {
  assert.ok(files.length >= 4, `CONTROL: expected the ui sources, found ${files.length} files`);
  const offenders = [];
  let tokenUses = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    tokenUses += (src.match(/var\(--vera-/g) ?? []).length;
    for (const [index, line] of src.split('\n').entries()) {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue; // comments may name colors freely
      /** A literal INSIDE a token's fallback — `var(--vera-fg, #18181b)` — is the claim working
       *  as designed: token first, sensible default when no theme is loaded. Strip those before
       *  scanning, so only a literal that BYPASSES the token system offends. */
      const bare = line.replace(/var\(--vera-[^()]*(?:\([^()]*\))?[^()]*\)/g, 'var()');
      if (RAW_COLOR.test(bare)) offenders.push(`${file.slice(root.length)}:${index + 1}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.ok(tokenUses >= 20, `CONTROL: only ${tokenUses} token uses found — the lint is reading the wrong files`);
  assert.deepEqual(offenders, [], 'raw color literals in component styles — theme through --vera-* tokens instead');
});
