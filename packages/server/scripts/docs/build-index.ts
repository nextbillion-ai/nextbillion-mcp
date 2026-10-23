/**
 * Builds the packed documentation index from a local clone of nb-public-docs.
 *
 * Usage (from packages/server):
 *   tsx scripts/docs/build-index.ts --docs <clone> [--out data/docs-index]
 *
 * The clone must be at the commit pinned in docs/docs-pin.json (run
 * `npm run docs:validate -- --docs <clone> --fetch-sitemap --write` first). Only pages the
 * URL mapping publishes are indexed. The output is deterministic for a given docs commit.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunkSection,
  hasUnbalancedFence,
  headingAnchor,
  mergeTinyChunks,
  parseBlocks,
  splitSections,
} from '../../src/docs/markdown.js';
import type {
  ChunkRecord,
  DocsIndexManifest,
  DocsIndexFile,
  PageRecord,
  ParameterRecord,
  SectionRecord,
} from '../../src/docs/types.js';
import { docIdForPath, mapDocPath, type UrlOverrides } from './mapping.js';
import { pageMeta } from './page-meta.js';
import { dedupe, extractParameters, missingUnitsReport } from './parameters.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '../..');
const docsDir = join(serverRoot, 'docs');

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const fail = (message: string): never => {
  console.error(`build-index: ${message}`);
  process.exit(1);
};

const docsClone = option('--docs') ?? fail('--docs <clone> is required');
const outDir = resolve(serverRoot, option('--out') ?? 'data/docs-index');

const git = (gitArgs: string[]): string =>
  execFileSync('git', gitArgs, { cwd: docsClone, encoding: 'utf8' }).trim();
const pin = JSON.parse(readFileSync(join(docsDir, 'docs-pin.json'), 'utf8')) as {
  commit: string;
  commit_date: string;
};
const head = git(['rev-parse', 'HEAD']);
if (head !== pin.commit) {
  fail(
    `clone is at ${head.slice(0, 7)} but docs-pin.json pins ${pin.commit.slice(0, 7)}; ` +
      'run `npm run docs:validate -- --docs <clone> --fetch-sitemap --write` first',
  );
}
if (git(['status', '--porcelain']).length > 0) fail('clone has uncommitted changes');

const overrides = JSON.parse(
  readFileSync(join(docsDir, 'url-overrides.json'), 'utf8'),
) as UrlOverrides;
const files = readFileSync(join(docsDir, 'docs-files.txt'), 'utf8')
  .split('\n')
  .filter((line) => line.length > 0);

const pages: PageRecord[] = [];
const chunks: ChunkRecord[] = [];
const problems: string[] = [];
const rawParameters: ParameterRecord[] = [];
const PAGE_PRIORITY: Record<string, number> = { reference: 0, guide: 1, example: 2 };

for (const file of files) {
  const mapped = mapDocPath(file, overrides);
  if (mapped.kind !== 'url') continue;
  const docId = docIdForPath(file);
  const markdown = readFileSync(join(docsClone, file), 'utf8');
  const blocks = parseBlocks(markdown);
  const sections = splitSections(blocks);
  const meta = pageMeta(file);

  const title =
    blocks.find((b) => b.kind === 'heading' && b.level === 1)?.heading ??
    file.split('/').pop()!.replace(/\.md$/i, '');
  const outline: SectionRecord[] = sections
    .filter((s) => s.level > 0)
    .map((s) => ({
      heading: s.headingPath[s.headingPath.length - 1] ?? '',
      level: s.level,
      anchor: headingAnchor(s.headingPath[s.headingPath.length - 1] ?? ''),
    }));

  const pageChunks: ChunkRecord[] = [];
  for (const chunk of mergeTinyChunks(sections.flatMap((section) => chunkSection(section)))) {
    pageChunks.push({
      chunk_id: `${docId}#${pageChunks.length}`,
      doc_id: docId,
      chunk_type: chunk.chunkType,
      heading_path: chunk.headingPath,
      text: chunk.text,
    });
  }

  // Integrity: lossless join, no split fence, no split table.
  const rejoined = pageChunks.map((c) => c.text).join('\n');
  if (rejoined !== markdown.replace(/\r\n?/g, '\n'))
    problems.push(`${file}: chunks do not rejoin to the page`);
  for (const chunk of pageChunks) {
    if (hasUnbalancedFence(chunk.text)) problems.push(`${chunk.chunk_id}: unbalanced code fence`);
  }
  for (let i = 1; i < pageChunks.length; i += 1) {
    const prevLast = pageChunks[i - 1]!.text.split('\n').pop() ?? '';
    const first = pageChunks[i]!.text.split('\n')[0] ?? '';
    if (/^\s*\|/.test(prevLast) && /^\s*\|/.test(first))
      problems.push(`${pageChunks[i]!.chunk_id}: table split`);
  }

  const pageRecord: PageRecord = {
    doc_id: docId,
    title,
    category: meta.category,
    api: meta.api,
    ...(meta.sdk ? { sdk: meta.sdk } : {}),
    page_type: meta.page_type,
    source_url: mapped.url,
    path: file,
    sections: outline,
  };
  pages.push(pageRecord);
  chunks.push(...pageChunks);
  if (meta.page_type !== 'example' && meta.sdk === undefined) {
    rawParameters.push(...extractParameters(pageRecord, markdown));
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} integrity problem(s):`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}

const priority = (docId: string): number =>
  PAGE_PRIORITY[pages.find((p) => p.doc_id === docId)?.page_type ?? 'guide'] ?? 1;
const parameters = dedupe(
  [...rawParameters].sort((a, b) => priority(a.doc_id) - priority(b.doc_id)),
);
const index: DocsIndexFile = {
  meta: {
    format: 2,
    commit_sha: pin.commit,
    built_at: pin.commit_date,
    pages: pages.length,
    chunks: chunks.length,
    parameters: parameters.length,
  },
  pages,
  chunks,
  parameters,
};
writeFileSync(
  join(docsDir, 'reports', 'missing-units-report.md'),
  missingUnitsReport(
    parameters,
    `Generated by \`npm run docs:build-index\` from docs commit ${pin.commit.slice(0, 7)} (${pin.commit_date.slice(0, 10)}). Do not edit by hand.`,
  ),
);
// Written as a directory of parts: plugin directories cap files at 5 MiB and prefer them
// under 256 KiB, and the whole index is several MB. Chunks are packed greedily into parts
// of at most PART_LIMIT bytes in index order, so the output stays deterministic and the
// loader (src/docs/store.ts) rebuilds the exact single-file shape by concatenation.
const PART_LIMIT = 900 * 1024;
const chunkParts: ChunkRecord[][] = [];
let current: ChunkRecord[] = [];
let currentBytes = 2;
for (const chunk of chunks) {
  const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8') + 1;
  if (current.length > 0 && currentBytes + bytes > PART_LIMIT) {
    chunkParts.push(current);
    current = [];
    currentBytes = 2;
  }
  current.push(chunk);
  currentBytes += bytes;
}
if (current.length > 0) chunkParts.push(current);
const partName = (i: number): string => `chunks-${String(i).padStart(2, '0')}.json`;
const manifest: DocsIndexManifest = {
  layout: 'split-v1',
  meta: index.meta,
  parts: {
    pages: 'pages.json',
    parameters: 'parameters.json',
    chunks: chunkParts.map((_, i) => partName(i)),
  },
};
rmSync(outDir, { recursive: true, force: true });
rmSync(`${outDir}.json`, { force: true }); // pre-0.3.3 single-file layout
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
writeFileSync(join(outDir, 'pages.json'), `${JSON.stringify(pages)}\n`);
writeFileSync(join(outDir, 'parameters.json'), `${JSON.stringify(parameters)}\n`);
chunkParts.forEach((part, i) =>
  writeFileSync(join(outDir, partName(i)), `${JSON.stringify(part)}\n`),
);
const json = JSON.stringify(index);
const largest = Math.max(...readdirSync(outDir).map((f) => readFileSync(join(outDir, f)).length));

const byType = new Map<string, number>();
for (const c of chunks) byType.set(c.chunk_type, (byType.get(c.chunk_type) ?? 0) + 1);
const sizes = chunks.map((c) => c.text.length).sort((a, b) => a - b);
const endpoints = new Set(parameters.map((p) => p.endpoint));
console.log(
  `${parameters.length} parameters over ${endpoints.size} endpoints (${parameters.filter((p) => p.units !== null).length} with units); ` +
    `${pages.length} pages, ${chunks.length} chunks (${[...byType.entries()].map(([t, n]) => `${t} ${n}`).join(', ')}), ` +
    `chunk chars median ${sizes[Math.floor(sizes.length / 2)]} p90 ${sizes[Math.floor(sizes.length * 0.9)]} max ${sizes[sizes.length - 1]}, ` +
    `total ${(json.length / 1e6).toFixed(2)} MB in ${chunkParts.length + 3} files (largest ${(largest / 1024).toFixed(0)} KiB) -> ${outDir}`,
);
