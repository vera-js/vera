/**
 * **The engine running a browser test, read ONCE from its user agent** — never from the run's settings — or `null` when
 * the agent names none of the three, which a row keying a table by engine fails on rather than defaulting to an engine's
 * answer. One reader for every such table (autoloader's failed import, labeled's `labels` list), so they cannot drift.
 */
export const engineOf = (ua) => {
  /**
   * Firefox first, then Chrome (a Chromium agent also says AppleWebKit and Safari), then WebKit, read from `Version/`: its
   * `AppleWebKit/605.1.15` token is frozen and never read as a version, and an agent with no `Version/` is no engine here.
   */
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return { name: 'Firefox', version: +firefox[1] };
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return { name: 'Chromium', version: +chrome[1] };
  const webkit = /AppleWebKit\/[\d.]+.*Version\/(\d+)/.exec(ua);
  if (webkit) return { name: 'WebKit', version: +webkit[1] };
  return null;
};
export const ENGINE = engineOf(navigator.userAgent);
/** The engine as a row's message names it. */
export const ON = ENGINE === null ? `an unknown engine (${navigator.userAgent})` : `${ENGINE.name} ${ENGINE.version}`;
