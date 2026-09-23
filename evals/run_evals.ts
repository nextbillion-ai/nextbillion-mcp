import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MCPClientManager, HostRunner, createEvalRunReporter } from '@mcpjam/sdk';

// ─── Load Environment Variables ──────────────────────────────────────────────
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// Check local .env.evals, .env.evals.example, or .env
loadEnvFile(resolve(process.cwd(), '.env.evals'));
loadEnvFile(resolve(process.cwd(), '.env.evals.example'));
loadEnvFile(resolve(process.cwd(), '.env'));

// ─── Configuration ───────────────────────────────────────────────────────────
const MCPJAM_API_KEY = process.env.MCPJAM_API_KEY;
const MCPJAM_PROJECT_ID = process.env.MCPJAM_PROJECT_ID;
const MODEL = process.env.EVAL_MODEL || 'google/gemini-2.5-flash';
const LLM_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY;

const NBAI_API_KEY = process.env.NBAI_API_KEY;
const SUITE_PATH = resolve(process.cwd(), 'evals/nextbillion_eval_suite.json');

interface TestCase {
  id: string;
  title?: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  expectedTool: string | null;
  expectedArgs?: Record<string, unknown>;
  forbiddenTools?: string[];
  passCriteria: string;
}

interface SuiteDefinition {
  suiteName: string;
  description: string;
  cases: TestCase[];
}

