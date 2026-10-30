/**
 * Holds the documentation index in memory and decides where it comes from.
 *
 * Hosted mode (`configureDocsIndex({ github })`): the index is rebuilt in-process from the
 * docs repository on GitHub — at start, and again whenever `main` moves (checked every few
 * minutes with a conditional request). A rebuild takes about a second and is swapped in
 * atomically; the copy baked into the image (`data/docs-index.json`) is only the fallback
 * when GitHub cannot be reached at start; tests read that bundled copy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logError, logInfo } from '../log.js';
import { Bm25Field } from './bm25.js';
import { buildDocsIndexFile } from './builder.js';
import { fetchSnapshot, latestCommit, type GitHubDocsSource } from './github.js';
import { tokenize } from './tokenizer.js';
import type {
  ChunkRecord,
  DocsIndexFile,
  DocsIndexMeta,
  PageRecord,
  ParameterRecord,
} from './types.js';

export interface DocsIndex {
  meta: DocsIndexMeta;
  pages: ReadonlyMap<string, PageRecord>;
  pageList: ReadonlyArray<PageRecord>;
  chunks: ReadonlyArray<ChunkRecord>;
  /** Chunk indexes per doc_id, in page order. */
  chunksByDoc: ReadonlyMap<string, number[]>;
  body: Bm25Field;
  head: Bm25Field;
  parameters: ReadonlyArray<ParameterRecord>;
  /** Distinct endpoints in index order. */
  endpoints: ReadonlyArray<string>;
}

/**
 * The index file next to this module: `../data/` next to the bundled `dist/index.js`
 * (the Docker image) and `../../data/` when running from `src/` under
 * tsx or vitest. `NBAI_DOCS_INDEX` overrides it (tests and experiments).
 */
