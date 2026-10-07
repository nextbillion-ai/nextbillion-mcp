import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { checkEvalSet, loadPublishedDocIds, type EvalSet } from '../../scripts/docs/eval-check.js';

const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
const evalSet = JSON.parse(readFileSync(`${docsDir}eval/questions.json`, 'utf8')) as EvalSet;
const published = loadPublishedDocIds(docsDir);
const tools = new Set(ALL_TOOLS.map((tool) => tool.name));

describe('documentation eval set', () => {
  it('is consistent with the published pages and the served tools', () => {
    const result = checkEvalSet(evalSet, published, tools);
    expect(result.problems).toEqual([]);
  });

  it('keeps both splits populated so the held-out gate means something', () => {
    const heldOut = evalSet.questions.filter((q) => q.split === 'held_out').length;
    expect(heldOut).toBeGreaterThanOrEqual(10);
    expect(evalSet.questions.length - heldOut).toBeGreaterThanOrEqual(heldOut);
  });

  it('contains the spec acceptance question for truck height and weight', () => {
    const q = evalSet.questions.find((x) => x.id === 'spec-acceptance-2-truck-height-weight');
    expect(q?.match).toBe('all');
    expect(q?.expected_doc_ids).toEqual([
      'routing/directions-api/examples/directions-for-custom-truck-sizes',
      'routing/directions-api/examples/legal-routes-for-a-given-truck-weight',
    ]);
    expect(q?.expected_related_tools).toContain('directions');
  });
});

describe('checkEvalSet', () => {
  it('rejects unpublished pages, unknown tools and missing variants', () => {
    const broken: EvalSet = {
      version: 1,
      k: 5,
      questions: [
        {
          id: 'bad',
          split: 'tuning',
          source: 'test',
          queries: [{ kind: 'keywords', text: 'only keywords' }],
          expected_doc_ids: ['nowhere/page'],
          expected_related_tools: ['no_such_tool'],
        },
      ],
    };
    const { problems } = checkEvalSet(broken, published, tools);
    expect(problems.some((p) => p.includes('2 to 3 query variants'))).toBe(true);
    expect(problems.some((p) => p.includes('nowhere/page'))).toBe(true);
    expect(problems.some((p) => p.includes('no_such_tool'))).toBe(true);
  });
});
