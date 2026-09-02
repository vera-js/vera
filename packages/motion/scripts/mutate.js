/**
 * Mutation testing: does the suite actually catch a defect?
 *
 * Every gate in this repo answers "is it green". This asks the harder
 * question — plant a specific, plausible bug and see whether anything goes
 * red. A mutation that survives is a claim the tests do not really make.
 *
 * Deliberately hand-written mutations rather than a generic operator sweep:
 * each one is a bug someone could actually write, in a line that matters.
 *
 * Usage:
 *   npm run mutate                       every mutation, in parallel shards
 *   npm run mutate -- --group sequence   one concern
 *   npm run mutate -- --only "tween"     any name containing this
 *   npm run mutate -- --list             the concerns, and how many each holds
 *
 * **A filter that matches nothing fails.** It used to select zero mutations,
 * run none, print `0/0 mutations caught` and exit 0 — so a typo in `--only`
 * was indistinguishable from a clean run, in the one tool whose whole purpose
 * is catching checks that cannot fail.
 *
 * A **concern** is the part of a mutation's name before the colon, so the
 * groups are derived from the mutations themselves and there is no second list
 * to fall out of date (hand-held copies of live tables drift).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Threads inside this shard's own suite run, derived from how many shards there
 * are rather than set independently — the two are one decision, and splitting
 * them is how you end up running eight shards of eight threads on eight cores.
 *
 * One shard: hand the choice to the runner's default per-file concurrency. More
 * than one: pin to a single file at a time, so N shards use N cores instead of
 * N pools fighting for all of them.
 *
 * `MUTATE_TEST_WORKERS` overrides; `0` means the default concurrency.
 */
const shardCount = (() => {
  const flag = process.argv.indexOf('--shard');
  return flag === -1 ? 1 : Number(process.argv[flag + 1].split(':')[1]);
})();
const inner = process.env['MUTATE_TEST_WORKERS'] ?? (shardCount > 1 ? '1' : '0');
const TEST_CONCURRENCY = inner === '0' ? '' : ` --test-concurrency=${inner}`;

/**
 * A hard ceiling on one suite run, because `execSync` without one waits
 * forever and a mutation is *designed* to make the suite behave abnormally.
 *
 * Measured the hard way: a full sweep ran 293 of 335 mutations and then sat
 * for **nineteen hours** on shard 4, one `node --test` process wedged with
 * `--test-timeout=0` inherited from the runner. Seven shards had long since
 * written their results; nothing surfaced them, because the run only reports
 * when every shard returns. A wedged run is now a **TIMEOUT** verdict — which
 * is information (this mutation makes something hang) rather than a silence.
 *
 * Generous on purpose — and **recalibrated 2026-09-01**: the original minute
 * was four times a ~15s suite, but the suite has grown to ~21s quiet and ~55s
 * on a busy machine, so a 60s ceiling sat inside the honest range and timed
 * out 8 runtime mutations on a quiet machine and 53 across a loaded sweep —
 * every one of them reported as "the suite hung" when the suite was merely
 * slow. A hang detector needs to be unambiguous, not tight: four minutes is
 * 4x the slowest honest run seen, ~12x the quiet one, and still turns the
 * 8-hour wedge this guard exists for into a bounded verdict. Override with
 * `MUTATE_RUN_TIMEOUT_MS` where a machine is slower still.
 */
const RUN_TIMEOUT = Number(process.env.MUTATE_RUN_TIMEOUT_MS ?? 240000);

/**
 * One suite run against the planted mutation, killed at the **first failure**.
 *
 * The runner only ever asks one bit of this run — did anything fail — and the
 * mutations that answer loudest used to answer slowest: a mutant that
 * disables an option guard fails nearly every test, and under a shard's
 * `--test-concurrency=1` that all-red run serialises ~100s of CPU plus error
 * output, the slowest run the suite can produce. Three such mutants crossed
 * even a 240s ceiling and were reported "TIMED OUT — the suite hung" when no
 * test hangs at all (M6 in the audit ledger: planted by hand, the suite goes
 * red in 16s parallel). Killing at the first `✖`/`not ok` line makes a caught
 * verdict cost seconds — the redder the mutant, the *faster* now — and a
 * sweep's cost approaches one honest-run per survivor rather than per
 * mutation. Streaming also removes `execSync`'s output buffer from the story.
 *
 * The ceiling stays, for the mutation that genuinely wedges the suite before
 * anything fails — that is still a TIMEOUT verdict, still reported as
 * untested (a hang is information, not a catch). A clean exit with no
 * failure marker is the survivor; a non-zero exit with no marker (a crash,
 * a reporter this pattern does not speak) still counts as caught.
 */
