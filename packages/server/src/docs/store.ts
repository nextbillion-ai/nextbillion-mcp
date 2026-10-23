/**
 * Loads the packed documentation index once per process and builds the in-memory
 * search structures (spec §7). Sync and lazy: the first documentation tool call pays
 * the load; API tools never touch it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bm25Field } from './bm25.js';
import { tokenize } from './tokenizer.js';
import type {
  ChunkRecord,
  DocsIndexFile,
  DocsIndexManifest,
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
 * Candidate locations of the index relative to this module: `../data/docs-index` next to
 * the bundled `dist/index.js` (npm package, Claude Code plugin, Claude Desktop extension)
 * and `../../data/docs-index` when running from `src/` under tsx or vitest. The index is a
 * directory of JSON parts (see `readDocsIndexFile`) so that no single file exceeds the
 * size limits of plugin directories; a legacy single `docs-index.json` is still accepted.
 */
function defaultIndexPath(): string {
  const override = process.env.NBAI_DOCS_INDEX?.trim();
  if (override) return override;
  for (const relative of [
    '../data/docs-index',
    '../../data/docs-index',
    '../data/docs-index.json',
    '../../data/docs-index.json',
  ]) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('documentation index data/docs-index not found next to the server');
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/**
 * Reads the packed index from `path`: either a directory holding `manifest.json` plus the
 * part files it lists (the committed layout), that manifest file itself, or a legacy
 * single-file index. Parts are concatenated in manifest order, so the result is identical
 * to the single-file form.
 */
export function readDocsIndexFile(path: string): DocsIndexFile {
  const manifestPath = statSync(path).isDirectory() ? join(path, 'manifest.json') : path;
  const dir = statSync(path).isDirectory() ? path : join(path, '..');
  const parsed = readJson<DocsIndexManifest | DocsIndexFile>(manifestPath);
  if ('layout' in parsed) {
    if (parsed.layout !== 'split-v1' || parsed.meta?.format !== 2) {
      throw new Error(`unsupported documentation index layout in ${manifestPath}`);
    }
    return {
      meta: parsed.meta,
      pages: readJson<PageRecord[]>(join(dir, parsed.parts.pages)),
      parameters: readJson<ParameterRecord[]>(join(dir, parsed.parts.parameters)),
      chunks: parsed.parts.chunks.flatMap((part) => readJson<ChunkRecord[]>(join(dir, part))),
    };
  }
  if (parsed.meta?.format !== 2) {
    throw new Error(`unsupported documentation index format in ${manifestPath}`);
  }
  return parsed;
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

export function loadDocsIndex(path: string = defaultIndexPath()): DocsIndex {
  return buildDocsIndex(readDocsIndexFile(path));
}

let cached: DocsIndex | undefined;

/** The process-wide index, loaded on first use. */
export function getDocsIndex(): DocsIndex {
  cached ??= loadDocsIndex();
  return cached;
}

/** Test hook: replace or clear the cached index. */
export function setDocsIndexForTests(index: DocsIndex | undefined): void {
  cached = index;
}