async function main() {
  console.log('\n======================================================');
  console.log(' NextBillion MCP Evaluation Suite Runner (@mcpjam/sdk)');
  console.log('======================================================\n');
  console.log(`Model:           ${MODEL}`);
  console.log(`MCPJam Project:  ${MCPJAM_PROJECT_ID}`);
  console.log(
    `MCPJam Key:      ${MCPJAM_API_KEY ? MCPJAM_API_KEY.slice(0, 10) + '...' : '(none)'}`,
  );
  console.log(`LLM API Key:     ${LLM_API_KEY ? 'Present (configured)' : 'MISSING'}`);

  if (!LLM_API_KEY) {
    console.error('\n[Error] LLM API key not found in environment.');
    console.error('Please export GEMINI_API_KEY or LLM_API_KEY before running:');
    console.error('  export GEMINI_API_KEY="your-gemini-key"\n');
    process.exit(1);
  }

  // Load test suite
  const suiteData: SuiteDefinition = JSON.parse(readFileSync(SUITE_PATH, 'utf-8'));
  const testCases = suiteData.cases;
  console.log(`Loaded ${testCases.length} evaluation cases from: ${SUITE_PATH}\n`);

  // Ensure server bundle exists
  const serverBundlePath = resolve(process.cwd(), 'packages/server/dist/index.js');
  if (!existsSync(serverBundlePath)) {
    console.error(
      `[Error] Server bundle not found at ${serverBundlePath}. Run 'npm run build' first.`,
    );
    process.exit(1);
  }

  // Initialize MCPClientManager and connect to localhost nextbillion-mcp
  console.log('Connecting to localhost NextBillion MCP server via stdio...');
  const manager = new MCPClientManager();
  const SERVER_ID = 'nextbillion-mcp';

  await manager.connectToServer(SERVER_ID, {
    command: 'node',
    args: [serverBundlePath],
    env: {
      ...process.env,
      NBAI_API_KEY: NBAI_API_KEY ?? '',
    },
  });

  console.log('Connected successfully!');
  const tools = await manager.getToolsForAiSdk([SERVER_ID]);
  console.log(`Registered ${Object.keys(tools).length} tools for evaluation.\n`);

  // Initialize HostRunner with system prompt to guide tool invocation
  process.env.AI_SDK_LOG_WARNINGS = 'false';
  const runner = new HostRunner({
    tools,
    model: MODEL,
    apiKey: LLM_API_KEY,
    systemPrompt:
      'You are a geospatial AI assistant for NextBillion.ai. When an inquiry pertains to coordinates, locations, places, addresses, routing, navigation, distance matrices, isochrones, postcodes, or maps, you MUST use the corresponding NextBillion tool. Never fabricate geospatial data without calling a tool. Only respond without tools if the prompt is totally unrelated to geospatial queries (e.g., general knowledge, creative writing).',
    maxSteps: 6,
    mcpClientManager: manager,
  });

  // Initialize MCPJam Reporter if API Key provided
  let reporter: ReturnType<typeof createEvalRunReporter> | undefined;
  if (MCPJAM_API_KEY) {
    try {
      reporter = createEvalRunReporter({
        suiteName: suiteData.suiteName,
        apiKey: MCPJAM_API_KEY,
        project: MCPJAM_PROJECT_ID,
        strict: false,
        serverNames: [SERVER_ID],
        mcpClientManager: manager,
        expectedIterations: testCases.length,
      });
      console.log(`Connected to MCPJam Cloud Reporter for project: ${MCPJAM_PROJECT_ID}\n`);
    } catch (err) {
      console.warn('Could not initialize MCPJam cloud reporter:', err);
    }
  }

  // Run Test Cases
  console.log(
    '-----------------------------------------------------------------------------------------------------',
  );
  console.log(
    '| Status | Case ID                       | Target Tool           | Called Tools             | Time    |',
  );
  console.log(
    '-----------------------------------------------------------------------------------------------------',
  );

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]!;
    const startTime = Date.now();
    let status = 'PASS';
    let calledTools: string[] = [];
    let errorMessage = '';

    try {
      let runResult = await runner.run(tc.prompt, {
        timeout: { totalMs: 35_000, stepMs: 25_000 },
      });

      // Handle rate limit / quota exceeded with backoff retry
      if (runResult.hasError()) {
        const errText = runResult.getError() || '';
        if (
          errText.includes('Quota exceeded') ||
          errText.includes('rate-limit') ||
          errText.includes('Please retry in') ||
          errText.includes('RESOURCE_EXHAUSTED')
        ) {
          const matches = [...errText.matchAll(/Please retry in ([\d\.]+)s/g)];
          let waitSecs = 60;
          if (matches.length > 0) {
            const parsed = matches.map((m) => Math.ceil(parseFloat(m[1])));
            waitSecs = Math.max(...parsed) + 5;
          }
          console.log(
            `\n  └─> [Rate Limit] Waiting ${waitSecs}s for quota window to clear before retrying...`,
          );
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
          runner.resetPromptHistory();
          runResult = await runner.run(tc.prompt, {
            timeout: { totalMs: 45_000, stepMs: 35_000 },
          });
        }
      }

      if (runResult.hasError()) {
        status = 'FAIL';
        errorMessage = `API error: ${runResult.getError()}`;
      } else {
        calledTools = runResult.toolsCalled();

        // Evaluation assertion
        if (tc.expectedTool === null) {
          // Negative test case: no tool should be called
          if (calledTools.length > 0) {
            status = 'FAIL';
            errorMessage = `Expected no tools, but called: ${calledTools.join(', ')}`;
          }
        } else {
          // Positive test case: expected tool must be in calledTools
          if (!calledTools.includes(tc.expectedTool)) {
            status = 'FAIL';
            errorMessage = `Expected '${tc.expectedTool}', but called: ${calledTools.join(', ') || 'none'}`;
          }
        }

        // Disambiguation check: forbidden tools must not be called
        if (tc.forbiddenTools) {
          for (const fb of tc.forbiddenTools) {
            if (calledTools.includes(fb)) {
              status = 'FAIL';
              errorMessage = `Forbidden tool '${fb}' was called`;
            }
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      if (status === 'PASS') passed++;
      else failed++;

      const caseCol = tc.id.padEnd(29, ' ');
      const toolCol = (tc.expectedTool || '(none)').padEnd(21, ' ');
      const calledCol = (calledTools.join(',') || '(none)').slice(0, 24).padEnd(24, ' ');
      const statusLabel = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';

      console.log(
        `| ${statusLabel}   | ${caseCol} | ${toolCol} | ${calledCol} | ${duration.padStart(7, ' ')} |`,
      );
      if (errorMessage) {
        console.log(`  └─> \x1b[31m${errorMessage}\x1b[0m`);
      }

      // Record in MCPJam Cloud Reporter if available
      if (reporter && runResult) {
        try {
          await reporter.recordFromPrompt(runResult, {
            caseTitle: tc.title || tc.description || tc.name,
            caseId: tc.id,
            expectedToolCalls: tc.expectedTool ? [{ toolName: tc.expectedTool }] : [],
            isNegativeTest: tc.expectedTool === null,
          });
        } catch {
          // Non-fatal recording error
        }
      }
    } catch (err: unknown) {
      failed++;
      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      console.log(
        `| \x1b[31mERR \x1b[0m   | ${tc.id.padEnd(29, ' ')} | ${(tc.expectedTool || '').padEnd(21, ' ')} | ${'ERROR'.padEnd(24, ' ')} | ${duration.padStart(7, ' ')} |`,
      );
      console.log(
        `  └─> \x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
      );
    }

    runner.resetPromptHistory();

    // Respect LLM rate limit (140 requests per minute sliding window)
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(
    '-----------------------------------------------------------------------------------------------------\n',
  );
  const total = testCases.length;
  const passRate = ((passed / total) * 100).toFixed(1);
  console.log(`Results: ${passed}/${total} Passed (${passRate}% Pass Rate)`);

  if (reporter && reporter.getAddedCount() > 0) {
    console.log('\nFinalizing and uploading run results to MCPJam Cloud dashboard...');
    try {
      await reporter.finalize();
      console.log(
        `✓ Run data uploaded to: https://app.mcpjam.com/projects/${MCPJAM_PROJECT_ID}/evals`,
      );
    } catch (uploadErr) {
      console.warn('Upload to MCPJam dashboard failed:', uploadErr);
    }
  }

  await manager.disconnectAllServers();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
