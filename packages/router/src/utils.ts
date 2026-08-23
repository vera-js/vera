import {
  MatchFunction,
  ParamData,
  ParsedPattern,
  ParsedPatternKey,
  RouteEvent,
  RouteSnapshot,
} from './types.js';
import { emit } from './events.js';
import { stripTrailingSlash } from '@verajs/shared-utils';

export { stripTrailingSlash };

/**
 * Aliases
 */
const wildcard = 'wildcard';
const param = 'param';

/**
 * Creates a custom event that traverses ShadowDOMs (using composed) and can be listened for in any parent element
 *
 * @param element Element to dispatch the event from
 * @param type Type of event to dispatch
 * @param to Destination route
 * @param from From route
 * @returns
 */
export const emitEvent = async (
  element: HTMLElement | Document = document,
  type: RouteEvent,
  to: RouteSnapshot,
  from?: RouteSnapshot
) => {
  const event = new CustomEvent(`vera:${type}`, {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: { currentRoute: to, previousRoute: from },
  });
  /**
   * Dispatched on the router element itself. `bubbles` and `composed` then mean what they say —
   * the event reaches `document` and crosses shadow boundaries — and `cancelable` becomes true in
   * practice: `preventDefault()` cancels the navigation, alongside a handler returning `false`.
   *
   * It used to be dispatched on `element.ownerDocument` instead, so a listener on the router
   * element never fired at all and `preventDefault()` did nothing. The reason given was a memory
   * leak; dispatching does not retain a target, and `detail` carries route snapshots rather than
   * the element, so there was nothing to leak.
   */
  const uncancelled = element.dispatchEvent(event);
  return (await emit(element, type, to, from)) && uncancelled;
};

/**
 * Focuses on the firstElementChild's first focusable element, or the firstElementChild itself if one
 * doesn't exist
 *
 * @param view View element to query for first focusable element
 */
export const focusView = (view: HTMLElement) => {
  const firstChild = view.firstElementChild as HTMLElement | null;

  if (!firstChild) return; // Early return if there is no first child

  const firstChildElement = firstChild.shadowRoot ?? firstChild;
  const firstFocusableElement = getFirstFocusableElements(firstChildElement as HTMLElement) as HTMLElement;

  if (firstFocusableElement) {
    firstFocusableElement.focus();
  } else {
    firstChild.tabIndex = 0; // Ensure tabIndex is set before focusing
    firstChild.focus();
  }
};

/**
 * Gets the first focusable child element from an element
 *
 * @param element Element to query
 * @returns First focusable element
 */
const getFirstFocusableElements = (element: HTMLElement) =>
  element.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');

/**
 * Take a pattern and returns a MatchFunction which can be applied to paths
 *
 * @param routePattern Pattern to get a MatchFunction for. Takes the same arguments as path-to-regexp's
 * match function and returns the same function which returns the same structure
 * @return Match function to apply to paths
 */
export const getMatch = <P extends ParamData>(routePattern: string): MatchFunction<P> => {
  const { pattern, regExp, keys } = parsePattern(routePattern);
  return (path: string) => {
    const match = regExp ? path.match(regExp) : pattern === path;

    if (match) {
      const params = Array.isArray(match) && keys ? (getParams(match, keys) as P) : ({} as P);
      return { path, params };
    }
    return false;
  };
};

/**
 * Gets the params from a parsed pattern's regExp match results and keys. Returns the same structure
 * as path-to-regexp
 *
 * @param match Results from RegExp match on the path
 * @param keys Keys from the parsedPattern that the results need to be applied to
 * @returns The params in the same structure as path-to-regexp
 */
export const getParams = (match: string[], keys: ParsedPatternKey[]) =>
  // The first element in `match` contains the whole string so we have to
  // offset the index by 1.
  Object.fromEntries(
    keys.map((key, index) => [
      key.name,
      key.type === wildcard ? match[index + 1].split('/').map(decode) : decode(match[index + 1]),
    ])
  );

/**
 * Params arrive percent-encoded, because that is how they travel in a URL: a link to a user named
 * `John Doe` is `/u/John%20Doe`, and handing a component that string back verbatim made every
 * param with a space, slash or accent wrong. Decoding here matches path-to-regexp, whose structure
 * this deliberately mirrors.
 *
 * A malformed escape — a bare `%`, or `%zz` — throws from `decodeURIComponent`, and a URL someone
 * can type is not a reason to throw out of routing. The raw text is the best answer available.
 */
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Parses a pattern
 *
 * The replace pass also escapes regex metacharacters in the static segments — without that,
 * `/file.html` matched `/fileXhtml` (`.` is "any character") and a `(` in a pattern threw at
 * `new RegExp`. Patterns are author code, so this is correctness, not an injection surface.
 *
 * @param routePattern The pattern to parse
 * @returns An object containing the pattern without a trailing slash, the keys that were found, and
 * a regEx that can be run for matches on paths
 */
export const parsePattern = (routePattern: string): ParsedPattern => {
  const pattern = stripTrailingSlash(routePattern);
  const regex = /(?:\*([^/:|]+)|:([^/:|]+)|\||([.+?^=!${}()[\]\\]))/g;
  const keys: ParsedPatternKey[] = [];
  const regexPattern = pattern.replace(regex, (_, _wildcard, _param, _metacharacter) => {
    // Any character that isn't a wildcard or parameter is removed, including the pipe in the regex
    let replacementPattern = '';
    if (_wildcard) {
      keys.push({ name: _wildcard, type: wildcard });
      replacementPattern = '(.*)';
    } else if (_param) {
      keys.push({ name: _param, type: param });
      replacementPattern = '([^/]+)';
    } else if (_metacharacter) {
      replacementPattern = '\\' + _metacharacter;
    }
    return replacementPattern;
  });
  return { pattern, keys, regExp: new RegExp(`^${regexPattern}$`) };
};

export const removeHashFragment = (str: string): [string, number] => {
  const hashIndex = str.lastIndexOf('#');
  const trimmedHref = hashIndex > 0 ? str.substring(0, hashIndex) : str;
  return [trimmedHref, hashIndex];
};
