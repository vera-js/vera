/**
 * Migrates markup from the old `data-oxyani-*` attributes to `data-vm-*`.
 *
 * Reports what it could not map rather than dropping it silently — an
 * unreported drop is how a migration quietly loses a feature.
 *
 * Usage: node scripts/migrate-attributes.mjs <file> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Old property name → new attribute. Every target here must be a real
 * attribute, which `check-examples` now enforces: a map that emits a name the
 * parser refuses produces markup that *looks* migrated and animates nothing,
 * which is worse than reporting it as unmappable.
 *
 * `position` was in this table mapping to itself, and there is no `position`
 * property. It is out, so it now falls through to "has no equivalent" and gets
 * reported — which is what this script says it does with anything it cannot
 * map.
 */
const PROPERTY_MAP = {
  'translate-x': 'translate-x', 'translate-y': 'translate-y', 'translate-z': 'translate-z',
  'rotate': 'rotate', 'rotate-x': 'rotate-x', 'rotate-y': 'rotate-y',
  'skew-x': 'skew-x', 'skew-y': 'skew-y', 'scale': 'scale',
  'opacity': 'opacity', 'blur': 'blur',
  'border-top-left-radius': 'radius-top-left',
  'border-top-right-radius': 'radius-top-right',
  'border-bottom-left-radius': 'radius-bottom-left',
  'border-bottom-right-radius': 'radius-bottom-right',
  'svg-path': 'path',
};

/**
 * Old setting name → new attribute. The per-category overrides were
 * `transform-speed` and `filter-speed` on both sides of this map long after
 * `speed` became `inertia`, so the tool emitted two attributes that do not
 * exist.
 */
const SETTING_MAP = {
  'transform-speed': 'transform-inertia',
  'filter-speed': 'filter-inertia',
  'run-once': 'run-once',
  'will-change': 'will-change',
  'transform-origin': 'transform-origin',
  'svg-path': 'path-selector',
};

const DEFAULT_PER = { start: 0, end: 1 };
/**
 * The old fixed pair. There is no fixed tablet/mobile any more — a width band
 * is either a range in the value or a **registered name** in the attribute
 * suffix — so migrated markup keeps these as names and the page has to declare
 * them. Said out loud at the end of a run rather than left for whoever wonders
 * why the mobile keyframes do nothing.
 */
const BREAKPOINTS = ['tablet', 'mobile'];

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) { console.error('usage: migrate-attributes.mjs <file> [--write]'); process.exit(1); }

const source = readFileSync(file, 'utf8');
const unmapped = new Map();
const note = (name, why) => unmapped.set(name, why);

/** Split one element's attribute text into name/value pairs. */
const parseAttrs = (text) => {
  const out = [];
  const re = /([a-zA-Z0-9-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(text))) out.push([m[1], m[2]]);
  return out;
};