export function bundledIndexPath(): string | undefined {
  const override = process.env.NBAI_DOCS_INDEX?.trim();
  if (override) return override;
  for (const relative of ['../data/docs-index.json', '../../data/docs-index.json']) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function buildDocsIndex(file: DocsIndexFile): DocsIndex {
  const pages = new Map(file.pages.map((p) => [p.doc_id, p] as const));
  const chunksByDoc = new Map<string, number[]>();
  const bodyDocs: string[][] = [];
  const headDocs: string[][] = [];
  file.chunks.forEach((chunk, index) => {
    const list = chunksByDoc.get(chunk.doc_id) ?? [];
    list.push(index);
    chunksByDoc.set(chunk.doc_id, list);
    const page = pages.get(chunk.doc_id);
    bodyDocs.push(tokenize(chunk.text));
    headDocs.push(tokenize([page?.title ?? '', page?.api ?? '', ...chunk.heading_path].join(' ')));
  });
  return {
    meta: file.meta,
    pages,
    pageList: file.pages,
    chunks: file.chunks,
    chunksByDoc,
    body: new Bm25Field(bodyDocs),
    head: new Bm25Field(headDocs),
    parameters: file.parameters,
    endpoints: [...new Set(file.parameters.map((p) => p.endpoint))],
  };
}

export function loadDocsIndex(path: string): DocsIndex {
  const file = JSON.parse(readFileSync(path, 'utf8')) as DocsIndexFile;
  if (file.meta?.format !== 2) throw new Error(`unsupported documentation index format in ${path}`);
  return buildDocsIndex(file);
}

export interface DocsIndexOptions {
  /** Rebuild from this repository (hosted mode). Absent = the bundled file only. */
  github?: GitHubDocsSource;
  /** Fall back to the bundled file when GitHub is unreachable (default true). */
  allowBundled?: boolean;
}

export type DocsOrigin = 'github' | 'bundled' | 'none';

let options: DocsIndexOptions = {};
let cached: DocsIndex | undefined;
let origin: DocsOrigin = 'none';
let firstBuild: Promise<void> | undefined;
let checking: Promise<RefreshOutcome> | undefined;
let lastError: string | undefined;

export interface RefreshOutcome {
  status: 'rebuilt' | 'unchanged' | 'failed' | 'disabled';
  error?: string;
}

/** Sets the source. Clears any loaded index (tests, start-up). */
export function configureDocsIndex(next: DocsIndexOptions): void {
  options = next;
  cached = undefined;
  origin = 'none';
  firstBuild = undefined;
  checking = undefined;
  lastError = undefined;
}

/** Version facts for /healthz and logs. */
export function docsIndexInfo(): {
  origin: DocsOrigin;
  commit_sha?: string;
  docs_updated_at?: string;
  last_error?: string;
} {
  return {
    origin,
    ...(cached
      ? { commit_sha: cached.meta.commit_sha, docs_updated_at: cached.meta.docs_updated_at }
      : {}),
    ...(lastError ? { last_error: lastError } : {}),
  };
}

async function rebuildFromGitHub(github: GitHubDocsSource): Promise<void> {
  const started = Date.now();
  const snapshot = await fetchSnapshot(github);
  const { index, problems, skipped } = buildDocsIndexFile({
    files: snapshot.files,
    commitSha: snapshot.commitSha,
    docsUpdatedAt: snapshot.commitDate ?? new Date().toISOString(),
  });
  if (problems.length > 0) {
    throw new Error(`index integrity: ${problems.length} problem(s), first: ${problems[0]}`);
  }
  cached = buildDocsIndex(index);
  origin = 'github';
  lastError = undefined;
  logInfo(
    `documentation index: rebuilt from ${github.repo}@${snapshot.commitSha.slice(0, 7)} ` +
      `(${index.pages.length} pages, ${skipped.length} excluded) in ${Date.now() - started} ms`,
  );
}

/**
 * Checks whether the docs repository moved and rebuilds when it did. Concurrent calls
 * share one check. Never throws; failures are logged and reported in the outcome and on
 * /healthz, and the previous index stays in service.
 */
export function refreshDocsIndex(): Promise<RefreshOutcome> {
  if (checking) return checking;
  const github = options.github;
  if (!github) return Promise.resolve({ status: 'disabled' });
  const run = (async (): Promise<RefreshOutcome> => {
    try {
      const known = origin === 'github' ? cached?.meta.commit_sha : undefined;
      const head = await latestCommit(github, known);
      if (!head.changed) return { status: 'unchanged' };
      await rebuildFromGitHub(github);
      return { status: 'rebuilt' };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logError(`documentation index: could not refresh from ${github.repo}`, lastError);
      return { status: 'failed', error: lastError };
    } finally {
      checking = undefined;
    }
  })();
  checking = run;
  return run;
}

/**
 * Hosted start-up: build from GitHub once; fall back to the bundled copy if that fails so
 * the service still starts. Returns when an index (of either origin) is in place.
 */
export function startDocsIndex(): Promise<void> {
  firstBuild ??= (async () => {
    const outcome = await refreshDocsIndex();
    if (outcome.status === 'rebuilt' || cached) return;
    loadBundledFallback(outcome.error);
  })();
  return firstBuild;
}

function loadBundledFallback(reason?: string): void {
  const bundled = options.allowBundled === false ? undefined : bundledIndexPath();
  if (!bundled) {
    throw new DocsUnavailableError(reason);
  }
  cached = loadDocsIndex(bundled);
  origin = 'bundled';
  if (reason) {
    logError(
      `documentation index: using the bundled copy (${cached.meta.commit_sha.slice(0, 7)}) until GitHub is reachable`,
    );
  }
}

/** The process-wide index. Without a GitHub source: the bundled file. Otherwise see startDocsIndex. */
export async function getDocsIndex(): Promise<DocsIndex> {
  if (cached) return cached;
  if (options.github) {
    await startDocsIndex();
    if (cached) return cached;
    throw new DocsUnavailableError(lastError);
  }
  loadBundledFallback();
  return cached!;
}

/** Thrown by the documentation tools when no index could be obtained at all. */
export class DocsUnavailableError extends Error {
  constructor(reason?: string) {
    super(
      'The documentation is not available right now' +
        (reason ? ` (${reason})` : '') +
        '. The API tools are unaffected; please try again in a few minutes.',
    );
    this.name = 'DocsUnavailableError';
  }
}
