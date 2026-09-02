/**
 * The writer: the staged workspace and the one atomic commit — how anything (the editing tooling,
 * an agent, a script) changes a site's repository. The read side never sees this file; it lives
 * behind the publish entry because a deployed site must be structurally unable to import a
 * committer.
 *
 * The shape is the proven one: **a staged overlay over a pinned base commit.** `open()` pins where
 * the branch is; `stage`/`remove` accumulate locally and cost no requests; `publish()` lands
 * everything as ONE commit — a blob per changed file, a **delta tree** on `base_tree` (unlisted
 * files ride through untouched; removals are null-sha entries), one commit with the pin as parent,
 * and a ref update that is **never forced**. If the branch moved while editing, GitHub refuses the
 * fast-forward and this reports it as exactly that — "the repository moved ahead; re-open and
 * publish again (staged work is kept)" — instead of silently discarding someone else's commit.
 * The overlay survives the refusal because the overlay is local; `open()` again re-pins and the
 * same staged changes publish onto the newer base.
 *
 * Plain `fetch` against the REST API, which serves every environment this must run in (browser,
 * worker, Node) and every test that fakes it. **The options are the trust boundary**: `api`,
 * `repo` and `branch` are caller configuration with the same standing as the token itself — code
 * that lets an outsider choose them has handed over the token's destination. `stageFile` takes any
 * bounded repository path by documented contract, workflows included; never hand it a path an
 * outsider chose. **Token acquisition is deliberately not here** — how
 * a token is minted (device flow, a paste, CI secrets) is the host application's concern; the
 * writer is handed one, or a function that produces one fresh per request.
 */
import { serializeContent } from './write.js';
import { FrontmatterMap } from './types.js';

export type WriterOptions = {
  /** `owner/name`, the repository this writer commits into. */
  repo: string;
  /** The branch to pin and publish to. Default `main`; an editorial flow points this at a session branch. */
  branch?: string;
  /** The token, or a function producing one — never stored beyond the call that needs it. */
  token: string | (() => string | Promise<string>);
  /** The API root; override for GitHub Enterprise or a test double. */
  api?: string;
};

export type Staged = { path: string; text: string | null };

export type Writer = {
  /** Pins the branch head this session edits against. Required before publish; safe to re-call. */
  open(): Promise<{ base: string }>;
  /** Stages one content entry — serialized, uuid added at creation if the data carries none. */
  stage(collection: string, slug: string, entry: { data: FrontmatterMap; body: string }): void;
  /** Stages any file — how generated artifacts (manifests, contracts) ride the same commit. */
  stageFile(path: string, text: string): void;
  /** Stages a content entry's removal. */
  remove(collection: string, slug: string): void;
  /** Stages any file's removal. */
  removeFile(path: string): void;
  /** What would publish: every staged path, removals marked null. */
  status(): { base: string | null; staged: Staged[] };
  /** Drops one staged path, or everything. */
  discard(path?: string): void;
  /** Everything staged, as one commit. The overlay clears only when the ref lands. */
  publish(options: { message: string }): Promise<{ commit: string }>;
};

/**
 * Anything that becomes a repository path is bounded before it does (CODE-PRINCIPLES #8: bound
 * whatever turns outside text into a path) — measured before the bound existed:
 * `stage('../.github/workflows', …)` staged a workflow file, which on a push would run it.
 */
/**
 * Collections match the schema's own name rule exactly — a collection the writer accepts must be
 * one the schema can declare and the reader can fetch, or the three disagree about the same name.
 * Slugs additionally allow dots (`v1.2-notes` is a fine file name), never doubled.
 */
const COLLECTION = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The schema's reserved words, repeated here on purpose (three bundles, no shared runtime) — a lockstep test fails if the copies ever disagree. */
const RESERVED = new Set(['constructor', 'prototype', 'site', 'taxonomies']);
const safeName = (kind: 'collection' | 'slug', value: string): string => {
  const rule = kind === 'collection' ? COLLECTION : SLUG;
  if (!rule.test(value) || value.includes('..') || (kind === 'collection' && RESERVED.has(value)))
    throw new Error(`createWriter: "${value}" is not a ${kind} name`);
  return value;
};
const safePath = (path: string): string => {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part === '' || part === '.' || part === '..'))
    throw new Error(`createWriter: "${path}" is not a repository path — relative, no empty, . or .. segments`);
  return path;
};

const contentPath = (collection: string, slug: string): string =>
  `content/${safeName('collection', collection)}/${safeName('slug', slug)}.md`;

/**
 * Creates a writer for one repository and branch.
 *
 * @param options The repository, the branch, and the token (or its producer)
 * @return The writer — a local overlay until `publish`, one atomic commit after
 */
