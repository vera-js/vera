/**
 * The runtime reader: fetches a site's manifests and answers queries over them. This is the one
 * place in the package that touches the network, and it is deliberately a thin shell — everything
 * with logic in it lives in `query.ts`, pure, where a build can use it without pretending to fetch.
 *
 * **A factory returning an instance, per the house `create*` grammar**, because a reader has
 * instance-shaped state: the base URL and the manifest cache. Free functions would have hidden
 * that state at module scope, where two readers on one page — a site reading itself and a widget
 * reading a friend's site — would fight over it.
 *
 * A reader can only ever read. Writing is a different capability, behind a different entry, with a
 * different factory — which mirrors where the credentials live: manifests are public files this
 * fetches with no auth at all.
 */
import { queryEntries, QueryOptions, ReaderEntry } from './query.js';
import { TaxonomyIndex } from './taxonomy.js';
import { Manifest } from './types.js';

export type ReaderOptions = {
  /**
   * Where manifests live, ending in `/` — `${url}${collection}.json`. Defaults to `/_manifests/`,
   * the underscore matching static-platform convention for infrastructure files. Absolute URLs
   * work too, which is how one site reads another's manifests.
   */
  url?: string;
};

export type Reader = {
  /** One entry by its address, or null — a missing entry is an answer, not an error. */
  entry(collection: string, slug: string): Promise<ReaderEntry | null>;
  /** One entry by its identity — how a `reference` field's value resolves to the row it names. */
  byUuid(collection: string, uuid: string): Promise<ReaderEntry | null>;
  /** Entries from one collection or several, filtered/sorted/sliced; rows say where they came from. */
  entries(collection: string | string[], options?: QueryOptions<ReaderEntry>): Promise<ReaderEntry[]>;
  /** The raw manifest, cached — for anything the query surface does not cover. */
  manifest(collection: string): Promise<Manifest>;
  /**
   * A taxonomy's terms, ready for a cloud or a nav: the term entries (title, body-derived excerpt,
   * whatever their files carry) with usage counts joined on from the generated index. Terms nobody
   * uses arrive with `count: 0` — an archive page can decide not to link them.
   */
  terms(taxonomy: string): Promise<(ReaderEntry & { count: number })[]>;
};

/**
 * Creates a reader over a site's published manifests.
 *
 * @param options Where the manifests live; defaults cover a site reading itself
 * @return The reader — `entry`, `entries`, and the raw `manifest` escape hatch
 */
export const createReader = (options: ReaderOptions = {}): Reader => {
  const base = options.url ?? '/_manifests/';

  /**
   * The PROMISE is cached, not the result, so two queries racing for the same collection share one
   * request instead of the second slipping past an empty cache while the first is in flight. A
   * failed load is evicted before rethrowing — a 404 stays retryable rather than becoming the
   * cached answer for the life of the page.
   */
  const cache = new Map<string, Promise<Manifest>>();
  const manifest = (collection: string): Promise<Manifest> => {
    /**
     * The name becomes a URL segment; bounding it here keeps `../` out of every fetch this makes.
     * The reserved words match the schema's — repeated on purpose (three bundles, no shared
     * runtime); a lockstep test fails if the copies ever disagree.
     */
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(collection) ||
      collection === 'constructor' ||
      collection === 'prototype' ||
      collection === 'site' ||
      collection === 'taxonomies'
    )
      throw new Error(`createReader: "${collection}" is not a collection name`);
    let loading = cache.get(collection);
    if (loading === undefined) {
      loading = load(collection);
      cache.set(collection, loading);
      loading.catch(() => cache.delete(collection));
    }
    return loading;
  };

  const load = async (collection: string): Promise<Manifest> => {
    const target = `${base}${collection}.json`;
    const response = await fetch(target);
    if (!response.ok)
      throw new Error(`createReader: could not load the "${collection}" manifest (HTTP ${response.status}) from ${target}`);
    return (await response.json()) as Manifest;
  };

  /** Stamped at read time — the manifest does not repeat its own name per row, so the reader does. */
  const stamped = async (collection: string): Promise<ReaderEntry[]> => {
    const loaded = await manifest(collection);
    return loaded.entries.map((entry) => ({ ...entry, collection }));
  };

  /**
   * `taxonomies.json`, cached with the SAME semantics as the manifests four lines up — the first
   * version cached a transient network failure forever, and read an HTTP 500 as "this site has no
   * taxonomies" (audit pass 8). Absence (404) is the one answer that means empty; any other
   * failure throws and is evicted, so the next call retries.
   */
  let taxonomyIndex: Promise<TaxonomyIndex> | undefined;
  const taxonomies = (): Promise<TaxonomyIndex> => {
    if (taxonomyIndex === undefined) {
      taxonomyIndex = (async () => {
        const response = await fetch(`${base}taxonomies.json`);
        if (response.status === 404) return { version: 1, taxonomies: {} };
        if (!response.ok)
          throw new Error(`createReader: could not load the taxonomy index (HTTP ${response.status})`);
        return (await response.json()) as TaxonomyIndex;
      })();
      taxonomyIndex.catch(() => (taxonomyIndex = undefined));
    }
    return taxonomyIndex;
  };

  return {
    manifest,
    terms: async (taxonomy) => {
      const [rows, index] = await Promise.all([stamped(taxonomy), taxonomies()]);
      const usage = index.taxonomies[taxonomy] ?? {};
      /** `hasOwn`: a term slug is content, and `constructor` must count 0, not find Object's. */
      return rows.map((row) => ({ ...row, count: Object.hasOwn(usage, row.slug) ? usage[row.slug].count : 0 }));
    },
    entry: async (collection, slug) => {
      /** Single lookups stamp the one hit, not the whole collection — measured ~17 ns/row saved, but free. */
      const loaded = await manifest(collection);
      const row = loaded.entries.find((candidate) => candidate.slug === slug);
      return row === undefined ? null : { ...row, collection };
    },
    byUuid: async (collection, uuid) => {
      /**
       * A non-string answers null rather than matching: rows without identity carry `uuid: null`,
       * and a plain-JS caller resolving a reference field that is itself null (`author:` left
       * bare) would otherwise get back an arbitrary identity-less row as "the author".
       */
      if (typeof uuid !== 'string') return null;
      const loaded = await manifest(collection);
      const row = loaded.entries.find((candidate) => candidate.uuid === uuid);
      return row === undefined ? null : { ...row, collection };
    },
    entries: async (collection, options = {}) => {
      const names = Array.isArray(collection) ? collection : [collection];
      /** Loaded in parallel; concatenated in ASKED order, so unsorted results are still deterministic. */
      const all = (await Promise.all(names.map(stamped))).flat();
      return queryEntries(all, options);
    },
  };
};
