/** lit-html's node build calls document.createTreeWalker at module scope; the vera SSR shim's
 * minimal document lacks it. A module (not a statement) so import hoisting keeps the order. */
globalThis.document.createTreeWalker = () => ({});
