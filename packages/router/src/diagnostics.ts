/**
 * **The router's diagnostics, keyed by code — DEVELOPMENT ONLY** (referenced behind `__DEV__`; production drops it and
 * prints the shared short line). One table: the router is one bundle. `scripts/sync-diagnostics.mjs` publishes it as
 * `packages/router/diagnostics.json`, the docs pages at `https://verajs.dev/e/<code>`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /* ── guards and navigation ── */
  'router-string-guard': (verdict, fix) => [
    `returned the string "${verdict}", which is truthy, so the route was allowed. Only \`false\` cancels.`,
    fix,
  ],
  'router-handler-threw': () => [
    'threw, so the navigation was canceled — a throwing guard fails closed.',
    'Catch inside the handler what it can recover from; the error itself is printed beside this line.',
  ],
  'router-navigate-threw': (path) => [
    `navigating to ${path} threw, so the view was left as it was.`,
    'A link click has nobody to reject to: listen for `vera:route-error` (it bubbles, composed) to handle it; the error is printed beside this line.',
  ],
  'router-redirect-loop': (path) => [
    `a redirect loop at ${path} — ten redirects in one navigation, so it was stopped.`,
    'Check the routes whose `redirect` lead back to each other.',
  ],
  'router-no-match': (path) => [
    `nothing matched "${path}", so the navigation did nothing. A link with \`route\` has already had its click canceled by then.`,
    'Add the route, or a catch-all `/*rest`, which sorts last however it is declared.',
  ],
  'router-cross-origin': (path, why) => [
    `navigate() refused "${path}" — ${why}.`,
    'Use location.assign() to leave the site.',
  ],
  'router-relative-param': (target, prior, bare, last) => [
    `navigate("${target}") from "${prior}" resolved to "${bare}" — a relative path replaces the last segment, like a relative href, and here that segment was a route param ("${last}").`,
    `For the SIBLING "${bare}" this is right. For the child "${prior}/${target}", use a named route — \`navigate({ name })\` fills params from the current route — or the absolute path.`,
  ],
  /** Two variants of one fact — a nested route found no outlet — the variant a parameter (vera-5a). */
  'router-no-outlet': (path, variant) => [
    `the route "${path}" is nested, ${variant === 'element'
      ? 'and this router was given its root outlet as an element — one node, so a child cannot inherit it without overwriting its parent. Its view is looked for inside the one its parent rendered into, and no [view] was found there.'
      : `so its view is looked for inside the one its parent rendered into — and no [view="${variant}"] was found there.`}`,
    variant === 'element'
      ? "Give the child a `view` name and have the parent's template render an outlet with it, or initialize the router with a name instead of an element."
      : "A parent's template has to render the outlet its children route into.",
  ],
  'router-no-renderer': () => [
    'nothing is wired to render a route, so navigation changes the URL and paints nothing.',
    'Wire the router itself alongside the renderer — `wire([renderer, router])` — or hand it one directly with `setRouterRenderer(render)`.',
  ],
  'router-href-base': (href, base, pathname) => [
    `<a route href="${href}"> points outside the app's base ("${base}"). Clicking it works, because the router re-bases the URL it writes — but the href itself is wrong anywhere the router is not involved: a new tab, a copied link, a crawler.`,
    `Write it as "${base}${pathname}" or relative to the <base>. \`resolve()\` already returns the mounted path.`,
  ],
  /* ── setup ── */
  'router-no-view': () => [
    'needs an element and a view — without a view there is no outlet, so every navigation would do nothing.',
    'initRouter(element, { view }) — the view is an element or the name of a [view] outlet.',
  ],
  'router-init-option': (option, known) => [
    `\`${option}\` is not an initRouter option, so it was ignored.`,
    option === 'routes'
      ? 'Routes are registered separately: `const { addRoutes } = initRouter(el, { view }); addRoutes(routes)`.'
      : `The options are ${known}.`,
  ],
  'router-option': (option) => [`\`${option}\` is not a router option, so it was ignored.`, 'The options are animate, base.'],
  'router-route-option': (key, path, known) => [
    `\`${key}\` is not a route option, so it was ignored on "${path}".`,
    `The options are ${known} — anything else belongs in \`meta\`, which every guard and action reads off the snapshot.`,
  ],
  'router-duplicate-name': (name, first, second) => [
    `two routes are named "${name}" — "${first}" and "${second}".`,
    'The last one registered is the one `resolve` will build; give each route a name of its own.',
  ],
  'router-unknown-name': (name) => [`no route is named "${name}".`, 'resolve() returns "" for it; register a route with that `name`.'],
  /* ── misused calls (thrown, development only) ── */
  'router-renderer-not-function': (received) => [
    `expected a function and received ${received}.`,
    '`@verajs/renderer` exports it as `renderInto` — or pass the module to `wire` instead, which is what `wire([renderer, router])` does.',
  ],
  'router-match-not-function': (received) => [
    `expected a function and received ${received}.`,
    'It is called once per route pattern and must return a matcher — this is the seam for path-to-regexp.',
  ],
  'router-base-not-string': (received) => [
    `expected a string or null and received ${received}.`,
    "It is the path prefix the app is served under, such as '/app'.",
  ],
  'router-navigate-target': (received) => [
    `expected a path or a { name, params } object and received ${received}.`,
    "`navigate('/users/5')`, or `navigate({ name: 'user', params: { id: 5 } })`.",
  ],
};
