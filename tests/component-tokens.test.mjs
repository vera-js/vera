/**
 * **Every component's look reads the shared tokens, with the shared defaults** (Brian, 2026-11-25: "super modern, sleek,
 * elegant... completely customizable"; the contract is `packages/shared-utils/src/tokens.ts`). Read from each
 * component's source, comments stripped:
 *
 * - every `--vera-*` name is one of the shared thirteen, a component's own (`--vera-<component>-…`), or private
 *   (`--_vera-…`): a thirteenth token is a contract change, made in tokens.ts first;
 * - every read of a shared token through a literal `var(--vera-<name>, <default>)` carries exactly tokens.ts's default
 *   (the simplest way to hold that is to write the constant: `${ACCENT}`), so two components can never disagree on
 *   what an unset accent looks like, or a mix of `currentColor` alone, for a part that follows its text's color;
 * - no raw color (hex, rgb()/hsl()/oklch()/oklab()/color(), a color name) outside a token's default, shared or the
 *   component's own (`var(--vera-dialog-backdrop, rgb(0 0 0/.45))`): a theme value is a token. System colors (Canvas,
 *   CanvasText, Highlight…) are forced colors' own and pass;
 * - its surface's `tokens` lists exactly the custom properties its look reads (the shared constants it imports, and
 *   any name it writes), so the manifest tells an app every name it can set.
 *
 * A component not yet moved onto the tokens is listed in NOT_YET, by name, and skipped; a listed component that already
 * passes is refused, so the list only shrinks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withoutComments } from './source-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOKENS_SOURCE = join(ROOT, 'packages/shared-utils/src/tokens.ts');

/** The shared tokens, read from tokens.ts's own constants: name → its full `var(--vera-name,default)` text. */
export const sharedTokens = (text) => {
  const tokens = new Map();
  for (const [, value] of text.matchAll(/export const [A-Z_]+ = (?:'([^']*)'|`[^`]*`);/g)) if (value) tokens.set(/^var\(--vera-([a-z-]+),/.exec(value)[1], value);
  /** FOCUS is a template (it embeds ACCENT): its name only; its default is the accent's, checked through ACCENT. */
  for (const [, name] of text.matchAll(/export const [A-Z_]+ = `var\(--vera-([a-z-]+),/g)) tokens.set(name, null);
  return tokens;
};

/** Each `var(--vera-<name>,<fallback>)` in `text`, with its whole text, parentheses balanced. */
export const tokenReads = (text) => {
  const reads = [];
  for (const match of text.matchAll(/var\(\s*--vera-([a-z][a-z0-9-]*)\s*,/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    reads.push({ name: match[1], whole: text.slice(match.index, end + 1).replace(/\s+/g, ' ').replace(/,\s/g, ',') });
  }
  return reads;
};

const RAW_COLOR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(|\b(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|cyan|magenta|silver|maroon|navy|teal|olive|aqua|fuchsia|lime)\b(?=\s*[;)\s!,])/;

/**
 * The one other default a shared token may have: a mix of `currentColor` (kbd's key border, spinner's track), so the
 * part follows ANY text it sits in (a key in a red error, a spinner on an accent button), which two schemes cannot. An
 * app's token still wins; only the default differs. Nothing but `currentColor` and `transparent` may be mixed.
 */
const FOLLOWS_TEXT = /^var\(--vera-[a-z-]+,color-mix\(in [a-z]+,currentColor [0-9.]+%,transparent\)\)$/i;

/** What a component's sources break, as readable lines (empty: it is on the tokens). */
export const breaches = (component, files, tokens) => {
  const out = [];
  for (const [file, raw] of files) {
    /** Each shared default is removed before the raw-color scan, so only colors outside them remain. */
    let rest = raw;
    for (const name of new Set([...raw.matchAll(/--vera-([a-z][a-z0-9-]*)/g)].map((m) => m[1]))) {
      if (!tokens.has(name) && !name.startsWith(`${component}-`)) out.push(`${file}: --vera-${name} is not a shared token nor ${component}'s own`);
    }
    for (const read of tokenReads(raw)) {
      const shared = tokens.get(read.name);
      if (shared === undefined) {
        /** A component's own token: its default may be a raw color (it is still a token), so it leaves the scan. */
        if (read.name.startsWith(`${component}-`)) rest = rest.split(read.whole).join('');
        continue;
      }
      if (shared !== null && read.whole !== shared && !FOLLOWS_TEXT.test(read.whole))
        out.push(`${file}: ${read.whole} is not the shared ${shared}`);
      rest = rest.split(read.whole).join('');
    }
    for (const value of tokens.values()) if (value !== null) rest = rest.split(value).join('');
    const color = RAW_COLOR.exec(rest);
    if (color) out.push(`${file}: a raw color ${JSON.stringify(color[0])} outside a shared token`);
  }
  return out;
};

/** Each token constant's name in tokens.ts (`ACCENT`) → its custom property (`--vera-accent`). */
const constants = new Map(
  [...readFileSync(TOKENS_SOURCE, 'utf8').matchAll(/export const ([A-Z_]+) = ['`]var\(--vera-([a-z-]+),/g)].map(([, constant, name]) => [constant, `--vera-${name}`]),
);
/** The custom properties a component's look reads: the token constants it imports from shared-utils, and every name it writes. */
export const readNames = (files) => {
  const names = new Set();
  for (const [, text] of files) {
    for (const [, list] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@verajs\/shared-utils'/g))
      for (const item of list.split(',').map((s) => s.trim())) if (constants.has(item)) names.add(constants.get(item));
    for (const [name] of text.matchAll(/--vera-[a-z][a-z0-9-]*/g)) names.add(name);
  }
  return [...names].sort();
};

/** Components whose look has not moved onto the tokens yet (W106/W108). A name leaves this list in its look's commit. */
const NOT_YET = [];

/** Each component's look sources: every .ts under src except its demo and surface (data) and diagnostics (prose). */
const lookFiles = (name) => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !['demo.ts', 'surface.ts', 'diagnostics.ts'].includes(entry.name))
        files.push([path.slice(ROOT.length).replaceAll('\\', '/'), withoutComments(readFileSync(path, 'utf8'), entry.name)]);
    }
  };
  walk(join(ROOT, 'packages/components', name, 'src'));
  return files;
};

const components = readdirSync(join(ROOT, 'packages/components')).filter((name) => existsSync(join(ROOT, 'packages/components', name, 'src')));
const tokens = sharedTokens(readFileSync(TOKENS_SOURCE, 'utf8'));

test('CONTROL: the shared tokens are read from tokens.ts, all thirteen', () => {
  assert.deepEqual([...tokens.keys()].sort(), ['accent', 'accent-fg', 'bg', 'border', 'border-control', 'danger', 'fg', 'fg-muted', 'focus', 'hover', 'radius', 'shadow', 'surface']);
  assert.ok(components.length >= 9, `CONTROL: ${components.length} components`);
});

test('CONTROL: every component has look sources, and the moved ones read the tokens (the scan reads the right files)', () => {
  for (const name of components) assert.ok(lookFiles(name).length >= 1, `${name}: no look sources found under src`);
  const reads = components.filter((name) => !NOT_YET.includes(name)).reduce((sum, name) => sum + readNames(lookFiles(name)).length, 0);
  assert.ok(reads >= 20, `only ${reads} token reads across the moved components: the scan is reading the wrong files`);
  assert.ok(lookFiles('select').length >= 4, `select: ${lookFiles('select').length} look sources (it has four or more)`);
});

test('CONTROL: breaches() names a wrong default, an unknown token, and a raw color; passes a shared read and an own token', () => {
  const accent = tokens.get('accent');
  const files = [
    ['a.ts', `x{color:var(--vera-accent,#7c3aed)}`],
    ['b.ts', `x{color:var(--vera-brand,red)}`],
    ['c.ts', `x{color:#123456}`],
    ['d.ts', `x{color:${accent};inline-size:var(--vera-demo-size,1em);outline-color:Highlight;background:var(--vera-demo-scrim,rgb(0 0 0/.4))}`],
    ['e.ts', 'x{border-color:var(--vera-border, color-mix(in srgb, currentColor 30%, transparent))}'],
    ['f.ts', 'x{border-color:var(--vera-border,color-mix(in srgb,currentColor 30%,#fff))}'],
  ];
  assert.deepEqual(breaches('demo', files, tokens), [
    `a.ts: var(--vera-accent,#7c3aed) is not the shared ${accent}`,
    'b.ts: --vera-brand is not a shared token nor demo\'s own',
    'b.ts: a raw color "red" outside a shared token',
    'c.ts: a raw color "#123456" outside a shared token',
    `f.ts: var(--vera-border,color-mix(in srgb,currentColor 30%,#fff)) is not the shared ${tokens.get('border')}`,
  ]);
});

for (const name of components)
  test(`${name}: its look reads the shared tokens with the shared defaults, and no raw color`, async (t) => {
    const found = breaches(name, lookFiles(name), tokens);
    if (NOT_YET.includes(name)) {
      assert.notDeepEqual(found, [], `${name} is in NOT_YET but already on the tokens: take it off the list`);
      return t.skip(`not yet on the tokens (${found.length} to move)`);
    }
    assert.deepEqual(found, [], `${name}: move these onto packages/shared-utils/src/tokens.ts`);
    const src = join(ROOT, 'packages/components', name, 'src');
    const folder = readdirSync(src).find((entry) => existsSync(join(src, entry, 'surface.ts')));
    const surface = Object.values(await import(pathToFileURL(join(src, folder, 'surface.ts')).href))[0];
    assert.deepEqual([...surface.tokens].sort(), readNames(lookFiles(name)), `${name}: its surface's tokens list is not what its look reads`);
  });