const runSuite = (root) => new Promise((settle) => {
  const child = spawn(
    'node',
    ['--import', './test/setup.mjs', '--test',
     ...(TEST_CONCURRENCY ? [TEST_CONCURRENCY.trim()] : []), 'test/*.test.js'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let done = false;
  const finish = (verdict) => {
    if (done) return;
    done = true;
    clearTimeout(ceiling);
    child.kill('SIGKILL');
    settle(verdict);
  };
  const ceiling = setTimeout(() => finish({ timedOut: true }), RUN_TIMEOUT);
  const watch = (chunk) => {
    if (/^\s*(✖|not ok )/m.test(String(chunk))) finish({ caught: true });
  };
  child.stdout.on('data', watch);
  child.stderr.on('data', watch);
  child.on('exit', (code) => finish(code === 0 ? {} : { caught: true }));
  child.on('error', () => finish({ caught: true }));
});
const file = (p) => resolve(root, p);

export const MUTATIONS = [
  ['curve: clamp the wrong end', 'src/modules/curve.ts',
   'if (position <= positions[0]!) return values[0]!;', 'if (position <= positions[0]!) return values[last]!;'],
  ['curve: skip the easing', 'src/modules/curve.ts',
   'if (ease === null) return values[i]! + (position - start) * slopes[i]!;', 'return values[i]! + (position - start) * slopes[i]!;'],
  ['apply: drop the rounding', 'src/modules/apply.ts',
   'String(Math.round(value * 1000) / 1000)', 'String(value)'],
  ['apply: lose the unit', 'src/modules/apply.ts',
   'out += `${property.cssFunction}(${format(values[i]!)}${unit})`;', 'out += `${property.cssFunction}(${format(values[i]!)})`;'],
  ['runtime: never skip a transform write', 'src/modules/runtime.ts',
   'if (next !== element.lastTransform) {', 'if (true) {'],
  ['runtime: forget the run-once latch', 'src/modules/runtime.ts',
   '  if (element.runOnce && element.runOnceRan) {\n    /**\n     * Latched.', '  if (false) {\n    /**\n     * Latched.'],
  ['runtime: a forced repaint recomputes a latched scroll element', 'src/modules/runtime.ts',
   '    if (force) animateElement(element);\n    return;\n  }', '    return;\n  }'],
  ['runtime: a forced repaint skips a latched state element', 'src/modules/runtime.ts',
   '    if (force) animateElement(element);\n    return false;\n  }', '    return false;\n  }'],
  ['runtime: ignore band ranges', 'src/modules/runtime.ts',
   'if (width < band.min || width > band.max) continue;', 'if (false) continue;'],
  ['schema: a value past a declared maximum is accepted', 'src/modules/schema.ts',
   '  if (property.max !== undefined && value > property.max) return null;', ''],
  ['schema: a value below a declared minimum is accepted', 'src/modules/schema.ts',
   '  if (property.min !== undefined && value < property.min) return null;', ''],
  ['schema: accept any unit', 'src/modules/schema.ts',
   "if (authored !== '' && !property.units.includes(authored)) return null;", '/* dropped */;'],
  ['schema: drop the keyframe cap', 'src/modules/schema.ts',
   'if (keyframes.length >= MAX_KEYFRAMES) {', 'if (false) {'],
  ['schema: allow any scheme through', 'src/modules/url.ts',
   "if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {", 'if (false) {'],
  /**
   * These attributes have three authors and two of them write CSS all day. A
   * trailing separator is what CSS habit produces, and the value is not CSS.
   */
  /**
   * `run-once="yes"` meant "on" to whoever wrote it and came out **off**, with
   * nothing said. Being wrong about a boolean is quiet: nothing looks broken,
   * the animation simply repeats when it was asked not to.
   */
  /**
   * `when` is evaluated with `matches()`, where `a, b` means "either".
   * `path-selector` is handed to `querySelector`, where it does not.
   */
  ['parse: when refuses a selector list, as if it were a querySelector',
   'src/modules/schema.ts',
   "  { attribute: 'when', type: 'selector', parse: (raw) => parseSelector(raw, true) },",
   "  { attribute: 'when', type: 'selector' },"],
  ['parse: path-selector accepts a list it cannot honour', 'src/modules/schema.ts',
   "  if (!lists && value.includes(',')) return null;\n", ''],
  ['parse: an unrecognised boolean is read as off rather than refused',
   'src/modules/parse.ts',
   "        if (raw === '' || raw === 'true') settings[key] = true;\n        else if (raw === 'false') settings[key] = false;\n        else no(WHY['boolean']!);",
   "        settings[key] = raw === '' || raw === 'true';"],
  /** Echoing the empty string reports a complaint with no text in it. */
  /**
   * `opacity-mobile` on its own is "animate only on small screens", which the
   * inline spelling has always allowed. The named one was read as a base
   * written blank and refused as an empty value.
   */
  /**
   * `"0% 0px, 100% 40rem"` resolved to `translateY(40px)` in silence — a
   * sixteenth of what was asked for.
   */
  ['parse: two units in one animation are resolved silently', 'src/modules/parse.ts',
   "    if (keyframe.unit !== '' && keyframe.unit !== unit) {",
   '    if (false) {'],
  ['parse: a band that disagrees about the unit is not checked', 'src/modules/parse.ts',
   '  for (const keyframe of [...base.keyframes, ...all.flatMap((b) => b.keyframes)]) {',
   '  for (const keyframe of base.keyframes) {'],
  ['parse: an animation that exists only in a band is refused', 'src/modules/parse.ts',
   "  const { base, bands, rejected: bad } = collected.base === undefined && collected.named.length\n    ? { base: { keyframes: [], rejected: [], geometryDependent: false }, bands: [], rejected: [] }\n    : parseBandedList(collected.base ?? '', property);",
   "  const { base, bands, rejected: bad } = parseBandedList(collected.base ?? '', property);"],
  ['parse: an empty value is echoed rather than named', 'src/modules/schema.ts',
   "    return { keyframes, rejected: ['no keyframes'], geometryDependent };",
   '    return { keyframes, rejected: [raw], geometryDependent };'],
  ['parse: an empty keyframe segment is reported as itself, which is nothing',
   'src/modules/schema.ts',
   "     */\n    if (trimmed === '') continue;",
   "     */\n    if (trimmed === '') { rejected.push(entry); continue; }"],
  ['parse: a trailing semicolon is left on the last value',
   'src/modules/schema.ts',
   "raw.trim().replace(/;+$/, '')", 'raw'],
  ['parse: stop reporting unknown attributes', 'src/modules/parse.ts',
   '      if (\n        name.startsWith(SUB_PREFIX) &&\n        name !== SCROLL_TARGET_ATTRIBUTE &&\n        !isSetting(name.slice(SUB_PREFIX.length))\n      ) {',
   '      if (false) {'],
  ['observer: treat a move as a removal', 'src/modules/observer.ts',
   'if (element.isConnected) removed.delete(element);', 'if (false) removed.delete(element);'],
  ['visibility: start elements inactive', 'src/modules/visibility.ts',
   '      /** Active until the observer says otherwise — see rule 2 above. */\n      active.add(element);',
   '      /* dropped */;'],
  ['events: fire complete on every pass past the end', 'src/modules/runtime.ts',
   '    element.runOnceRan = true;\n    emit(element.node, EVENTS.complete, element.timelinePosition);',
   '    emit(element.node, EVENTS.complete, element.timelinePosition);'],
  /**
   * `html { scroll-behavior: smooth }` is in a very large number of themes, and
   * the browser animating each of the tween's per-frame writes made
   * `onComplete` report arrival at scrollY 94 with the target at 1,800.
   */
  ['scrollTo: the browser animates the tween as well as the tween', 'src/modules/createScrollTo.ts',
   '    takeBehaviour();\n', ''],
  ['scrollTo: scroll-behavior is never given back', 'src/modules/createScrollTo.ts',
   "        /** Before `onComplete`, so a callback that scrolls again is not fighting it. */\n        releaseBehaviour();\n",
   ''],
  ['scrollTo: an interrupted tween keeps the page scroll-behavior', 'src/modules/createScrollTo.ts',
   '  const cancel = (): void => {\n    releaseBehaviour();',
   '  const cancel = (): void => {'],
  ['scrollTo: hijack modified clicks', 'src/modules/createScrollTo.ts',
   'mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey', 'false'],
  ['scrollTo: drop the container offset again', 'src/modules/createScrollTo.ts',
   'getElementSize(target.node, settings.scrollDirection, scrollElement)', 'getElementSize(target.node, settings.scrollDirection)'],

  /* Everything below is a guard this audit added. A fix nothing can catch is
     a fix that will be undone by the next person who finds it untidy. */
  ['modules: prepare ignores whether anything animates', 'src/split.ts',
   'if (!enabled) return;', ''],
  ['modules: a removed node is never released', 'src/modules/createMotion.ts',
   "          for (const node of nodes) {\n            runInserts('release', node);\n          }", ''],
  ['modules: unobserve never tells a module an element is leaving', 'src/modules/createMotion.ts',
   "        runInserts('release', element.node);\n        drop(element);\n        clearElement(element, runtimeSettings);\n        gone.add(element);",
   '        drop(element);\n        clearElement(element, runtimeSettings);\n        gone.add(element);'],
  ['when: a resize never repaints a state-driven element', 'src/modules/createMotion.ts',
   '        updateState(undefined, true);\n      });', '      });'],
  ['when: the re-measure repaint is not forced, so it returns early', 'src/modules/createMotion.ts',
   '        updateState(undefined, true);\n      });',
   '        updateState();\n      });'],
  ['when: refresh() repaints state elements unforced', 'src/modules/createMotion.ts',
   '      updateState(undefined, true);\n    },', '      updateState();\n    },'],
  ['units: the root font size is read once and never again', 'src/modules/runtime.ts',
   "  rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;",
   '  rootFontSize = rootFontSize || 16;'],
  ['units: a rem position resolves against a hard-coded 16', 'src/modules/runtime.ts',
   '  const root = rootFontSize;', '  const root = 16;'],
  ['stagger: the group is indexed once and never re-indexed', 'src/modules/createMotion.ts',
   '    forgetStagger();\n    const fresh', '    const fresh'],
  ['stagger: a nested group is counted by the outer host too', 'src/modules/parse.ts',
   '    if (candidate.parentElement?.closest(`[${STAGGER_ATTRIBUTE}]`) === host) index.set(candidate, at++);',
   '    index.set(candidate, at++);'],
  ['stagger: every member of a group gets the same offset', 'src/modules/parse.ts',
   '  const index = indexIn(host, node);', '  const index = 1;'],
  ['pin: an adopted element is never styled at all', 'src/modules/createMotion.ts',
   '      for (const element of fresh) unpainted.add(element);\n      queuePaint();',
   ''],
  ['marker: an element with our attributes and no marker is passed over in silence', 'src/modules/createMotion.ts',
   '          if (!animatable.has(name)) continue;', '          continue;'],
  ['marker: any prefixed attribute counts, not only a property', 'src/modules/createMotion.ts',
   '    new Set(liveProperties().map((property) => `${ATTRIBUTE_PREFIX}-${property.attribute}`));',
   '    new Set([...liveProperties(), ...liveSettings()].map((one) => `${ATTRIBUTE_PREFIX}-${one.attribute}`));'],
  /**
   * Anchored with the line after it. The bare statement is a substring of the
   * identically-worded guard in the root branch above, which is indented two
   * further and therefore contains it — so the anchor matched twice and audit
   * rule 10 said so.
   */
  ['marker: a second reason is piled onto one already explained', 'src/modules/createMotion.ts',
   '        if (rejectionsFor(element).length) continue;\n        /**\n         * A stagger host that staggers nothing.',
   '        /**\n         * A stagger host that staggers nothing.'],
  ['collect: an unmarked element keeps its reason for ever', 'src/modules/createMotion.ts',
   '      if (inRoots(node) && !scanned.has(node)) dropped.splice(i, 1);', ''],
  ['collect: a module reason outlives the mistake', 'src/modules/createMotion.ts',
   '    for (const node of rejectedNodes()) if (inRoots(node)) forgetRejections(node);', ''],
  ['collect: an adopted element keeps the parse it already had', 'src/modules/createMotion.ts',
   '      if (signatures.get(node) !== signature || !byNode.has(node)) changed.push(node);',
   '      if (!byNode.has(node)) changed.push(node);'],
  ['collect: every element is re-read whether or not it changed', 'src/modules/createMotion.ts',
   '    reparse(changed);', '    reparse(found);'],
  ['collect: a cascade is not re-read when its host or its order moves', 'src/modules/createMotion.ts',
   '        signature += `@${index}:${host.getAttribute(`${ATTRIBUTE_PREFIX}-stagger`)}`;',
   ''],
  ['collect: a changed value is not part of what is compared', 'src/modules/createMotion.ts',
   '    if (name.startsWith(ATTRIBUTE_PREFIX)) out += `${name}=${value};`;',
   '    if (name.startsWith(ATTRIBUTE_PREFIX)) out += `${name};`;'],
  ['collect: a removed element is kept for the life of the page', 'src/modules/createMotion.ts',
   '    const stale = new Set(\n      elements.filter(\n        (element) => !inRoots(element.node) || !element.node.hasAttribute(ATTRIBUTE_PREFIX)\n      )\n    );',
   '    const stale = new Set<RuntimeElement>();'],
  ['collect: an unmarked element goes on animating', 'src/modules/createMotion.ts',
   '      (element) => !inRoots(element.node) || !element.node.hasAttribute(ATTRIBUTE_PREFIX)',
   '      (element) => !inRoots(element.node)'],
  ['collect: a pruned element is dropped without being cleared', 'src/modules/createMotion.ts',
   '      clearElement(element, runtimeSettings);\n    }\n    elements = elements.filter((element) => !stale.has(element));',
   '    }\n    elements = elements.filter((element) => !stale.has(element));'],
  ['collect: the modules are not told what left the document', 'src/modules/createMotion.ts',
   "    runInserts('teardown', (node: Node) => !node.isConnected);", ''],
  ['run-once: a re-parse un-latches a run-once element', 'src/modules/createMotion.ts',
   'const latched = existing?.runOnceRan ? existing.timelinePosition : null;',
   'const latched = null;'],
  ['run-once: the latch is carried without the position it played to', 'src/modules/createMotion.ts',
   '        element.runOnceRan = true;\n        element.timelinePosition = latched;',
   '        element.runOnceRan = true;'],
  ['events: stopping the instance leaves every listener holding an active element', 'src/modules/createMotion.ts',
   '    for (const element of announced) emit(element.node, EVENTS.idle, element.timelinePosition);\n    announced.clear();',
   '    announced.clear();'],
  ['events: idle fires for elements that never went active', 'src/modules/createMotion.ts',
   '    if (active) announced.add(element);\n    else announced.delete(element);',
   '    announced.add(element);'],
  ['events: re-enabling never announces anything again', 'src/modules/createMotion.ts',
   '      retrack();\n      /**\n       * start(), not update(): update() skips state-driven elements by design,',
   '      /**\n       * start(), not update(): update() skips state-driven elements by design,'],
  ['scrollTo: the active link depends on nav order again', 'src/modules/createScrollTo.ts',
   '      if (target.start < currentStart) continue;', ''],
  ['sticky: a stuck ancestor is measured at its stuck position', 'src/modules/dom.ts',
   '    if (isSticky(up)) (sticky ??= []).push(up);', ''],
  ['sticky: the batch stands nothing down, only says it has', 'src/modules/dom.ts',
   '  for (const node of all) node.style.position = \'static\';\n  standing++;',
   '  standing++;'],
  ['sticky: the batch leaves the page static afterwards', 'src/modules/dom.ts',
   '    standing--;\n    all.forEach((node, i) => { node.style.position = held[i]!; });',
   '    standing--;'],
  ['sticky: the union misses the elements own position', 'src/modules/dom.ts',
   '  for (const node of nodes) for (const up of stickyAbove(node) ?? []) sticky.add(up);',
   '  for (const node of nodes) for (const up of stickyAbove(node.parentElement as HTMLElement) ?? []) sticky.add(up);'],
  ['sticky: the ancestors are stood down and left that way', 'src/modules/dom.ts',
   '  try {\n    return read();\n  } finally {\n    sticky.forEach((node, i) => { node.style.position = held[i]!; });\n  }',
   '  return read();'],
  ['sticky: a throw mid-reading leaves the page static', 'src/modules/dom.ts',
   '  try {\n    return read();\n  } finally {\n    sticky.forEach((node, i) => { node.style.position = held[i]!; });\n  }',
   '  const value = read();\n  sticky.forEach((node, i) => { node.style.position = held[i]!; });\n  return value;'],
  ['sticky: the displacement correction reads the stuck rect', 'src/modules/dom.ts',
   '  const drawn = standingDown(element, () => {\n    const box = element.getBoundingClientRect();',
   '  const drawn = ((read) => read())(() => {\n    const box = element.getBoundingClientRect();'],
  ['sticky: what was learned is never forgotten', 'src/modules/dom.ts',
   'export const forgetSticky = (): void => {\n  stickyGeneration++;\n};',
   'export const forgetSticky = (): void => {};'],
  ['api: the scroll-to marker is reported as an unknown attribute', 'src/modules/parse.ts',
   '        name !== SCROLL_TARGET_ATTRIBUTE &&\n', ''],
  ['schema: a value made only of separators refuses in silence', 'src/modules/schema.ts',
   "  if (!keyframes.length && !rejected.length) rejected.push('no keyframes');", ''],
  /**
   * The original shape, which is what has to be planted: `[min, max]` was
   * *destructured*, and spreading is the same operation. Indexing a number is
   * harmless — `640[0]` is undefined and the finite check catches it — so a
   * mutation that only removed `Array.isArray` survived, correctly.
   */
  ['options: a breakpoint entry that is not a pair takes the page down', 'src/modules/createMotion.ts',
   '    const pair = Array.isArray(range) ? (range as readonly unknown[]) : null;',
   '    const pair = [...(range as Iterable<unknown>)];'],
  ['options: a reversed breakpoint range is registered anyway', 'src/modules/createMotion.ts',
   '    if (!pair || !Number.isFinite(min) || Number.isNaN(max) || min > max) {',
   '    if (!pair) {'],
  ['options: an unknown scrollDirection is read as vertical in silence', 'src/modules/createMotion.ts',
   "  if (settings.scrollDirection !== 'vertical' && settings.scrollDirection !== 'horizontal') {",
   '  if (false) {'],
  ['options: scrollTo numbers go unchecked', 'src/modules/createScrollTo.ts',
   "  for (const name of ['offset', 'activeThreshold'] as const) {\n    if (Number.isFinite(settings[name])) continue;",
   "  for (const name of [] as const) {\n    if (Number.isFinite(settings[name])) continue;"],
  ['options: a NaN option is reported as null', 'src/modules/createMotion.ts',
   "    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);",
   '    const shown = JSON.stringify(value);'],
  ['split: an author aria-label gets a competing hidden copy', 'src/modules/split.ts',
   "  const ownCopy = !node.hasAttribute('aria-label');", '  const ownCopy = true;'],
  ['split: the readable copy is announced and animated both', 'src/modules/split.ts',
   "    if (ownCopy) node.append(hiddenCopy());\n\n    if (mode !== 'lines') {",
   "    if (mode !== 'lines') {"],
  ['scrollTo: updateHash pushes instead of replacing', 'src/modules/createScrollTo.ts',
   "            history.replaceState(null, '', `#${link.id}`);",
   "            history.pushState(null, '', `#${link.id}`);"],
  ['bands: a band outside its named range is kept, impossible', 'src/modules/parse.ts',
   '      if (min > max) {', '      if (false) {'],
  ['bands: the intersection is reported but the band still applies', 'src/modules/parse.ts',
   '        continue;\n      }\n      all.push({ ...band, min, max });',
   '      }\n      all.push({ ...band, min, max });'],
  /**
   * Anchored with the line that follows, because `cascadeTrouble` needs the
   * same no-box guard for its own reason (a display:none element reports
   * computed `transform: none` in two engines) — so the guard alone is no
   * longer unique to this function.
   */
  /**
   * The refusal that names what was refused but not why — `opacity: 0% 2` with
   * no hint that opacity stops at 1, which is what a GUI editor renders.
   */
  ['diagnostics: a refused keyframe is echoed with no reason', 'src/modules/schema.ts',
   '      rejected.push(`${trimmed} \\u2014 ${whyRefused(rawValue, property)}`);',
   '      rejected.push(trimmed);'],
  ['pin: an unrendered element is reported as having no room', 'src/modules/runtime.ts',
   '  if (!node.offsetWidth && !node.offsetHeight) return null;\n  const horizontal =',
   '  const horizontal ='],
  /**
   * The check that reports a page's CSS discarding the runtime's writes, and
   * the guard without which it accuses every element in a closed accordion —
   * a `display: none` element reports computed `transform: none` in Chromium
   * and WebKit. Two plants: the report, and the false-positive guard.
   */
  ['cascade: an overridden write is never reported', 'src/modules/createMotion.ts',
   '      element.cascadeBlocked = cascadeTrouble(element);',
   '      element.cascadeBlocked = null;'],
  ['cascade: an unrendered element is accused of a CSS override', 'src/modules/runtime.ts',
   '  /** Not rendered: see above. It will be measured again when it is shown. */\n  if (!node.offsetWidth && !node.offsetHeight) return null;',
   ''],
  ['pin: a translate-z with nothing to project through says nothing', 'src/modules/runtime.ts',
   '  element.flatBlocked = flatTrouble(element, settings);\n\n  return element;',
   '\n  return element;'],
  ['pin: the perspective walk stops at the first ancestor', 'src/modules/runtime.ts',
   "    if (perspective && perspective !== 'none') return null;",
   "    if (perspective !== undefined) return null;"],
  ['pin: an element carrying its own perspective is accused anyway', 'src/modules/runtime.ts',
   "  if (element.parsed.settings['perspective'] !== undefined) return null;", '  if (false) return null;'],
  ['pin: a pin that cannot possibly hold says nothing', 'src/modules/runtime.ts',
   '  element.pinBlocked = pinTrouble(element, settings);\n  element.flatBlocked = flatTrouble(element, settings);\n\n  return element;',
   '  element.flatBlocked = flatTrouble(element, settings);\n\n  return element;'],
  /**
   * Anchored on the line *plus* the `getComputedStyle` that follows it, because
   * `flatTrouble` next door walks ancestors the same way and the bare line
   * appears twice. Repointing it to something unique but behaviourally inert —
   * an extra `break` the loop already had — made a mutation that could not be
   * caught, and it was reported as untested behaviour rather than as the
   * mistake it was.
   */
  ['pin: the clipping check walks through the scroll container', 'src/modules/runtime.ts',
   "    if (up === stop || up === document.body || up === document.documentElement) break;\n    const overflow = getComputedStyle(up).overflow;",
   '    if (up === document.documentElement) break;\n    const overflow = getComputedStyle(up).overflow;'],
  ['pin: the blocked reason is recorded once instead of re-derived', 'src/modules/runtime.ts',
   '  /** A resize is exactly when a wrapper starts or stops clipping. */\n  element.pinBlocked = pinTrouble(element, settings);',
   ''],
  ['diagnostics: a throwing module is console-only again', 'src/modules/createMotion.ts',
   '          problem(__DEV__ ? `a wired module threw in ${point}; the rest of the chain still ran.` : `module threw in ${point}`);', ''],
  ['diagnostics: a dropped onProgress is console-only again', 'src/modules/createMotion.ts',
   "      report('onProgress threw, so it is being ignored from here on.');", ''],
  ['diagnostics: an unusable path is console-only again', 'src/path.ts',
   '    reject(node, `${SELECTOR_ATTRIBUTE}="${selector}" ${why}${__DEV__ ? `; ${ATTRIBUTE_PREFIX}-path does nothing.` : \'\'}`);',
   ''],
  ['diagnostics: every path failure reads the same', 'src/path.ts',
   "    const why = !source\n      ? 'matched no element'\n      : data === null\n        ? 'matched an element with no d attribute'\n        : 'matched a path whose d attribute is not usable';",
   "    const why = 'matched no element';"],
  ['modules: unobserve asks the attributes but not the modules', 'src/modules/createMotion.ts',
   "      runInserts('teardown', (node: Node) => root === node || root.contains(node));", ''],
  ['vera: a light-DOM component is registered as a root', 'src/vera.ts',
   '    if (!root || !instance) return;', '    if (!instance) return;'],
  ['vera: the root is never given back when the component goes', 'src/vera.ts',
   '    cleanups?.add(() => held.unobserve(root));', ''],
  ['vera: wiring it twice starts a second instance', 'src/vera.ts',
   '    if (!instance) {\n      instance = createMotion(options);',
   '    {\n      instance = createMotion(options);'],
  ['vera: the instance is never started', 'src/vera.ts',
   '      instance.init();', ''],
  ['roots: a root outlives the host that held it', 'src/modules/createMotion.ts',
   '      if ((root as Node).isConnected) continue;\n      roots.delete(root);',
   '      if (true) continue;\n      roots.delete(root);'],
  ['roots: the batch entry points never flush what they queued', 'src/modules/createMotion.ts',
   '    paintNow();\n    start();', '    start();'],
  ['roots: every root shares one watcher again', 'src/modules/createMotion.ts',
   '    watcher.observe(root as Node, observerOptions());\n    watchers.set(root, watcher);',
   '    watcher.observe(root as Node, observerOptions());'],
  ['roots: giving one up stops watching the rest', 'src/modules/createMotion.ts',
   '    watchers.get(root)?.disconnect();\n    watchers.delete(root);',
   '    for (const watcher of watchers.values()) watcher.disconnect();\n    watchers.delete(root);'],
  ['modules: observe skips prepare for a new root', 'src/modules/createMotion.ts',
   "      runInserts('prepare', root, enabled);\n      applyChanges(findElements(root));",
   '      applyChanges(findElements(root));'],
  ['audit: unobserve keeps watching the root it gave up', 'src/modules/createMotion.ts',
   '      unwatch(root);\n      const gone', '      const gone'],
  ['audit: a mutation batch transition write is not cancellable', 'src/modules/createMotion.ts',
   '    queueTransitions(list);', '    setTransitions(list);'],
  ['options: a scrollElement of the wrong type is used as one', 'src/modules/dom.ts',
   "    if (typeof (option as HTMLElement | null)?.addEventListener === 'function') return option;\n    report('scrollElement is not an element or a selector; using window.');\n    return window;",
   '    return option;'],
  ['options: an inertia outside the schema range is accepted', 'src/modules/createMotion.ts',
   '      : Number.isFinite(value) && inRange(value as number);',
   '      : Number.isFinite(value);'],
  ['options: the inertia range is written out instead of read', 'src/modules/createMotion.ts',
   "  const inertiaBounds = liveSettings().find((setting) => setting.attribute === 'inertia');",
   '  const inertiaBounds = { min: 0, max: 10000 };'],
  ['options: a root that is not a node takes init() down', 'src/modules/createMotion.ts',
   '  const roots = new Set<ParentNode>(givenRoots.length > 0 ? givenRoots : fallbackRoot);',
   '  const roots = new Set<ParentNode>([options.root ?? document]);'],
  ['options: observe() takes anything and poisons the instance', 'src/modules/createMotion.ts',
   "      if (!usableRoot(root)) {\n        configProblems.push(__DEV__ ? 'observe() was given something that is not an element or document' : 'observe(): not an element');\n        return;\n      }\n",
   ''],
  ['options: a bad root is refused in silence', 'src/modules/createMotion.ts',
   "    configProblems.push(__DEV__ ? 'root is not an element or document; falling back to the document' : 'root unusable; using document');",
   ''],
  ['teardown: an unreadable geometry read aborts destroy() half way', 'src/modules/createMotion.ts',
   '      try {\n        const win = getWindowSize(settings.scrollDirection, scrollElement);',
   '      {\n        const win = getWindowSize(settings.scrollDirection, scrollElement);'],
  ['audit: a paint owed at disable() lands after it', 'src/modules/createMotion.ts',
   '     * is otherwise careful about.\n     */\n    unpainted.clear();',
   '     * is otherwise careful about.\n     */'],
  ['audit: disable() writes styles back onto what it just released', 'src/modules/createMotion.ts',
   '    if (enabled) {\n      for (const element of fresh) unpainted.add(element);',
   '    {\n      for (const element of fresh) unpainted.add(element);'],
  ['audit: disable() leaves start() deferred transition write standing', 'src/modules/createMotion.ts',
   '    cancelTransitions();\n    for (const cancel of pendingTransitions) cancel();',
   '    for (const cancel of pendingTransitions) cancel();'],
  ['audit: teardown does not cancel the writes in flight', 'src/modules/createMotion.ts',
   '    for (const cancel of pendingTransitions) cancel();\n    pendingTransitions.clear();', ''],
  ['audit: deferred remeasure not cancelled', 'src/modules/createMotion.ts',
   'if (queued !== null) { cancelAnimationFrame(queued); queued = null; }', '/* dropped */;'],
  ['modules: teardown never runs', 'src/modules/createMotion.ts',
   "    runInserts('teardown', inRoots);", ''],
  ['modules: drop() releases on a re-parse', 'src/modules/createMotion.ts',
   '    byNode.delete(element.node);\n    visible?.unobserve(element);',
   "    byNode.delete(element.node);\n    visible?.unobserve(element);\n    for (const fn of insert('release')) fn(element.node);"],
  ['audit: overlapping roots register one element twice', 'src/modules/createMotion.ts',
   '    const batch = new Set<Element>(nodes);', '    const batch = nodes;'],
  ['audit: unmarked node stays registered', 'src/modules/createMotion.ts',
   'if (!node.hasAttribute(ATTRIBUTE_PREFIX)) continue;', '/* dropped */;'],
  ['audit: observer cannot see the marker leave', 'src/modules/observer.ts',
   '(!marker && !isAnimated(mutation.target))', '!isAnimated(mutation.target)'],
  ['audit: start() cannot repaint a latched run-once', 'src/modules/createMotion.ts',
   'else updateElement(element, win, runtimeSettings, true);', 'else updateElement(element, win, runtimeSettings);'],
  ['audit: stagger group not re-parsed', 'src/modules/createMotion.ts',
   'for (const sibling of host.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) batch.add(sibling);', '/* dropped */;'],
  /**
   * A module property missing from ORDER falls back to MAX_SAFE_INTEGER, so
   * two of them tie — and `sort` being stable, the tie is broken by the order
   * the *attributes* were written in, which is the one thing the sort exists
   * to stop.
   */
  ['modules: a wired property never joins the transform order', 'src/modules/schema.ts',
   '      if (!ORDER.has(one.attribute)) ORDER.set(one.attribute, ORDER.size);',
   ''],
  ['modules: a wired setting is not recognised', 'src/modules/schema.ts',
   "      clash(BY_SETTING.get(one.attribute), one, 'setting');\n      BY_SETTING.set(one.attribute, one);",
   "      clash(BY_SETTING.get(one.attribute), one, 'setting');"],
  ['scrollTo: a new tween does not stop the one in flight', 'src/modules/createScrollTo.ts',
   '  const toPosition: ScrollToInstance[\'toPosition\'] = (destination, opts = {}) => {\n    cancel();',
   '  const toPosition: ScrollToInstance[\'toPosition\'] = (destination, opts = {}) => {'],
  ['events: every scroll event queues its own frame', 'src/modules/eventListeners.ts',
   '    if (frame !== null) {\n      return;\n    }', '    if (false) {\n      return;\n    }'],
  ['scrollTo: the size observer never re-measures', 'src/modules/createScrollTo.ts',
   '        queued = requestAnimationFrame(() => { queued = null; refresh(); });',
   '        queued = requestAnimationFrame(() => { queued = null; });'],
  ['scrollTo: a reflow storm queues a frame each', 'src/modules/createScrollTo.ts',
   '        if (queued !== null) return;\n        queued = requestAnimationFrame',
   '        queued = requestAnimationFrame'],
  ['scrollTo: the load re-measure is wired even when loading is done', 'src/modules/createScrollTo.ts',
   "    if (document.readyState !== 'complete') {", '    if (true) {'],
  ['scrollTo: a resize never re-measures the targets', 'src/modules/createScrollTo.ts',
   '    const resize = resizeListener(refresh);', '    const resize = resizeListener(() => {});'],
  ['scrollTo: a click listener outlives the instance', 'src/modules/createScrollTo.ts',
   "    teardown.push(() => document.removeEventListener('click', onClick));", ''],
  ['scrollTo: a NaN duration starts a tween that never ends', 'src/modules/createScrollTo.ts',
   '    if (Number.isFinite(value)) return value;', '    if (true) return value;'],
  ['scrollTo: a bad duration is corrected but never reported', 'src/modules/createScrollTo.ts',
   '      problems.push({ node: null, reason });\n      console.warn(`@verajs/motion: scrollTo ${reason}`);\n    }\n    return 0;',
   '    }\n    return 0;'],
  ['scrollTo: the duration is never checked until a click', 'src/modules/createScrollTo.ts',
   '    durationFor(settings.duration);\n\n    for (const node of linkNodes) {',
   '\n    for (const node of linkNodes) {'],
  ['scrollTo: an unusable scrollElement is warned but not reported', 'src/modules/createScrollTo.ts',
   '    if (scrollElementProblem) problems.push({ node: null, reason: scrollElementProblem });', ''],
  ['sequence: a frame outside the window is kept forever', 'src/modules/sequence.ts',
   '    for (const i of held) {\n      if (Math.abs(i - centre) <= keep) continue;',
   '    for (const i of held) {\n      continue;'],
  ['split: a deferred line rebuild is not cancelled on destroy', 'src/modules/split.ts',
   '      if (queued !== null) { cancelAnimationFrame(queued); queued = null; }', ''],
  ['split: the line rebuild runs inside the observer callback', 'src/modules/split.ts',
   '      queued = requestAnimationFrame(() => {\n        queued = null;\n        if (!destroyed) build();\n      });',
   '      build();'],
  ['split: the piece cap counts the raw string, not the pieces', 'src/modules/split.ts',
   "    mode === 'chars'\n      ? characters(original.replace(/\\s+/g, '')).length\n      : tokenise(original).filter((part) => !isSpace(part)).length;",
   '    original.length;'],
  ['paint: the slot table has no cap', 'src/paint.ts',
   '      if (values.length >= MAX_VALUES) {', '      if (false) {'],
  /**
   * The once-only guard is now the retraction handle itself — holding one is
   * what says "already reported" — so the anchor moved with it.
   */
  ['paint: the cap warns on every refusal instead of once', 'src/paint.ts',
   '        if (!retractCountProblem) {\n          retractCountProblem = pageProblem(', '        if (true) {\n          pageProblem('],
  ['paint: an over-long value is accepted', 'src/paint.ts',
   "    if (value === '' || value.length > MAX_LENGTH) return null;", "    if (value === '') return null;"],
  ['visibility: the tracker always observes against the viewport', 'src/modules/createMotion.ts',
   '      scrollElement === window ? null : (scrollElement as Element)', '      null'],
  ['visibility: the root replaces the margin instead of joining it', 'src/modules/visibility.ts',
   '      { root, rootMargin: rootMarginFor(before, after, horizontal, rootSize) }', '      { root }'],
  ['runtime: a band does not force a rebuild on resize', 'src/modules/runtime.ts',
   '      plan.all.some((a) => a.geometryDependent || a.bands.length > 0),',
   '      plan.all.some((a) => a.geometryDependent),'],
  ['runtime: a transformOrigin the engine refuses is used anyway', 'src/modules/createMotion.ts',
   "  if (settings.transformOrigin && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('transform-origin', settings.transformOrigin)) {",
   '  if (false) {'],
  ['paint: a value the engine refuses is accepted', 'src/paint.ts',
   "    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(cssProperty, value)) {",
   '    if (false) {'],
  ['runtime: a usable transformOrigin is thrown away', 'src/modules/createMotion.ts',
   "  if (settings.transformOrigin && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('transform-origin', settings.transformOrigin)) {",
   '  if (settings.transformOrigin) {'],
  ['runtime: a non-callable onProgress is handed to the loop', 'src/modules/createMotion.ts',
   "  if (typeof fn !== 'function') return undefined;",
   '  if (false) return undefined;'],
  ['runtime: an unusable option is used as given', 'src/modules/createMotion.ts',
   '    if (usable) continue;', '    continue;'],
  ['runtime: an easing option is checked as a number', 'src/modules/createMotion.ts',
   "    const usable = typeof value === 'string'\n      ? parseEasing(value) !== null\n      : Number.isFinite(value) && inRange(value as number);",
   '    const usable = Number.isFinite(value);'],
  /**
   * Was a deduction from "a string option that came back as `window`". It is a
   * reported reason now, so the mutation is the report going missing.
   */
  ['scrollTo: a fallen-back scrollElement is never noticed', 'src/modules/createScrollTo.ts',
   '    scrollElementProblem = reason;',
   ''],
  ['scrollTo: toPosition animates past the end of the container', 'src/modules/createScrollTo.ts',
   '    const target = Math.max(0, Math.min(destination, maxScroll(scrollElement, horizontal)));',
   '    const target = destination;'],
  ['scrollTo: the clamp lets a negative destination through', 'src/modules/createScrollTo.ts',
   '    const target = Math.max(0, Math.min(destination, maxScroll(scrollElement, horizontal)));',
   '    const target = Math.min(destination, maxScroll(scrollElement, horizontal));'],
  ['scrollTo: an unknown easing name falls back in silence', 'src/modules/createScrollTo.ts',
   'cubic-bezier(); using ${FALLBACK_EASING}`;\n    if (!problems.some((problem) => problem.reason === reason)) {',
   'cubic-bezier(); using ${FALLBACK_EASING}`;\n    if (false) {'],
  ['scrollTo: the easing is never checked until a click', 'src/modules/createScrollTo.ts',
   '    easingFor(settings.easing);\n    durationFor(settings.duration);',
   '    durationFor(settings.duration);'],
  ['scrollTo: the marker is dropped while another instance still holds it', 'src/modules/createScrollTo.ts',
   '  const remaining = (markCounts.get(node) ?? 1) - 1;\n  if (remaining > 0) {',
   '  const remaining = 0;\n  if (remaining > 0) {'],
  ['scrollTo: the marker count never rises, so the first release clears it', 'src/modules/createScrollTo.ts',
   "  markCounts.set(node, (markCounts.get(node) ?? 0) + 1);", '  markCounts.set(node, 1);'],
  ['scrollTo: an activeClass that classList refuses is used anyway', 'src/modules/createScrollTo.ts',
   "  if (typeof settings.activeClass !== 'string' || !/^\\S+$/.test(settings.activeClass)) {",
   '  if (false) {'],
  ['scrollTo: a threshold outside the viewport is accepted', 'src/modules/createScrollTo.ts',
   '  if (settings.activeThreshold < 0 || settings.activeThreshold > 1) {',
   '  if (false) {'],
  ['scrollTo: a bad root is reported as a bad selector', 'src/modules/createScrollTo.ts',
   "  const root: ParentNode = usableRoot\n    ? (settings.root as ParentNode)",
   '  const root: ParentNode = (settings.root as ParentNode) ?? document;\n  const _dead = usableRoot\n    ? (settings.root as ParentNode)'],
  ['scrollTo: an element root cannot reach a target outside itself', 'src/modules/createScrollTo.ts',
   '    byIdIn(root, id) ?? byIdIn((root as Node).getRootNode() as ParentNode, id);',
   '    byIdIn(root, id);'],
  ['scrollTo: a destination that is not a number is tweened towards', 'src/modules/createScrollTo.ts',
   '    if (!Number.isFinite(destination)) {', '    if (false) {'],
  ['scrollTo: a refused destination leaves the caller hanging', 'src/modules/createScrollTo.ts',
   "          `${String(destination)} (${typeof destination})`,\n      });\n      opts.onComplete?.();\n      return;",
   "          `${String(destination)} (${typeof destination})`,\n      });\n      return;"],
  ['scrollTo: a target is marked once per link rather than once per target', 'src/modules/createScrollTo.ts',
   '      if (!targets.some((t) => t.id === id)) {\n        mark(target, targetAttribute);',
   '      mark(target, targetAttribute);\n      if (!targets.some((t) => t.id === id)) {'],
  ['scrollTo: re-collect strands the marker attribute', 'src/modules/createScrollTo.ts',
   '    for (const target of targets) unmark(target.node, targetAttribute);\n    clearActive();',
   '    clearActive();'],
  ['scrollTo: re-collect keeps the active class on a link it dropped', 'src/modules/createScrollTo.ts',
   '    for (const target of targets) unmark(target.node, targetAttribute);\n    clearActive();',
   '    for (const target of targets) unmark(target.node, targetAttribute);'],
  ['scrollTo: public collect rebuilds without measuring', 'src/modules/createScrollTo.ts',
   '    collect() {\n      collect();\n      refresh();\n    },',
   '    collect() {\n      collect();\n    },'],
  ['scrollTo: a short last section is never marked active', 'src/modules/createScrollTo.ts',
   'if (position >= maxScroll(scrollElement, horizontal) - 1) {', 'if (false) {'],
  ['scrollTo: the end-of-range rule fires everywhere, not just at the end', 'src/modules/createScrollTo.ts',
   'if (position >= maxScroll(scrollElement, horizontal) - 1) {', 'if (true) {'],
  ['scrollTo: the last section is chosen by nav order, not position', 'src/modules/createScrollTo.ts',
   'for (const target of targets) if (!last || target.start > last.start) last = target;',
   'for (const target of targets) last = target;'],
  ['scrollTo: user input never aborts the tween', 'src/modules/createScrollTo.ts',
   "        if (event.type === 'keydown' && !SCROLL_KEYS.has((event as KeyboardEvent).key)) return;\n        cancel();",
   "        if (event.type === 'keydown' && !SCROLL_KEYS.has((event as KeyboardEvent).key)) return;"],
  ['scrollTo: a tabindex is injected on an already-focusable target', 'src/modules/createScrollTo.ts',
   "const needsTabIndex = !node.hasAttribute('tabindex') && node.tabIndex < 0;",
   "const needsTabIndex = !node.hasAttribute('tabindex');"],
  ['scrollTo: an encoded fragment is never decoded', 'src/modules/createScrollTo.ts',
   'const target = findById(fragment) ?? (decoded === fragment ? null : findById(decoded));',
   'const target = findById(fragment);'],
  ['scrollTo: the decoded spelling wins over the raw one', 'src/modules/createScrollTo.ts',
   'const target = findById(fragment) ?? (decoded === fragment ? null : findById(decoded));',
   'const target = findById(decoded) ?? findById(fragment);'],
  ['scrollTo: a fragment that will not decode takes the link out', 'src/modules/createScrollTo.ts',
   '  try {\n    return decodeURIComponent(fragment);\n  } catch {\n    return fragment;\n  }',
   '  return decodeURIComponent(fragment);'],
  ['scrollTo: the link keeps the href spelling, not the element id', 'src/modules/createScrollTo.ts',
   'const id = target.id;', 'const id = fragment;'],
  ['diagnostics: a module refusal never reaches rejected', 'src/modules/runtime.ts',
   'if (refusal) reject(element.node, refusal);', ''],
  ['diagnostics: the instance reads only parse-time reasons', 'src/modules/createMotion.ts',
   'const all = parsed.length ? [...parsed, ...rejectionsFor(node)] : rejectionsFor(node);',
   'const all = parsed;'],
  ['diagnostics: an unmarked container\'s refusals reach nobody', 'src/modules/createMotion.ts',
   '      for (const node of rejectedNodes()) {', '      for (const node of []) {'],
  ['diagnostics: a refused container from another instance is reported too', 'src/modules/createMotion.ts',
   '        if (!inRoots(node)) continue;', ''],
  ['diagnostics: an adopted container is reported twice', 'src/modules/createMotion.ts',
   '        if (out.some((entry) => entry.node === node)) continue;', ''],
  ['split: an unknown mode is skipped in silence', 'src/split.ts',
   "          reject(node, `${SPLIT_ATTRIBUTE}=\"${mode}\" is not one of ${MODES.join(', ')}.`);", ''],
  /**
   * And the other direction: refusing regardless of the marker puts one
   * mistake in `rejected` twice, since the schema already refuses it for a
   * marked container.
   */
  ['split: an unknown mode is reported twice on a marked container', 'src/split.ts',
   '          !node.hasAttribute(ATTRIBUTE_PREFIX)', '          true'],
  ['split: a pin on a split container says nothing', 'src/modules/split.ts',
   '    console.warn(`@verajs/motion: ${reason}`);\n    reject(node, reason);', ''],
  ['diagnostics: a module reason replaces rather than accumulates', 'src/modules/rejections.ts',
   '  if (existing) {\n    existing.add(reason);\n    return;\n  }',
   '  if (existing) {\n    REJECTIONS.set(node, new Set([reason]));\n    return;\n  }'],
  ['diagnostics: split refuses without recording why', 'src/modules/split.ts',
   '  reject(node, message);\n  return null;', '  return null;'],
  ['sequence: tween ignores the fractional part', 'src/modules/sequence.ts',
   'const alpha = tween ? Math.round((clamped - index) * ALPHA_STEPS) / ALPHA_STEPS : 0;',
   'const alpha = 0;'],
  ['sequence: tween blends onto a fallback frame', 'src/modules/sequence.ts',
   'if (target >= 0) render(target, target === index ? alpha : 0);',
   'if (target >= 0) render(target, alpha);'],
  ['sequence: a late upper frame never repaints the pair', 'src/modules/sequence.ts',
   'if (index === lastDrawn || (tween && index === lastDrawn + 1)) render(lastDrawn, lastAlpha);',
   'if (index === lastDrawn) render(lastDrawn, lastAlpha);'],
  ['sequence: globalAlpha is left set after a blend', 'src/modules/sequence.ts',
   '    context.globalAlpha = 1;\n  };', '  };'],
  /**
   * Two of the four refusals `docs/modules/sequence.md` documents were
   * deletable with all 1,120 tests green, which is how they got here.
   */
  ['sequence: an allowedOrigins that is not a list takes the page down', 'src/sequence.ts',
   '  const allowedOrigins = (Array.isArray(declared) ? declared : []).flatMap((entry) => {',
   '  const allowedOrigins = (declared ?? []).flatMap((entry) => {'],
  ['sequence: a refused allowlist is refused in silence', 'src/sequence.ts',
   '  if (declared !== undefined && !Array.isArray(declared)) {', '  if (false) {'],
  ['sequence: the origin allowlist is taken unnormalised', 'src/sequence.ts',
   '      return [new URL(entry).origin];',
   '      return [entry];'],
  ['sequence: a frame-count of zero is refused silently', 'src/sequence.ts',
   'return fail(`${ATTRIBUTE_PREFIX}-frame-count must be a positive number.`);',
   'return null;'],
  /**
   * The drawer cache outlived the settings it was built from: `release` was
   * the only thing that dropped one, and it does not run on a re-parse.
   */
  ['sequence: an edited frame setting keeps the old drawer', 'src/sequence.ts',
   'if (was !== undefined && was !== settingsKey(node)) forget(node);',
   'if (was === undefined) forget(node);'],
  /**
   * The other half — a `prepare` that forgets unconditionally passes every
   * test about an edit taking effect and quietly re-fetches the whole
   * sequence on each `collect()`.
   */
  ['sequence: every collect() rebuilds the drawer from scratch', 'src/sequence.ts',
   'if (was !== undefined && was !== settingsKey(node)) forget(node);',
   'forget(node);'],
  /**
   * A paint value is a slot in a shared table, not a quantity — the numbers
   * between two of an element's slots belong to other elements. Three links,
   * each plantable on its own: the flag, the plumbing, and the evaluation.
   */
  /**
   * The `forget` insert's whole safety argument is "only when the last
   * instance goes". Firing it per destroy empties the table while another
   * instance's curves still hold slot numbers.
   */
  ['modules: page state is forgotten while an instance is still live', 'src/modules/createMotion.ts',
   '      if (--liveInstances === 0) runInserts(\'forget\');',
   '      --liveInstances; runInserts(\'forget\');'],
  ['modules: page state is never forgotten at all', 'src/modules/createMotion.ts',
   '      if (--liveInstances === 0) runInserts(\'forget\');',
   '      --liveInstances;'],
  ['paint: colour slots are interpolated like quantities', 'src/paint.ts',
   '  discrete: true,',
   '  discrete: false,'],
  /**
   * The image-set finding: `image-set("…")` fetches with no `url(` in the
   * value, in all three engines. A guard that regresses to the one spelling
   * is a guard an attribute walks straight past — the exact shipped bug.
   */
  ['paint: the image guard names only the url() spelling', 'src/paint.ts',
   '    if (/url\\(|image-set\\(|image\\(|cross-fade\\(|element\\(/i.test(value)) return null;',
   '    if (/url\\(/i.test(value)) return null;'],
  ['curve: a held curve interpolates between keyframes anyway', 'src/modules/curve.ts',
   'if (hold) return values[i]!;',
   'if (!hold) return values[i]!;'],
  ['runtime: a discrete property is built as an ordinary curve', 'src/modules/runtime.ts',
   'const curve = buildCurve(points, ease, a.property.discrete, arena, at);',
   'const curve = buildCurve(points, ease, false, arena, at);'],
  /**
   * The arena's failure class: an off-by-one in the placement arithmetic
   * corrupts a *neighbouring* curve, and the symptom surfaces on whichever
   * property that neighbour drives — nowhere near the arithmetic. One plant
   * per address: the placement stride, and each intra-curve view boundary.
   */
  ['runtime: two curves share overlapping arena slices', 'src/modules/runtime.ts',
   '    at += slice(a);',
   '    at += slice(a) - 1;'],
  ['curve: a carved curve\'s values overlap its positions', 'src/modules/curve.ts',
   '    values: a.subarray(offset + n, offset + 2 * n),',
   '    values: a.subarray(offset + n - 1, offset + 2 * n - 1),'],
  ['curve: a carved curve\'s slopes overlap its values', 'src/modules/curve.ts',
   '    slopes: a.subarray(offset + 2 * n, offset + 2 * n + Math.max(0, n - 1)),',
   '    slopes: a.subarray(offset + 2 * n - 1, offset + 2 * n - 1 + Math.max(0, n - 1)),'],
  /**
   * The same category error where a missing end is filled: `initial` is a slot
   * number for a discrete property, and slot 0 belongs to whoever minted first.
   */
  ['runtime: a discrete property rests on slot 0', 'src/modules/runtime.ts',
   "      ? (merged[0] ?? animation.bands[0]?.keyframes[0])?.value ?? animation.property.initial",
   '      ? animation.property.initial'],
  /**
   * The audit's systemic finding: settings were never
   * range-checked. Nothing planted a bug at the line that fixed it until the
   * settings sweep existed to catch one.
   */
  ['schema: a setting past its declared maximum is accepted', 'src/modules/parse.ts',
   '          !(def.max !== undefined && value > def.max);',
   '          true;'],
  ['schema: a setting below its declared minimum is accepted', 'src/modules/parse.ts',
   '          !(def.min !== undefined && value < def.min) &&',
   ''],
  /**
   * The catch rethrows, which is what "the guard does not guard" looks like.
   * The first version of this appended `if (0) throw 0;` after the call — dead
   * code that never throws, so the mutation planted nothing and survived, and
   * the survivor was the mutation rather than a hole in the suite.
   */
  /**
   * Both loops iterate an array, so a `destroy()` from `onProgress` used to
   * leave the iteration writing styles onto elements teardown had cleaned.
   */
  ['runtime: a scroll container resize is never noticed', 'src/modules/createMotion.ts',
   '      if (scrollElement !== window) sizeObserver.observe(scrollElement as Element);',
   ''],
  ['runtime: the init pass writes past a re-entrant teardown', 'src/modules/createMotion.ts',
   '      /** Re-read per element: both calls below reach `onProgress`, which can tear the instance down. */\n      if (!enabled) return;\n',
   ''],
  ['runtime: a mutation batch writes past a re-entrant teardown', 'src/modules/createMotion.ts',
   '    for (const element of list) {\n      if (!enabled) return;\n',
   '    for (const element of list) {\n'],
  ['easings: an option-supplied ease is reported as an attribute', 'src/modules/runtime.ts',
   '  const named = declared ? `${ATTRIBUTE_PREFIX}-ease="${value}"` : `ease "${value}" (an option, not an attribute)`;',
   '  const named = `${ATTRIBUTE_PREFIX}-ease="${value}"`;'],
  ['easings: a throwing resolver escapes init', 'src/modules/runtime.ts',
   '    } catch {\n      threw = true;\n    }',
   '    } catch (error) {\n      throw error;\n    }'],
  ['easings: a throwing resolver goes unreported', 'src/modules/runtime.ts',
   '  if (threw) {',
   '  if (false) {'],
  ['modules: a throwing insert stops the rest of the chain', 'src/modules/createMotion.ts',
   "        (fn as (...rest: readonly unknown[]) => void)(...args);\n      } catch (error) {",
   "        (fn as (...rest: readonly unknown[]) => void)(...args);\n      } catch (error) { throw error;"],
  ['modules: a throwing prepare escapes init', 'src/modules/createMotion.ts',
   "      runInserts('prepare', root, enabled);\n      for (const node of findElements(root)) found.add(node);",
   "      for (const fn of insert('prepare')) fn(root, enabled);\n      for (const node of findElements(root)) found.add(node);"],
  /**
   * The three module-boundary crossings the audit's own table did not list. All
   * are authored by a module, third-party ones included.
   */
  ['modules: a throwing apply escapes the frame loop', 'src/modules/runtime.ts',
   `    let refusal: void | string;
    try {
      refusal = applyProperty(element.node, animation.property, animation.unit, value);
    } catch {
      refusal = \`\${animation.property.attribute}: this module's apply threw.\`;
    }`,
   '    const refusal = applyProperty(element.node, animation.property, animation.unit, value);'],
  ['modules: a throwing property parse takes init down', 'src/modules/schema.ts',
   'try { slot = property.parse(raw); } catch { /* refused, like any bad value */ }',
   'slot = property.parse(raw);'],
  ['modules: a throwing setting parse takes init down', 'src/modules/parse.ts',
   'try { parsed = def.parse(raw); } catch { /* refused */ }',
   'parsed = def.parse(raw);'],
  ['modules: a throwing teardown escapes destroy', 'src/modules/createMotion.ts',
   "    runInserts('teardown', inRoots);",
   "    for (const fn of insert('teardown')) fn(inRoots);"],
  /**
   * Configuration problems reach `rejected`, not only the console — the GUI
   * this library exists for renders one and cannot read the other.
   */
  ['scrollto: a non-function onComplete throws out of a public method',
   'src/modules/createScrollTo.ts',
   "    if (opts.onComplete !== undefined && typeof opts.onComplete !== 'function') {",
   '    if (false) {'],
  ['scrollto: a direction that is neither is read as vertical in silence', 'src/modules/createScrollTo.ts',
   "  if (settings.scrollDirection !== 'vertical' && settings.scrollDirection !== 'horizontal') {",
   '  if (false) {'],
  ['scrollto: an option name that does not exist is accepted in silence', 'src/modules/createScrollTo.ts',
   '    if (!KNOWN_OPTIONS.has(key)) {', '    if (false) {'],
  ['diagnostics: a refused setting is named but never explained', 'src/modules/parse.ts',
   "    const no = (why: string): void => { rejected.push(`${name}: ${why}`); };",
   '    const no = (why: string): void => { void why; rejected.push(name); };'],
  ['diagnostics: a setting with its own parse gets the wrong reason', 'src/modules/parse.ts',
   "      if (parsed === null) no(WHY[def.type] ?? (__DEV__ ? 'was refused by the module that owns it' : 'refused'));",
   "      if (parsed === null) no('was refused by the module that owns it');"],
  /**
   * The reason now branches on whether a near name was found, so the anchor is
   * the dev branch's opening rather than a single push.
   */
  ['diagnostics: an unknown attribute is named but not called unknown', 'src/modules/parse.ts',
   '          const meant = probablyMeant(name.slice(SUB_PREFIX.length));',
   '          const meant = null; rejected.push(name); return;'],
  /**
   * And the half the message change was *for*: an attribute whose module is
   * simply not wired must not be reported as a misspelling.
   */
  ['diagnostics: an unwired module attribute is blamed on spelling', 'src/modules/parse.ts',
   '            : `${name}: no such attribute — check the spelling, or wire the module that provides it.`);',
   '            : `${name}: not an attribute this library has — check the spelling`);'],
  ['parse: an element with no offsetTop is animated to NaN in silence', 'src/modules/parse.ts',
   "  if (typeof HTMLElement === 'function' && !(node instanceof HTMLElement)) {", '  if (false) {'],
  ['diagnostics: a marked root is not one of its own elements', 'src/modules/parse.ts',
   "  if (self.nodeType === 1 && self.hasAttribute(ATTRIBUTE_PREFIX)) found.unshift(self);", ''],
  ['diagnostics: the root is collected after its children rather than first',
   'src/modules/parse.ts',
   'found.unshift(self);', 'found.push(self);'],
  ['diagnostics: the root itself is never looked at', 'src/modules/createMotion.ts',
   '      const nodes: Element[] = rootElement ? [rootElement] : [];',
   '      const nodes: Element[] = [];'],
  ['diagnostics: a second instance animating the same element says nothing',
   'src/modules/createMotion.ts',
   '    const held = CLAIMED.get(element.node);\n    if (held && held !== owner) {',
   '    const held = CLAIMED.get(element.node);\n    if (false) {'],
  ['diagnostics: destroy leaves its claims behind, so the next instance is accused',
   'src/modules/createMotion.ts',
   '    for (const element of elements) unclaim(element.node);\n    elements = [];',
   '    elements = [];'],
  ['diagnostics: a claim is dropped on any instance, not only its owner',
   'src/modules/createMotion.ts',
   '    if (CLAIMED.get(node) === owner) CLAIMED.delete(node);', '    CLAIMED.delete(node);'],
  ['diagnostics: a when element is told the page is too short for it', 'src/modules/runtime.ts',
   '    !element.when &&\n    win.reach > win.size &&', '    win.reach > win.size &&'],
  ['diagnostics: an option given as undefined overrides its default', 'src/modules/createMotion.ts',
   '    if (value === undefined && key in DEFAULTS) {', '    if (false) {'],
  ['scrollto: an option given as undefined overrides its default', 'src/modules/createScrollTo.ts',
   '    if (value === undefined && key in DEFAULTS) {', '    if (false) {'],
  ['diagnostics: a boolean option is read as truthy rather than refused', 'src/modules/createMotion.ts',
   '    if (given === undefined || typeof given === "boolean") continue;'.replace(/"/g, "'"),
   '    if (given !== null) continue;'],
  ['diagnostics: a refused boolean option keeps the value instead of the default',
   'src/modules/createMotion.ts',
   '    (settings as Record<string, unknown>)[key] = fallback;', '    void fallback;'],
  ['scrollto: a boolean option is read as truthy rather than refused', 'src/modules/createScrollTo.ts',
   '    if (given === undefined || typeof given === "boolean") continue;'.replace(/"/g, "'"),
   '    if (given !== null) continue;'],
  ['diagnostics: an option name that does not exist is accepted in silence', 'src/modules/createMotion.ts',
   '    if (!KNOWN_OPTIONS.has(key)) {', '    if (false) {'],
  ['diagnostics: the options with no default are treated as unknown', 'src/modules/createMotion.ts',
   "const KNOWN_OPTIONS = new Set([...Object.keys(DEFAULTS), 'root', 'onProgress']);",
   'const KNOWN_OPTIONS = new Set([...Object.keys(DEFAULTS)]);'],
  ['diagnostics: a bad option is warned about but not reported', 'src/modules/createMotion.ts',
   '      const setup = [...pageProblems(), ...configProblems];\n      if (setup.length) out.push({ node: null, rejected: setup });',
   '      const setup = [...pageProblems()];\n      if (setup.length) out.push({ node: null, rejected: setup });'],
  ['diagnostics: a bad option is reported but not warned about', 'src/modules/createMotion.ts',
   '    console.warn(`@verajs/motion: ${reason}`);\n  };',
   '  };'],
  ['diagnostics: an unresolved scrollElement says nothing', 'src/modules/dom.ts',
   '    report(`no element matched scrollElement "${option}"; using window.`);',
   ''],
  ['api: a throwing onProgress takes the instance down', 'src/modules/createMotion.ts',
   '    onProgress: guarded(options.onProgress, problem),',
   "    onProgress: typeof options.onProgress === 'function' ? options.onProgress : undefined,"],
  ['api: a throwing onProgress is called again every frame', 'src/modules/createMotion.ts',
   "      live = false;\n      report('onProgress threw, so it is being ignored from here on.');",
   "      report('onProgress threw, so it is being ignored from here on.');"],
  ['easings: a resolver answering nonsense reaches the curve', 'src/modules/runtime.ts',
   "      if (typeof shaped === 'function') return shaped;\n      if (shaped) threw = true;",
   '      if (shaped) return shaped;'],
  ['easings: an unshaped ease is reported to the console only', 'src/modules/runtime.ts',
   'reject(node, __DEV__ ? `${named} needs the easings module; the curve is linear.` : `${named}: needs easings module`);',
   ''],
  ['sequence: a canvas with no 2D context is refused silently', 'src/sequence.ts',
   "if (!drawer) return fail('this canvas has no 2D context.');",
   'if (!drawer) return null;'],
  ['modules: wireMotion takes the page down on something that is not a module', 'src/modules/schema.ts',
   "    if (!one || typeof one !== 'object' || !('on' in one || 'attribute' in one)) {",
   '    if (false) {'],
  ['modules: a refused module is refused in silence', 'src/modules/createMotion.ts',
   '      const setup = [...pageProblems(), ...configProblems];',
   '      const setup = [...configProblems];'],
  ['modules: a registration that replaces another is silent', 'src/modules/schema.ts',
   '  if (prior && prior !== next) {', '  if (false) {'],
  ['modules: wiring the same module twice reports a clash', 'src/modules/schema.ts',
   '  if (prior && prior !== next) {', '  if (prior) {'],
  ['modules: a split with nothing to inherit is split anyway', 'src/split.ts',
   '        if (!node.getAttributeNames().some(', '        if (false && !node.getAttributeNames().some('],
  ['modules: a split checks for inheritable attributes before restoring them',
   'src/split.ts',
   '          restore(node);\n          for (const [name, value] of fresh) node.setAttribute(name, value);',
   '          for (const [name, value] of fresh) node.setAttribute(name, value);'],
  ['modules: a descriptor that is both a setting and a property is installed anyway',
   'src/modules/schema.ts',
   "    else if ('type' in one && 'category' in one) {", "    else if (false) {"],
  ['modules: a property with no way to write anything is registered',
   'src/modules/schema.ts',
   "    else if (!('cssProperty' in one) && !('cssFunction' in one) && !('apply' in one)) {",
   '    else if (false) {'],
  ['modules: insert points overwrite instead of chaining', 'src/modules/schema.ts',
   'chain.push(one.fn);', 'chain.length = 0; chain.push(one.fn);'],
  ['audit: window in module-scope DEFAULTS', 'src/modules/dom.ts',
   'if (option === undefined) return window;', ''],
  ['api: scroll-to loses selector support', 'src/modules/dom.ts',
   "  try {\n    const found = document.querySelector(option) as HTMLElement | null;",
   '  try {\n    const found = null as HTMLElement | null;'],
  ['modules: teardown ignores which instance owns the node', 'src/split.ts',
   'for (const node of [...live.keys()]) if (owns(node)) restore(node);',
   'for (const node of [...live.keys()]) restore(node);'],
  ['audit: destroy leaves `prepared` set for the next init', 'src/modules/createMotion.ts',
   '    prepared = false;\n    reducedMotion = false;', '    reducedMotion = false;'],
  ['audit: enable() runs before init or after destroy', 'src/modules/createMotion.ts',
   '      if (!started) { wanted = true; return; }\n      /**\n       * Before the `enabled` guard',
   '      /**\n       * Before the `enabled` guard'],
  ['easings: bezier built from junk instead of four finite numbers', 'src/modules/easings.ts',
   'if (points.length !== 4 || points.some((n) => !Number.isFinite(n))) return null;',
   'if (false) return null;'],

  /**
   * Newton-Raphson alone. The failure it was thought to have was a zero
   * derivative; the failure it has is leaving the interval and compounding.
   */
  ['easings: the bezier solver has no fallback when Newton walks off', 'src/modules/easings.ts',
   `    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i++) {
      t = (low + high) / 2;
      if (curve(t, x1, x2) < progress) low = t;
      else high = t;
    }
    return curve(t, y1, y2);`,
   '    return curve(t, y1, y2);'],
  /**
   * The convergence exit is what keeps the common curves cheap; without it
   * every one of them pays for eight Newton steps and then bisects anyway.
   */
  ['easings: the solver never stops early, so it always bisects', 'src/modules/easings.ts',
   '      if (offBy > -1e-6 && offBy < 1e-6) return curve(t, y1, y2);',
   '      if (offBy > 1) return curve(t, y1, y2);'],
  /** An object literal here inherits five keys that look like easings. */
  ['easings: the keyword table inherits from Object.prototype', 'src/modules/easings.ts',
   'const keyword = KEYWORDS.get(value);',
   'const keyword = { ...Object.fromEntries(KEYWORDS) }[value];'],
  ['schema: accept a zero or negative step count', 'src/modules/schema.ts',
   'steps\\(\\s*([1-9]\\d*)', 'steps\\(\\s*(\\d*)'],
  ['schema: accept steps(1, jump-none), which no engine does', 'src/modules/schema.ts',
   "return stepped[2] === 'jump-none' && stepped[1] === '1' ? null : value;",
   'return value;'],
  ['easings: a step position that is not one resolves anyway', 'src/modules/easings.ts',
   'const STEPS_FORM = /^steps\\(\\s*([1-9]\\d*)\\s*(?:,\\s*(jump-(?:start|end|none|both)|start|end)\\s*)?\\)$/;',
   'const STEPS_FORM = /^steps\\(\\s*([1-9]\\d*)\\s*(?:,\\s*([a-z-]+)\\s*)?\\)$/;'],
  ['split: direction-opposing text is scrambled instead of refused', 'src/modules/split.ts',
   "  if (opposing.test(original)) {",
   '  if (false) {'],
  ['split: the word cap counts the spaces it puts back', 'src/modules/split.ts',
   "      : tokenise(original).filter((part) => !isSpace(part)).length;",
   '      : tokenise(original).length;'],
  ['paint: slot table bounded by length but not by count', 'src/paint.ts',
   'if (values.length >= MAX_VALUES) {', 'if (false) {'],
  ['when: a selector naming an ancestor never re-evaluates', 'src/modules/observer.ts',
   '        } else {\n          foreign = true;\n        }', '        } else {\n        }'],
  ['stagger: editing the step on a non-animated parent does nothing', 'src/modules/observer.ts',
   'for (const element of animatedWithin(mutation.target)) changed.add(element);', ''],
  ['visibility: margin ignores which axis is scrolled', 'src/modules/visibility.ts',
   'return horizontal ? `0px ${trail}px 0px ${lead}px` : `${lead}px 0px ${trail}px 0px`;',
   'return `${lead}px 0px ${trail}px 0px`;'],

  /**
   * A timeline unit is the element *plus* the root, so a margin sized in
   * roots alone falls further short the taller the element is.
   */
  ['visibility: the margin ignores the element own size', 'src/modules/visibility.ts',
   'const span = element.size + rootSize;',
   'const span = rootSize;'],
  ['visibility: an element added later is watched with the old margin', 'src/modules/createMotion.ts',
   '    if (visible && fresh.some((element) => !visible!.covers(element))) retrack();',
   ''],
  ['visibility: every mutation batch rebuilds the tracker', 'src/modules/createMotion.ts',
   '    if (visible && fresh.some((element) => !visible!.covers(element))) retrack();',
   '    if (visible) retrack();'],
  ['visibility: covers() only asks about one edge', 'src/modules/visibility.ts',
   '      return b <= before && a <= after;', '      return b <= before;'],
  /**
   * A pixel margin does not resolve itself against the current root the way a
   * percentage did, so a re-measure that rebuilds no curves still invalidates
   * it. Gating the rebuild was right for a percentage and wrong for this.
   */
  /**
   * An element measured with no box — `display: none` — reads as past the end
   * of its own animation, and nothing tells the library to look again when it
   * is revealed inside a container that does not change size.
   */
  /**
   * Nothing watched an element's own box, so a size change after load — an
   * accordion opening, a lazy image, a font swap — was never noticed inside a
   * container that did not itself resize.
   */
  ['visibility: an element own box is not watched', 'src/modules/createMotion.ts',
   '      boxes = sizeObserver;\n      for (const element of elements) sizeObserver.observe(element.node);\n',
   ''],
  ['visibility: an element adopted after init is not watched', 'src/modules/createMotion.ts',
   '    boxes?.observe(element.node);\n', ''],
  ['visibility: a removed element is still watched for resizes', 'src/modules/createMotion.ts',
   '    boxes?.unobserve(element.node);\n', ''],
  ['visibility: an element revealed after init is never re-measured',
   'src/modules/createMotion.ts',
   '    if (active && element.size === 0) resetElement(element, runtimeSettings);\n', ''],
  ['visibility: every reported element is re-measured, not only the boxless ones',
   'src/modules/createMotion.ts',
   'if (active && element.size === 0) resetElement(element, runtimeSettings);',
   'if (active) resetElement(element, runtimeSettings);'],
  ['visibility: a resize leaves the margin sized for the old viewport',
   'src/modules/createMotion.ts',
   '    );\n    /**\n     * Unconditionally, because the root margin is in pixels.',
   '    );\n    if (!elements.some((e) => e.geometryDependent)) return;\n    /**\n     * Unconditionally, because the root margin is in pixels.'],  ['runtime: a stale transition batch restyles a dropped element', 'src/modules/runtime.ts',
   '      if (alive && !alive(element)) continue;\n', ''],
  ['pin: always sticks to the top, whatever axis is scrolled', 'src/modules/runtime.ts',
   "    if (settings.scrollDirection === 'horizontal') node.style.setProperty('inset-inline-start', String(pin));\n    else node.style.top = String(pin);",
   '    node.style.top = String(pin);'],
  /**
   * `enable()` and the media-query listener are the same instruction arriving
   * by different doors, and only one of them built what a module never got to.
   */
  ['modules: turning reduced motion off never prepares the page',
   'src/modules/createMotion.ts',
   '        reprepare();\n        start();',
   '        start();'],
  /**
   * The escape hatch the README promises. Without this the resolver compares
   * only `off` against `enabled`, so a preference that moves twice walks over
   * an explicit `enable()` or `disable()` and puts the instance back where the
   * media query wants it.
   */
  ['audit: a preference change overrides an explicit enable or disable',
   'src/modules/createMotion.ts',
   '      if (!following) return;\n      const off = reducedMotion || touchDisabled;',
   '      const off = reducedMotion || touchDisabled;'],
  /**
   * `scrollLeft` is 0 at the right edge in an RTL scroller and goes negative;
   * `offsetLeft` stays physical. Unreconciled, every horizontal timeline ran
   * backwards.
   */
  /**
   * `offsetTop` is immune to transforms, which is why it is used — and why an
   * ancestor's transform was invisible while it moved the element for real.
   */
  /**
   * `100%` is where the element has fully left, so one at the end of the page
   * can never get there. A last section reached 0.222 of its timeline and
   * stopped, silently.
   */
  ['diagnostics: an animation the page is too short to finish says nothing',
   'src/modules/runtime.ts',
   '    !element.when &&\n    win.reach > win.size &&\n    win.reach - element.start < element.highestEnd * (element.size + win.size);',
   '    false;'],
  ['diagnostics: every element on an unscrollable page is reported',
   'src/modules/runtime.ts',
   '    win.reach > win.size &&\n', ''],
  ['diagnostics: reach is compared against 1 rather than the authored end',
   'src/modules/runtime.ts',
   'element.highestEnd * (element.size + win.size)', '(element.size + win.size)'],
  /** A condition that can stop being true, recorded once and never revisited. */
  ['diagnostics: the page-too-short state is never recomputed', 'src/modules/runtime.ts',
   '  markUnfinishable(element, win ?? getWindowSize', '  if (false) markUnfinishable(element, win ?? getWindowSize'],
  ['runtime: an ancestor transform is not corrected for', 'src/modules/runtime.ts',
   '    start: start + displaced,\n    end: end + displaced,', '    start,\n    end,'],
  ['runtime: a re-measure drops the displacement again', 'src/modules/runtime.ts',
   '  element.start = start + element.displaced;\n  element.end = end + element.displaced;',
   '  element.start = start;\n  element.end = end;'],
  ['runtime: the displacement is not rounded to the layout domain', 'src/modules/dom.ts',
   'return Math.round(drawn - layoutStart);', 'return drawn - layoutStart;'],
  ['runtime: an element with no box reports a displacement', 'src/modules/dom.ts',
   '  if (!rect.width && !rect.height) return 0;\n', ''],
  ['runtime: the displacement is applied to a mirrored axis too', 'src/modules/dom.ts',
   '  if (horizontal && isRtl(container ?? document.documentElement)) return 0;\n', ''],
  ['runtime: an rtl container scrolls its timeline backwards', 'src/modules/dom.ts',
   'return horizontal ? node.scrollLeft * (isRtl(node) ? -1 : 1) : node.scrollTop;',
   'return horizontal ? node.scrollLeft : node.scrollTop;'],
  ['runtime: an rtl element is measured from the wrong edge', 'src/modules/dom.ts',
   "  const scroller = container ?? document.documentElement;\n  if (scrollDirection === 'horizontal' && isRtl(scroller)) {\n    start = scroller.clientWidth - start - size;\n  }\n",
   '  const scroller = container ?? document.documentElement;\n'],
  ['runtime: the rtl flip is applied to the vertical axis too', 'src/modules/dom.ts',
   "if (scrollDirection === 'horizontal' && isRtl(scroller)) {",
   'if (isRtl(scroller)) {'],
  /**
   * **No SSR mutations here, deliberately.** The no-DOM guards
   * (`supports()`'s `typeof` tests, `refresh()`/`update()`'s started checks,
   * `toPosition`'s early return) are covered by `tests/motion-no-dom.test.mjs`
   * at the repository root, which runs in a realm with no DOM globals against
   * the built artifacts in both sweeps. This runner executes motion's own
   * happy-dom suite, where a DOM always exists — so a mutation removing a
   * guard survives for want of an executor rather than for want of a test,
   * which is the one thing a mutation table must never record. Two were
   * planted, both survived for exactly that reason, and both were removed.
   */
  ['scrollTo: a poisoned timestamp hangs the tween forever', 'src/modules/createScrollTo.ts',
   "      if (!Number.isFinite(timestamp)) {\n        frame = requestAnimationFrame(step);\n        return;\n      }",
   ''],
  ['scrollTo: a back-to-top link is reported broken and left to jump', 'src/modules/createScrollTo.ts',
   "        if (decoded === 'top') {\n          links.push({ node: node as HTMLElement, id: null });\n          continue;\n        }",
   ''],
  ['scrollTo: the back-to-top link lights up whenever nothing is active', 'src/modules/createScrollTo.ts',
   "      link.node.classList.toggle(settings.activeClass, link.id !== null && link.id === current);",
   '      link.node.classList.toggle(settings.activeClass, link.id === current);'],
  /**
   * A fragment alone was the whole test, so a link to another page whose
   * fragment matched a local id was intercepted and never navigated.
   */
  /**
   * `href="#"` is the commonest spelling of a back-to-top link, and all three
   * engines scroll to the top for it — skipping it makes that one anchor jump
   * while every other glides.
   */
  ['scrollTo: an empty fragment is skipped instead of glided', 'src/modules/createScrollTo.ts',
   '      if (emptyFragment) {', '      if (false) {'],
  ['scrollTo: a link to another document is intercepted', 'src/modules/createScrollTo.ts',
   '      if (!sameDocument) continue;', ''],
  ['scrollTo: zero the axis that is not being tweened', 'src/modules/createScrollTo.ts',
   '      horizontal ? (isRtl(document.documentElement) ? -position : position) : window.scrollX,\n      horizontal ? window.scrollY : position',
   '      horizontal ? (isRtl(document.documentElement) ? -position : position) : 0,\n      horizontal ? 0 : position'],
  /**
   * `children` is elements only, so a comment node passed the check and was
   * destroyed by the split — `the <!-- c --> fox` came back as `the  fox`.
   */
  ['split: a mode change never re-splits', 'src/split.ts',
   '          if (already.mode === mode && !editedSinceSplit(node)) continue;',
   '          continue;'],
  ['split: a comment node is treated as plain text', 'src/modules/split.ts',
   '    if (node.childNodes[i]!.nodeType === 3) continue;',
   '    if (node.childNodes[i]!.nodeType !== 1) continue;'],
  ['split: chars splits by code point instead of grapheme', 'src/modules/split.ts',
   'segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);',
   'Array.from(text);'],
  ['sequence: in-flight frames for scrolled-away territory are never abandoned', 'src/modules/sequence.ts',
   '      abandon(i);\n      freed = true;', '      freed = false;'],
  /**
   * A wrong `frame-url` builds a perfectly good drawer and then fails every
   * fetch — a blank canvas with an empty `rejected` and no console line.
   */
  ['sequence: a failed frame is requested again on every draw', 'src/modules/sequence.ts',
   '        if (loaded[index] || pending.has(index) || failed.has(index)) continue;',
   '        if (loaded[index] || pending.has(index)) continue;'],
  ['sequence: a frame that never loads says nothing', 'src/modules/sequence.ts',
   '        if (!reportedFailure) {\n          reportedFailure = true;\n          options.onFailure?.(image.src);\n        }\n',
   ''],
  ['sequence: a live drawer hides a refusal recorded since', 'src/sequence.ts',
   '      if (drawer) drawer.draw(value);',
   '      if (drawer) { drawer.draw(value); return; }'],
  ['sequence: destroy leaves its fetches running', 'src/modules/sequence.ts',
   'for (const i of [...inProgress.keys()]) abandon(i);', ''],
  ['schema: properties() returns only the built-ins, not wired modules', 'src/modules/schema.ts',
   'export const properties = (): readonly PropertyDef[] => [...BY_ATTRIBUTE.values()];',
   'export const properties = (): readonly PropertyDef[] => PROPERTIES as PropertyDef[];'],
  ['schema: settings() returns only the built-ins, not wired modules', 'src/modules/schema.ts',
   'export const settings = (): readonly SettingDef[] => [...BY_SETTING.values()];',
   'export const settings = (): readonly SettingDef[] => SETTINGS as SettingDef[];'],
  ['presets: a band-suffixed override suppresses the preset entirely', 'src/modules/parse.ts',
   'if (into.get(property)?.base !== undefined) continue;', 'if (into.has(property)) continue;'],
  ['diagnostics: stale rejections survive a re-parse and pile up', 'src/modules/createMotion.ts',
   'if (batch.has(dropped[i]!.node)) dropped.splice(i, 1);', '/* dropped */;'],
  ['will-change: hint everything instead of what the element animates', 'src/modules/runtime.ts',
   "if (hints.size) node.style.willChange = [...hints].join(', ');",
   "node.style.willChange = 'transform, filter';"],
  ['scrollTo: destroy leaves the instance disabled for its next init', 'src/modules/createScrollTo.ts',
   '      enabled = true;\n      /** Diagnostics for a page this instance no longer looks at. */',
   '      /** Diagnostics for a page this instance no longer looks at. */'],
  ['scrollTo: destroy keeps diagnostics for a page it no longer reads', 'src/modules/createScrollTo.ts',
   '      /** Diagnostics for a page this instance no longer looks at. */\n      problems = [];', ''],
  /**
   * `destroy()` releases the styles it injected. It was releasing the author's
   * with them — a page builder's `transform: translateX(-50%)` for centring did
   * not survive a teardown.
   */
  ['runtime: teardown keeps the styles it took over', 'src/modules/runtime.ts',
   `  /** Last, so it lands on top of every removal above. */
  for (let i = 0; i < element.restore.length; i += 2) {
    node.style.setProperty(element.restore[i]!, element.restore[i + 1]!);
  }`,
   ''],
  ['runtime: every managed style is recorded, not only the ones that were set',
   'src/modules/runtime.ts',
   'if (had) restore.push(name, had);',
   'restore.push(name, had);'],
  /**
   * A second instance reads the first one's current frame as the page's value,
   * and hands it back on teardown.
   */
  ['runtime: a second instance records the first one output as the page value',
   'src/modules/runtime.ts',
   '  if (!adopted.has(node)) {\n    adopted.add(node);',
   '  {'],
  ['runtime: re-measure drops the scroll container offset', 'src/modules/runtime.ts',
   'getElementSize(node, settings.scrollDirection, settings.scrollElement);\n  /** Layout position plus whatever else is moving it',
   'getElementSize(node, settings.scrollDirection);\n  /** Layout position plus whatever else is moving it'],
  ['path: an edited-away selector keeps its offset-path forever', 'src/path.ts',
   "      for (const node of [...written.keys()]) {\n        if ((root === node || root.contains(node)) && !node.hasAttribute(SELECTOR_ATTRIBUTE)) {\n          restore(node);\n        }\n      }\n",
   ''],
  ['path: an element following no path says nothing', 'src/path.ts',
   'reject(node, `${ATTRIBUTE_PREFIX}-path needs ${SELECTOR_ATTRIBUTE}`);', ''],
  ['bands: an earlier band wins over a later one at an overlap', 'src/modules/runtime.ts',
   'for (const band of animation.bands) {', 'for (const band of [...animation.bands].reverse()) {'],
  ['diagnostics: a scroller that has left the document says nothing',
   'src/modules/createMotion.ts',
   '    if (scrollElement !== window && !(scrollElement as Node).isConnected) {', '    if (false) {'],
  ['marker: an unmarked stagger host that staggers nothing says nothing',
   'src/modules/createMotion.ts',
   '          element.hasAttribute(`${ATTRIBUTE_PREFIX}-stagger`) &&', '          false &&'],
  ['marker: a split container is accused of staggering nothing', 'src/modules/createMotion.ts',
   '          !element.hasAttribute(`${ATTRIBUTE_PREFIX}-split`) &&', ''],
  ['options: disable() before init() is ignored', 'src/modules/createMotion.ts',
   '      if (!started) { wanted = false; return; }', '      if (!started) return;'],
  ['options: enable() before init() does not undo a disable', 'src/modules/createMotion.ts',
   '      if (!started) { wanted = true; return; }', '      if (!started) return;'],
  ['options: an answer given before init keeps following the preference',
   'src/modules/createMotion.ts',
   '    if (!wanted) following = false;', ''],
  ['parse: a perspective CSS refuses is kept, dropping the whole transform',
   'src/modules/parse.ts',
   "  if (typeof perspective === 'string' && (perspective.startsWith('-') || perspective.endsWith('%'))) {",
   '  if (false) {'],
  ['path: a path the engine will not take is written anyway', 'src/path.ts',
   "    (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('offset-path', `path(\"${cleaned}\")`))",
   '    true'],
  ['parse: a transform-origin with two keywords on one axis is accepted',
   'src/modules/schema.ts',
   '    if (!positional && !named) return null;', ''],
  ['parse: a transform-origin third value need not be a length', 'src/modules/schema.ts',
   '    if (c !== undefined && !isLength(c)) return null;', ''],
  ['parse: a bezier x outside 0-1 is accepted and CSS drops the transition',
   'src/modules/schema.ts',
   '    if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) return null;', ''],
  ['schema: a module parse returning NaN crosses into the curve', 'src/modules/schema.ts',
   "    return typeof slot === 'number' && Number.isFinite(slot) ? { value: slot, unit: '' } : null;",
   "    return slot === null ? null : { value: slot, unit: '' };"],
  ['parse: a magnitude CSS cannot express is accepted', 'src/modules/schema.ts',
   '  if (Math.abs(value) > MAX_MEASURE) return null;', ''],
  ['parse: a selector list is refused with the wrong reason', 'src/modules/parse.ts',
   "        if (selector === null && raw.includes(',')) {", '        if (false) {'],
  ['when: a selector made of unwatchable state is accepted', 'src/modules/parse.ts',
   '    if (blind) {', '    if (false) {'],
  ['when: an unwatchable selector is reported but still used', 'src/modules/parse.ts',
   "      delete settings['when'];", ''],
  ['when: inertia-ease with no catch-up to shape says nothing', 'src/modules/parse.ts',
   "  if (typeof settings['inertia-ease'] === 'string' && Number(effectiveInertia) === 0) {",
   '  if (false) {'],
  ['when: a category override does not rescue inertia-ease', 'src/modules/parse.ts',
   "      (name) => name.endsWith('-inertia') && Number(settings[name]) > 0",
   '      () => false'],
  ['when: inertia-ease ignores the instance default', 'src/modules/parse.ts',
   "  const effectiveInertia = settings['inertia'] ?? context.inertia;",
   "  const effectiveInertia = settings['inertia'];"],
  ['when: an ease that can never shape anything says nothing', 'src/modules/parse.ts',
   "  if (typeof settings['ease'] === 'string' && typeof settings['when'] === 'string') {",
   '  if (false) {'],
  ['stagger: silently inert on a when element', 'src/modules/parse.ts',
   "  if (stagger && typeof settings['when'] === 'string') {", '  if (false) {'],
];

/**
 * The runner only runs when this file is the entry point, so `scripts/audit.js`
 * can import `MUTATIONS` and read the anchors without running the suite.
 * Importing this file used to *be* running it, which is a thirty-minute
 * surprise — and a bare `process.exit(0)` guard is worse, because it ends the
 * importing process too, silently and with a success code.
 */
/** The concern a mutation belongs to: everything before the first colon. */
export const concernOf = (name) => name.split(':')[0];

/** Every concern, with how many mutations it holds. */
export const concerns = () => {
  const counts = new Map();
  for (const [name] of MUTATIONS) {
    const key = concernOf(name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/**
 * Prints one combined verdict from however many shards ran.
 *
 * Separate from the run so a shard reports data and exactly one place decides
 * what it means — eight shards each printing "N/M caught" is eight answers to
 * a question with one answer.
 */
const report = (dir) => {
  const parts = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));
  const survived = parts.flatMap((p) => p.survived);
  const skipped = parts.flatMap((p) => p.skipped);
  const checked = parts.reduce((n, p) => n + p.checked, 0);

  /**
   * Nothing ran is a failure, not a clean sheet.
   *
   * This is the same hole the `--only` filter had, left in the half that
   * aggregates — and it fired within the hour: a bad `MUTATE_WORKERS` made
   * every shell test error, no shard ever started, and this printed
   * `0/0 mutations caught by the suite.` and exited 0. A tool for finding
   * checks that cannot fail is the last place to leave one.
   */
  if (!checked) {
    console.log('\n  0 mutations ran — nothing was verified.');
    return 1;
  }

  console.log(`\n  ${checked - survived.length}/${checked} mutations caught by the suite.`);
  if (skipped.length) {
    /**
     * A skipped mutation is drift, not a pass. Audit rule 10 asserts every
     * anchor is present exactly once, so reaching here means the source moved
     * under an anchor and the count above is quietly measuring less than it
     * claims.
     */
    console.log('  Anchors no longer in the source — the mutation was never planted:');
    for (const name of skipped) console.log(`    - ${name}`);
  }
  if (survived.length) {
    console.log('  Untested behaviour:');
    for (const name of survived) console.log(`    - ${name}`);
  }
  return survived.length + skipped.length ? 1 : 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

  /**
   * Every option, and how many words it takes. Anything else is refused.
   *
   * An unrecognised flag used to be **ignored**, and since planting mutations
   * one at a time is what this script does when it is not asked for something
   * else, the fall-through from a typo was a full in-place run over `src/`.
   * `node scripts/mutate.js --help` did exactly that: it mutated the working
   * tree for an hour, was killed part-way, and left a planted defect behind a
   * green-looking gate — the planted-defect-left-behind failure, through an
   * entrance the worktree runner cannot guard because it is upstream of it.
   *
   * A `Map`, not an object literal: `'--constructor' in {}` is false but the
   * habit is what matters, and `@verajs/motion/easings` has already been bitten
   * by the other version of this.
   */
  const OPTIONS = new Map([
    ['--list', 0], ['--count', 0], ['--here', 0],
    ['--report', 1], ['--only', 1], ['--group', 1], ['--shard', 1], ['--json', 1],
  ]);
  for (let i = 0; i < args.length; i++) {
    const takes = OPTIONS.get(args[i]);
    if (takes === undefined) {
      console.error(`  unknown option: ${args[i]}`);
      console.error(`  known: ${[...OPTIONS.keys()].join(' ')}`);
      process.exit(1);
    }
    i += takes;
  }

  if (args.includes('--list')) {
    const counts = [...concerns()].sort((a, b) => b[1] - a[1]);
    console.log(`\n  ${MUTATIONS.length} mutations across ${counts.length} concerns:\n`);
    for (const [name, count] of counts) console.log(`    ${name.padEnd(14)} ${count}`);
    console.log('\n  npm run mutate -- --group <concern>\n');
    process.exit(0);
  }

  const reportDir = value('--report');
  if (reportDir) process.exit(report(reportDir));

  const only = value('--only');
  const group = value('--group');

  let chosen = MUTATIONS;
  if (group) {
    if (!concerns().has(group)) {
      console.error(`  no such concern: "${group}". Run with --list to see them.`);
      process.exit(1);
    }
    chosen = chosen.filter(([name]) => concernOf(name) === group);
  }
  if (only) chosen = chosen.filter(([name]) => name.includes(only));

  /**
   * Checked before sharding, never after: an empty *selection* is a typo and
   * must fail, while an empty *shard* is ordinary when there are fewer
   * mutations than workers.
   */
  if (!chosen.length) {
    console.error(`  no mutation matched ${group ? `--group ${group} ` : ''}${only ? `--only "${only}"` : ''}.`);
    process.exit(1);
  }

  /**
   * How many mutations the filter selected, for the driver to size itself by.
   *
   * Building eight worktrees to run one mutation spends more on setup than on
   * the run — and a single concern is the common case, which is the case this
   * whole flag set exists to make quick.
   */
  if (args.includes('--count')) {
    console.log(chosen.length);
    process.exit(0);
  }

  const shard = value('--shard');
  const mine = shard
    ? chosen.filter((_, index) => index % Number(shard.split(':')[1]) === Number(shard.split(':')[0]))
    : chosen;

  /**
   * Planting a mutation edits `src/` in place, so it has to be asked for.
   *
   * It used to be what happened when nothing else was asked for, which made
   * the destructive mode the default and every other mode a special case. That
   * is the wrong way round for a tool whose failure mode is leaving a
   * deliberate bug in the working tree. `npm run mutate` builds a throwaway
   * worktree and passes this from inside it; `npm run mutate:here` passes it
   * because that is what it is for, and the trade is documented in CLAUDE.md.
   */
  if (!args.includes('--here')) {
    console.error('  refusing to mutate the working tree without --here.');
    console.error('  npm run mutate        throwaway worktrees, what you want');
    console.error('  npm run mutate:here   in place, and it will edit src/');
    process.exit(1);
  }

  const survived = [];
  const skipped = [];
  let checked = 0;

  for (const [name, path, from, to] of mine) {
    const target = file(path);
    const original = readFileSync(target, 'utf8');
    if (!original.includes(from)) {
      console.log(`  SKIP     ${name} — anchor no longer present`);
      skipped.push(name);
      continue;
    }
    const planted = original.replace(from, to);
    /**
     * A mutation that does not change the file is not a mutation.
     *
     * The anchor check above only asks whether `from` is present, so a
     * replacement equal to it — or one that differs only where the source does
     * not, `if (false) throw 0;` being the case that got written here — plants
     * nothing, passes the suite, and is reported as **SURVIVED**. That reads as
     * "the tests do not cover this", which is the opposite of true and sends
     * the next reader looking for a gap in the wrong place. It is
     * a scripted edit failing silently, inside the tool built to catch defects.
     */
    if (planted === original) {
      console.log(`  BROKEN   ${name} — replacement leaves the file unchanged`);
      skipped.push(name);
      continue;
    }
    writeFileSync(target, planted);
    checked++;
    let caught = false;
    /** The suite wedged rather than answering — see RUN_TIMEOUT. */
    let timedOut = false;
    /**
     * **Whether sharding pays depends on how much work there is**, which is
     * why the driver scales the shard count with the selection. Measured on
     * 8 cores, on mains (pre `runSuite`'s first-failure kill, which shifts
     * every caught mutation toward the fast end — re-measure before tuning):
     *
     *   10 mutations          70 mutations
     *     1 shard  127s         1 shard  913s
     *     2 pooled 129s         8 shards 776s   <- 15% faster
     *     4 pinned 141s
     *     8 pinned 344s   <- 2.7x worse
     *
     * A single pooled run costs 9.9s wall and 46.9s CPU across 4.7 cores, so
     * the runner's pool already saturates this machine and every added shard
     * contends with it. Over 70 mutations that contention is still worth it;
     * over 10 the eight worktrees cost more than they save.
     *
     * **The small measurement does not extrapolate**, and reading it as
     * though it did produced a confident "sharding does not pay" that the
     * full run then contradicted. Fixed costs dominate a small sample, which
     * is the oldest trap in benchmarking and was walked into anyway.
     *
     * **Measure this plugged in.** The first numbers here were taken on
     * battery and every one was wrong — 31s and 51s rather than 9.9 and 34.4
     * — and the throttling was uneven enough that five parallel runs timed
     * *faster* than one alone, which cannot happen and should have stopped
     * the measurement rather than being written down.
     */
    {
      const verdict = await runSuite(root);
      caught = Boolean(verdict.caught);
      timedOut = Boolean(verdict.timedOut);
    }

    /**
     * A survivor is confirmed by a second run before it is reported.
     *
     * `caught` means only "the runner exited non-zero", so a survivor means "the
     * whole suite passed with a deliberate bug in it" — the one verdict here
     * that accuses the tests of something. It has been wrong: a full sharded
     * run reported `split: chars splits by code point instead of grapheme` as
     * surviving, and planting that same mutation by hand fails six assertions
     * in `test/split-graphemes.test.js`. Eight shards, each its own vitest,
     * against one symlinked `node_modules`, on a machine also running a build
     * and three browsers.
     *
     * The mechanism was not pinned down, which is exactly why the guard is a
     * re-run rather than a fix to whatever it was. What matters is that the
     * two runs **disagreeing** is itself a finding — it says this tool's
     * verdicts are not deterministic under load — so it is printed rather than
     * quietly resolved in the tests' favour.
     *
     * Only survivors are re-run. They are meant to be rare, so this costs
     * nothing on a clean run, and it does not make a false *caught* visible —
     * that direction stays unguarded and is the more dangerous one.
     */
    if (!caught) {
      writeFileSync(target, original.replace(from, to));
      const verdict = await runSuite(root);
      timedOut = timedOut || Boolean(verdict.timedOut);
      if (verdict.caught) {
        caught = true;
        console.log(`  FLAKY    ${name} — survived once, caught on re-run`);
      }
      writeFileSync(target, original);
    }

    writeFileSync(target, original);
    console.log(`  ${timedOut ? 'TIMEOUT ' : caught ? 'caught  ' : 'SURVIVED'} ${name}`);
    /**
     * A timeout is reported with the survivors — it is an untested mutation,
     * and lumping it in with the caught ones is the false-caught direction —
     * but named so the reader knows the suite hung rather than passed.
     */
    if (timedOut) survived.push(`${name} (TIMED OUT — the suite hung, it was not tested)`);
    else if (!caught) survived.push(name);
  }

  const json = value('--json');
  if (json) {
    writeFileSync(json, JSON.stringify({ checked, survived, skipped }));
    process.exit(0);
  }

  console.log(`\n  ${checked - survived.length}/${checked} mutations caught by the suite.`);
  if (skipped.length) {
    console.log('  Anchors no longer in the source — the mutation was never planted:');
    for (const name of skipped) console.log(`    - ${name}`);
  }
  if (survived.length) {
    console.log('  Untested behaviour:');
    for (const name of survived) console.log(`    - ${name}`);
  }
  if (survived.length || skipped.length) process.exit(1);
}
