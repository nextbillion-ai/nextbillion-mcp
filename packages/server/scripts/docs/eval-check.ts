/**
 * Validates the documentation eval set (docs/eval/questions.json) without running the
 * server: schema, unique ids, query variants, and that every expected doc_id is a page
 * that the URL mapping publishes. The retrieval runner that drives the built server and
 * reports recall@5 / MRR lands with the search tools (K1); this check keeps the labelled
 * set consistent in the meantime and runs in `npm test` via the unit tests.
 *
 * Usage: tsx scripts/docs/eval-check.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { docIdForPath, mapDocPath, type UrlOverrides } from './mapping.js';

export const QUERY_KINDS = ['sentence', 'keywords', 'paraphrase'] as const;
export const SPLITS = ['tuning', 'held_out'] as const;

export interface EvalQuery {
  kind: (typeof QUERY_KINDS)[number];
  text: string;
}

export interface EvalQuestion {
  id: string;
  split: (typeof SPLITS)[number];
  source: string;
  queries: EvalQuery[];
  expected_doc_ids: string[];
  /** `any` (default): one expected page in the top k is a hit. `all`: every page must be. */
  match?: 'any' | 'all';
  expected_related_tools?: string[];
  notes?: string;
}

export interface EvalSet {
  version: 1;
  k: number;
  questions: EvalQuestion[];
}

export interface EvalCheckResult {
  problems: string[];
  summary: string[];
}

/** Pure validation so the unit tests can reuse it. */
export function checkEvalSet(
  evalSet: EvalSet,
  publishedDocIds: ReadonlySet<string>,
  toolNames: ReadonlySet<string>,
): EvalCheckResult {
  const problems: string[] = [];
  if (evalSet.version !== 1) problems.push(`unsupported version ${String(evalSet.version)}`);
  if (!Number.isInteger(evalSet.k) || evalSet.k < 1) problems.push('k must be a positive integer');
  if (!Array.isArray(evalSet.questions) || evalSet.questions.length === 0) {
    problems.push('questions must be a non-empty array');
    return { problems, summary: [] };
  }

  const ids = new Set<string>();
  const bySplit = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byKind = new Map<string, number>();
  const docs = new Set<string>();
  const allTexts = new Map<string, string>();

  for (const q of evalSet.questions) {
    const where = `question ${q.id}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(q.id)) problems.push(`${where}: id must be kebab-case`);
    if (ids.has(q.id)) problems.push(`${where}: duplicate id`);
    ids.add(q.id);
    if (!SPLITS.includes(q.split)) problems.push(`${where}: split must be tuning or held_out`);
    bySplit.set(q.split, (bySplit.get(q.split) ?? 0) + 1);
    if (typeof q.source !== 'string' || q.source.length === 0)
      problems.push(`${where}: source is required`);
    bySource.set(q.source, (bySource.get(q.source) ?? 0) + 1);

    if (!Array.isArray(q.queries) || q.queries.length < 2 || q.queries.length > 3) {
      problems.push(`${where}: needs 2 to 3 query variants`);
    } else {
      const kinds = new Set<string>();
      for (const query of q.queries) {
        if (!QUERY_KINDS.includes(query.kind))
          problems.push(`${where}: unknown query kind ${query.kind}`);
        if (kinds.has(query.kind))
          problems.push(`${where}: query kind ${query.kind} appears twice`);
        kinds.add(query.kind);
        byKind.set(query.kind, (byKind.get(query.kind) ?? 0) + 1);
        if (typeof query.text !== 'string' || query.text.trim().length < 3) {
          problems.push(`${where}: empty ${query.kind} query`);
        } else {
          const key = query.text.trim().toLowerCase();
          const owner = allTexts.get(key);
          if (owner !== undefined && owner !== q.id)
            problems.push(`${where}: query text duplicates ${owner}`);
          allTexts.set(key, q.id);
        }
      }
      if (!kinds.has('sentence')) problems.push(`${where}: a sentence variant is required`);
    }

    if (!Array.isArray(q.expected_doc_ids) || q.expected_doc_ids.length === 0) {
      problems.push(`${where}: expected_doc_ids must be non-empty`);
    } else {
      for (const docId of q.expected_doc_ids) {
        if (!publishedDocIds.has(docId))
          problems.push(`${where}: ${docId} is not a published page`);
        docs.add(docId);
      }
    }
    if (q.match !== undefined && q.match !== 'any' && q.match !== 'all') {
      problems.push(`${where}: match must be any or all`);
    }
    for (const tool of q.expected_related_tools ?? []) {
      if (!toolNames.has(tool)) problems.push(`${where}: unknown tool ${tool}`);
    }
  }

  const heldOut = bySplit.get('held_out') ?? 0;
  const summary = [
    `${evalSet.questions.length} questions (tuning ${bySplit.get('tuning') ?? 0}, held_out ${heldOut}), k=${evalSet.k}`,
    `variants: ${[...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    `sources: ${[...bySource.entries()].map(([s, n]) => `${s} ${n}`).join(', ')}`,
    `distinct expected pages: ${docs.size}; categories: ${[...new Set([...docs].map((d) => d.split('/')[0]))].sort().join(', ')}`,
  ];
  return { problems, summary };
}

export function loadPublishedDocIds(docsDir: string): Set<string> {
  const overrides = JSON.parse(
    readFileSync(join(docsDir, 'url-overrides.json'), 'utf8'),
  ) as UrlOverrides;
  const files = readFileSync(join(docsDir, 'docs-files.txt'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const ids = new Set<string>();
  for (const file of files) {
    if (mapDocPath(file, overrides).kind === 'url') ids.add(docIdForPath(file));
  }
  return ids;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs');
  const evalSet = JSON.parse(
    readFileSync(join(docsDir, 'eval', 'questions.json'), 'utf8'),
  ) as EvalSet;
  const result = checkEvalSet(
    evalSet,
    loadPublishedDocIds(docsDir),
    new Set(ALL_TOOLS.map((tool) => tool.name)),
  );
  for (const line of result.summary) console.log(line);
  if (result.problems.length > 0) {
    console.error(`\n${result.problems.length} problem(s):`);
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log('eval set is consistent with the published docs and the served tools.');
}
