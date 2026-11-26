/**
 * **Every component tag is typed by importing its package.** A package's `.` entry registers its tags, and its built
 * declaration (`exports['.'].types`) merges exactly those tags into `HTMLElementTagNameMap`, so
 * `document.createElement('vera-select')`, `querySelector` and a TSX element's handlers get the element's own type.
 * The tags compared are the registered ones, recorded in jsdom while the built `.` bundle runs, and they must equal
 * the tags the package's surfaces declare: a tag registered without a surface, or declared without a registration,
 * is red here too. `tests/consumer/tsxcheck.tsx` is what proves the merged types are usable; this proves none is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentsDir = join(root, 'packages', 'components');
const packages = readdirSync(componentsDir).filter((name) => existsSync(join(componentsDir, name, 'src', 'register.ts')));

/** Every `tag: 'vera-…'` a package's surfaces declare. */
const surfaceTags = (name) => {
  const tags = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name === 'surface.ts')
        for (const match of readFileSync(join(dir, entry.name), 'utf8').matchAll(/^\s*tag:\s*['"](vera-[a-z-]+)['"]/gm)) tags.push(match[1]);
    }
  };
  walk(join(componentsDir, name, 'src'));
  return tags.sort();
};

/** The keys of every `HTMLElementTagNameMap` block in a declaration file. */
const mappedTags = (file) =>
  [...readFileSync(file, 'utf8').matchAll(/interface HTMLElementTagNameMap\s*\{([^}]*)\}/g)]
    .flatMap((block) => [...block[1].matchAll(/['"](vera-[a-z-]+)['"]\s*:/g)].map((key) => key[1]))
    .sort();

const typesOf = (name, entry) => join(componentsDir, name, JSON.parse(readFileSync(join(componentsDir, name, 'package.json'), 'utf8')).exports[entry].types);

/**
 * The tags the built `.` development bundle registers, recorded by wrapping `customElements.define` before it runs.
 * One child process for all packages: jsdom is installed by `--import` before the first module evaluates.
 */
const registered = () => {
  const urls = packages.map((name) => pathToFileURL(join(componentsDir, name, JSON.parse(readFileSync(join(componentsDir, name, 'package.json'), 'utf8')).exports['.'].development)).href);
  const script = `
    const seen = {};
    const define = customElements.define.bind(customElements);
    let current = '';
    customElements.define = (tag, ctor, options) => { (seen[current] ??= []).push(tag); return define(tag, ctor, options); };
    const urls = ${JSON.stringify(urls)}; const names = ${JSON.stringify(packages)};
    for (let i = 0; i < urls.length; i++) { current = names[i]; await import(urls[i]); }
    process.stdout.write(JSON.stringify(seen));`;
  const out = execFileSync(process.execPath, ['--import', pathToFileURL(join(root, 'tests', 'dom-globals.mjs')).href, '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60_000 });
  return JSON.parse(out);
};

test('the corpus is the component packages, and the reader finds a tag map where one is and none where none is', () => {
  assert.ok(packages.length >= 10, `at least 10 component packages with a register entry; found ${packages.length}`);
  assert.deepEqual(mappedTags(typesOf('checkbox', './element')), [], 'CONTROL: the ./element entry registers nothing, so its declaration maps no tag');
  assert.ok(mappedTags(typesOf('select', '.')).includes('vera-select'), 'CONTROL: the reader finds vera-select in select\'s . declaration');
});

test("each package's . declaration maps exactly the tags its . bundle registers, and those are exactly its surfaces' tags", () => {
  const seen = registered();
  let total = 0;
  for (const name of packages) {
    const live = (seen[name] ?? []).filter((tag) => tag.startsWith('vera-')).sort();
    total += live.length;
    assert.deepEqual(live, surfaceTags(name), `${name}: the tags its . bundle registers [${live}] are the tags its surfaces declare`);
    assert.deepEqual(mappedTags(typesOf(name, '.')), live, `${name}: its . declaration merges into HTMLElementTagNameMap exactly the tags it registers [${live}]; add the missing ones to src/register.ts`);
  }
  assert.ok(total > packages.length, `more tags than packages (checkbox registers two); found ${total}`);
});
