/**
 * The server entry: the shell, with the same wiring the browser gets and no renderer of its own.
 *
 * `@verajs/ssr/vera` must be imported before anything that imports `@verajs/core`, which is why the
 * server imports *this* rather than the shell directly — the shims have to exist before core
 * evaluates. The autoloader is left out: it observes a DOM the server does not have, and the
 * components it would find are eagerly imported here anyway.
 */
import { wireApp } from './wiring.js';

wireApp(null);

export { default } from './components/sink-shell.js';
