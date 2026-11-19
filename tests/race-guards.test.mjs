/**
 * **The race harness's machine checks, driven by synthetic `ps` snapshots** (`bench/dom/guards.mjs`; 2026-11-17, the
 * policy Brian approved). A live race cannot be made to show each case on demand — the own-leftover exclusion
 * never fired in four live runs — so every rule is a row here, and each row's message names the rule it pins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePs, treeOf, outside, foreignBrowsers, busyApps, assess, saverUp, displayHeldFor, startVerdict } from '../bench/dom/guards.mjs';

const SELF = 100;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HELPER = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/157/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)';
const SHELL = '/Users/u/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const CODE = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer)';
const DASD = '/usr/libexec/dasd';
const ANALYTICS = '/System/Library/CoreServices/osanalyticshelper';
/** A snapshot as `ps -Ao pid=,ppid=,pcpu=,comm=` prints it. */
const ps = (...rows) => rows.map(([pid, ppid, pcpu, comm]) => `${String(pid).padStart(6)} ${String(ppid).padStart(6)} ${pcpu.toFixed(1).padStart(5)} ${comm}`).join('\n');
const othersOf = (text, launched = new Set()) => outside(parsePs(text), SELF, launched).others;

test('a snapshot parses, and an empty one is not a pass (the floor)', () => {
  const rows = parsePs(ps([1, 0, 0.1, '/sbin/launchd'], [SELF, 1, 3, 'node'], [200, SELF, 40, CHROME]));
  assert.equal(rows.length, 3, 'the floor: three rows parsed, so the rows below examine something');
  assert.deepEqual(rows[2], [200, SELF, 40, CHROME]);
  assert.equal(parsePs('').length, 0, 'an empty snapshot parses to nothing, which the callers treat as nothing to judge');
});

test('the screen saver is load even though it lives under /System; any other /System daemon is not', () => {
  const SAVER_PATH = '/System/Library/ExtensionKit/Extensions/WallpaperAerialsExtension.appex/Contents/MacOS/WallpaperAerialsExtension';
  const rows = parsePs(ps([SELF, 1, 5, 'node'], [500, 1, 13, SAVER_PATH], [501, 1, 40, '/System/Library/CoreServices/mds']));
  const busy = busyApps(outside(rows, SELF, new Set()).others).map(([pid]) => pid);
  assert.deepEqual(busy, [500], 'the saver is busy; mds (CONTROL: a daemon at 40%) is not');
});

test("a WebKit page's own XPC services (launchd-parented) are ours while our browser lives; a stray one with none alive is load", () => {
  const XPC = '/Users/x/Library/Caches/ms-playwright/webkit-2336/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent.Development';
  const BROWSER = '/Users/x/Library/Caches/ms-playwright/webkit-2336/Playwright.app/Contents/MacOS/Playwright';
  const live = othersOf(ps([SELF, 1, 5, 'node'], [400, SELF, 1, BROWSER], [401, 1, 68, XPC]), new Set([400]));
  assert.deepEqual(live.map(([pid]) => pid), [], 'our page\'s WebContent is ours, not contention');
  const stray = othersOf(ps([SELF, 1, 5, 'node'], [401, 1, 68, XPC]), new Set([400]));
  assert.deepEqual(stray.map(([pid]) => pid), [401], 'CONTROL: with no browser of ours alive, a WebContent counts');
});

test("our own process tree is never load: the race's browser and its helpers are excluded by the tree", () => {
  const others = othersOf(ps([SELF, 1, 5, 'node'], [200, SELF, 90, CHROME], [201, 200, 80, HELPER], [300, 1, 1, CHROME]));
  assert.deepEqual(others.map(([pid]) => pid), [300], 'only the browser outside our tree is left');
});

test('own-leftover exclusion: a browser this race LAUNCHED, reparented out of our tree, is excluded and reported — never refused', () => {
  const launched = new Set([200, 201]);
  const { others, ownLeftovers } = outside(parsePs(ps([SELF, 1, 5, 'node'], [200, 1, 30, CHROME], [201, 1, 60, HELPER])), SELF, launched);
  assert.deepEqual(ownLeftovers.map(([pid]) => pid), [200, 201], 'the exclusion fired, and says so');
  assert.deepEqual(foreignBrowsers(others), [], 'our own dying browser is not a foreign browser');
  assert.deepEqual(busyApps(others), [], 'nor load');
});

test('a browser NOT launched by this race is refused by name and PID — the installed Chrome and a stray Playwright shell; a helper alone is not a browser', () => {
  const others = othersOf(ps([SELF, 1, 5, 'node'], [400, 1, 2, CHROME], [401, 1, 1, SHELL], [402, 1, 50, HELPER]));
  assert.deepEqual(foreignBrowsers(others), ['Google Chrome (PID 400)', 'chrome-headless-shell (PID 401)']);
  assert.deepEqual(foreignBrowsers(othersOf(ps([500, 1, 9, HELPER]))), [], 'a reparented helper with no main binary is not refused');
});

test('OS daemons are not apps (by binary path); an app over 10% is — an assistant process too; only ps, the instrument, never is', () => {
  const others = othersOf(ps([600, 1, 89, DASD], [601, 1, 95, ANALYTICS], [602, 1, 31, CODE], [603, 1, 50, '/Users/u/.vscode/extensions/x/claude'], [604, 1, 40, '/bin/ps'], [605, 1, 9, '/usr/local/bin/node']));
  assert.deepEqual(busyApps(others).map(([pid]) => pid), [602, 603], 'VS Code and an assistant process count; dasd and osanalyticshelper are daemons; ps never; 9% is under the line');
});

