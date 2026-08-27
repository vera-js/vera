/**
 * Text the HTML boundary has to survive: astral pairs, lone surrogates, combining marks, bidi
 * controls, control characters, noncharacters, and the two the HTML input-stream preprocessor
 * rewrites — CR and NUL.
 *
 * Every value is written as an escape sequence on purpose, so this file is pure ASCII: a literal
 * NUL or bidi override in a source file is invisible in a diff and mangled by half the tools that
 * touch it.
 */

export const CASES = {
  'astral emoji': '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} family',
  'lone surrogate': 'a\uD800b',
  'combining marks': 'e\u0301\u0301\u0301',
  'RTL LTR mix': '\u05E9\u05DC\u05D5\u05DD world \u0645\u0631\u062D\u0628\u0627',
  'bidi override': 'a\u202Eb\u202Cc',
  'zero width joiner': 'a\u200Db',
  'NUL': 'a\u0000b',
  'control chars': 'a\u0001\u0008\u001Fb',
  'line separator': 'a\u2028b\u2029c',
  'BOM': '\uFEFFtext',
  'nbsp': 'a\u00A0b',
  'entity text': 'a &amp; &lt;script&gt; b',
  'raw angle': '<script>alert(1)</script>',
  'quotes': 'a"b\'c`d',
  'backslash': 'a\\\\b',
  'CRLF': 'a\r\nb',
  'tab': 'a\tb',
  'very long': 'x'.repeat(5000),
  'noncharacter': 'a\uFFFEb\uFFFFc',
  'CJK': '\u65E5\u672C\u8A9E',
  'zalgo': 'a' + '\u0301'.repeat(40),
  'closing style': 'a</style>b',
  'closing textarea': 'a</textarea>b',
  'comment close': 'a-->b<!--c',
  'attr breakout': '" onload=alert(1) x="',
  'js url': 'javascript:alert(1)'
};
