/**
 * **What a race page's machine checks DECIDE, from `ps` snapshots: pure functions over plain data** (2026-11-17, Brian
 * approved the policy). `race.mjs` keeps every side effect (running `ps`, launching and killing browsers) and
 * asks these; `tests/race-guards.test.mjs` drives them with synthetic snapshots, so every rule has a control that can
 * fail. Imports nothing, so the test needs no bench dependency.
 *
 * The policy:
 * - **Our own processes are never load:** this race's process tree, and every browser PID it ever launched (kept after
 *   the kill: `launched`). That exclusion rarely fires live — a SIGKILLed browser stays our child, a zombie, until node
 *   reaps it, and its helpers are not browser main binaries — but it CAN: a reparented helper still holding CPU on the
 *   sampling path, or a main process whose parent exited before reaping. Keep it (the unit rows prove it).
 * - **A browser this race did not launch refuses the race** (its main binary, by app path; a stray Playwright browser too).
 * - **OS daemons are ignored, never waited on** (Brian, 2026-10-17/18): by BINARY PATH — anything under `/System/`,
 *   `/usr/libexec/`, `/usr/sbin/` or `/sbin/` — not by a name list, which kept missing new ones (dasd,
 *   osanalyticshelper, SafariPlatformSupport, launchd). Each daemon burst over 10% of a core is LOGGED per page, never
 *   voiding: a later two-mode reading can be checked against them without a rerun.
 * - **An app is load when SUSTAINED:** over 10% of a core in two consecutive samples (one blip does not re-run a page).
 *   VS Code counts (Brian, 2026-11-05), and so do `node` outside our tree and any assistant process (formerly exempt by name).
 * - **A machine-wide ceiling, whoever causes it:** everything outside our tree, daemons included, above one full core
 *   (100%) in two consecutive samples.
 */

/** One `ps -Ao pid=,ppid=,pcpu=,comm=` line per process: [pid, ppid, pcpu, comm]. */
export const parsePs = (text) =>
  String(text).trim().split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), m[4]]);

/** The PIDs under `roots` (roots included) in one snapshot. */
export const treeOf = (rows, roots) => {
  const tree = new Set(roots);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of rows) if (!tree.has(pid) && tree.has(ppid)) { tree.add(pid); grew = true; }
  }
  return tree;
};

/** A browser's MAIN binary, by app path, or a Playwright browser (a stray from a killed run). Helpers never match. */
export const FOREIGN_BROWSER = /\/Applications\/[^/]+\.app\/Contents\/MacOS\/(Google Chrome|Google Chrome for Testing|Chromium|firefox|Safari|Microsoft Edge|Brave Browser|Arc)$|ms-playwright\/[^/]+\/.*\/(Chromium|Google Chrome for Testing|chrome-headless-shell|headless_shell|firefox|pw_run\.sh)$/;
/** An OS daemon: its binary lives in the system's own folders. */
export const OS_DAEMON = /^\/(?:System|usr\/libexec|usr\/sbin|sbin)\//;
/**
 * Never load, whatever its path: `ps`, the instrument itself (it runs BECAUSE we sample, so counting it would measure the
 * sampler). Nothing else is exempt by name — not even an editor or assistant process beside the race (2026-11-17): one
 * that breaks the quiet-during-races rule must show in the log, not vanish from it.
 */
export const NEVER_LOAD = /(?:^|\/)ps$/;
/** Over this share of a core, a process is busy (apps: in two consecutive samples). */
export const BUSY = 10;
/** Over this total share of cores outside our tree, the machine is saturated (in two consecutive samples). */
export const CEILING = 100;

/**
 * One snapshot, split: what is outside this race (`others`), and which of OUR launched PIDs were seen outside our tree
 * (`ownLeftovers`, the exclusion firing). `self` is the race's own PID; `launched` every browser PID it ever started.
 */
/**
 * **A Playwright WebKit page's own processes are XPC services launchd parents** (2026-11-18): WebContent, Networking and
 * GPU run from the Playwright WebKit bundle's `.xpc` folders with PPID 1, so they are never in our tree, and every WebKit
 * page read as contended by its own page (`com.apple.WebKit.WebContent.Development` at ~45%, every page of a session:
 * the session voided). They are ours while a browser this race launched is alive; with none alive, one is a stray from
 * another run and counts like any app.
 */
export const PLAYWRIGHT_XPC = /ms-playwright\/webkit-[^/]+\/.+\.xpc\//;
export const outside = (rows, self, launched) => {
  const ours = treeOf(rows, [self]);
  if (rows.some(([pid]) => launched.has(pid) && ours.has(pid)))
    for (const [pid, , , comm] of rows) if (PLAYWRIGHT_XPC.test(comm)) ours.add(pid);
  const out = rows.filter(([pid]) => !ours.has(pid));
  return { others: out.filter(([pid]) => !launched.has(pid)), ownLeftovers: out.filter(([pid]) => launched.has(pid)) };
};