export const createWriter = (options: WriterOptions): Writer => {
  const branch = options.branch ?? 'main';
  const api = options.api ?? 'https://api.github.com';
  /** path -> new text, or null for a removal. Insertion order is publish order, not that it matters. */
  const overlay = new Map<string, string | null>();
  let base: string | null = null;

  const request = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const token = typeof options.token === 'function' ? await options.token() : options.token;
    const response = await fetch(`${api}/repos/${options.repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`createWriter: ${method} ${path} answered HTTP ${response.status}`);
      (error as Error & { status: number }).status = response.status;
      throw error;
    }
    return (await response.json()) as Record<string, unknown>;
  };

  const mustBeOpen = (): string => {
    if (base === null)
      throw new Error('createWriter: open() first — publishing needs the branch head this session edits against');
    return base;
  };

  return {
    open: async () => {
      const ref = await request('GET', `/git/ref/heads/${branch}`);
      base = (ref.object as { sha: string }).sha;
      return { base };
    },

    stage: (collection, slug, entry) => {
      /**
       * Identity is written at creation, which is the only cheap moment (D-rule: a uuid added
       * later has already missed every reference that wanted it). Staging an entry whose data
       * carries one keeps it — an edit is not a new identity.
       */
      let data = entry.data;
      if (typeof data.uuid !== 'string') {
        /** Spread ORDER matters: a `uuid: null` parsed from a bare `uuid:` line once rode the spread and clobbered the fresh identity. */
        const { uuid: _discarded, ...rest } = data;
        data = { uuid: crypto.randomUUID(), ...rest };
      }
      overlay.set(contentPath(collection, slug), serializeContent(data, entry.body));
    },
    stageFile: (path, text) => void overlay.set(safePath(path), text),
    remove: (collection, slug) => void overlay.set(contentPath(collection, slug), null),
    removeFile: (path) => void overlay.set(safePath(path), null),

    status: () => ({ base, staged: [...overlay.entries()].map(([path, text]) => ({ path, text })) }),
    discard: (path) => void (path === undefined ? overlay.clear() : overlay.delete(path)),

    publish: async ({ message }) => {
      const parent = mustBeOpen();
      if (overlay.size === 0) throw new Error('createWriter: nothing is staged — there is nothing to publish');

      /**
       * A blob per write, POSTed in parallel — a publish's latency is one round trip, not one per
       * file (measured: 20 staged files at 40 ms RTT went ~990 ms serial, ~240 ms parallel). Capped
       * at eight in flight, because GitHub's secondary rate limits punish request bursts and a
       * 500-file publish should be fast, not banned. Text goes utf-8, no base64 round-trip to get
       * wrong; removals need no blob at all.
       */
      const entries = [...overlay.entries()];
      const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = new Array(entries.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, entries.length) }, async () => {
          while (next < entries.length) {
            const at = next++;
            const [path, text] = entries[at];
            if (text === null) {
              tree[at] = { path, mode: '100644', type: 'blob', sha: null };
            } else {
              const blob = await request('POST', '/git/blobs', { content: text, encoding: 'utf-8' });
              tree[at] = { path, mode: '100644', type: 'blob', sha: (blob as { sha: string }).sha };
            }
          }
        })
      );

      /** The delta: base_tree carries every unlisted file through untouched. */
      const baseCommit = await request('GET', `/git/commits/${parent}`);
      let created;
      try {
        created = await request('POST', '/git/trees', { base_tree: (baseCommit.tree as { sha: string }).sha, tree });
      } catch (error) {
        /**
         * Stated as the usual cause, not a diagnosis — the house rule on messages (a 422 here has
         * rarer causes too, and sending someone to fix the wrong thing is worse than hedging).
         */
        if ((error as Error & { status?: number }).status === 422 && tree.some((entry) => entry.sha === null))
          throw new Error(
            'createWriter: the tree was refused (HTTP 422). The usual cause is a staged removal naming a ' +
              'file the branch does not have — discard() that removal (or open() a fresher base) and ' +
              'publish again; everything staged is kept.'
          );
        throw error;
      }
      const commit = await request('POST', '/git/commits', { message, tree: created.sha as string, parents: [parent] });

      /**
       * NO force, ever. A moved head answers 409/422 and the report says what actually happened
       * and what to do — the staged overlay is deliberately NOT cleared, so re-opening and
       * publishing again lands the same work on the newer base.
       */
      try {
        await request('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha });
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status === 409 || status === 422)
          throw new Error(
            `createWriter: "${branch}" moved ahead while this session edited. Nothing was lost — ` +
              `open() again to pin the new head, then publish; the staged changes are kept.`
          );
        throw error;
      }

      overlay.clear();
      base = commit.sha as string;
      return { commit: commit.sha as string };
    },
  };
};
