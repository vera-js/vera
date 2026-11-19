/**
 * The raw-text shapes the server, core and lite must write byte for byte alike (tests/renderer-raw-text-round-trip.test.mjs,
 * and through `raw-text-parity-ssr.js` the same sources as lite and core COMPONENTS on the server): `[name, strings,
 * values]`, the strings a literal's pieces.
 */
export const IMG = '<img src=x onerror=zq()>';
const STYLE = ['<style>p{content:"', '"}</style>'];
const JSON_OPEN = '<script type="application/json">';
/** [name, strings, values]: the same source on every side. */
export const SHAPES = [
  ...['</style>', '</STYLE>', '</sTyLe>', '</style ', '</style/', '</style\t'].map((closer) => [`style, ${JSON.stringify(closer)} in a value`, STYLE, [closer + IMG]]),
  ['style, a static `<` and a value `/style>`', ['<style>p{content:"<', '"}</style>'], ['/style>' + IMG]],
  ['style, `</st` | `yle>` across two values', ['<style>a{b:', '', '}</style>'], ['</st', 'yle>' + IMG]],
  ['style, empty values around a closer', ['<style>', '', '', '', '</style>'], ['', '</style>' + IMG, '', '']],
  ['style, `<!--` and `-->`', ['<style>', '</style>'], ['<!--</style>' + IMG + '-->']],
  ['style, emoji, accents, a C1 control', STYLE, ['😀 é \u0080']],
  ['style, a backslash before a closer', ['<style>p{content:"\\', '"}</style>'], ['\\</style>' + IMG]],
  ['style, already escaped (idempotence)', STYLE, ['<\\/style>']],
  /** A static `</stylex` or `</style\v` ends nothing, and is written closed all the same, as the client writes the composed text. */
  ['style, a static `</stylex` (no closer)', ['<style>p{}</stylex>', '</style>'], ['v']],
  ['style, a static `</style\\v` (no closer)', ['<style>a</style\v>', '</style>'], ['.a>.b{}']],
  /** A list is its items' text, nested lists flattened, nothing for null (2026-11-18: every tier and the server). */
  ['style, a list (items joined, a closer among them)', ['<style>', '</style>'], [['a{}', ['b{}', null], 'c</style>' + IMG]]],
  ['json, `</script` in a value', [JSON_OPEN + '{"a":"', '"}</script>'], ['</script>' + IMG]],
  ['json, `</SCRIPT ` and `<!--<script>`', [JSON_OPEN + '{"a":"', '","b":"', '"}</script>'], ['</SCRIPT ', '<!--<script>']],
  ['json, a static `<` and a value `/script>`', [JSON_OPEN + '{"a":"<', '"}</script>'], ['/script>' + IMG]],
  ['json, statics holding markup', ['<script type="application/ld+json">{"d":"<p>', '</p>"}</script>'], ['<b>bold</b>']],
  ['json, a list', [JSON_OPEN + '[', ']</script>'], [['1', ',', ['2', ',"</script>"']]]],
  ['json, emoji and a backslash', [JSON_OPEN + '{"a":"', '"}</script>'], ['😀 \\\\ é']],
  ['json, already escaped (idempotence)', [JSON_OPEN + '{"a":"', '"}</script>'], ['\\u003c/script>']],
];

/** A tagged literal's strings, built: an array OWNING `raw`, as the language makes one. */
export const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });
