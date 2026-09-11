/**
 * The console-silence assertion, as a shared shape — the class the `data-vd-a` find earned.
 *
 * A framework warning during a healthy flow is a defect no ordinary assertion sees: the
 * `data-vd-a` marker warned `unknown-directive` on every SSR'd page for weeks of green runs,
 * and the stagger-group host was misdiagnosed `motion-inexpressible` until the first suite that
 * LISTENED caught both. So the hydrate- and kitchen-class suites capture `console.warn`/`error`
 * from import time and assert, at suite end, that nothing `[vera]`-prefixed was said.
 *
 * Deliberately NOT installed in suites that provoke warnings on purpose (mismatch, resilience,
 * misuse batteries) — there the warning is the assertion's subject, not noise.
 */
const captured = [];
const realWarn = console.warn;
const realError = console.error;

export const captureConsole = () => {
  console.warn = (...args) => { captured.push(args.join(' ')); realWarn(...args); };
  console.error = (...args) => { captured.push(args.join(' ')); realError(...args); };
};

/** Every `[vera]` line said since capture began — the suite asserts this is empty. */
export const veraSaid = () => captured.filter((line) => line.includes('[vera]'));
