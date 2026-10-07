/**
 * Retrieval evaluation: drives search_documentation through a real MCP client and scores
 * the labelled questions in docs/eval/questions.json (spec §10).
 *
 * Usage (from packages/server):
 *   tsx scripts/docs/eval-run.ts [--split tuning|held_out|all] [--stdio] [--gate] [--update-baseline] [--json <file>] [--quiet]
 *
 * Default: in-process server over an in-memory transport (fast, deterministic).
 * --stdio spawns the built bundle (dist/index.js) instead, which also proves the shipped
 * artifact finds its data file. --gate applies the CI thresholds on the held-out split:
 * recall@k >= 0.90 and MRR >= 0.75, and no query that was a hit in docs/eval/baseline.json
 * may regress; exit code 1 when not met. --update-baseline rewrites the baseline from this run.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../src/core/server.js';
import { NbClient } from '../../src/nbclient/client.js';
import type { EvalQuestion, EvalSet } from './eval-check.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '../..');

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const split = option('--split') ?? 'all';
const useStdio = args.includes('--stdio');
const gate = args.includes('--gate');
const quiet = args.includes('--quiet');
const jsonOut = option('--json');
const updateBaseline = args.includes('--update-baseline');
const BASELINE = join(serverRoot, 'docs/eval/baseline.json');

interface Baseline {
  updated_at: string;
  hits: Record<string, boolean>;
}

export const GATE = { recall: 0.9, mrr: 0.75 };

interface QueryResult {
  id: string;
  split: string;
  kind: string;
  text: string;
  hit: boolean;
  reciprocalRank: number;
  top: string[];
  expected: string[];
  relatedToolsOk: boolean | undefined;
}

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: 'docs-eval', version: '0.0.0' });
  if (useStdio) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(serverRoot, 'dist/index.js')],
      env: { ...process.env, NBAI_API_KEY: 'docs-eval-dummy-key' },
      stderr: 'ignore',
    });
    await client.connect(transport);
    return { client, close: () => client.close() };
  }
  const nb = new NbClient({
    apiKey: 'docs-eval-dummy-key',
    baseUrl: 'https://localhost.invalid',
    timeoutMs: 1000,
  });
  const server = buildServer(nb, '0.0.0-eval');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => void (await client.close()) };
}

export function score(
  question: EvalQuestion,
  ranked: string[],
  relatedTools: Map<string, string[]>,
): QueryResult[] {
  return question.queries.map((query) => {
    const distinct = [...new Set(ranked)];
    const ranks = question.expected_doc_ids
      .map((id) => distinct.indexOf(id))
      .filter((r) => r >= 0)
      .sort((a, b) => a - b);
    const hit =
      question.match === 'all'
        ? ranks.length === question.expected_doc_ids.length
        : ranks.length > 0;
    const reciprocalRank = ranks.length === 0 ? 0 : 1 / (ranks[0]! + 1);
    let relatedToolsOk: boolean | undefined;
    if (question.expected_related_tools && hit) {
      relatedToolsOk = question.expected_related_tools.every((tool) =>
        question.expected_doc_ids.some((id) => (relatedTools.get(id) ?? []).includes(tool)),
      );
    }
    return {
      id: question.id,
      split: question.split,
      kind: query.kind,
      text: query.text,
      hit,
      reciprocalRank,
      top: distinct,
      expected: question.expected_doc_ids,
      relatedToolsOk,
    };
  });
}

function summarize(results: QueryResult[]): { n: number; recall: number; mrr: number } {
  const n = results.length;
  if (n === 0) return { n, recall: 0, mrr: 0 };
  return {
    n,
    recall: results.filter((r) => r.hit).length / n,
    mrr: results.reduce((a, r) => a + r.reciprocalRank, 0) / n,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const evalSet = JSON.parse(
    readFileSync(join(serverRoot, 'docs/eval/questions.json'), 'utf8'),
  ) as EvalSet;
  const questions = evalSet.questions.filter((q) => split === 'all' || q.split === split);
  const { client, close } = await connect();
  const results: QueryResult[] = [];
  const started = performance.now();
  try {
    for (const question of questions) {
      const perQuery: string[][] = [];
      const related = new Map<string, string[]>();
      for (const query of question.queries) {
        const response = await client.callTool({
          name: 'search_documentation',
          arguments: { query: query.text, limit: evalSet.k },
        });
        const structured = response.structuredContent as {
          results?: Array<{ doc_id: string; related_tools: string[] }>;
        };
        const hits = structured.results ?? [];
        perQuery.push(hits.map((h) => h.doc_id));
        for (const hit of hits) related.set(hit.doc_id, hit.related_tools);
      }
      question.queries.forEach((_, i) => {
        results.push(
          ...score({ ...question, queries: [question.queries[i]!] }, perQuery[i]!, related),
        );
      });
    }
  } finally {
    await close();
  }
  const elapsed = performance.now() - started;

  const report: Record<string, { n: number; recall: number; mrr: number }> = {};
  for (const s of ['tuning', 'held_out']) {
    const subset = results.filter((r) => r.split === s);
    if (subset.length > 0) report[s] = summarize(subset);
    for (const kind of ['sentence', 'keywords', 'paraphrase']) {
      const byKind = subset.filter((r) => r.kind === kind);
      if (byKind.length > 0) report[`${s}/${kind}`] = summarize(byKind);
    }
  }
  report.all = summarize(results);

  if (!quiet) {
    console.log(
      `search_documentation over ${useStdio ? 'stdio (dist/index.js)' : 'in-memory transport'}, k=${evalSet.k}, ${results.length} queries in ${Math.round(elapsed)} ms`,
    );
    console.log('');
    console.log('| subset | queries | recall@k | MRR |');
    console.log('| --- | --- | --- | --- |');
    for (const [name, s] of Object.entries(report))
      console.log(`| ${name} | ${s.n} | ${pct(s.recall)} | ${s.mrr.toFixed(3)} |`);
    const misses = results.filter((r) => !r.hit);
    if (misses.length > 0) {
      console.log(`\n${misses.length} miss(es):`);
      for (const m of misses) {
        console.log(
          `- [${m.split}/${m.kind}] ${m.id}: "${m.text}"\n    expected ${m.expected.join(', ')}\n    got      ${m.top.slice(0, evalSet.k).join(', ') || '(none)'}`,
        );
      }
    }
    const toolMisses = results.filter((r) => r.relatedToolsOk === false);
    if (toolMisses.length > 0) {
      console.log(
        `\n${toolMisses.length} related_tools mismatch(es): ${[...new Set(toolMisses.map((r) => r.id))].join(', ')}`,
      );
    }
  }
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ report, results }, null, 2)}\n`);

  const hits: Record<string, boolean> = {};
  for (const r of results) hits[`${r.id}/${r.kind}`] = r.hit;
  if (updateBaseline) {
    const baseline: Baseline = { updated_at: new Date().toISOString().slice(0, 10), hits };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`baseline written: ${Object.keys(hits).length} queries`);
  }
  let regressions: string[] = [];
  if (gate && existsSync(BASELINE) && !updateBaseline) {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    regressions = Object.entries(baseline.hits)
      .filter(([key, wasHit]) => wasHit && hits[key] === false)
      .map(([key]) => key);
  }

  if (gate) {
    const held = report.held_out;
    if (held === undefined) {
      console.error('gate: no held_out questions were evaluated');
      process.exit(1);
    }
    const ok = held.recall >= GATE.recall && held.mrr >= GATE.mrr && regressions.length === 0;
    console.log(
      `\ngate on held_out: recall@k ${pct(held.recall)} (>= ${pct(GATE.recall)}), MRR ${held.mrr.toFixed(3)} (>= ${GATE.mrr}), regressions ${regressions.length} -> ${ok ? 'PASS' : 'FAIL'}`,
    );
    for (const key of regressions) console.log(`- regressed: ${key}`);
    if (!ok) process.exit(1);
  }
}

await main();