/** The foreign browsers in one snapshot's `others`, as `name (PID n)` for the refusal message. */
export const foreignBrowsers = (others) => others.filter(([, , , comm]) => FOREIGN_BROWSER.test(comm)).map(([pid, , , comm]) => `${comm.split('/').pop()} (PID ${pid})`);

/** The busy APPS in one snapshot's `others` (daemons and never-load excluded), as [pid, pcpu, comm]. */
/**
 * **The screen saver is the one /System process that is load** (2026-11-18): it lives under /System (ExtensionKit), so the
 * daemon rule would log it as a burst and never contend — yet its whole cost is throttling the headed browsers. A saver
 * that comes up MID-race (a caffeinate that died) must make the page contended, never vanish into the daemon log.
 */
export const SAVER = /(?:WallpaperAerialsExtension|ScreenSaverEngine|legacyScreenSaver)$/;
export const busyApps = (others) =>
  others.filter(([, , pcpu, comm]) => pcpu > BUSY && (SAVER.test(comm) || (!OS_DAEMON.test(comm) && !NEVER_LOAD.test(comm)))).map(([pid, , pcpu, comm]) => [pid, pcpu, comm]);

/**
 * **A page's verdict from its snapshots in order** (each already reduced to `others`): `contended` names the first
 * sustained cause or is null; `daemonBursts` lists every daemon over BUSY, logged, never a verdict.
 */
export const assess = (snapshots) => {
  let contended = null;
  const daemonBursts = [];
  for (let i = 0; i < snapshots.length; i++) {
    const others = snapshots[i];
    for (const [, , pcpu, comm] of others) if (pcpu > BUSY && OS_DAEMON.test(comm)) daemonBursts.push(`${comm.split('/').pop()} ${pcpu}%`);
    if (contended !== null || i === 0) continue;
    const before = snapshots[i - 1];
    const sustained = busyApps(others).find(([pid]) => busyApps(before).some(([p]) => p === pid));
    if (sustained) contended = `${sustained[1]}% ${sustained[2].split('/').pop()} (sustained)`;
    const total = (rows) => rows.reduce((sum, [, , pcpu, comm]) => sum + (NEVER_LOAD.test(comm) ? 0 : pcpu), 0);
    if (contended === null && total(others) > CEILING && total(before) > CEILING) contended = `${Math.round(total(others))}% outside the race (machine ceiling)`;
  }
  return { contended, daemonBursts };
};

/**
 * **The screen saver, and whether a race may start** (the decision `race.mjs` makes before any page; 2026-11-17).
 * The Aerials screen saver runs as `WallpaperAerialsExtension` with NO `ScreenSaverEngine` process, so it counts as up when
 * that extension holds over 1% of a core (BROWSER-LEDGER). Once up only real input dismisses it, and a machine idle past
 * the saver's threshold has it up, or its display asleep (where Aerials reads 0%) — unless a display-sleep assertion has
 * been held since BEFORE idle crossed the line, which kept the saver from ever coming up (an unattended series under one
 * caffeinate). An assertion taken after the line vouches for nothing.
 */
export const saverUp = (saverProcesses, rows) => [
  ...saverProcesses,
  ...rows.filter(([, , pcpu, comm]) => /WallpaperAerialsExtension$/.test(comm) && pcpu > 1).map(([, , pcpu]) => `WallpaperAerialsExtension ${pcpu}%`),
];
/**
 * The longest-held display-sleep assertion in `pmset -g assertions`, in seconds. The WHOLE line must match
 * (`pid N(name): [0x…] H:MM:SS PreventUserIdleDisplaySleep named`, hours past 24 counted on, as measured): a format this
 * does not know matches nothing and reads 0 — not vouched, so the race refuses, never the reverse.
 */
export const displayHeldFor = (pmsetText) => {
  let held = 0;
  for (const m of String(pmsetText).matchAll(/^\s+pid \d+\([^)\n]*\):\s+\[0x[0-9a-f]+\]\s+(\d+):([0-5]\d):([0-5]\d) PreventUserIdleDisplaySleep named/gm))
    held = Math.max(held, +m[1] * 3600 + +m[2] * 60 + +m[3]);
  return held;
};
/** Whether a race may start: `saver` (saverUp's list), `idle` and `threshold` (the saver's idleTime, 0 never) in seconds, `held` (displayHeldFor). */
export const startVerdict = ({ saver, idle, threshold, held }) => {
  if (saver.length) return { start: false, reason: `screen saver up (${saver.join(', ')})` };
  const pastLine = threshold > 0 && idle >= threshold - 30;
  if (!pastLine) return { start: true, reason: `idle ${Math.round(idle)} s (screen saver after ${threshold || 'never'} s)` };
  if (held >= idle - (threshold - 30)) return { start: true, reason: `idle ${Math.round(idle)} s, past the saver's line, but a display assertion held ${held} s, from before it, vouches` };
  return { start: false, reason: `screen saver due: idle ${Math.round(idle)} s, saver after ${threshold} s, a display assertion held ${held} s, not since before the line` };
};