test('an app is load only when SUSTAINED: one sample over 10% passes, two consecutive samples of the same process do not', () => {
  const blip = assess([othersOf(ps([700, 1, 1, CODE])), othersOf(ps([700, 1, 60, CODE])), othersOf(ps([700, 1, 2, CODE]))]);
  assert.equal(blip.contended, null, 'one blip does not re-run a page');
  const sustained = assess([othersOf(ps([700, 1, 1, CODE])), othersOf(ps([700, 1, 31, CODE])), othersOf(ps([700, 1, 25, CODE]))]);
  assert.match(String(sustained.contended), /^25% Code Helper \(Renderer\) \(sustained\)$/);
  const twoDifferent = assess([othersOf(ps([700, 1, 40, CODE], [701, 1, 1, CODE])), othersOf(ps([700, 1, 1, CODE], [701, 1, 40, CODE]))]);
  assert.equal(twoDifferent.contended, null, 'two different processes each once is not one sustained one');
});

test('the machine ceiling: over one full core outside the race in two consecutive samples is contended, whoever causes it (daemons included); one sample is not', () => {
  const daemons = (cpu) => othersOf(ps([800, 1, cpu / 2, DASD], [801, 1, cpu / 2, ANALYTICS]));
  assert.match(String(assess([daemons(140), daemons(130)]).contended), /% outside the race \(machine ceiling\)$/);
  assert.equal(assess([daemons(140), daemons(20)]).contended, null, 'one saturated sample is not sustained');
});

test('daemon bursts over 10% are LOGGED for the page, never a verdict', () => {
  const { contended, daemonBursts } = assess([othersOf(ps([600, 1, 89, DASD])), othersOf(ps([601, 1, 95, ANALYTICS]))]);
  assert.equal(contended, null, 'bursts alone never void a page');
  assert.deepEqual(daemonBursts, ['dasd 89%', 'osanalyticshelper 95%']);
});

test('treeOf follows the whole descent', () => {
  assert.deepEqual([...treeOf(parsePs(ps([2, 1, 0, 'a'], [3, 2, 0, 'b'], [4, 3, 0, 'c'], [5, 1, 0, 'd'])), [2])].sort(), [2, 3, 4]);
});

/** `pmset -g assertions` lines, as macOS prints them (the 24 h form measured 2026-11-17: hours count on past 24). */
const assertion = (held, type = 'PreventUserIdleDisplaySleep') => `   pid 71017(caffeinate): [0x000144620005a58f] ${held} ${type} named: "caffeinate command-line tool"  `;

test('displayHeldFor reads only display-sleep assertions, hours past 24 included; a format it does not know reads 0 (refuse, never vouch)', () => {
  assert.equal(displayHeldFor([assertion('00:43:52'), assertion('24:01:12', 'PreventUserIdleSystemSleep')].join('\n')), 2632, 'the display one only');
  assert.equal(displayHeldFor(assertion('24:01:12')), 86472, 'the measured past-24 h form');
  assert.equal(displayHeldFor(assertion('1 day 02:00:00')), 0, 'an unknown shape matches nothing');
});

test('saverUp: a saver process, or Aerials over 1% of a core; Aerials at 0% (idle, or the display asleep) is not up', () => {
  const AERIALS = '/System/Library/ExtensionKit/Extensions/WallpaperAerialsExtension.appex/Contents/MacOS/WallpaperAerialsExtension';
  assert.deepEqual(saverUp([], parsePs(ps([765, 1, 13.2, AERIALS]))), ['WallpaperAerialsExtension 13.2%']);
  assert.deepEqual(saverUp([], parsePs(ps([765, 1, 0, AERIALS]))), []);
  assert.deepEqual(saverUp(['412 ScreenSaverEngine'], []), ['412 ScreenSaverEngine']);
});

test('startVerdict: not past the line starts; past it, a display assertion held since BEFORE the line vouches and starts', () => {
  assert.equal(startVerdict({ saver: [], idle: 39, threshold: 600, held: 0 }).start, true, 'the user is active');
  assert.equal(startVerdict({ saver: [], idle: 900, threshold: 600, held: 2632 }).start, true, 'an unattended series under one caffeinate (the vouched row)');
  assert.equal(startVerdict({ saver: [], idle: 900, threshold: 0, held: 0 }).start, true, 'a machine with no screen saver');
});

test('startVerdict refuses: an assertion taken after the line, an unparsed one (0), and a saver up even when vouched', () => {
  const late = startVerdict({ saver: [], idle: 2445, threshold: 600, held: 3 });
  assert.equal(late.start, false, 'held 3 s at idle 2445 s: taken after the line');
  assert.match(late.reason, /not since before the line/);
  assert.equal(startVerdict({ saver: [], idle: 900, threshold: 600, held: displayHeldFor(assertion('1 day 02:00:00')) }).start, false, 'an unparsed pmset line never vouches');
  assert.equal(startVerdict({ saver: ['WallpaperAerialsExtension 13.2%'], idle: 900, threshold: 600, held: 9999 }).start, false, 'a saver already up refuses, vouched or not');
});
