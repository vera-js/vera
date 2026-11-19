import { runInThisContext } from 'node:vm';

/**
 * **Seeded tag soup for the lite tier's fuzzes** (`lite-placement-fuzz`, `lite-parity-fuzz`): one
 * alphabet of real markup and its awkward cases, one generator, so the two fuzzes walk the same templates.
 *
 * `<style/>` and `</stylex>` are in it (2026-11-17): the tiers read the first as opening raw text (HTML) and the second as
 * ending nothing, as the parser and `@verajs/ssr` do. Core's own renderer reads both differently today, a separate item.
 * So are the shapes only the tree builder sees (foreign content, CDATA, tables, `<select>`, stray end tags), which the
 * tiers' parser check judges.
 */
export const PIECES = [
  '<a', '<p', '<img', '<div', ' title="', " title='", ' href=', ' class = "', ' data-x =', '"', "'", '>', '/>', ' ',
  'a > b', 'a < b', ' x ', '</a>', '</p>', '</div>', '<!--', '-->', '<!x>', '<?x>', '</ x>', '<textarea>', '</textarea>',
  '<title>', '</title>', '<style>', '</style>', '<template>', '</template>', '<noscript>', '</noscript>', '<xmp>', '</xmp>',
  '<svg>', '</svg>', 'text', '=', ' b=', 'c', ' ', '\v', '<!-->', '<!--->', '--!>', ' onclick=', ' onclick="', ' href="',
  '<script>', '</script>', '<iframe>', '</iframe>', '<style/>', '</stylex>', '<title/>', '<script/>', '<textarea/>', '<iframe/>', '<noscript/>',
  /** Tree construction a tokenizer cannot see (2026-11-17): foreign content and its breakouts, CDATA, tables, select, implied ends. */
  '<math>', '</math>', '<foreignObject>', '<desc>', '<mtext>', '<mi>', '<annotation-xml encoding="text/html">', '<b>', '</b>',
  '<font color=x>', '<![CDATA[', ']]>', '<table>', '</table>', '<tr>', '<td>', '<select>', '</select>', '<option>', '<plaintext>',
  '<li>', '<body', '<html', '</template>', '</svg>',
];

/**
 * Where a parent template puts its first hole, for the COMPOSING fuzz: a child template's nodes go in under the parent's
 * open elements (`<table>`, `<select>`, `<svg>`…), so a child is exercised in each context a parent can give it.
 */
export const CONTEXTS = ['', '<div>', '<table>', '<table><tr>', '<select>', '<svg>', '<math><mi>', '<template>', '<p>', '<ul><li>'];

/** A seeded generator: `pick(n)` is an integer in [0, n). */
export const random = (seed) => {
  let x = (seed * 2654435761) >>> 0 || 1;
  return (n) => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) % n);
};

/** A template's strings: 1–4 pieces between each hole, 1–3 holes, drawn from `pieces`; every other one tidied (`tidy`). */
export const soup = (pick, pieces = PIECES) => {
  const strings = [];
  const holes = 1 + pick(3);
  for (let h = 0; h <= holes; h++) {
    let s = '';
    for (let k = 1 + pick(4); k > 0; k--) s += pieces[pick(pieces.length)];
    strings.push(s);
  }
  return pick(2) ? tidy(strings) : strings;
};

const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

/**
 * `strings` with the elements its tags open closed at the end, innermost first (a rough tag reading, not the parser's):
 * a template that ends inside a tag or raw text is refused, so a corpus of raw soup reaches less rendered output. The
 * fuzzes tidy half their templates and keep half raw.
 */
export const tidy = (strings) => {
  const open = [];
  for (const [, end, name] of strings.join('').matchAll(/<(\/?)([a-zA-Z][^\s/>]*)/g)) {
    if (end === '') {
      if (!VOID.test(name)) open.push(name.toLowerCase());
    } else {
      const at = open.lastIndexOf(name.toLowerCase());
      if (at !== -1) open.length = at;
    }
  }
  return [...strings.slice(0, -1), strings.at(-1) + open.reverse().map((name) => `</${name}>`).join('')];
};

/** A tagged-template strings array from plain strings (a fresh call site per template, as a real one is). */
export const tagged = (strings) => Object.freeze(Object.assign([...strings], { raw: Object.freeze([...strings]) }));

/** The codes a small tier refuses a template with. Anything else a tier throws is a defect, never a refusal. */
/** `template-in-text` (2026-11-18): a template in a text-only element, refused on every tier and the server. */
export const TIER_REFUSALS = new Set(['static-hole', 'tier-hole-position', 'static-binding', 'static-partial-value', 'unfinished-tag', 'tier-inert-element', 'template-in-text']);

/** The code an error names, in either build: `(code)` ending a development sentence, `…/e/code` in production. */
export const codeOf = (error) => /(?:\(|\/e\/)([a-z][a-z0-9-]*)\)?$/.exec(String(error?.message ?? ''))?.[1];

/**
 * A jsdom virtual console that drops ONLY jsdom's CSS-parse noise (the soup puts junk in `<style>` on purpose) and
 * collects every other jsdom error in `unexpected`, for a fuzz to assert empty: dropping them all would silence an error
 * the fuzz exists to see.
 */
export const quietConsole = (VirtualConsole) => {
  const unexpected = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!/^Could not parse CSS stylesheet/.test(error.message)) unexpected.push(error.message);
  });
  return { virtualConsole, unexpected };
};

/** A fuzz case's time limit: a case runs in milliseconds; one that runs longer is a hang, named, not a stalled suite. */
export const CASE_LIMIT_MS = 3000;

/**
 * Runs `fn` with a hard time limit, answering `{ value }` or `{ timedOut: true }`. A synchronous loop cannot be stopped by
 * a timer in its own thread, but V8 terminates whatever runs under a `vm` call with a `timeout` — this code included, in
 * any context (found 2026-11-17: a re-entrant regex walk composed forever and surfaced, 210 s later, as "Invalid string
 * length"). The probes-need-a-hard-limit rule, per case.
 */
export const within = (ms, fn) => {
  globalThis.__tierCase = fn;
  try {
    return { value: runInThisContext('__tierCase()', { timeout: ms }) };
  } catch (error) {
    if (/Script execution timed out/.test(String(error?.message))) return { timedOut: true };
    throw error;
  } finally {
    delete globalThis.__tierCase;
  }
};
