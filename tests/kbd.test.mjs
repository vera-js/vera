/**
 * **<vera-kbd>'s spelling, pure** (`spellKeys`, `platformOf` from `@vera-components/kbd/element`): the modifiers in
 * one order on every platform, Apple's symbols with their words, aliases, `Plus`, the function keys, unknown keys as
 * written, and every name as text. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { spellKeys, platformOf } = await load('vera-components/kbd/element');
const text = (keys, platform) => spellKeys(keys, platform).map((key) => key.text);
const words = (keys, platform) => spellKeys(keys, platform).map((key) => key.word ?? key.text);

test('Mod is Command on Apple and Ctrl elsewhere, in Apple\'s order ⇧⌘', () => {
  assert.deepEqual(text('Mod+Shift+K', 'apple'), ['⇧', '⌘', 'K']);
  assert.deepEqual(text('Mod+Shift+K', 'windows'), ['Ctrl', 'Shift', 'K']);
  assert.deepEqual(text('Mod+Shift+K', 'other'), ['Ctrl', 'Shift', 'K']);
});

test('the modifiers are ordered Control, Option, Shift, Command whatever order they were written in; other keys keep theirs', () => {
  for (const platform of ['apple', 'windows', 'other'])
    assert.deepEqual(text('Shift+Mod+K', platform), text('Mod+Shift+K', platform), platform);
  assert.deepEqual(text('Meta+Shift+Alt+Ctrl+A', 'apple'), ['⌃', '⌥', '⇧', '⌘', 'A']);
  assert.deepEqual(text('Meta+Shift+Alt+Ctrl+A', 'windows'), ['Ctrl', 'Alt', 'Shift', 'Win', 'A']);
  assert.deepEqual(text('Ctrl+K+B', 'other'), ['Ctrl', 'K', 'B'], 'non-modifier keys in the order written');
});

test('each Apple symbol carries its word; a word carries none', () => {
  assert.deepEqual(words('Ctrl+Alt+Shift+Meta+Z', 'apple'), ['Control', 'Option', 'Shift', 'Command', 'Z']);
  assert.ok(spellKeys('Ctrl+Alt+Shift+K', 'other').every((key) => key.word === null), 'words elsewhere need no word');
});

test('Meta is Command on Apple, Win on Windows and Meta elsewhere', () => {
  assert.deepEqual(text('Meta+L', 'apple'), ['⌘', 'L']);
  assert.deepEqual(text('Meta+L', 'windows'), ['Win', 'L']);
  assert.deepEqual(text('Meta+L', 'other'), ['Meta', 'L']);
});

test('aliases: Cmd and Command are Meta, Option is Alt, Control is Ctrl, in any case', () => {
  assert.deepEqual(text('Cmd+K', 'apple'), ['⌘', 'K']);
  assert.deepEqual(text('command+k', 'windows'), ['Win', 'K']);
  assert.deepEqual(text('Option+Control+X', 'apple'), ['⌃', '⌥', 'X']);
  assert.deepEqual(text('OPTION+x', 'other'), ['Alt', 'X']);
});

test('a modifier written twice, or Mod beside the key it stands for, is shown once', () => {
  assert.deepEqual(text('Mod+Meta+K', 'apple'), ['⌘', 'K']);
  assert.deepEqual(text('Mod+Ctrl+K', 'other'), ['Ctrl', 'K']);
  assert.deepEqual(text('Shift+shift+K', 'apple'), ['⇧', 'K']);
});

test('named keys: Apple\'s symbols with their words, words elsewhere; arrows are symbols on both', () => {
  assert.deepEqual(words('Enter', 'apple'), ['Return']);
  assert.deepEqual(text('Enter', 'apple'), ['↩']);
  assert.deepEqual(text('Enter', 'other'), ['Enter']);
  assert.deepEqual(text('Backspace', 'apple'), ['⌫']);
  assert.deepEqual(text('Backspace', 'windows'), ['Backspace']);
  assert.deepEqual(text('Delete', 'apple'), ['⌦']);
  assert.deepEqual(text('Tab', 'apple'), ['⇥']);
  assert.deepEqual(text('Escape', 'apple'), ['Esc']);
  assert.deepEqual(text('esc', 'other'), ['Esc']);
  assert.deepEqual(text('ArrowUp+ArrowDown+ArrowLeft+ArrowRight', 'other'), ['↑', '↓', '←', '→']);
  assert.deepEqual(words('ArrowUp', 'other'), ['Up Arrow']);
  assert.deepEqual(text('PageUp+Home', 'apple'), ['Page Up', 'Home']);
});

test('Plus is the literal + key; a + itself only separates', () => {
  assert.deepEqual(text('Mod+Plus', 'other'), ['Ctrl', '+']);
  assert.deepEqual(words('Mod+Plus', 'apple'), ['Command', 'Plus']);
  assert.deepEqual(text('Mod++K', 'other'), ['Ctrl', 'K'], 'an empty name between two + is skipped');
  assert.deepEqual(text('Mod+K+', 'other'), ['Ctrl', 'K'], 'a trailing + adds nothing');
});

test('the function keys print with a capital, one to twenty-four; past that, as written', () => {
  assert.deepEqual(text('f5', 'apple'), ['F5']);
  assert.deepEqual(text('Shift+f12', 'other'), ['Shift', 'F12']);
  assert.deepEqual(text('F24', 'windows'), ['F24']);
  assert.deepEqual(text('f25', 'other'), ['f25'], 'not a function key: as written');
});

test('an unknown key shows as written; a single character as its capital', () => {
  assert.deepEqual(text('Mod+k', 'other'), ['Ctrl', 'K']);
  assert.deepEqual(text('Mod+/', 'apple'), ['⌘', '/']);
  assert.deepEqual(text('Mod+Insert', 'other'), ['Ctrl', 'Insert']);
  assert.deepEqual(text('', 'other'), [], 'empty keys spell nothing');
});

test('hostile strings stay text: spellKeys returns strings only, as written', () => {
  for (const name of ['<img src=x onerror=alert(1)>', '"><script>x</script>', '\u0000‮x'])
    assert.deepEqual(text(`Mod+${name}`, 'other'), ['Ctrl', name]);
});

test('platformOf: userAgentData first, then navigator.platform; iOS and iPadOS are Apple', () => {
  assert.equal(platformOf({ userAgentData: { platform: 'macOS' }, platform: 'Win32' }), 'apple', 'userAgentData wins');
  assert.equal(platformOf({ userAgentData: { platform: 'Windows' } }), 'windows');
  assert.equal(platformOf({ userAgentData: { platform: 'Linux' } }), 'other');
  assert.equal(platformOf({ userAgentData: { platform: '' }, platform: 'MacIntel' }), 'apple', 'an empty userAgentData falls back');
  for (const platform of ['MacIntel', 'iPhone', 'iPad', 'iPod touch']) assert.equal(platformOf({ platform }), 'apple', platform);
  assert.equal(platformOf({ platform: 'Win32' }), 'windows');
  for (const platform of ['Linux x86_64', 'Linux armv81', '']) assert.equal(platformOf({ platform }), 'other', JSON.stringify(platform));
  assert.equal(platformOf({}), 'other', 'nothing reported');
});