const migrateElement = (attrText) => {
  const attrs = parseAttrs(attrText);
  const keep = [];
  /** property -> breakpoint -> { slot: value, slotPer: n, unit } */
  const anims = new Map();
  let marker = false;
  const settings = [];

  for (const [name, value] of attrs) {
    if (!name.startsWith('data-oxyani')) { keep.push([name, value]); continue; }
    if (name === 'data-oxyani') { marker = true; continue; }

    let rest = name.slice('data-oxyani-'.length);

    if (rest.startsWith('animate-')) {
      rest = rest.slice('animate-'.length);
      const category = rest.split('-')[0];
      rest = rest.slice(category.length + 1);
      if (category === 'border') rest = rest.replace(/^border-/, 'border-');   // border-border-*

      let breakpoint = '';
      for (const bp of BREAKPOINTS) {
        if (rest.endsWith(`-${bp}`)) { breakpoint = bp; rest = rest.slice(0, -(bp.length + 1)); break; }
      }

      let per = false;
      if (rest.endsWith('-per')) { per = true; rest = rest.slice(0, -4); }

      const slotMatch = /-(start|mid1|mid2|end|unit|url|width|height)$/.exec(rest);
      if (!slotMatch) { note(name, 'no recognisable slot'); continue; }
      const slot = slotMatch[1];
      const prop = rest.slice(0, -(slot.length + 1));

      const mapped = PROPERTY_MAP[prop];
      if (!mapped) { note(name, `property "${prop}" has no equivalent`); continue; }

      if (!anims.has(mapped)) anims.set(mapped, new Map());
      const byBp = anims.get(mapped);
      if (!byBp.has(breakpoint)) byBp.set(breakpoint, { slots: {}, pers: {}, unit: '' });
      const entry = byBp.get(breakpoint);

      if (slot === 'unit') entry.unit = value ?? '';
      else if (slot === 'url' || slot === 'width' || slot === 'height') note(name, 'image sequence not yet ported');
      else if (per) entry.pers[slot] = Number(value);
      else entry.slots[slot] = value ?? '';
      continue;
    }

    const setting = SETTING_MAP[rest];
    if (setting) { settings.push([`data-vm-${setting}`, value]); continue; }
    note(name, 'setting has no equivalent');
  }

  if (!marker && anims.size === 0) return null;

  const out = [['data-vm', undefined]];
  for (const [prop, byBp] of anims) {
    for (const [bp, entry] of byBp) {
      const suffix = bp ? `-${bp}` : '';

      /**
       * One attribute per property, positions in the value.
       *
       * This emitted the grammar that keyframe positions left in `4db01be` —
       * `-from`, `-at-n50` and a bare name for the end — so its own output was
       * refused by the parser it migrates *to*: `translate-y-from` is an
       * unknown attribute, and the lone survivor became a one-keyframe
       * animation that goes to a value rather than between two. Markup that
       * looks migrated and animates wrong.
       *
       * Negatives are minus signs here. The `n` prefix existed because a
       * position lived in an attribute *name*, where `-50` could not be told
       * from a separator; in a value there is nothing to confuse it with.
       */
      const keyframes = [];
      for (const [slot, value] of Object.entries(entry.slots)) {
        const per = entry.pers[slot] ?? DEFAULT_PER[slot];
        if (per === undefined) { note(`${prop}.${slot}`, 'midpoint without a percentage'); continue; }
        keyframes.push([Math.round(per * 100), `${value}${entry.unit}`]);
      }
      if (!keyframes.length) continue;

      /** Position order, not attribute order: `end` is written before `mid1` often enough. */
      keyframes.sort((a, b) => a[0] - b[0]);
      out.push([
        `data-vm-${prop}${suffix}`,
        keyframes.map(([pct, value]) => `${pct}% ${value}`).join(', '),
      ]);
    }
  }
  out.push(...settings);
  for (const [n, v] of keep) out.push([n, v]);
  return out;
};

const render = (pairs) =>
  pairs.map(([n, v]) => (v === undefined ? n : `${n}="${v}"`)).join(' ');

let migrated = source.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g, (whole, tag, attrs, selfClose) => {
  if (!attrs.includes('data-oxyani')) return whole;
  const pairs = migrateElement(attrs);
  if (!pairs) return whole;
  return `<${tag} ${render(pairs)}${selfClose ? ' /' : ''}>`;
});

const count = (s, re) => (s.match(re) || []).length;
const bytes = (s, re) => (s.match(re) || []).reduce((n, m) => n + m.length, 0);
const OLD = /data-oxyani[a-z0-9-]*(?:="[^"]*")?/g;
const NEW = /data-vm[a-z0-9-]*(?:="[^"]*")?/g;

console.log(`\n  ${file}`);
console.log(`  before  ${String(count(source, OLD)).padStart(4)} attributes  ${String(bytes(source, OLD)).padStart(6)} bytes`);
console.log(`  after   ${String(count(migrated, NEW)).padStart(4)} attributes  ${String(bytes(migrated, NEW)).padStart(6)} bytes`);
const b = bytes(source, OLD), a = bytes(migrated, NEW);
console.log(`  saved   ${String(b - a).padStart(4)} bytes (${Math.round((1 - a / b) * 100)}% smaller)\n`);

if (unmapped.size) {
  console.log(`  NOT MIGRATED (${unmapped.size}):`);
  for (const [name, why] of unmapped) console.log(`    ${name.padEnd(58)} ${why}`);
  console.log();
}

/**
 * A band suffix in an attribute *name* is a registered name, and nothing
 * registers these two any more. Migrated markup carrying them animates at every
 * width until the page declares them, which is a silent no-op — exactly what
 * the unmapped list above exists to prevent, one level further out.
 */
const usedBreakpoints = BREAKPOINTS.filter((bp) => migrated.includes(`-${bp}="`));
if (usedBreakpoints.length) {
  console.log(`  NEEDS REGISTERING (${usedBreakpoints.length}):`);
  console.log(`    createMotion({ breakpoints: { ${usedBreakpoints.map((bp) => `${bp}: [min, max]`).join(', ')} } })`);
  console.log('    There is no fixed tablet/mobile any more — a name in an attribute suffix');
  console.log('    resolves only if the instance registered it, and does nothing if it did not.\n');
}

if (write) { writeFileSync(file, migrated); console.log(`  written to ${file}\n`); }
else console.log('  (dry run — pass --write to apply)\n');
