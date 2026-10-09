/**
 * **The arguments a console call PRINTS, for a test that captures one.** Every framework line that carries a subject
 * before an object it forwards is passed as `console.warn('%s', line, …)` — with two or more arguments the console
 * reads the first as a format string, so `%c3` in a path would otherwise eat the line and the error with it
 * (`tests/console-format-strings.test.mjs`). The `'%s'` is the format, not the line: a capture reads past it.
 */
export const printed = (args) => (args[0] === '%s' ? args.slice(1) : args);
